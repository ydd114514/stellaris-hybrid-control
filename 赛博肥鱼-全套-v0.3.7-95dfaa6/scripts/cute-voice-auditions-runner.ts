/** No automatic synthesis. Only one voice-enrollment request returns the preview. */
import { app, safeStorage } from 'electron'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import plan from './cute-voice-auditions-plan.json'

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || ''
const project = resolve(argument('project')), output = resolve(argument('output'))
const outputRoot = join(project, '.local', 'cute-voice-auditions')
const workspace = argument('workspace')
const sample = plan.directions.find(value => value.id === argument('sample'))
if (!process.argv.includes('--generate') || !argument('project') || !argument('output') || !output.startsWith(`${outputRoot}${sep}`) || !/^[a-zA-Z0-9-]{1,100}$/.test(workspace) || !sample) throw new Error('请通过项目的幼态声音试听脚本显式启动。')
const chosen = sample
const runtimeBase = join(output, '.runtime')
for (const directory of [runtimeBase, join(runtimeBase, 'session'), join(runtimeBase, 'crashes'), join(runtimeBase, 'logs')]) mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setName('赛博肥鱼')
app.setPath('userData', runtimeBase)
app.setPath('sessionData', join(runtimeBase, 'session'))
app.setPath('crashDumps', join(runtimeBase, 'crashes'))
app.setAppLogsPath(join(runtimeBase, 'logs'))
app.commandLine.appendSwitch('disable-background-networking')

