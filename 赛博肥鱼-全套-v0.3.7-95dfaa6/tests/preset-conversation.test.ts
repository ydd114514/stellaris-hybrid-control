import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, defaultGifts } from '../packages/core/src/defaults'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { getShopTime } from '../packages/shared/src'
import type { LiveEvent } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.useRealTimers() })
async function replyFor(kind: LiveEvent['kind'], value = '', catchphrase?: string) {
  const config = structuredClone(defaultConfig)
  config.demo = true; config.voice.enabled = false; config.idle.enabled = false; config.music.bgmEnabled = false
  if (catchphrase !== undefined) config.persona.catchphrase = catchphrase
  const fetch = vi.fn(async () => { throw new Error('离线测试禁止真实服务') })
  const runtime = createRuntime({ fetch, store: { load: () => ({ config }), save() {} } }); runtimes.push(runtime)
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'preset', kind, user: { id: 'guest', name: '小猫' }, text: value, at: Date.now() } })
  await runtime.flush()
  expect(fetch).not.toHaveBeenCalled()
  return runtime.getState().history[0]!
}

describe('预设不把聊天拉回固定茶水招呼', () => {
  it.each([['enter',''],['follow',''],['chat','你好'],['chat','今天工作好累'],['chat','给你喝彩'],['chat','店里的音乐真好听'],['chat','这只小猫好可爱'],['chat','刚才发生了一件有意思的事']])('%s %s 不主动引茶水或靠窗座', async (kind, text) => {
    const reply = await replyFor(kind as LiveEvent['kind'], text)
    expect(reply.say.join('')).not.toMatch(/热水|来杯|喝点|先喝|靠窗|窗边|烦恼寄存/)
    expect(reply.action).not.toMatch(/brew_coffee|^tea$|^serve$/)
  })
  it.each([['想喝咖啡','咖啡','brew_coffee'],['给我泡一杯茶','茶','tea']])('明确点%s时仍正常处理饮品', async (question, word, action) => {
    const reply = await replyFor('chat', question)
    expect(reply.say.join('')).toContain(word)
    expect(reply.say.join('')).toContain('甜度')
    expect(reply.action).toBe(action)
  })
  it('只迁移逐字相同的旧口头禅，自定义口头禅和礼物台词保留', async () => {
    const config = structuredClone(defaultConfig)
    config.persona.catchphrase = '坐会儿吧，热水管够。'
    expect(validateConfig(config).persona.catchphrase).toBe(defaultConfig.persona.catchphrase)
    const custom = '坐会儿吧，热水管够。喵！'
    config.persona.catchphrase = custom
    expect(validateConfig(config).persona.catchphrase).toBe(custom)
    const reply = await replyFor('chat', '你好', custom)
    expect(reply.say).toContain(custom)
    expect(defaultGifts.find(gift => gift.id === 'coffee')!.template).toContain('这杯我来冲')
  })
  it.each(['morning','day','dusk','night'] as const)('%s 默认开门问候不再预设茶水话题', phase => {
    expect(getShopTime(Date.now(), undefined, phase).greeting).not.toMatch(/热水|喝|茶|靠窗|窗边/)
  })
})
