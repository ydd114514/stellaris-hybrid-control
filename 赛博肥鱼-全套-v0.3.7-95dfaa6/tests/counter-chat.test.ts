import { describe, expect, it } from 'vitest'
import type { Reply } from '../packages/shared/src'
import { counterChat } from '../apps/stage/counter-chat'
const reply = (id: string, patch: Partial<Reply> = {}): Reply => ({ id, viewerName: '听雨', heard: '早上好', say: ['给你一杯早安茶。'], face: 'happy', action: 'wave', station: null, voiceStyle: '', status: 'done', source: 'deepseek', createdAt: Number(id) || 0, ...patch })

describe('柜台聊天记录', () => {
  it('只展示已公开说出的对话，草稿、跳过与空原话不进入舞台', () => {
    const rows = counterChat([reply('1'), reply('2', { status: 'draft' }), reply('3', { status: 'ready' }), reply('4', { status: 'skipped' }), reply('5', { heard: '' })])
    expect(rows.map(row => row.id)).toEqual(['1'])
  })
  it('最近两轮按聊天先后排列，同条刷新不重复，正在播的回复可见', () => {
    const rows = counterChat([reply('2'), reply('1'), reply('3', { status: 'speaking' }), reply('3')])
    expect(rows.map(row => row.id)).toEqual(['2', '3'])
    expect(rows[1]).toMatchObject({ name: '听雨', heard: '早上好', reply: '给你一杯早安茶。' })
  })
  it('长昵称和原话保留开头并明确省略，控制字符与疑似凭证不外显', () => {
    const rows = counterChat([reply('1', { viewerName: '这是非常非常长的模拟观众昵称', heard: 'sk-neverExpose123456 今天\n想聊一聊'.repeat(20), say: ['sk-secretToken123456 配音和聊天都很好。'.repeat(20)] })])
    expect(rows[0]!.name).toContain('…'); expect(rows[0]!.heard).toContain('…'); expect(rows[0]!.reply).toContain('…')
    expect(JSON.stringify(rows)).not.toMatch(/neverExpose|secretToken|\\n/)
    expect(rows[0]!.heard).toContain('[已隐藏]')
  })
  it('同一事件生成两个不同回复编号时只展示最新一条', () => {
    const rows = counterChat([reply('1', { eventId: 'event-1' }), reply('2', { eventId: 'event-1' }), reply('3', { eventId: 'event-2' })])
    expect(rows.map(row => row.id)).toEqual(['2', '3'])
  })
  it('不同事件与无事件编号的同名同句仍各自保留，不按昵称猜身份', () => {
    expect(counterChat([reply('1', { eventId: 'event-1' }), reply('2', { eventId: 'event-2' })]).map(row => row.id)).toEqual(['1', '2'])
    expect(counterChat([reply('1'), reply('2')]).map(row => row.id)).toEqual(['1', '2'])
  })
})
