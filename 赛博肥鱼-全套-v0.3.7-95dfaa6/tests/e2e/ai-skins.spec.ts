import { expect, test } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

test('八种AI形象名称对应原配色，DeepSeek本体与扮演清楚，切换保留衣服及其它配置', async ({ page }, info) => {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false; state.stage.muted = true
  state.config.look = { scheme: 'deepseek', outfit: 'cape', timeOfDay: 'dusk' }
  state.config.audio.musicGain = .23; state.config.music.qqAutoSearch = false; state.config.vote.enabled = false
  state.shop.scene = 'snow'; state.config.safety.blockedWords = ['保留这一条']
  await page.addInitScript(initial => {
    let current = initial
    const listeners = new Set<(value: typeof initial) => void>(), changes: typeof initial.config[] = []
    Object.assign(window, { __skinConfigChanges: changes })
    window.shop = { async getState() { return current }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, async command(command) {
      if (command.type === 'set-config') { current = { ...current, config: command.config }; changes.push(JSON.parse(JSON.stringify(command.config))); for (const listener of listeners) listener(JSON.parse(JSON.stringify(current))) }
      return { ok: true }
    }, async openStage() {}, async exportLogs() { return { ok: true } } }
  }, state)
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('navigation').getByRole('button', { name: '形象与动作', exact: true }).click()
  const skins = page.getByTestId('ai-skins'), identity = page.getByTestId('skin-identity')
  await expect(page.getByText('观众可提议换 AI 形象；同时有已记录的关注和赠礼后，还要和肥鱼拉扯几轮。店长手动换装随时可用。', { exact: true })).toBeVisible()
  const choices = [
    ['deepseek', 'DeepSeek', '深海蓝'], ['harness', 'DeepSeek Harness', '夜幕黑'], ['chatgpt', 'ChatGPT', '月光银'], ['claude', 'Claude', '暖陶橙'],
    ['gemini', 'Gemini', '四色糖'], ['qwen', '千问 (Qwen)', '薰衣紫'], ['kimi', 'Kimi', '午夜蓝'], ['minimax', 'MiniMax', '玫瑰橙'],
  ]
  await expect(skins.getByRole('button')).toHaveCount(8)
  for (const [id, ai, color] of choices) {
    const button = skins.getByRole('button', { name: `形象 ${ai} · ${color}`, exact: true })
    await expect(button.locator('strong')).toHaveText(ai!); await expect(button.locator('small')).toHaveText(color!)
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(skins.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(identity).toHaveText(id === 'deepseek' ? 'DeepSeek 本体 · 原版形象' : id === 'harness' ? 'DeepSeek 本体 · 自己的 Harness 形态' : `DeepSeek 本体 · 正在扮 ${ai}`)
    await expect(page.getByRole('button', { name: '斗篷', exact: true })).toHaveClass(/selected/)
    await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'dusk'); await expect(page.getByTestId('stage')).toHaveAttribute('data-scene', 'snow')
  }
  for (const outfit of ['女仆裙', '牛仔装', '南瓜女巫', '幽灵斗篷', '斗篷', '店员装']) { await page.getByRole('button', { name: outfit, exact: true }).click(); await expect(page.getByRole('button', { name: outfit, exact: true })).toHaveClass(/selected/) }
  const changes = await page.evaluate(() => (window as any).__skinConfigChanges as typeof state.config[])
  expect(changes).toHaveLength(14)
  for (const config of changes) expect({ ...config, look: { ...config.look, scheme: state.config.look.scheme, outfit: state.config.look.outfit } }).toEqual(state.config)
  await expect(identity).toHaveText('DeepSeek 本体 · 正在扮 MiniMax')
  await page.waitForTimeout(300); await page.screenshot({ path: info.outputPath('deepseek-ai-cosplay-eight-skins.png') })
})
