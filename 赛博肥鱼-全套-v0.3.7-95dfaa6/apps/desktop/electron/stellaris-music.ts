import { randomUUID,createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createJukebox, validateTracks, musicLibraryFull } from '../../../packages/core/src/jukebox'
import { MUSIC_LIBRARY_LIMIT, MUSIC_QUEUE_DEFAULT, MUSIC_QUEUE_LIMIT } from '../../../packages/shared/src/music-limits'
import { safeError } from './qq-music'
import { DEFAULT_BGM_TRACKS } from '../../../packages/core/src/music-defaults'
import {MUSIC_DENY_TERMS,musicDenied,parseMusicBlacklist,assessMusic} from '../../../packages/core/src/music-policy'
import type { AppConfig, LiveEvent, MusicState, MusicTrack, QQMusicLogin, QQMusicStatus } from '../../../packages/shared/src/index'
import type { createQQMusic } from './qq-music'

type Provider = Pick<ReturnType<typeof createQQMusic>, 'status' | 'loginStart' | 'loginPoll' | 'resolve' | 'lyrics' | 'stream' | 'dispose'>
export function createStellarisMusic(options: { directory: string; disabled?: boolean; provider(isAllowed: (mid: string) => boolean): Promise<Provider> }) {
  const state: MusicState = { tracks: DEFAULT_BGM_TRACKS.map(x => ({ ...x })), queue: [], searches: [], status: 'stopped', skipVotes: [], activeViewers: 0, skipRequired: 3, lastMessage: '音乐已停止；点击开启后才播放。', messageAt: Date.now() }
  const config: AppConfig['music'] = { enabled: true, qqAutoSearch: true, bgmEnabled: true, bgmTrackIds: DEFAULT_BGM_TRACKS.map(x => x.id), requestPolicy: 'open', userCooldownSeconds: 120, globalCooldownSeconds: 3, maxQueue: MUSIC_QUEUE_DEFAULT, minPlaySeconds: 30, skipMinVotes: 3, skipRatio: .5, blockedTracks: [], autoStart: true }
  let enabled = false, disposed = false, epoch = 0, busy = false, volume = .22, recoverAt = 0
  let blacklist:string[]=[]
  const screened=new Map<string,{allowed:boolean;reason:string;expires:number}>()
  const screening=new Map<string,Promise<{allowed:boolean;reason:string;expires:number}>>()
  const policyKey=(track:MusicTrack)=>createHash('sha256').update(JSON.stringify(['lyrics-rules-1',MUSIC_DENY_TERMS,blacklist,track.id,track.title,track.artist])).digest('hex')
  let qq: Provider | undefined, loading: Promise<Provider> | undefined
  let account: QQMusicStatus = { loggedIn: false, loginPending: false, message: '点击连接 QQ 音乐读取本机登录。' }
  const viewers = new Map<string, { id: string; name: string; visits: number; blocked: boolean; seen: number }>()
  const seen = new Set<string>()
  const current = () => state.tracks.find(x => x.id === state.current?.trackId)
  const isAllowed = (mid: string) => enabled && !disposed && !!current() && !musicDenied(current()!,blacklist) && screened.get(policyKey(current()!))?.allowed===true && current()?.source === `shop-qqmusic://track/${mid}`
  const jukebox = createJukebox({ state, config: () => config, now: Date.now, id: randomUUID, canStart: () => enabled && !disposed,
    resolve: async (query, signal) => { if (!qq) throw new Error('请先连接 QQ 音乐。'); const track=await qq.resolve(query,signal);const verdict=await checkTrack(track,signal);if(!verdict.allowed)throw new Error('这首歌已被拦截：'+verdict.reason);return track }, viewer: id => viewers.get(id) })
  const file = join(options.directory, 'stellaris-music.json')
  let saving: Promise<unknown> = Promise.resolve()
  const loaded = options.disabled ? Promise.resolve() : readFile(file, 'utf8').then(text => {
    const data = JSON.parse(text)
    blacklist=parseMusicBlacklist(typeof data.blacklist==='string'?data.blacklist:'')
    const tracks = validateTracks(data.tracks).filter(x=>!musicDenied(x,blacklist))
    if (tracks.some(x => !/^shop-qqmusic:\/\/track\/[A-Za-z0-9]{1,64}$/.test(x.source))) return
    if (disposed) return
    if(Array.isArray(data.screening))for(const [key,value] of data.screening.slice(-500)) {
      if(typeof key==='string'&&/^[0-9a-f]{64}$/.test(key)&&typeof value?.allowed==='boolean'&&typeof value.reason==='string'&&value.reason.length<=100&&value.expires>Date.now()&&value.expires<Date.now()+8*86400000)screened.set(key,value)
    }
    state.tracks = tracks
    config.bgmTrackIds = Array.isArray(data.bgmTrackIds) ? data.bgmTrackIds.filter((id: unknown) => typeof id === 'string' && tracks.some(t => t.id === id)) : tracks.map(t => t.id)
    if (typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 1) volume = data.volume
    if (Number.isInteger(data.maxQueue) && data.maxQueue >= 1 && data.maxQueue <= MUSIC_QUEUE_LIMIT) config.maxQueue = data.maxQueue
  }).catch(() => undefined)
  function save() {
    const text = JSON.stringify({ tracks: state.tracks, bgmTrackIds: config.bgmTrackIds, maxQueue: config.maxQueue, volume,blacklist:blacklist.join('\n'),screening:[...screened].slice(-500) })
    saving = saving.catch(() => undefined).then(async () => { await mkdir(options.directory, { recursive: true }); await writeFile(file, text) })
    return saving
  }
  async function provider() {
    if (options.disabled || disposed) throw new Error('离线测试不读取 QQ 登录或访问网络。')
    if (qq) return qq
    if (!loading) loading = options.provider(isAllowed).then(value => { if (disposed) { value.dispose(); throw new Error('音乐已关闭。') }; qq = value; return value }).finally(() => { loading = undefined })
    return loading
  }
  async function view() {
    await loaded
    // The player polls this even with the settings tab closed. Recover a failed
    // background list at most once a minute, only while explicitly enabled.
    if(!enabled||disposed||state.current||state.queue.length||state.searches.length)recoverAt=0
    else if(config.bgmTrackIds.length){
      if(!recoverAt)recoverAt=Date.now()+60000
      else if(Date.now()>=recoverAt){recoverAt=Date.now()+60000;jukebox.retryBackground()}
    }
    return { localTest: !!options.disabled, enabled, volume, maxQueue: config.maxQueue, account: { ...account }, state: structuredClone(state), bgmTrackIds: [...config.bgmTrackIds],blacklist:[...blacklist],builtInBlacklist:[...MUSIC_DENY_TERMS],reviewedLibraryOnly:false }
  }
  async function checkTrack(track:MusicTrack,signal?:AbortSignal) {
    if(musicDenied(track,blacklist))return {allowed:false,reason:'国歌／政治相关或自定义黑名单',expires:Date.now()+7*86400000}
    const key=policyKey(track),cached=screened.get(key)
    if(cached&&cached.expires>Date.now())return cached
    let job=screening.get(key)
    if(!job){job=(async()=>{
      if(!qq)throw new Error('QQ音乐未连接')
      const mid=/^shop-qqmusic:\/\/track\/([A-Za-z0-9]{1,64})$/.exec(track.source)?.[1]
      if(!mid)throw new Error('歌曲来源无效')
      const lyrics=await qq.lyrics(mid,signal),result={...assessMusic(track,lyrics,blacklist),expires:Date.now()+7*86400000}
      if(disposed||signal?.aborted||key!==policyKey(track))throw new Error('歌曲检查已取消')
      screened.set(key,result);while(screened.size>500)screened.delete(screened.keys().next().value!)
      await save();return result
    })().finally(()=>{screening.delete(key)});screening.set(key,job)}
    return job
  }
  async function action(action: string, value?: unknown) {
    if (options.disabled || disposed) return { ok: false, message: '离线测试不操作真实音乐。', view: await view() }
    if (action === 'stop') { epoch++; enabled = false; jukebox.stop(); return { ok: true, message: '音乐已停止，在途点歌检索已取消。', view: await view() } }
    if (busy) return { ok: false, message: '上一项音乐操作尚未完成。', view: await view() }
    busy = true; const token = epoch
    try {
      await loaded
      if(action==='blacklist') {
        const terms=parseMusicBlacklist(value);epoch++;enabled=false;jukebox.stop();blacklist=terms
        jukebox.setTracks(state.tracks.filter(x=>!musicDenied(x,blacklist)))
        config.bgmTrackIds=config.bgmTrackIds.filter(id=>state.tracks.some(t=>t.id===id));await save()
        return {ok:true,message:'黑名单已更新，音乐已停止；核对曲库后再开启。',view:await view()}
      }
      if (action === 'queueLimit') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MUSIC_QUEUE_LIMIT) return { ok: false, message: `队列上限请输入 1 至 ${MUSIC_QUEUE_LIMIT} 的整数。`, view: await view() }
        if (value < state.queue.length + state.searches.length) return { ok: false, message: '上限不能少于当前待播和检索歌曲数，请先等队列缩短。', view: await view() }
        config.maxQueue = value; await save()
        return { ok: true, message: `点歌队列上限已改为 ${value} 首。`, view: await view() }
      }
      const q = await provider()
      let message = '', login: QQMusicLogin | undefined
      if (action === 'connect') { account = await q.status(); message = account.message }
      else if (action === 'login') { login = await q.loginStart(value === 'wechat' ? 'wechat' : 'qq'); account = await q.status(); message = login.message }
      else if (action === 'poll') { account = await q.loginPoll(); message = account.message }
      else if (action === 'start') {
        account = await q.status()
        if (!account.loggedIn) return { ok: false, message: '请先用手机 QQ 或微信扫码连接 QQ 音乐。', view: await view() }
        if (token !== epoch || disposed) return { ok: false, message: '已取消开启音乐。', view: await view() }
        enabled = true;recoverAt=0; jukebox.activate();if(!state.current)jukebox.retryBackground(); message = '背景音乐已开启，收到“点歌 歌名 歌手”会进入点歌队列。'
      } else if (action === 'add') {
        if (typeof value !== 'string' || !value.trim() || value.length > 60) throw new Error()
        const track = await q.resolve(value.trim(), new AbortController().signal)
        if (!state.tracks.some(x => x.id === track.id) && musicLibraryFull(state.tracks)) return { ok: false, message: `曲库已满 ${MUSIC_LIBRARY_LIMIT} 首，请先清理部分歌曲。`, view: await view() }
        const verdict=await checkTrack(track)
        if(!verdict.allowed)return {ok:false,message:'该歌曲禁止加入和播放：'+verdict.reason,view:await view()}
        if (token !== epoch || disposed) return { ok: false, message: '音乐已停止，已取消加入曲库。', view: await view() }
        if (!state.tracks.some(x => x.id === track.id)) jukebox.setTracks([...state.tracks, track])
        if (!config.bgmTrackIds.includes(track.id)) config.bgmTrackIds.push(track.id)
        await save(); jukebox.configurationChanged(); message = `已加入背景曲库：《${track.title}》。`
      } else if (action === 'remove') {
        if (typeof value !== 'string') throw new Error()
        config.bgmTrackIds = config.bgmTrackIds.filter(id => id !== value); await save(); jukebox.configurationChanged(); message = '已从背景轮播列表移除。'
      } else if (action === 'volume') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error()
        volume = value; await save(); message = '音乐音量已更新。'
      } else if (action === 'next') { if (!enabled) throw new Error(); jukebox.next(); message = '已手动切换歌曲。' }
      else throw new Error()
      return { ok: true, message, login, view: await view() }
    } catch (error) { return { ok: false, message: safeError(error).message, view: await view() } }
    finally { busy = false }
  }
  function event(event: LiveEvent) {
    if (!enabled || disposed || event.platform !== 'bilibili' || seen.has(event.id)) return
    seen.add(event.id); if (seen.size > 10000) seen.delete(seen.values().next().value!)
    const viewer = { ...event.user, visits: 1, blocked: false, seen: Date.now() }
    viewers.set(viewer.id, viewer)
    for (const [id, row] of viewers) if (Date.now() - row.seen > 600000) viewers.delete(id)
    while (viewers.size > 5000) viewers.delete(viewers.keys().next().value!)
    jukebox.audience([...viewers.keys()])
    if (event.kind === 'chat' && event.text) jukebox.chat(viewer, event.text, event.id)
    if (event.kind === 'gift') jukebox.gift(event)
  }
  function feedback(generation: unknown, kind: unknown) {
    if (disposed || !enabled || typeof generation !== 'string' || generation !== state.current?.generationId) return
    if (kind === 'started') jukebox.started(generation)
    if (kind === 'ended') jukebox.ended(generation)
    if (kind === 'error') jukebox.ended(generation, '播放器未能读取该曲目。')
  }
  async function stream(request: Request) {
    if (!qq || !enabled || disposed) return new Response('音乐未开启', { status: 403 })
    const track=current(),generation=state.current?.generationId
    if(!track||!generation||request.url!==track.source && !request.url.startsWith(track.source+'?'))return new Response('不是当前曲目',{status:403})
    try{
      const verdict=await checkTrack(track,request.signal)
      if(!enabled||disposed||generation!==state.current?.generationId)return new Response('播放已取消',{status:499})
      if(!verdict.allowed){jukebox.ended(generation,verdict.reason);state.lastMessage='歌曲已拦截：'+verdict.reason;return new Response('歌曲已拦截',{status:403})}
    }catch{
      if(enabled&&!disposed&&generation===state.current?.generationId){jukebox.ended(generation,'未能取得歌词完成检查');state.lastMessage='未能取得歌词完成检查，已跳过；不加入违规黑名单。'}
      return new Response('歌曲检查未完成',{status:503})
    }
    return qq.stream(request)
  }
  return { view, action, event, feedback, stream, async flush() { await jukebox.flush() }, async dispose() { disposed = true; epoch++; enabled = false; jukebox.stop(); jukebox.dispose(); qq?.dispose(); await saving.catch(() => undefined) } }
}