const maximumAudioBytes = 10 * 1024 * 1024
const maximumResponseBytes = Math.ceil(maximumAudioBytes * 4 / 3) + 16384
const controller = new AbortController()
let requestCount = 0
const manifest: Record<string, unknown> = {
  createdAt: new Date().toISOString(), sample: { id: chosen.id, name: chosen.name, prompt: chosen.prompt }, text: plan.text,
  targetModel: plan.targetModel, sources: plan.sources, status: 'pending', maxDesignCalls: 1, designCalls: 0, synthesisCalls: 0,
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const save = async () => {
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  const player = manifest.status === 'ok' ? `<audio controls preload="none" src="${escape(manifest.file)}"></audio>` : `<p>${escape(manifest.message || '等待生成')}</p>`
  await writeFile(join(output, '试听.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:"><title>大肥鱼·可爱动漫声线</title><style>body{max-width:780px;margin:60px auto;padding:25px;color:#f2ead4;background:#11231f;font:18px/1.8 system-ui}article{background:#1c332b;padding:28px;border-radius:20px}audio{display:block;width:100%;margin:25px 0}small{color:#b9cbb9}</style><article><h1>${escape(chosen.id)} · ${escape(chosen.name)}</h1><p>${escape(plan.text)}</p>${player}<p>${escape(chosen.prompt)}</p><small>模型：${escape(plan.targetModel)}。仅保存声音设计接口直接返回的预览，不修改当前直播配置。</small></article></html>`, { mode: 0o600 })
}
async function jsonBounded(response: Response): Promise<Record<string, any>> {
  if (!response.body || Number(response.headers.get('content-length') || 0) > maximumResponseBytes) throw new Error('AUDIO_FORMAT')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumResponseBytes) throw new Error('AUDIO_FORMAT')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch { await reader.cancel().catch(() => undefined); throw new Error('AUDIO_FORMAT') }
  finally { reader.releaseLock() }
}
function wavPreview(audio: any): { bytes: Buffer; durationSeconds?: number } {
  if (!audio || audio.response_format !== 'wav' || audio.sample_rate !== 24000 || typeof audio.data !== 'string' || audio.data.length > Math.ceil(maximumAudioBytes * 4 / 3) + 100 || !/^[A-Za-z0-9+/=\r\n]+$/.test(audio.data)) throw new Error('AUDIO_FORMAT')
  const bytes = Buffer.from(audio.data, 'base64')
  if (bytes.length < 44 || bytes.length > maximumAudioBytes || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('AUDIO_FORMAT')
  let byteRate = 0, dataLength = 0
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.subarray(offset, offset + 4).toString(), length = bytes.readUInt32LE(offset + 4)
    if (offset + 8 + length > bytes.length) throw new Error('AUDIO_FORMAT')
    if (kind === 'fmt ' && length >= 16) byteRate = bytes.readUInt32LE(offset + 16)
    if (kind === 'data') dataLength += length
    offset += 8 + length + length % 2
  }
  if (!dataLength) throw new Error('AUDIO_FORMAT')
  return { bytes, ...(byteRate ? { durationSeconds: +(dataLength / byteRate).toFixed(2) } : {}) }
}
function failure(error: unknown): string {
  const value = error instanceof Error ? error.message : ''
  if (value === 'AUTH') return '无法使用本项目千问密钥，请检查钥匙串、北京地域和服务权限。未自动重试。'
  if (value === 'RATE') return '声音设计额度不足或请求受限，已停止；未自动重试。'
  if (value === 'NETWORK' || controller.signal.aborted) return '声音设计网络连接失败或超时，已停止；创建结果可能尚待核对，未自动重试。'
  if (value === 'PROVIDER') return '声音设计服务未成功返回，请核对模型和业务空间。未自动重试。'
  if (value === 'AUDIO_FORMAT') return '接口返回的预览音频格式不符，已保留取得的音色ID；没有追加合成或自动重试。'
  return '本次声音设计未完成，请检查本项目配置和输出目录。未自动重试。'
}
async function run() {
  if (chosen.prompt.length > 500 || plan.text.length < 15 || plan.text.length > 200 || !/^qwen-audio-3\.1-tts-(flash|plus)$/.test(plan.targetModel) || !/^[A-Za-z0-9]{1,10}$/.test(chosen.prefix)) throw new Error('PLAN')
  await save()
  if (!safeStorage.isEncryptionAvailable()) throw new Error('AUTH')
  // Read only this project's encrypted Qwen entry. No config, cookie, or other project is read.
  let apiKey = ''
  try {
    const record = JSON.parse(await readFile(join(project, '.local/user-data/credentials.enc.json'), 'utf8'))
    if (typeof record.qwen !== 'string') throw new Error('AUTH')
    apiKey = safeStorage.decryptString(Buffer.from(record.qwen, 'base64'))
    if (!apiKey.trim()) throw new Error('AUTH')
  } catch { throw new Error('AUTH') }
  const timeout = setTimeout(() => controller.abort(), 120000)
  try {
    if (++requestCount > 1) throw new Error('PLAN')
    manifest.designCalls = requestCount
    await save()
    const endpoint = `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'create_voice', target_model: plan.targetModel, voice_prompt: chosen.prompt, preview_text: plan.text, prefix: chosen.prefix, language_hints: ['zh'] }, parameters: { sample_rate: 24000, response_format: 'wav' } }),
      })
    } catch { throw new Error('NETWORK') }
    if (!response.ok) { void response.body?.cancel(); throw new Error(response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE' : 'PROVIDER') }
    const body = await jsonBounded(response)
    if (body.code || body.error) throw new Error('PROVIDER')
    const result = body.output || {}
    const voice = result.voice_id || result.voice
    if (typeof voice !== 'string' || !voice || voice.length > 256 || !/^[A-Za-z0-9_.-]+$/.test(voice)) throw new Error('PROVIDER')
    manifest.voice = voice
    if (result.target_model && result.target_model !== plan.targetModel) throw new Error('PROVIDER')
    const preview = wavPreview(result.preview_audio)
    const filename = `${chosen.id}-${chosen.name}-${plan.targetModel}.wav`
    await writeFile(join(output, filename), preview.bytes, { mode: 0o600 })
    manifest.file = filename; manifest.bytes = preview.bytes.length; manifest.durationSeconds = preview.durationSeconds; manifest.status = 'ok'
    manifest.usage = typeof body.usage?.count === 'number' ? { count: body.usage.count } : undefined
    await save()
    console.log(`${chosen.id}「${chosen.name}」预览已保存；设计请求1次、追加合成0次。`)
    console.log(`试听文件：${join(output, filename)}`)
    console.log(`试听页面：${join(output, '试听.html')}`)
  } finally { clearTimeout(timeout); apiKey = '' }
}
process.on('SIGINT', () => controller.abort())
process.on('SIGTERM', () => controller.abort())
void app.whenReady().then(run).catch(async error => {
  manifest.status = 'failed'; manifest.message = failure(error)
  console.error(manifest.message)
  await save().catch(() => undefined); process.exitCode = 1
}).finally(async () => { await rm(runtimeBase, { recursive: true, force: true }).catch(() => undefined); app.exit(Number(process.exitCode) || 0) })
