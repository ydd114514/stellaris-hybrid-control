import { afterEach, expect, test, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { CONVERSATION_RULES, conversationContext } from '../packages/core/src/conversation'
import type { Viewer } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const viewer: Viewer = { id: 'one', name: '同名客人', visits: 1, gifts: 0, blocked: false, note: '' }
test('昵称相同仍只接当前稳定身份的个人对话，不从公共摘要串记忆', () => {
  const context = conversationContext(viewer, [
    { userId: 'other', name: viewer.name, heard: '我喜欢咖啡', said: '坐窗边吧', at: 1 },
    { userId: viewer.id, name: viewer.name, heard: '我喜欢可可', said: '甜一点还是淡一点？', at: 2 },
  ])
  expect(JSON.stringify(context)).toContain('可可'); expect(JSON.stringify(context)).not.toContain('咖啡')
  expect(context.对话节奏).toContain('当前答案')
})

test('普通话题不被旧饮品偏好带回茶水套路，明确问菜单时才接饮品', () => {
  const turns = [{ userId: viewer.id, name: viewer.name, heard: '我喜欢热可可', said: '热可可给你。', at: 1 }]
  expect(conversationContext(viewer, turns, '你怎么穿着Claude的衣服？').本句接话重点).toContain('只接当前话题')
  expect(conversationContext(viewer, turns, '今天工作弄得很烦').本句接话重点).toContain('不主动提茶水')
  expect(conversationContext(viewer, turns, '我那杯茶能不能不要太甜？').本句接话重点).toContain('确实涉及饮品')
  expect(conversationContext(viewer, turns, '你菜单里有什么？').本句接话重点).toContain('确实涉及饮品')
})

test.each(['欢迎大家来肥鱼茶话铺。', '这家茶话铺的灯真好看。', '茶馆重新装修了吗？', '那家茶楼的窗户好漂亮。', '茶室的背景真安静。'])('场所名不把普通问候和装修话题变成点饮品：%s', message => {
  expect(conversationContext(viewer, [], message).本句接话重点).toContain('只接当前话题')
})

test.each(['你们茶馆的咖啡好喝吗？', '欢迎来肥鱼茶话铺，我想喝杯茶。', '肥鱼茶话铺的菜单里有什么？', '那家茶楼有无糖可可吗？', '今天想喝茶。'])('场所名旁仍识别真实饮品和菜单问题：%s', message => {
  expect(conversationContext(viewer, [], message).本句接话重点).toContain('确实涉及饮品')
})

test('换配色后告诉模型当前形象与真实服务，旧人设不强迫橙色角色自称蓝发', async () => {
  const bodies: any[] = []
  const runtime = createRuntime({ credentials: { get: () => 'offline-look-key', set() {}, encrypted: true }, fetch: (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['今天换了暖陶橙配色。'], face: 'happy', action: 'wave' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  }) as typeof globalThis.fetch }); runtimes.push(runtime)
  const cfg = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...cfg, demo: false, look: { ...cfg.look, scheme: 'claude' }, voice: { ...cfg.voice, enabled: false }, idle: { ...cfg.idle, enabled: false }, music: { ...cfg.music, bgmEnabled: false }, persona: { ...cfg.persona, personality: '我是一条蓝头发的鲸鱼娘。' } } })
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'look-context', kind: 'chat', user: { id: 'look-user', name: '阿黎' }, text: '你今天怎么是橙色的呀？', at: Date.now() } }); await runtime.flush()
  const context = JSON.parse(bodies[0].messages.at(-1).content).此刻
  expect(context.当前形象).toMatchObject({ 本体: 'DeepSeek 大肥鱼', 当前扮演AI: 'Claude', 配色: '暖陶橙', 配色代号: 'claude' })
  expect(context.当前服务.对话服务).toBe('DeepSeek')
  expect(bodies[0].messages[0].content).toContain('DeepSeek大肥鱼装别的AI')
  expect(runtime.getState().config.persona.personality).toBe('我是一条蓝头发的鲸鱼娘。')
})

