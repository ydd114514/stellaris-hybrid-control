import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveScreenInput, DEFAULT_SCREEN_ROIS } from '../apps/desktop/electron/live-screen-input'
import { parseScreenCandidates, validNormalizedRect, type OCRObservation } from '../apps/desktop/electron/live-screen-parser'
import { createInputFailover } from '../apps/desktop/electron/input-failover'
import type { LiveEvent } from '../packages/shared/src'

const readers: ReturnType<typeof createLiveScreenInput>[] = []
afterEach(() => { readers.splice(0).forEach(reader => reader.dispose()); vi.useRealTimers() })
const line = (text: string, region: 'comment' | 'gift' = 'comment', confidence = .95, y = .5, x = .8): OCRObservation => ({ text, region, confidence, bounds: { x, y, width: .18, height: .02 } })
const window = { id: 'window:104:0', name: '抖音直播伴侣' }
function setup(patch: Partial<Parameters<typeof createLiveScreenInput>[0]> = {}) {
  const candidates = vi.fn(), recognize = vi.fn(async () => ({ version: 1, observations: [line('小周：木书架做好了')] }))
  const reader = createLiveScreenInput({ platform: 'darwin', permission: () => 'granted', listSources: async () => [window], recognize, onCandidates: candidates, intervalMs: 1000, timeoutMs: 1000, ...patch }); readers.push(reader)
  return { reader, candidates, recognize }
}
describe('本机画面候选解析，不冒充后台事件', () => {
  it('评论/礼物/关注分开，礼物只保留明示数量，绝不输出账号ID或价格', () => {
    const rows = parseScreenCandidates([line('小周：我送了火箭', 'comment', .95, .1), line('小猫关注了主播', 'comment', .95, .2), line('小周 送出 小心心 × 3', 'gift', .95, .4), line('小猫 赠送 玫瑰', 'gift', .95, .5)])
    expect(rows.map(row => row.kind)).toEqual(['chat', 'follow', 'gift'])
    expect(rows[0]?.text).toBe('我送了火箭'); expect(rows[2]).toMatchObject({ userName: '小周', giftName: '小心心', count: 3 })
    expect(JSON.stringify(rows)).not.toMatch(/userId|unitDiamonds|yuan|price|origin/)
  })
  it('只拼接同一行OCR块；行滚动不改变fingerprint', () => {
    const a = line('小周', 'comment', .95, .5, .60); a.bounds.width = .08
    const b = line('：你好呀', 'comment', .96, .502, .70)
    const first = parseScreenCandidates([b, a])[0]!
    expect(first).toMatchObject({ kind: 'chat', userName: '小周', text: '你好呀' })
    const moved = parseScreenCandidates([line('小周 ：你好呀', 'comment', .95, .8)])[0]!
    expect(moved.fingerprint).toBe(first.fingerprint)
    expect(parseScreenCandidates([a, { ...b, bounds: { ...b.bounds, y: .7 } }])).toHaveLength(0)
  })
  it('低置信、缺昵称、被省略昵称、非评论区域和异常数量不猜', () => {
    expect(parseScreenCandidates([line('小周：你好', 'comment', .2), line('：你好'), line('小…：你好'), line('小***：你好'), line('送出小心心×2', 'gift'), line('小周送出小心心×0', 'gift'), line('小周送出小心心×100001', 'gift'), line('小周：这里不是礼物', 'gift')])).toEqual([])
    expect(validNormalizedRect({ x: .9, y: .9, width: .2, height: .2 })).toBe(false)
  })
})
describe('指定窗口的本机采集生命周期', () => {
  it('同一CG窗口的Electron显示屏后缀变化仍读原窗口，不把移动屏幕当作关闭', async () => {
    vi.useFakeTimers(); let suffix = '0'
    const { reader, recognize } = setup({ listSources: async () => [{ id: `window:104:${suffix}`, name: window.name }] })
    await reader.start({ windowId: window.id }); suffix = '7'
    await vi.advanceTimersByTimeAsync(1100)
    expect(reader.status()).toMatchObject({ state: 'reading', windowId: 'window:104:7', frames: 2, errorCount: 0 })
    expect(recognize.mock.calls.every(call => call[0].windowId === 104)).toBe(true)
  })
  it('其他数字窗口即使同名也不冒充原选择，不擅自切到别的窗口', async () => {
    const { reader, recognize } = setup({ listSources: async () => [{ id: 'window:105:0', name: window.name }] })
    await reader.start({ windowId: window.id })
    expect(reader.status().state).toBe('disconnected'); expect(recognize).not.toHaveBeenCalled()
  })
  it('本次已成功读取的唯一伴侣主窗口重建后可自动续接，不清去重记录', async () => {
    vi.useFakeTimers(); let current = window.id
    const observations = [line('测试路人 送出 小心心 x1', 'gift')]
    const { reader, recognize, candidates } = setup({ listSources: async () => [{ id: current, name: window.name }], recognize: vi.fn(async () => ({ version: 1, observations })) })
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(2100)
    expect(candidates).toHaveBeenCalledOnce()
    current = 'window:105:0'; await vi.advanceTimersByTimeAsync(3100)
    expect(reader.status()).toMatchObject({ state: 'reading', windowId: current, frames: 6, errorCount: 0 })
    expect(candidates).toHaveBeenCalledOnce()
  })
  it('主窗口重建出现两个同名候选时拒绝猜选；显式改选会清掉旧绑定身份', async () => {
    vi.useFakeTimers(); let sources = [window]
    const { reader, recognize } = setup({ listSources: async () => sources })
    await reader.start({ windowId: window.id })
    sources = [{ id: 'window:105:0', name: window.name }, { id: 'window:106:0', name: window.name }]
    await vi.advanceTimersByTimeAsync(1100)
    expect(reader.status().state).toBe('disconnected'); expect(recognize).toHaveBeenCalledOnce()
    await reader.start({ windowId: 'window:999:0' })
    expect(reader.status().state).toBe('disconnected'); expect(recognize).toHaveBeenCalledOnce()
  })
  it('数量竖线只容许末尾一根，不接受缺数量、混合多数量或相似礼物名的模糊猜测', () => {
    expect(parseScreenCandidates([line('测试路人 送出 小心v心 x1|', 'gift')])).toMatchObject([{ giftName: '小心心', count: 1 }])
    expect(parseScreenCandidates([line('测试路人 送出 小心v心', 'gift')])).toEqual([])
    expect(parseScreenCandidates([line('测试路人 送出 小心v心 x1||', 'gift')])).toEqual([])
    expect(parseScreenCandidates([line('测试路人 送出 小心v心 x1|x99', 'gift')])).toEqual([])
    expect(parseScreenCandidates([line('测试路人 送出 小v心 x1|', 'gift')])[0]?.giftName).toBe('小v心')
  })
  it('实际截图OCR的小心v心和x1竖线经过三帧投递为小心心一次，重复画面不重复入账', async () => {
    vi.useFakeTimers()
    const observations: OCRObservation[] = [
      { text: '测试路人 送出 小心v心', region: 'gift', confidence: .3, bounds: { x: .11258, y: .268, width: .45033, height: .0536 } },
      { text: 'x1|', region: 'gift', confidence: .3, bounds: { x: .66887, y: .268, width: .05298, height: .0402 } },
    ]
    const { reader, candidates } = setup({ recognize: async () => ({ version: 1, observations }) })
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(5100)
    expect(candidates).toHaveBeenCalledOnce()
    expect(candidates.mock.calls[0]![0]).toMatchObject([{ kind: 'gift', userName: '测试路人', giftName: '小心心', count: 1, confirmedFrames: 3 }])
  })
  it('同一卡先截断成小心再滚成小心心，只在名称完整稳定后记一次，不猜补数量或名字', async () => {
    vi.useFakeTimers(); let frame = 0
    const { reader, candidates } = setup({ recognize: async () => ({ version: 1, observations: [line(`测试路人 送出 ${++frame <= 3 ? '小心' : '小心心'} x1`, 'gift')] }) })
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(2100)
    expect(candidates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3100)
    expect(candidates).toHaveBeenCalledOnce()
    expect(candidates.mock.calls[0]![0]).toMatchObject([{ giftName: '小心心', count: 1, confirmedFrames: 3 }])
  })
  it('两条header+左对齐下行tiny x1经过三帧、行去重与controller后各投递1个，不再ignored2', async () => {
    vi.useFakeTimers(); const delivered: LiveEvent[] = []
    const control = createInputFailover({ deliver: event => { delivered.push(event); return { ok: true } } })
    await control.bridgeEvent({ id: 'known-viewer', kind: 'chat', user: { id: 'stable-viewer', name: '小周' }, text: '来坐坐', at: Date.now() })
    control.configureScreen(true); control.bridgeHealth({ state: 'disconnected' })
    const observations: OCRObservation[] = [.35, .42].flatMap(y => [{ text: '小周 送出 小心心', region: 'gift', confidence: .5, bounds: { x: .812, y, width: .17, height: .012 } }, { text: 'x1', region: 'gift', confidence: .5, bounds: { x: .812, y: y + .021, width: .008, height: .009 } }])
    const { reader } = setup({ recognize: async () => ({ version: 1, observations }), onCandidates: rows => { void control.screenCandidates(rows) } })
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(5100); await control.flush()
    const gifts = delivered.filter(event => event.kind === 'gift')
    expect(gifts).toHaveLength(2); expect(gifts.map(event => event.count)).toEqual([1, 1]); expect(gifts.every(event => event.user.id === 'stable-viewer')).toBe(true)
    expect(new Set(gifts.map(event => event.id)).size).toBe(2); expect(control.info()).toMatchObject({ ignored: 0, deliveredScreen: 2 })
    control.dispose()
  })
  it('预热只用中性假图，不请求屏幕权限、窗口或候选，不冒充已接收事件', async () => {
    const permission = vi.fn(() => 'denied'), listSources = vi.fn(async () => [window]), recognize = vi.fn(async request => ({ version: 1, observations: request.warmup ? [] : [line('不能读取：真实窗口')] }))
    const { reader, candidates } = setup({ permission, listSources, recognize })
    expect(await reader.warmup()).toMatchObject({ ready: true }); expect(recognize.mock.calls[0]![0].warmup).toBe(true)
    expect(permission).not.toHaveBeenCalled(); expect(listSources).not.toHaveBeenCalled(); expect(candidates).not.toHaveBeenCalled()
    expect(reader.status()).toMatchObject({ state: 'idle', frames: 0, candidates: 0 }); expect(reader.status().message).toContain('未读取任何真实窗口')
  })
  it('近全白/黑/透明的native失败不能冒充reading或增加有效帧', async () => {
    const { reader, candidates } = setup({ recognize: async () => ({ version: 1, observations: [], error: 'blank-frame' }) })
    await reader.start({ windowId: window.id })
    expect(reader.status()).toMatchObject({ state: 'disconnected', frames: 0, candidates: 0, errorCount: 1 })
    expect(reader.status().message).toContain('全白'); expect(candidates).not.toHaveBeenCalled()
  })
  it('inventory只允许直播伴侣窗口；重复帧只回调一次，停止不影响其它功能', async () => {
    vi.useFakeTimers()
    const { reader, recognize, candidates } = setup({ listSources: async () => [window, { id: 'screen:1:0', name: '抖音直播伴侣' }, { id: 'window:105:0', name: '浏览器' }] })
    expect(await reader.listWindows()).toEqual([window])
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(3100)
    expect(recognize).toHaveBeenCalledTimes(4); expect(candidates).toHaveBeenCalledOnce()
    expect(recognize.mock.calls[0]?.[0]).toEqual({ windowId: 104, regions: [{ region: 'comment', roi: DEFAULT_SCREEN_ROIS.commentRoi }, { region: 'gift', roi: DEFAULT_SCREEN_ROIS.giftRoi }] })
    expect(reader.status()).toMatchObject({ state: 'reading', frames: 4, candidates: 1 })
    reader.stop(); await vi.advanceTimersByTimeAsync(10000); expect(recognize).toHaveBeenCalledTimes(4)
  })
  it('未授权不截图且只显示手动授权说明；窗口丢失自动退避', async () => {
    vi.useFakeTimers()
    const denied = setup({ permission: () => 'denied' }); await denied.reader.start({ windowId: window.id })
    expect(denied.recognize).not.toHaveBeenCalled(); expect(denied.reader.status()).toMatchObject({ state: 'permission-needed' }); expect(denied.reader.status().message).toContain('手动')
    const missing = setup({ listSources: async () => [] }); await missing.reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(3000)
    expect(missing.recognize).not.toHaveBeenCalled(); expect(missing.reader.status().errorCount).toBe(1)
    expect(missing.reader.status().message).toContain('音乐继续')
  })
  it('单任务超时取消，不会并行堆积；迟到结果不派发，随后可重试', async () => {
    vi.useFakeTimers(); let resolve!: (value: { version: number; observations: OCRObservation[] }) => void
    const signals: AbortSignal[] = [], recognize = vi.fn(async (_request, signal: AbortSignal) => { signals.push(signal); return new Promise<{ version: number; observations: OCRObservation[] }>(done => { resolve = done }) })
    const { reader, candidates } = setup({ recognize })
    const starting = reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(1001); await starting
    expect(signals[0]?.aborted).toBe(true); expect(reader.status().state).toBe('disconnected')
    resolve({ version: 1, observations: [line('迟到用户：不能投递')] }); await Promise.resolve()
    expect(candidates).not.toHaveBeenCalled(); expect(recognize).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(4000); expect(recognize).toHaveBeenCalledTimes(2)
  })
  it('停止会取消在途任务，不让迟到候选或预览进入普通状态', async () => {
    let resolve!: (value: { version: number; observations: OCRObservation[] }) => void
    let ready!: () => void; const began = new Promise<void>(done => { ready = done })
    const { reader, candidates } = setup({ recognize: async () => { ready(); return new Promise(finish => { resolve = finish }) } })
    const starting = reader.start({ windowId: window.id }); await began; reader.stop(); await starting
    resolve({ version: 1, observations: [line('迟到用户：不能投递')] }); await Promise.resolve()
    expect(candidates).not.toHaveBeenCalled(); expect(reader.status().state).toBe('idle')
    expect(JSON.stringify(reader.status())).not.toMatch(/data:image|不能投递/)
  })
  it('礼物2→5同一行ID，仅数量变化再发；消失三帧后是新行实例', async () => {
    vi.useFakeTimers(); let frame = 0
    const { reader, candidates } = setup({ recognize: async () => ({ version: 1, observations: ++frame <= 6 ? [line(`小周送出小心心×${frame <= 3 ? 2 : 5}`, 'gift', .3)] : frame <= 9 ? [] : [line('小周送出小心心×1', 'gift', .3)] }) })
    await reader.start({ windowId: window.id }); await vi.advanceTimersByTimeAsync(11000)
    expect(candidates).toHaveBeenCalledTimes(3)
    expect(candidates.mock.calls[0]![0][0].count).toBe(2); expect(candidates.mock.calls[1]![0][0].count).toBe(5)
    expect(candidates.mock.calls[1]![0][0].fingerprint).toBe(candidates.mock.calls[0]![0][0].fingerprint)
    expect(candidates.mock.calls[2]![0][0].fingerprint).not.toBe(candidates.mock.calls[0]![0][0].fingerprint)
    expect(candidates.mock.calls[0]![0][0]).toMatchObject({ confidence: .3, confirmedFrames: 3 })
  })
  it('预览只给两张ROI裁图，状态和候选不携带图像', async () => {
    const { reader, candidates } = setup({ recognize: async request => ({ version: 1, observations: [], images: request.regions.map(item => ({ ...item, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' })) }) })
    const result = await reader.preview({ windowId: window.id })
    expect(result.images).toHaveLength(2); expect(candidates).not.toHaveBeenCalled(); expect(JSON.stringify(reader.status())).not.toContain('data:image')
    await expect(reader.preview({ windowId: 'screen:1:0' })).rejects.toThrow('请选择')
  })
})
