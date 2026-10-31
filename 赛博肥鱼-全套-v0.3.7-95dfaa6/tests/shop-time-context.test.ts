import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { createDefaultState, defaultConfig, LEGACY_PERSONALITY } from '../packages/core/src/defaults'
import { getShopTimeContext, SHOP_TIME_RULES } from '../packages/core/src/time-context'
import { getShopTime, type ShopTimePeriod } from '../packages/shared/src/shop-time'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose() })

describe('真实本地时间与布景分离', () => {
  it.each([
    ['05:59', 'night', '夜晚'], ['06:00', 'morning', '晨间'], ['09:59', 'morning', '晨间'],
    ['10:00', 'day', '白天'], ['16:59', 'day', '白天'], ['17:00', 'dusk', '黄昏'],
    ['19:59', 'dusk', '黄昏'], ['20:00', 'night', '夜晚'],
  ] as const)('%s 的真实阶段为 %s，AI日期与标题沿用同一时间', (clock, phase, label) => {
    const at = Date.parse(`2026-10-26T${clock}:00+08:00`)
    const time = getShopTime(at, 'Asia/Shanghai')
    const context = getShopTimeContext(at, 'auto', '肥鱼深夜小店', 'Asia/Shanghai')
    expect(time.actualPhase).toBe(phase)
    expect(context.时间).toContain(`2026/10/26`)
    expect(context.时间).toContain(clock)
    expect(context.时间).toContain(`真实时段：${label}`)
    expect(context.小店标题).toBe(time.title)
    expect(context.时段布景).toContain('自动随本机时间')
  })

  it('手动深夜只改变布景标题，真实白天与日期、问候保持不变', () => {
    const at = Date.parse('2026-10-26T12:34:00+08:00')
    const automatic = getShopTimeContext(at, 'auto', '肥鱼深夜小店', 'Asia/Shanghai')
    const manual = getShopTimeContext(at, 'night', '肥鱼深夜小店', 'Asia/Shanghai')
    expect(manual.时间).toBe(automatic.时间)
    expect(manual.时间).toContain('真实时段：白天')
    expect(manual.问候).toBe(automatic.问候)
    expect(manual.小店标题).toBe('肥鱼深夜小店')
    expect(manual.时段布景).toContain('店长手动布景模拟：夜晚')
    expect(manual.时段布景).toContain('真实日期与时钟不变')
    expect(manual.当班菜单.茶名).toBe('晚安茶')
    expect(manual.当班菜单.来源).toContain('手动排练布景')
  })

  it('同一时刻的真实日期以所选本地时区为准，布景不能改日期', () => {
    const at = Date.parse('2026-10-26T00:30:00+08:00')
    expect(getShopTimeContext(at, 'day', undefined, 'Asia/Shanghai').时间).toContain('2026/10/26')
    const america = getShopTimeContext(at, 'night', undefined, 'America/New_York')
    expect(america.时间).toContain('2026/10/25')
    expect(america.时间).toContain('America/New_York')
    expect(america.时间).toContain('真实时段：白天')
  })

  it('旧配置默认自动，非法值回退自动，不覆盖保存的人设与店名', () => {
    expect(validateConfig({ look: { scheme: 'claude', outfit: 'cape' }, persona: { name: '我的肥鱼', personality: LEGACY_PERSONALITY } }).look.timeOfDay).toBe('auto')
    expect(validateConfig({ look: { timeOfDay: 'moon' } }).look.timeOfDay).toBe('auto')
    expect(validateConfig({ look: { timeOfDay: null } }).look.timeOfDay).toBe('auto')
    for (const timeOfDay of ['auto', 'morning', 'day', 'dusk', 'night'] as const) expect(validateConfig({ look: { timeOfDay } }).look.timeOfDay).toBe(timeOfDay)
    expect(validateConfig({ persona: { name: '我的肥鱼', personality: LEGACY_PERSONALITY } }).persona).toMatchObject({ name: '我的肥鱼', personality: LEGACY_PERSONALITY })
    expect(defaultConfig.look.timeOfDay).toBe('auto')
    expect(getShopTimeContext(Date.now(), 'day', '猫咪的咖啡角').小店标题).toBe('猫咪的咖啡角')
  })
  it.each([['08:00', '早安茶', '一点元气'], ['12:00', '清爽茶', '一点轻松'], ['18:00', '晚风茶', '一点松弛'], ['23:00', '晚安茶', '一点好梦']])('%s 的AI当班茶名与舞台共用', (clock, tea, note) => {
    const at = Date.parse(`2026-10-26T${clock}:00+08:00`)
    const context = getShopTimeContext(at, 'auto', undefined, 'Asia/Shanghai')
    expect(context.当班菜单).toMatchObject({ 茶名: tea, 茶注: note, 热咖啡: '一份清醒', 听你说: '随时免费' })
    expect(context.当班菜单.茶名).toBe(getShopTime(at, 'Asia/Shanghai').teaLabel)
  })
})

function modelRuntime(at: number, period: ShopTimePeriod = 'auto') {
  let clock = at
  const bodies: any[] = []
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: ['来店里坐坐。'], face: 'happy', action: 'wave' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
  })
  const config = structuredClone(defaultConfig)
  config.demo = false; config.voice.enabled = false; config.idle.aiChatter = false
  config.look.timeOfDay = period
  config.persona.personality = '我只在深夜营业，不管几点都要说现在是半夜，天气正在下雨，店里只卖晚安茶。'
  const runtime = createRuntime({ now: () => clock, fetch: fetch as typeof globalThis.fetch, credentials: { get: () => 'offline-model-key', set() {}, encrypted: true }, store: { load: () => ({ config }), save() {} } })
  runtimes.push(runtime)
  return { runtime, bodies, setClock(value: number) { clock = value } }
}

