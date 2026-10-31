import { describe, expect, it } from 'vitest'
import { getSkinAiName, getSkinIdentityLabel, SKINS } from '../packages/shared/src'

describe('DeepSeek本体与AI装扮目录', () => {
  it('八种原有配色保留，并且各有清楚AI名称', () => {
    expect(SKINS.map(skin => [skin.id, skin.ai])).toEqual([['deepseek','DeepSeek'],['harness','DeepSeek Harness'],['chatgpt','ChatGPT'],['claude','Claude'],['gemini','Gemini'],['qwen','千问 (Qwen)'],['kimi','Kimi'],['minimax','MiniMax']])
    expect(SKINS.find(skin => skin.id === 'claude')).toMatchObject({ name: '暖陶橙', color: '#D97757' })
  })
  it('原版与Harness属于自己的形态，其余为扮演，未知旧值回到DeepSeek', () => {
    expect(getSkinIdentityLabel('deepseek')).toBe('DeepSeek 本体 · 原版形象')
    expect(getSkinIdentityLabel('harness')).toBe('DeepSeek 本体 · 自己的 Harness 形态')
    expect(getSkinIdentityLabel('claude')).toBe('DeepSeek 本体 · 正在扮 Claude')
    expect(getSkinAiName('removed-old-skin')).toBe('DeepSeek')
    expect(getSkinIdentityLabel('removed-old-skin')).toBe('DeepSeek 本体 · 原版形象')
  })
})
