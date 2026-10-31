import { expect, test } from 'vitest'
import { alignReplyPerformance } from '../packages/core/src/reply-performance'
import { ACTIONS } from '../packages/core/src/defaults'
import { FACES, type Reply } from '../packages/shared/src'
const reply = (say: string, face: Reply['face'], action: string): Reply => ({ id: 'performance-a', say: [say], face, action, source: 'deepseek', station: 'counter', voiceStyle: '', status: 'ready', createdAt: 1 })
test('生气、喜欢、开心的明确台词修正冲突表情与动作', () => {
  const angry = alignReplyPerformance(reply('本店长有点生气，哼！', 'happy', 'heart'))
  expect(angry.face).toBe('angry'); expect(['akimbo', 'shake']).toContain(angry.action)
  const love = alignReplyPerformance(reply('给你比个心，今天辛苦啦。', 'angry', 'akimbo'))
  expect(love.face).toBe('love'); expect(['heart', 'cheer', 'bow', 'serve', 'cocoa', 'toast', 'gift_open']).toContain(love.action)
  const happy = alignReplyPerformance(reply('好耶，太棒啦！', 'sad', 'blanket'))
  expect(happy.face).toBe('happy'); expect(['giggle', 'flap', 'wave', 'hop', 'dance', 'toast', 'cheer']).toContain(happy.action)
})
test('安慰不因“别生气”误判，场景饮品动作与主动表情保持', () => {
  const comfort = alignReplyPerformance(reply('别生气，先喝口热茶，我听你说。', 'worried', 'hop'))
  expect(comfort.face).toBe('worried'); expect(['listen', 'blanket', 'tea', 'serve']).toContain(comfort.action)
  expect(alignReplyPerformance(reply('我给你冲杯咖啡。', 'happy', 'brew_coffee')).action).toBe('brew_coffee')
})
test('19种表情的修正始终只使用现有库，语气也可送给配音', () => {
  for (const face of FACES) {
    const value = alignReplyPerformance(reply('本店长正在想事情。', face.id, 'stand'))
    expect(ACTIONS.some(action => action.id === value.action)).toBe(true)
    expect(FACES.some(face => face.id === value.face)).toBe(true)
    expect(value.voiceStyle).not.toBe('')
  }
})
