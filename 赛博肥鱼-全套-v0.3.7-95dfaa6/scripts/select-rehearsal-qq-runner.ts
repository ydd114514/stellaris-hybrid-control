/** Searches only; never requests play URLs or changes the real account. */
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { MusicTrack } from '../packages/shared/src/index'
import { createQQVault } from '../apps/desktop/electron/qq-vault'
import { createQQMusic } from '../apps/desktop/electron/qq-music'

const projectArg = process.argv.find(value => value.startsWith('--project='))?.slice('--project='.length)
if (!process.argv.includes('--select') || !projectArg) throw new Error('请通过项目的只读QQ选曲脚本显式启动。')
const project = resolve(projectArg), output = join(project, '.local/live-rehearsals/selected-qq-tracks.json')
const runtimeBase = join(project, `.local/live-rehearsals/.select-qq-runtime-${process.pid}`)
for (const folder of [runtimeBase, join(runtimeBase, 'session'), join(runtimeBase, 'crashes'), join(runtimeBase, 'logs')]) mkdirSync(folder, { recursive: true, mode: 0o700 })
app.setName('赛博肥鱼')
app.setPath('userData', runtimeBase)
app.setPath('sessionData', join(runtimeBase, 'session'))
app.setPath('crashDumps', join(runtimeBase, 'crashes'))
app.setAppLogsPath(join(runtimeBase, 'logs'))
app.commandLine.appendSwitch('disable-background-networking')

const queries = [
  { query: '晴天', titles: ['晴天'], artists: ['周杰伦'], instrumental: false },
  { query: '雨的印记', titles: ['雨的印记', 'kisstherain'], artists: ['yiruma', '李闰珉', '李闰民'], instrumental: true },
  { query: '小星星', titles: ['小星星', 'twinkletwinklelittlestar'], artists: [], instrumental: true },
]
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
function score(track: MusicTrack, query: typeof queries[number]) {
  const title = normalize(track.title), artist = normalize(track.artist), full = `${title}${artist}`
  let value = Math.max(...query.titles.map(name => title === name ? 100 : title.includes(name) ? 60 : 0))
  if (query.artists.length) value += query.artists.some(name => artist.includes(name)) ? 100 : -50
  if (query.instrumental && /纯音乐|钢琴|piano|八音盒|instrumental/.test(full)) value += 20
  if (/伴奏|karaoke|翻唱|cover|加速|dj|remix|live|现场/.test(full)) value -= 30
  return value
}
let service: ReturnType<typeof createQQMusic> | undefined
async function run() {
  const sourceDirectory = join(project, '.local/user-data')
  if (!existsSync(join(sourceDirectory, 'qq-music-session.enc.json'))) throw new Error('QQ音乐尚未保存登录，请在主应用扫码后再选曲。')
  const sourceVault = createQQVault(sourceDirectory)
  const secret = sourceVault.secret
  let snapshot = sourceVault.get()
  const previous = process.env.LOG_LEVEL
  let provider: typeof import('@yakult-green-tea/qq-music-api/serverless')
  try { process.env.LOG_LEVEL = 'silent'; provider = await import('@yakult-green-tea/qq-music-api/serverless') }
  finally { if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous }
  let searches = 0
  service = createQQMusic({
    vault: { get: () => snapshot, set(value) { snapshot = value } },
    isAllowed: () => false,
    request: async request => {
      if (request.method !== 'GET' || new URL(request.url).pathname !== '/search' || ++searches > 3) throw new Error('只读选曲仅允许最多3次搜索。')
      return provider.handleRequest(request, { QQ_SESSION_SECRET: secret })
    },
  })
  if (!(await service.status()).loggedIn) throw new Error('保存的QQ登录不可用，请先在主应用确认登录。')
  const selected: MusicTrack[] = []
  for (const query of queries) {
    const result = await service.search(query.query)
    const track = result.tracks.map((track, index) => ({ track, index, score: score(track, query) })).sort((a, b) => b.score - a.score || a.index - b.index).find(item => !selected.some(previous => previous.id === item.track.id))?.track
    if (track) {
      selected.push({ id: track.id, title: track.title, artist: track.artist, source: track.source, ...(track.duration ? { duration: track.duration } : {}) })
      console.log(`已选：${track.title} / ${track.artist}`)
    } else console.log(`未找到：${query.query}；不会伪造曲目。`)
  }
  if (!selected.length) throw new Error('QQ搜索没有返回可选歌曲，请在主应用核对登录和网络。')
  const temporary = `${output}.tmp`
  await writeFile(temporary, JSON.stringify(selected, null, 2), { mode: 0o600 })
  await rename(temporary, output)
  console.log(`已保存${selected.length}首安全曲目资料，仅搜索，未获取音频或修改真实账号。`)
  console.log(`曲目文件：${output}`)
  if (selected.length < 3) process.exitCode = 1
}
void app.whenReady().then(run).catch(() => {
  console.error('只读QQ选曲未完成，请核对主应用QQ登录、钥匙串和网络；未更改真实账号或伪造曲目。')
  process.exitCode = 1
}).finally(async () => { service?.dispose(); await rm(runtimeBase, { recursive: true, force: true }).catch(() => undefined); app.exit(Number(process.exitCode) || 0) })
