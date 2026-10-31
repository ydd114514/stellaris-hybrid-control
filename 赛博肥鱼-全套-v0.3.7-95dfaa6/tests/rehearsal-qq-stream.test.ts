import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRehearsalQQ } from '../scripts/rehearsal-qq'

const MID = 'TestAudio01', SIGNED = 'https://dl.stream.qqmusic.qq.com/fixture.mp3?vkey=never-export-SECRET'
vi.mock('../apps/desktop/electron/qq-vault', () => ({ createQQVault: () => ({ secret: 'a'.repeat(64), get: () => JSON.stringify({ token: 'offline-session' }) }) }))
vi.mock('@yakult-green-tea/qq-music-api/serverless', () => ({ handleRequest: async (request: Request) => {
  const path = new URL(request.url).pathname
  if (path.startsWith('/getSongInfo/')) return Response.json({ response: { songinfo: { data: { track_info: { file: { media_mid: 'FixtureMedia01' } } } } } })
  if (path.startsWith('/getMusicPlay/')) return Response.json({ data: { playUrl: { TestAudio01: { url: 'https://dl.stream.qqmusic.qq.com/fixture.mp3?vkey=never-export-SECRET', error: false } } } })
  return Response.json({ code: 404 }, { status: 404 })
} }))

const projects: string[] = [], bridges: Awaited<ReturnType<typeof createRehearsalQQ>>[] = []
afterEach(async () => { bridges.splice(0).forEach(bridge => bridge.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(projects.splice(0).map(project => rm(project, { recursive: true, force: true }))) })
async function setup(fetchAudio: typeof fetch, allowed = () => true) {
  vi.stubGlobal('fetch', vi.fn(fetchAudio))
  const parent = resolve('.local/test-data'); await mkdir(parent, { recursive: true })
  const project = await mkdtemp(join(parent, 'qq-stream-')); projects.push(project)
  const local = join(project, '.local'); await mkdir(join(local, 'user-data'), { recursive: true })
  await writeFile(join(local, 'user-data', 'qq-music-session.enc.json'), 'offline-fixture')
  await writeFile(join(local, 'tracks.json'), JSON.stringify([{ id: `qq:${MID}`, title: '离线音源', artist: '测试', source: `shop-qqmusic://track/${MID}` }]))
  const bridge = await createRehearsalQQ({ project, tracksFile: '.local/tracks.json', isAllowed: allowed }); bridges.push(bridge)
  expect(bridge.available).toBe(true)
  return bridge
}
const request = (signal?: AbortSignal) => new Request(`shop-qqmusic://track/${MID}`, { signal, headers: { range: 'bytes=0-' } })
function stalledSource() {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const fetchAudio: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(output) { source = output; output.enqueue(Uint8Array.of(1, 2)) } }), { headers: { 'content-type': 'audio/mpeg' } })
  return { fetchAudio, fail() { source.error(new Error(SIGNED)) } }
}

describe('QQ排练音频取消与真实故障状态', () => {
  it('播放器取消Range并发读取不会误记故障，也不留下流错误', async () => {
    const source = stalledSource(), bridge = await setup(source.fetchAudio)
    const response = await bridge.handle(request()), reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(Uint8Array.of(1, 2))
    const pending = reader.read(); await reader.cancel(); expect((await pending).done).toBe(true)
    expect(bridge.metadata()).toMatchObject({ failedStreams: 0, cancelledStreams: 1 })
    expect(bridge.reason).not.toMatch(/中断|中途停止|失败/)
  })
  it('明确请求abort只记取消，后续实际started清掉旧状态', async () => {
    const source = stalledSource(), bridge = await setup(source.fetchAudio), abort = new AbortController()
    const response = await bridge.handle(request(abort.signal)), reader = response.body!.getReader(); await reader.read()
    const pending = expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await pending
    expect(bridge.metadata()).toMatchObject({ failedStreams: 0, cancelledStreams: 1 })
    bridge.markPlaybackStarted(MID)
    expect(bridge.reason).toContain('实际播放回执')
  })
  it('切到别的曲目时晚到的旧流失败按取消，不覆盖当前播放说明', async () => {
    let allowed = true
    const source = stalledSource(), bridge = await setup(source.fetchAudio, () => allowed)
    const response = await bridge.handle(request()), reader = response.body!.getReader(); await reader.read()
    bridge.markPlaybackStarted(MID)
    const pending = expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' }); allowed = false; source.fail(); await pending
    expect(bridge.metadata()).toMatchObject({ failedStreams: 0, cancelledStreams: 1 })
    expect(bridge.reason).toContain('实际播放回执')
  })
  it('真实断流保留故障计数，之后正常读取与started不再显示陈旧故障', async () => {
    const source = stalledSource(), bridge = await setup(source.fetchAudio)
    const response = await bridge.handle(request()), reader = response.body!.getReader(); await reader.read()
    const pending = expect(reader.read()).rejects.toThrow('读取中断'); source.fail(); await pending
    expect(bridge.metadata()).toMatchObject({ failedStreams: 1, cancelledStreams: 0 })
    expect(bridge.reason).toContain('读取中断'); expect(bridge.reason).not.toContain('SECRET')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(Uint8Array.of(3, 4), { headers: { 'content-type': 'audio/mpeg' } }))
    await (await bridge.handle(request())).arrayBuffer()
    expect(bridge.reason).toContain('读取正常')
    bridge.markPlaybackStarted(MID)
    expect(bridge.metadata()).toMatchObject({ state: 'played', failedStreams: 1 })
    expect(bridge.reason).toContain('实际播放回执'); expect(bridge.reason).not.toContain('中断')
  })
  it('20秒读取超时仍然算真实失败，不因controller.abort误当普通暂停', async () => {
    const source = stalledSource(), bridge = await setup(source.fetchAudio)
    vi.useFakeTimers()
    const response = await bridge.handle(request()), reader = response.body!.getReader(); await reader.read()
    const pending = expect(reader.read()).rejects.toThrow('读取中断')
    await vi.advanceTimersByTimeAsync(20001); await pending
    expect(bridge.metadata()).toMatchObject({ failedStreams: 1, cancelledStreams: 0 })
  })
  it('CDN正常Range EOF返回416不当作音源失效', async () => {
    const bridge = await setup(async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */4' } }))
    expect((await bridge.handle(request())).status).toBe(416)
    expect(bridge.metadata().failedStreams).toBe(0)
  })
})
