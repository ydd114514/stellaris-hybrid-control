import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQQMusic, type QQMusicOptions } from '../apps/desktop/electron/qq-music'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZsAAAAASUVORK5CYII='
const TOKEN = 'sealed-local-session-SECRET'
const MID = '0039MnYb0qxYhV'
const SIGNED = 'https://dl.stream.qqmusic.qq.com/M500Fixture.mp3?vkey=SIGNED-SECRET'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const services: ReturnType<typeof createQQMusic>[] = []
afterEach(() => { services.splice(0).forEach(service => service.dispose()); vi.useRealTimers() })
function setup(extra: Partial<QQMusicOptions> = {}, initial?: string) {
  let saved = initial
  const sets: (string | undefined)[] = []
  const request = vi.fn(async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    if (url.pathname === '/login/qr/key') return json({ code: 200, data: { unikey: 'sealed-qr-SECRET' } })
    if (url.pathname === '/login/qr/create') return json({ code: 200, data: { qrimg: PNG } })
    if (url.pathname === '/login/qr/check') return json({ code: 803, cookie: `qqmusic_session=${TOKEN}; Path=/; HttpOnly` })
    if (url.pathname === '/login/qr/cancel' || url.pathname === '/logout') return json({ code: 200 })
    if (url.pathname === '/search') return json({ code: 200, type: 'song', page: 1, limit: 10, more: false, items: [{ mid: MID, title: '月亮小店', singer: [{ name: '夜班鱼' }], interval: 180, file: { media_mid: 'MediaFixture01' }, cookie: TOKEN, url: SIGNED }] })
    if (url.pathname.startsWith('/getSongInfo/')) return json({ response: { songinfo: { data: { track_info: { file: { media_mid: 'RestartMedia01' } } } } } })
    if (url.pathname.startsWith('/getMusicPlay/')) return json({ data: { playUrl: { [MID]: { url: SIGNED, error: false } } } })
    return json({ code: 404 }, 404)
  })
  const fetchAudio = vi.fn<typeof fetch>(async () => new Response(Uint8Array.of(1, 2, 3, 4), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-length': '4', 'content-range': 'bytes 0-3/20', 'set-cookie': 'forbidden=SECRET', location: SIGNED } }))
  const vault = { get: () => saved, set: (value: string | undefined) => { saved = value; sets.push(value) } }
  const service = createQQMusic({ request, fetch: fetchAudio, vault, isAllowed: () => true, ...extra })
  services.push(service)
  return { service, request, fetchAudio, sets, saved: () => saved }
}
const authenticated = (extra: Partial<QQMusicOptions> = {}) => setup(extra, JSON.stringify({ token: TOKEN }))
const audioRequest = (mid = MID, init?: RequestInit) => new Request(`shop-qqmusic://track/${mid}`, init)

describe('QQ音乐主进程账号与曲库', () => {
  it('只给界面二维码和安全状态，成功后仅保存sealed token', async () => {
    const { service, sets, saved } = setup()
    expect(await service.status()).toMatchObject({ loggedIn: false, loginPending: false })
    const login = await service.loginStart('qq')
    expect(login.qrDataUrl).toBe(PNG)
    expect(JSON.stringify(login)).not.toContain('sealed-qr')
    expect(await service.loginPoll()).toMatchObject({ loggedIn: true, loginPending: false })
    expect(sets).toEqual([JSON.stringify({ token: TOKEN })])
    expect(JSON.stringify(await service.status())).not.toContain('SECRET')
    await service.logout()
    expect(saved()).toBeUndefined()
    expect(await service.status()).toMatchObject({ loggedIn: false, loginPending: false })
  })
  it('恢复保存登录时明确提示权限仍需使用时核对', async () => {
    const { service, request } = authenticated()
    expect(await service.status()).toEqual({ loggedIn: true, loginPending: false, message: '已保存QQ音乐登录，播放权限将在使用时核对。' })
    expect(request).not.toHaveBeenCalled()
  })
  it('支持微信扫码，拒绝未实现App扫码', async () => {
    const { service, request } = setup()
    await service.loginStart('wechat')
    expect(request.mock.calls[0]![0].url).toContain('channel=wechat')
    await expect(service.loginStart('qqmusic')).rejects.toThrow('暂不支持')
  })
  it.each(['https://y.qq.com/qrcode.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4=', 'data:image/jpeg;base64,AAAA'])('拒绝不可信二维码格式 %s', async image => {
    const { service } = setup({ request: async request => new URL(request.url).pathname.includes('create') ? json({ code: 200, data: { qrimg: image } }) : json({ code: 200, data: { unikey: 'qr-key' } }) })
    await expect(service.loginStart()).rejects.toThrow('二维码格式')
    expect(await service.status()).toMatchObject({ loginPending: false })
  })
  it('二维码最多1MiB，过期后停止轮询', async () => {
    let time = 10000
    const { service, request } = setup({ now: () => time })
    await service.loginStart()
    time += 120001
    expect(await service.loginPoll()).toMatchObject({ loggedIn: false, loginPending: false, message: expect.stringContaining('过期') })
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.includes('/check'))).toHaveLength(0)
    const huge = setup({ request: async r => new URL(r.url).pathname.includes('create') ? json({ code: 200, data: { qrimg: `data:image/png;base64,${'A'.repeat(1500000)}` } }) : json({ code: 200, data: { unikey: 'qr' } }) }).service
    await expect(huge.loginStart()).rejects.toThrow('二维码格式')
  })
  it('退出后迟到扫码结果不能重新登录或落盘', async () => {
    const late = deferred<Response>()
    const base = setup()
    const { service, sets } = setup({ request: req => new URL(req.url).pathname.includes('/check') ? late.promise : base.request(req) })
    await service.loginStart()
    const poll = service.loginPoll()
    const rejected = expect(poll).rejects.toThrow('取消')
    await Promise.resolve()
    await service.logout()
    late.resolve(json({ code: 803, cookie: `qqmusic_session=${TOKEN}` }))
    await rejected
    expect(await service.status()).toMatchObject({ loggedIn: false })
    expect(sets).toEqual([undefined])
  })
  it('异步凭证写入与退出按顺序完成，退出后磁盘最终为空', async () => {
    const started = deferred<void>(), release = deferred<void>()
    let saved: string | undefined
    const { service } = setup({ vault: { get: () => undefined, set: async value => { if (value) { started.resolve(); await release.promise }; saved = value } } })
    await service.loginStart()
    const poll = service.loginPoll()
    const rejected = expect(poll).rejects.toThrow('取消')
    await started.promise
    const logout = service.logout()
    release.resolve()
    await logout; await rejected
    expect(saved).toBeUndefined()
    expect(await service.status()).toMatchObject({ loggedIn: false })
  })
  it('退出期间迟到的磁盘读取不能恢复旧账号', async () => {
    const load = deferred<string | undefined>()
    const { service } = setup({ vault: { get: () => load.promise, set: () => undefined } })
    const logout = service.logout()
    load.resolve(JSON.stringify({ token: TOKEN }))
    await logout
    expect(await service.status()).toMatchObject({ loggedIn: false })
  })
  it('搜索只保留安全曲目信息，不导出凭据或签名地址', async () => {
    const { service, request } = authenticated()
    const result = await service.search('月亮 夜班鱼')
    expect(result.tracks).toEqual([{ id: `qq:${MID}`, title: '月亮小店', artist: '夜班鱼', duration: 180, source: `shop-qqmusic://track/${MID}` }])
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(request.mock.calls[0]![0].headers.get('X-QQ-Session')).toBeNull()
    await expect(service.search('x'.repeat(61))).rejects.toThrow('60')
    await expect(service.search('')).rejects.toThrow('请输入')
  })
  it('非法MID、重复项和多余数据被过滤，搜索结果有上限', async () => {
    const items = [{ mid: '../evil', title: '错' }, { mid: 'a', title: '短ID', singer: [], interval: -1 }, { mid: 'a', title: '重复' }, ...Array.from({ length: 50 }, (_, i) => ({ mid: `m${i}`, title: `歌${i}` }))]
    const { service } = setup({ request: async () => json({ code: 200, items }) })
    const result = await service.search('歌')
    expect(result.tracks).toHaveLength(30)
    expect(result.tracks[0]).toEqual({ id: 'qq:a', source: 'shop-qqmusic://track/a', title: '短ID', artist: '未知歌手' })
  })
  it('匿名搜索遇到临时5xx只重试一次，成功结果仍走正常解析', async () => {
    vi.useFakeTimers()
    const base = setup()
    const request = vi.fn(async (r: Request) => request.mock.calls.length === 1 ? json({}, 502) : base.request(r))
    const { service } = setup({ request })
    const pending = service.search('月亮 夜班鱼')
    await vi.advanceTimersByTimeAsync(501)
    expect((await pending).tracks[0]?.title).toBe('月亮小店')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([r]) => !r.headers.has('X-QQ-Session'))).toBe(true)
  })
  it('搜索重试等待可取消，迟到后不再发请求', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => json({}, 502)), controller = new AbortController()
    const { service } = setup({ request })
    const pending = expect(service.search('歌', controller.signal)).rejects.toThrow('取消')
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await pending; await vi.advanceTimersByTimeAsync(1000)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 429])('搜索遇到账号或频率错误%d不重试', async status => {
    const request = vi.fn(async () => json({}, status))
    const { service } = setup({ request })
    await expect(service.search('歌')).rejects.toThrow(status === 401 ? '重新扫码' : status === 429 ? '频繁' : '暂时不可用')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('原始异常和上游消息不会出现在错误中', async () => {
    const first = setup({ request: async () => { throw new Error(`Cookie=${TOKEN} ${SIGNED}`) } }).service
    await expect(first.search('歌')).rejects.toThrow('连接失败')
    const second = setup({ request: async () => json({ code: 500, message: TOKEN, stack: SIGNED }) }).service
    await expect(second.search('歌')).rejects.toThrow('搜索暂时不可用')
    const third = setup({ request: async () => json({ message: TOKEN }, 401) }).service
    await expect(third.search('歌')).rejects.toThrow('重新扫码')
  })
  it('超时和释放均能停止忽略signal的提供器', async () => {
    vi.useFakeTimers()
    const { service } = setup({ request: () => new Promise(() => undefined) })
    const search = service.search('歌')
    const assertion = expect(search).rejects.toThrow('取消')
    await vi.advanceTimersByTimeAsync(25001)
    await assertion
    service.dispose()
    await expect(service.status()).rejects.toThrow('取消')
  })
})

