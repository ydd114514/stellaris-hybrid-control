import { describe, expect, it } from 'vitest'
import { createDefaultState } from '../packages/core/src/defaults'
import { audienceTip, audienceTips } from '../apps/stage/audience-care'

describe('观众互动轮播', () => {
  it('免费互动占多数，点歌、保护与取消均按实际配置解释', () => {
    const state = createDefaultState(), tips = audienceTips(state.config.music, state.gifts, 0)
    expect(tips.filter(t => t.kind === 'free').length).toBeGreaterThan(tips.filter(t => t.kind === 'gift').length)
    expect(tips.find(t => t.id === 'song')?.lines.join('')).toContain('QQ 可播就排队')
    expect(tips.find(t => t.id === 'skip')?.lines.join('')).toContain(`${state.config.music.minPlaySeconds} 秒`)
    expect(tips.find(t => t.id === 'cancel')?.lines.join('')).toContain('自己的')
    expect(tips.find(t => t.id === 'song-hearts')?.lines.join('')).toContain('播出清零，下轮重算')
  })

  it('口粮规则与表演开关独立，轮流展示礼物且零补充不展示', () => {
    const state = createDefaultState()
    state.gifts[0]!.enabled = false
    state.gifts[0]!.tokens = 2500
    state.gifts[1]!.tokens = 0
    const first = audienceTips(state.config.music, state.gifts, 0), second = audienceTips(state.config.music, state.gifts, first.length)
    expect(first.find(t => t.id === 'gift:heart')?.lines[0]).toContain('+2,500 token')
    expect(second.some(t => t.id === 'gift:coffee')).toBe(false)
    expect(second.find(t => t.id.startsWith('gift:'))?.id).toBe('gift:star')
  })

  it('关点歌时只说明关闭，不继续展示点歌或小心心排名', () => {
    const state = createDefaultState(); state.config.music.enabled = false
    const tips = audienceTips(state.config.music, state.gifts, 0)
    expect(tips.some(t => t.id === 'song' || t.id === 'skip' || t.id === 'song-hearts')).toBe(false)
    expect(tips.find(t => t.id === 'pause-songs')?.lines[0]).toContain('关闭点歌')
    expect(tips.filter(t => t.kind === 'free').length).toBeGreaterThan(tips.filter(t => t.kind === 'gift').length)
  })

  it('熟客限制、关闭自动搜歌及按步轮换不会虚构开放入口', () => {
    const state = createDefaultState(); state.config.music.requestPolicy = 'regular'; state.config.music.qqAutoSearch = false
    expect(audienceTip(state.config.music, state.gifts, 0).lines).toEqual(['熟客可发「点歌 歌名 歌手」', '从小店已收录歌曲里点一首'])
    expect(audienceTip(state.config.music, state.gifts, 1).id).toBe('chat')
    expect(audienceTip(state.config.music, state.gifts, -10).id).toBe('song')
  })
})
