import { expect, test, type Page } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

async function fixture(page: Page, reserved = false, legacy = false) {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false
  Object.assign(state.costs, { requests: 99, voiceRequests: 88, brainApiRequests: 3, brainApiSucceeded: 1, brainApiFailed: 1, brainApiCancelled: 1, voiceApiRequests: 4, voiceApiSucceeded: 2, voiceApiFailed: 1, voiceApiCancelled: 1, inputTokens: 1200, outputTokens: 240, cacheHitTokens: 1000, cacheMissTokens: 200, voiceInputTokens: 10, voiceOutputTokens: 20, voiceCharacters: 100, voiceCharactersEstimated: 20, brainUsageMissing: 1, voiceUsageMissing: 1, unpricedRequests: 3, session: .015, apiCountsIncomplete: legacy })
  if (reserved) { Object.assign(state, { audioReservation: { kind: 'rehearsal', message: '测试直播正在独占专用声卡，正式小店已暂停，避免双重声音。', expiresAt: Date.now() + 60000 } }); state.stage.muted = true }
  await page.addInitScript(initial => {
    let current = initial
    const listeners = new Set<(value: typeof current) => void>(), commands: string[] = []
    Object.assign(window, { __usageCommands: commands, __clearAudioReservation: () => { current = { ...current, audioReservation: undefined }; for (const listener of listeners) listener(current) } })
    window.shop = { async getState() { return current }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, async command(command) { commands.push(command.type); if (command.type === 'qq-status') return { ok: true, data: { loggedIn: false, loginPending: false, message: '离线界面测试' } }; return { ok: true } }, async openStage() {}, async exportLogs() { return { ok: true } } }
  }, state)
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
}

test('开播页显示两家实际请求与真实token，缺失为至少和待核算，可直达单价设置', async ({ page }, info) => {
  await fixture(page)
  const card = page.getByTestId('service-usage'), brain = card.getByTestId('brain-usage'), voice = card.getByTestId('voice-usage')
  await expect(brain.locator('.usage-call-total')).toHaveText('3实际请求'); await expect(voice.locator('.usage-call-total')).toHaveText('4实际请求')
  await expect(brain).toContainText('成功 1'); await expect(brain).toContainText('失败 1'); await expect(brain).toContainText('已取消 1')
  await expect(brain).toContainText('至少 1,200'); await expect(brain).toContainText('至少 240'); await expect(brain).toContainText('缓存命中 至少 1,000')
  await expect(voice).toContainText('至少 10'); await expect(voice).toContainText('至少 20'); await expect(voice).toContainText('计费字符 80')
  await expect(card).toContainText('待核算'); await expect(card).toContainText('已知部分 ¥ 0.0150'); await expect(card).toContainText('单价未完整配置')
  await expect(card).not.toContainText('99实际请求'); await expect(card).not.toContainText('88实际请求')
  await page.screenshot({ path: info.outputPath('live-service-usage.png') })
  await card.getByRole('button', { name: '费用与单价', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByLabel('对话输入 / 每百万 tokens', { exact: true })).toBeVisible()
})

test('旧版本缺少实际调用计数时明确只列升级后记录', async ({ page }) => {
  await fixture(page, false, true)
  const card = page.getByTestId('service-usage')
  await expect(card).toContainText('至少已记录的请求')
  await expect(card).toContainText('旧版没有记录实际调用次数')
})

test('真实演练独占时全局说明并禁开声，释放后仍等待手动恢复', async ({ page }, info) => {
  await fixture(page, true)
  await expect(page.getByTestId('audio-reservation')).toContainText('避免双重声音')
  await expect(page.locator('.hero').getByRole('button', { name: '开始营业', exact: true })).toBeDisabled()
  await expect(page.locator('.dock').getByRole('button', { name: '开始营业', exact: true })).toBeDisabled()
  await expect(page.locator('.dock').getByRole('button', { name: '恢复声音', exact: true })).toBeDisabled()
  await expect(page.locator('.dock').getByRole('button', { name: '打开本地监听', exact: true })).toBeDisabled()
  await page.getByRole('navigation').getByRole('button', { name: '点歌台', exact: true }).click()
  await expect(page.getByTestId('audio-reservation')).toBeVisible()
  await page.screenshot({ path: info.outputPath('single-audio-owner.png') })
  await page.evaluate(() => (window as typeof window & { __clearAudioReservation: () => void }).__clearAudioReservation())
  await expect(page.getByTestId('audio-reservation')).toHaveCount(0)
  await expect(page.locator('.dock').getByRole('button', { name: '开始营业', exact: true })).toBeEnabled()
  const commands = await page.evaluate(() => (window as typeof window & { __usageCommands: string[] }).__usageCommands)
  expect(commands).not.toContain('start'); expect(commands).not.toContain('unmute')
})