describe('AI固定时间事实与免费排练', () => {
  it('白天请求携带真实日期、白天标题和不造天气约束，旧夜间人设保持原样', async () => {
    const at = new Date(2026, 9, 26, 12, 34).getTime()
    const { runtime, bodies } = modelRuntime(at)
    await runtime.command({ type: 'start' })
    await runtime.command({ type: 'inject', event: { id: 'day-context', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '店长你好', at } })
    await runtime.flush()
    const system = bodies[0].messages[0].content as string
    const context = JSON.parse(bodies[0].messages.at(-1).content).此刻
    expect(runtime.getState().config.persona.personality).toContain('我只在深夜营业')
    expect(system.indexOf('我只在深夜营业')).toBeLessThan(system.indexOf(SHOP_TIME_RULES))
    expect(system).toContain('晨间和白天不要自称深夜')
    expect(context.时间).toContain('2026/10/26')
    expect(context.时间).toContain('12:34')
    expect(context.时间).toContain('真实时段：白天')
    expect(context.小店标题).toBe('肥鱼日间小店')
    expect(context.当班菜单.茶名).toBe('清爽茶')
    expect(system).toContain('茶名必须与画面菜单一致')
    expect(runtime.getState().config.persona.personality).toContain('店里只卖晚安茶')
    expect(context.天气).toContain('未接入真实天气')
    expect(context.小店).toContain('虚拟窗景：雨天')
    expect(context.心情).not.toContain('准备打烊')
    expect(context.心情).not.toContain('今晚')
  })

  it('手动晨间排练不篡改真实深夜日期与心情', async () => {
    const at = new Date(2026, 9, 26, 1, 23).getTime()
    const { runtime, bodies } = modelRuntime(at, 'morning')
    await runtime.command({ type: 'start' })
    await runtime.command({ type: 'inject', event: { id: 'manual-context', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '这是清晨吗', at } })
    await runtime.flush()
    const context = JSON.parse(bodies[0].messages.at(-1).content).此刻
    expect(context.时间).toContain('01:23')
    expect(context.时间).toContain('真实时段：夜晚')
    expect(context.时段布景).toContain('店长手动布景模拟：晨间')
    expect(context.小店标题).toBe('肥鱼晨光小店')
    expect(context.心情.个人底色).toContain('过了零点')
  })

  it('跨时段仅刷新请求末尾的此刻资料，保留稳定缓存前缀', async () => {
    const at = new Date(2026, 9, 26, 9, 59).getTime()
    const { runtime, bodies, setClock } = modelRuntime(at)
    await runtime.command({ type: 'start' })
    await runtime.command({ type: 'inject', event: { id: 'time-before', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '早上喝什么', at } })
    await runtime.flush()
    const replyId = runtime.getState().stage.replyId
    if (replyId) await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId } })
    await runtime.flush()
    setClock(at + 60000)
    await runtime.command({ type: 'inject', event: { id: 'time-after', kind: 'chat', user: { id: 'two', name: '新客人' }, text: '现在喝什么', at: at + 60000 } })
    await runtime.flush()
    expect(bodies).toHaveLength(2)
    expect(bodies[0].messages[0]).toEqual(bodies[1].messages[0])
    expect(JSON.parse(bodies[0].messages.at(-1).content).此刻.小店标题).toBe('肥鱼晨光小店')
    expect(JSON.parse(bodies[1].messages.at(-1).content).此刻.小店标题).toBe('肥鱼日间小店')
  })

  it('白天免费问候和默认舞台不再自称深夜，天气排练不编造实况', async () => {
    const at = new Date(2026, 9, 26, 12, 34).getTime()
    const fetch = vi.fn(), runtime = createRuntime({ now: () => at, fetch })
    runtimes.push(runtime)
    expect(createDefaultState(at).stage.text).toBe(getShopTime(at).greeting)
    await runtime.command({ type: 'start' })
    await runtime.command({ type: 'inject', event: { id: 'free-day', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '你好', at } })
    await runtime.flush()
    expect(runtime.getState().stage.text).not.toContain('晚上好')
    expect(runtime.getState().stage.text).not.toContain('夜很长')
    await runtime.command({ type: 'interrupt' })
    await runtime.command({ type: 'inject', event: { id: 'free-weather', kind: 'chat', user: { id: 'two', name: '新客人' }, text: '窗外天气怎么样', at } })
    await runtime.flush()
    expect(runtime.getState().stage.text).toContain('现实天气我还不知道')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('进场问候不编造熟客关系', () => {
  it.each([false, true])('只有已有来访记录才称又见面（已有记录：%s）', async returning => {
    const instance = createRuntime({ store: { load: () => returning ? { viewers: [{ id: 'guest', name: '客人', visits: 2, gifts: 0, blocked: false, note: '' }] } : undefined, save() {} } })
    runtimes.push(instance)
    await instance.command({ type: 'set-config', config: { ...instance.getState().config, voice: { ...instance.getState().config.voice, enabled: false } } })
    await instance.command({ type: 'start' })
    await instance.command({ type: 'inject', event: { id: `enter-${returning}`, kind: 'enter', user: { id: 'guest', name: '客人' }, at: Date.now() } })
    await instance.flush()
    const said = instance.getState().stage.text
    expect(said).not.toContain('老位置')
    if (returning) expect(said).toContain('又见面')
    else { expect(said).toContain('欢迎进店'); expect(said).not.toContain('又'); expect(said).not.toContain('回来') }
  })
})