describe('QQ音乐受限流式音频', () => {
  it('Range只转发给QQ CDN，返回206且不泄露上游Cookie/临时地址', async () => {
    const { service, fetchAudio, request } = authenticated()
    const response = await service.stream(audioRequest(MID, { headers: { Range: 'bytes=0-3', Cookie: 'do-not-forward', Authorization: 'do-not-forward' } }))
    expect(response.status).toBe(206)
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4])
    expect(response.headers.get('content-range')).toBe('bytes 0-3/20')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect(JSON.stringify([...response.headers])).not.toContain('SECRET')
    const [url, options] = fetchAudio.mock.calls[0]!
    expect(String(url)).toBe(SIGNED)
    expect(options?.redirect).toBe('manual')
    expect(options?.headers).toEqual({ Accept: 'audio/*', Range: 'bytes=0-3' })
    const resolver = request.mock.calls.find(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))![0]
    expect(resolver.headers.get('X-QQ-Session')).toBe(TOKEN)
    expect(resolver.url).toContain('quality=128')
    expect(resolver.url).toContain('mediaId=RestartMedia01')
    expect(resolver.url).not.toContain('preview')
  })
  it('HEAD无响应体，HTTP腾讯音频地址升级HTTPS', async () => {
    const { service, fetchAudio } = authenticated({ request: async () => json({ data: { playUrl: { [MID]: { url: SIGNED.replace('https:', 'http:'), error: false } } } }) })
    const response = await service.stream(audioRequest(MID, { method: 'HEAD' }))
    expect(response.body).toBeNull()
    expect(String(fetchAudio.mock.calls[0]![0])).toBe(SIGNED)
    expect(fetchAudio.mock.calls[0]![1]?.method).toBe('HEAD')
  })
  it.each(['https://evil.test/secret.mp3', 'http://127.0.0.1/secret.mp3', 'https://dl.stream.qqmusic.qq.com.evil.test/a.mp3', 'https://user:pass@dl.stream.qqmusic.qq.com/a.mp3', 'https://dl.stream.qqmusic.qq.com:444/a.mp3', 'https://dl.stream.qqmusic.qq.com/a.html'])('拒绝非音源地址 %s', async url => {
    const { service, fetchAudio } = authenticated({ request: async () => json({ data: { playUrl: { [MID]: { url, error: false } } } }) })
    const response = await service.stream(audioRequest())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(url)
    expect(fetchAudio).not.toHaveBeenCalled()
  })
  it('每次重定向都检查白名单，不跟随外站', async () => {
    const fetchAudio = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/steal.mp3?token=SECRET' } }))
    const { service } = authenticated({ fetch: fetchAudio })
    const response = await service.stream(audioRequest())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('SECRET')
    expect(fetchAudio).toHaveBeenCalledTimes(1)
  })
  it('曲库权限、方法和Range异常在访问上游前拒绝', async () => {
    const { service, request, fetchAudio } = authenticated({ isAllowed: mid => mid === MID })
    expect((await service.stream(audioRequest('other'))).status).toBe(403)
    expect((await service.stream(audioRequest(MID, { method: 'POST' }))).status).toBe(405)
    for (const range of ['bytes=3-1', 'bytes=0-3,5-7', 'bytes=-0', 'bytes=-', 'bytes=9007199254740992-']) expect((await service.stream(audioRequest(MID, { headers: { Range: range } }))).status).toBe(416)
    expect((await service.stream(new Request(`shop-qqmusic://track/${MID}?url=evil`))).status).toBe(400)
    expect(request).not.toHaveBeenCalled(); expect(fetchAudio).not.toHaveBeenCalled()
  })
  it('未登录不取播放地址，试听及空地址不冒充完整播放', async () => {
    const { service, request } = setup()
    expect((await service.stream(audioRequest())).status).toBe(401)
    expect(request).not.toHaveBeenCalled()
    const preview = authenticated({ request: async () => json({ data: { playUrl: { [MID]: { url: SIGNED, error: false, preview: true } } } }) })
    expect((await preview.service.stream(audioRequest())).status).toBe(403)
    expect(preview.fetchAudio).not.toHaveBeenCalled()
  })
  it('退出会中止正在读取的音频流', async () => {
    let fetchSignal: AbortSignal | undefined
    const next = deferred<void>()
    const { service } = authenticated({ fetch: async (_url, init) => { fetchSignal = init?.signal as AbortSignal; return new Response(new ReadableStream({ async pull(output) { await next.promise; output.enqueue(Uint8Array.of(1)) } }), { headers: { 'content-type': 'audio/mpeg' } }) } })
    const response = await service.stream(audioRequest())
    const body = response.arrayBuffer()
    const rejected = expect(body).rejects.toThrow('停止')
    await service.logout()
    expect(fetchSignal?.aborted).toBe(true)
    next.resolve()
    await rejected
  })
  it('客户端取消时停止音频请求，迟到地址不会启动下载', async () => {
    const later = deferred<Response>(), abort = new AbortController()
    const { service, fetchAudio } = authenticated({ request: () => later.promise })
    const stream = service.stream(audioRequest(MID, { signal: abort.signal }))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    abort.abort()
    later.resolve(json({ data: { playUrl: { [MID]: { url: SIGNED, error: false } } } }))
    const response = await stream
    expect(response.status).toBe(499)
    expect(fetchAudio).not.toHaveBeenCalled()
  })
})