test('音乐现场按实际播放回执报告，并用稳定身份区分同名客人的点歌', async () => {
  const bodies: any[] = []
  const runtime = createRuntime({ credentials: { get: () => 'offline-music-context', set() {}, encrypted: true }, fetch: (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['坐着听歌吧。'], face: 'happy', action: 'music' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  }) as typeof globalThis.fetch }); runtimes.push(runtime)
  const cfg = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...cfg, demo: false, voice: { ...cfg.voice, enabled: false }, idle: { ...cfg.idle, enabled: false }, music: { ...cfg.music, bgmEnabled: false, requestPolicy: 'all', globalCooldownSeconds: 0 } } })
  await runtime.command({ type: 'music-set-tracks', tracks: [{ id: 'morning', title: '晨光小调', artist: '店长', source: 'https://example.com/morning.mp3' }] })
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'song-own', kind: 'chat', user: { id: 'one', name: '同名客人' }, text: '点歌 晨光小调', at: Date.now() } })
  const current = runtime.getState().music.current!
  expect(current).toBeDefined(); expect(current.startedAt).toBeUndefined()
  await runtime.command({ type: 'music-started', generationId: current.generationId })
  const finish = async () => { const replyId = runtime.getState().stage.replyId; if (replyId) await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId } }) }
  await runtime.flush(); await finish()
  for (const id of ['one', 'other']) {
    await runtime.command({ type: 'inject', event: { id: `music-chat-${id}`, kind: 'chat', user: { id, name: '同名客人' }, text: '我点的歌现在是什么状态呀？', at: Date.now() } }); await runtime.flush(); await finish()
  }
  const mine = JSON.parse(bodies[0].messages.at(-1).content).此刻, other = JSON.parse(bodies[1].messages.at(-1).content).此刻
  expect(mine.音乐现场.当前歌曲).toMatchObject({ 歌名: '晨光小调', 已实际开始: true, 背景音乐: false })
  expect(mine.这位客人的点歌.当前歌曲.歌名).toBe('晨光小调')
  expect(other.这位客人的点歌.当前歌曲).toBeNull()
})

test('每个观众的模型记忆随回复持久保存，下次回答带本人上下文和情绪引导', async () => {
  let saved: any, n = 0
  const bodies: any[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['可可来啦，今天想坐窗边还是柜台？'], face: 'happy', action: 'serve', memory_note: '喜欢喝热可可' }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  })
  const options = { fetch: fetch as typeof globalThis.fetch, credentials: { get: () => 'offline-memory-key', set() {}, encrypted: true }, store: { load: () => saved, save: (value: any) => { saved = structuredClone(value) } } }
  const runtime = createRuntime(options); runtimes.push(runtime)
  const cfg = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...cfg, demo: false, voice: { ...cfg.voice, enabled: false }, idle: { ...cfg.idle, enabled: false }, music: { ...cfg.music, bgmEnabled: false } } })
  await runtime.command({ type: 'start' })
  const inject = async (id: string, message: string) => { await runtime.command({ type: 'inject', event: { id: `own-${++n}`, kind: 'chat', text: message, user: { id, name: '同名客人' }, at: Date.now() } }); await runtime.flush() }
  await inject('one', '我喜欢喝热可可')
  expect(runtime.getState().viewers.find(row => row.id === 'one')?.memory?.facts).toContain('喜欢喝热可可')
  const reply = runtime.getState().stage.replyId!
  await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: reply } })
  await inject('one', '我想坐窗边，甜一点')
  const context = JSON.parse(bodies.at(-1).messages.at(-1).content).此刻
  expect(context.这位客人刚才聊的[0].客人说).toBe('我喜欢喝热可可')
  expect(bodies.at(-1).messages[0].content).toContain(CONVERSATION_RULES)
  runtime.dispose(); runtimes.pop()
  const restored = createRuntime(options); runtimes.push(restored)
  expect(restored.getState().viewers.find(row => row.id === 'one')?.memory?.facts).toContain('喜欢喝热可可')
  expect(restored.getState().viewers.find(row => row.id === 'other')?.memory).toBeUndefined()
})
