import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIONS, defaultConfig, defaultGifts } from '../packages/core/src/defaults'
import { createRuntime } from '../packages/core/src/runtime'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const morning = new Date(2026, 9, 26, 8, 0).getTime()
function make(gifts = structuredClone(defaultGifts)) {
  const config = structuredClone(defaultConfig)
  config.demo = true; config.voice.enabled = false; config.idle.enabled = false; config.music.bgmEnabled = false
  const fetch = vi.fn(async () => { throw new Error('离线测试禁止真实服务') })
  const runtime = createRuntime({ now: () => morning, fetch, store: { load: () => ({ config, gifts }), save() {} } }); runtimes.push(runtime)
  return { runtime, fetch }
}

describe('预设台词不默认夜晚', () => {
  it('晨间礼物预设使用中性时段，动作说明不把当班热茶固定为晚安茶', async () => {
    const { runtime, fetch } = make()
    await runtime.command({ type: 'start' })
    await runtime.command({ type: 'inject', event: { id: 'morning-heart', kind: 'gift', user: { id: 'guest', name: '晨间客人' }, giftId: 'heart', giftName: '小心心', count: 2, origin: 'simulator', at: morning } })
    await runtime.flush()
    const said = runtime.getState().history[0]!.say.join('')
    expect(said).toContain('晨间客人的2颗小心心，这会儿的小店又暖了一点')
    expect(said).not.toContain('今晚')
    expect(ACTIONS.find(action => action.id === 'tea')).toMatchObject({ name: '泡热茶', about: '提起小茶壶倒一杯当班热茶' })
    for (const id of ['write_note', 'fortune', 'umbrella']) expect(ACTIONS.find(action => action.id === id)!.about).not.toMatch(/今晚|晚归/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['heart', '谢谢{name}的{count}颗小心心，今晚的小店又暖了一点。'],
    ['light', '谢谢{name}的小灯笼，给晚归的人留一盏灯。'],
  ])('只迁移%s的完整旧默认模板，保留奖励和动作设置', (id, template) => {
    const original = { ...defaultGifts.find(rule => rule.id === id)!, template, tokens: 17, yuan: .27, points: 8, action: 'wave', enabled: false }
    const { runtime } = make([original])
    expect(runtime.getState().gifts[0]).toEqual({ ...original, template: defaultGifts.find(rule => rule.id === id)!.template })
  })
  it('用户自定义或仅近似旧默认的台词保持逐字不变', () => {
    const custom = [
      { ...defaultGifts[0]!, template: '谢谢{name}的{count}颗小心心，今晚的小店又暖了一点。喵！' },
      { ...defaultGifts.find(rule => rule.id === 'light')!, template: '谢谢{name}，这是我为你写的晚归灯光。' },
    ]
    const { runtime } = make(custom)
    expect(runtime.getState().gifts).toEqual(custom)
  })
})