const resultSong = (mid: string, title = '晴天', singer = '周杰伦') => ({ mid, title, singer: [{ name: singer }], interval: 180, file: { media_mid: `Media${mid}` } })
function resolverSetup(items: unknown[], entry?: (mid: string, request: Request) => unknown | Promise<Response>, extra: Partial<QQMusicOptions> = {}) {
  const base = setup()
  const request = vi.fn(async (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname === '/search') return json({ code: 200, items })
    if (url.pathname.startsWith('/getMusicPlay/')) {
      const mid = url.pathname.split('/').pop()!
      const value = await entry?.(mid, req)
      return value instanceof Response ? value : json({ data: { playUrl: { [mid]: value ?? { url: `https://dl.stream.qqmusic.qq.com/M500${mid}.mp3?vkey=SIGNED-SECRET`, error: false } } } })
    }
    return base.request(req)
  })
  return { ...authenticated({ request, ...extra }), request }
}

describe('自动QQ弹幕点歌解析', () => {
  it('按歌名歌手精确匹配、完整授权后返回不透明曲目，不播放、不要求已在曲库', async () => {
    const { service, request, fetchAudio } = resolverSetup([
      resultSong('cover1', '晴天 (Cover 周杰伦)', '翻唱者'), resultSong('wrong1', '晴天', '另一人'), resultSong('original1'), resultSong('live1', '晴天 (Live)'),
    ], undefined, { isAllowed: () => false })
    const track = await service.resolve('晴天 周杰伦')
    expect(track).toEqual({ id: 'qq:original1', title: '晴天', artist: '周杰伦', duration: 180, source: 'shop-qqmusic://track/original1' })
    expect(JSON.stringify(track)).not.toContain('SECRET')
    expect(fetchAudio).not.toHaveBeenCalled()
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(1)
    expect(request.mock.calls[0]![0].headers.get('X-QQ-Session')).toBeNull()
    const check = request.mock.calls.find(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))![0]
    expect(check.headers.get('X-QQ-Session')).toBe(TOKEN)
    expect(check.url).toContain('quality=128'); expect(check.url).not.toContain('preview')
    expect((await service.stream(audioRequest('original1'))).status).toBe(403)
  })
  it('同名没有指定歌手时采用QQ顺序的原版，排除未点名的现场伴奏翻唱', async () => {
    const { service } = resolverSetup([resultSong('inst', '晴天 (伴奏)'), resultSong('live', '晴天 (Live)'), resultSong('cover', '晴天 (翻唱)'), resultSong('firstOriginal'), resultSong('secondOriginal')])
    expect((await service.resolve('晴天')).id).toBe('qq:firstOriginal')
  })
  it('明确点现场版时可以匹配现场版', async () => {
    const { service } = resolverSetup([resultSong('original'), resultSong('live', '晴天 (Live)')])
    expect((await service.resolve('晴天 Live 周杰伦')).id).toBe('qq:live')
  })
  it('完整关键词无结果时最多再用歌名单词搜一次，仍检查原始歌手', async () => {
    const base = resolverSetup([resultSong('original')])
    const { service } = authenticated({ request: async req => {
      const url = new URL(req.url)
      if (url.pathname === '/search' && url.searchParams.get('keyword')?.includes(' ')) return json({ code: 200, items: [] })
      return base.request(req)
    } })
    expect((await service.resolve('晴天 周杰伦')).id).toBe('qq:original')
    expect(base.request.mock.calls.find(([r]) => new URL(r.url).pathname === '/search')![0].url).toContain('keyword=%E6%99%B4%E5%A4%A9&')
  })
  it('跳过无权与试听候选，最多确认3首，不下载候选音频', async () => {
    const { service, request, fetchAudio } = resolverSetup([resultSong('denied'), resultSong('preview'), resultSong('whole'), resultSong('fourth')], mid => mid === 'denied' ? { url: '', error: '无权限' } : mid === 'preview' ? { url: SIGNED, error: false, preview: true } : undefined)
    expect((await service.resolve('晴天')).id).toBe('qq:whole')
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(3)
    expect(fetchAudio).not.toHaveBeenCalled()
  })
  it('最多核对6首，达到上限后明确失败，不降级为试听', async () => {
    const { service, request } = resolverSetup(Array.from({ length: 8 }, (_, i) => resultSong(`s${i}`)), () => ({ url: '', error: '无会员' }))
    await expect(service.resolve('晴天')).rejects.toThrow('完整播放地址')
    const checked = request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))
    expect(checked).toHaveLength(6)
    expect(checked.every(([r]) => !r.url.includes('preview') && r.url.includes('quality=128'))).toBe(true)
  })
  it('前三首无权限时仍能找到第四首完整版本', async () => {
    const { service, request } = resolverSetup(Array.from({length:4},(_,i)=>resultSong(`s${i}`)), mid=>mid==='s3'?undefined:{url:'',error:'无会员'})
    expect((await service.resolve('晴天')).id).toBe('qq:s3')
    expect(request.mock.calls.filter(([r])=>new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(4)
  })
  it('命中第11条以后曲目，不再截断为前10条', async () => {
    const {service}=resolverSetup([...Array.from({length:15},(_,i)=>resultSong(`wrong${i}`,'其他歌曲')),resultSong('target')])
    expect((await service.resolve('晴天 周杰伦')).id).toBe('qq:target')
  })
  it('第一页没有目标且有更多结果时翻到第二页，继续使用匿名搜索', async () => {
    const base=resolverSetup([resultSong('target')])
    const request=vi.fn(async(req:Request)=>{const u=new URL(req.url);return u.pathname==='/search'&&u.searchParams.get('page')==='1'?json({code:200,more:true,items:[resultSong('wrong','其他歌曲')]}):base.request(req)})
    const {service}=authenticated({request})
    expect((await service.resolve('晴天 周杰伦')).id).toBe('qq:target')
    const searches=request.mock.calls.filter(([r])=>new URL(r.url).pathname==='/search').map(([r])=>r)
    expect(searches.map(r=>new URL(r.url).searchParams.get('page'))).toEqual(['1','2'])
    expect(searches.every(r=>!r.headers.has('X-QQ-Session')&&new URL(r.url).searchParams.get('limit')==='30')).toBe(true)
  })
  it.each(['Love Story Taylor Swift','Taylor Swift Love Story'])('关键词拆分保留多词歌名，支持歌手在前：%s', async keyword => {
    const base=resolverSetup([resultSong('target','Love Story','Taylor Swift')])
    const request=vi.fn(async(req:Request)=>{const u=new URL(req.url);return u.pathname==='/search'&&u.searchParams.get('keyword')!=='Love Story'?json({code:200,items:[]}):base.request(req)})
    const {service}=authenticated({request})
    expect((await service.resolve(keyword)).id).toBe('qq:target')
  })
  it('精简常用书名号和歌手分隔符后搜索，仍按原始歌手核对', async()=>{
    const {service,request}=resolverSetup([resultSong('wrong','晴天','其他人'),resultSong('target')])
    expect((await service.resolve('《晴天》—周杰伦')).id).toBe('qq:target')
    expect(new URL(request.mock.calls[0]![0].url).searchParams.get('keyword')).toBe('晴天 周杰伦')
  })
  it('空结果分页及关键词回退有请求预算，不会无限翻页或重试', async()=>{
    const request=vi.fn(async()=>json({code:200,more:true,items:[resultSong('wrong','其他歌曲','其他人')]}))
    const {service}=authenticated({request})
    await expect(service.resolve('晴天 周杰伦')).rejects.toThrow('歌名和歌手')
    expect(request).toHaveBeenCalledTimes(6)
  })
  it('翻页中取消后不再取播放地址或发起下一页',async()=>{
    const controller=new AbortController(),request=vi.fn(async()=>{controller.abort();return json({code:200,more:true,items:[resultSong('target')]})})
    const {service}=authenticated({request})
    await expect(service.resolve('晴天',controller.signal)).rejects.toThrow('取消')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([
    { url: 'https://evil.test/a.mp3?vkey=SECRET', error: false },
    { url: 'https://dl.stream.qqmusic.qq.com/RS02preview.mp3?vkey=SECRET', error: false },
    { url: SIGNED, error: false, trial: true },
  ])('不接受伪造来源或仅试听资源', async entry => {
    const { service, fetchAudio } = resolverSetup([resultSong('song')], () => entry)
    await expect(service.resolve('晴天')).rejects.toThrow('完整播放地址')
    expect(fetchAudio).not.toHaveBeenCalled()
  })
  it('没有账号时不搜索、不伪造可播结果', async () => {
    const { service, request } = setup()
    await expect(service.resolve('晴天')).rejects.toThrow('重新扫码')
    expect(request).not.toHaveBeenCalled()
  })
  it('指定歌手不匹配、只有模糊标题或URL时拒绝盲选', async () => {
    const { service, request } = resolverSetup([resultSong('wrong', '晴天', '其他歌手'), resultSong('substring', '晴天的雨', '周杰伦')])
    await expect(service.resolve('晴天 周杰伦')).rejects.toThrow('歌名和歌手')
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(0)
    await expect(service.resolve('https://evil.test/a.mp3')).rejects.toThrow('歌名和歌手')
  })
  it('单并发限制不会为第二个请求额外访问上游', async () => {
    const pending = deferred<Response>(), entered = deferred<void>(), abort = new AbortController()
    const base = resolverSetup([resultSong('song')])
    const { service } = authenticated({ request: async req => { if (new URL(req.url).pathname === '/search') { entered.resolve(); return pending.promise }; return base.request(req) } })
    const first = service.resolve('晴天', abort.signal), stopped = expect(first).rejects.toThrow('取消')
    await entered.promise
    await expect(service.resolve('晴天')).rejects.toThrow('前一首')
    abort.abort(); pending.resolve(json({ code: 200, items: [] })); await stopped
    expect(base.request).not.toHaveBeenCalled()
  })
  it('取消迟到取链不会返回曲目或留下可复用的签名缓存', async () => {
    const late = deferred<Response>(), entered = deferred<void>(), abort = new AbortController()
    let checks = 0
    const { service } = resolverSetup([resultSong('song')], () => { checks++; if (checks === 1) { entered.resolve(); return late.promise }; return undefined })
    const first = service.resolve('晴天', abort.signal), stopped = expect(first).rejects.toThrow('取消')
    await entered.promise; abort.abort(); await stopped
    late.resolve(json({ data: { playUrl: { song: { url: SIGNED, error: false } } } }))
    await Promise.resolve()
    expect((await service.resolve('晴天')).id).toBe('qq:song')
    expect(checks).toBe(2)
  })
  it('登出中止解析，迟到结果不能恢复授权或曲目', async () => {
    const late = deferred<Response>(), entered = deferred<void>()
    const { service } = resolverSetup([resultSong('song')], () => { entered.resolve(); return late.promise })
    const first = service.resolve('晴天'), stopped = expect(first).rejects.toThrow('取消')
    await entered.promise; await service.logout(); await stopped
    late.resolve(json({ data: { playUrl: { song: { url: SIGNED, error: false } } } }))
    await expect(service.resolve('晴天')).rejects.toThrow('重新扫码')
  })
  it('播放可短暂复用同账号已确认地址，缓存过期后重新核对', async () => {
    let time = 1000
    const { service, request } = resolverSetup([resultSong('song')], undefined, { now: () => time })
    await service.resolve('晴天')
    const first = await service.stream(audioRequest('song')); await first.arrayBuffer()
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(1)
    time += 60001
    const second = await service.stream(audioRequest('song')); await second.arrayBuffer()
    expect(request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(2)
  })
})

describe('QQ授权切换与候选缓存', () => {
  it('二维码等待时旧账号新取得的地址在换号完成后失效', async () => {
    const base = resolverSetup([resultSong('song')])
    const request = vi.fn(async (req: Request) => new URL(req.url).pathname === '/login/qr/check' ? json({ code: 803, cookie: 'qqmusic_session=NEW-ACCOUNT-TOKEN' }) : base.request(req))
    const { service } = authenticated({ request })
    await service.loginStart()
    await service.resolve('晴天')
    expect(base.request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))).toHaveLength(1)
    await service.loginPoll()
    const response = await service.stream(audioRequest('song')); await response.arrayBuffer()
    const checked = base.request.mock.calls.filter(([r]) => new URL(r.url).pathname.startsWith('/getMusicPlay/'))
    expect(checked).toHaveLength(2)
    expect(checked[0]![0].headers.get('X-QQ-Session')).toBe(TOKEN)
    expect(checked[1]![0].headers.get('X-QQ-Session')).toBe('NEW-ACCOUNT-TOKEN')
  })
})
