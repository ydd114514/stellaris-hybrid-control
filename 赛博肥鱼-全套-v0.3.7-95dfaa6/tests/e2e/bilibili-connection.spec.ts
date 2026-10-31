import { expect, test, type Page } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

async function openConnections(page: Page, localTest = false, configured = true) {
 const state = createDefaultState(); state.config.voice.enabled = false; state.config.idle.enabled = false; state.stage.muted = true
 await page.addInitScript(({ state, localTest, configured }) => {
  const commands: any[] = []
  let input = { state: 'stopped', message: '尚未连接 B 站官方互动。', received: 0, reconnects: 0, configured }
  Object.assign(window, { __bilibiliCommands: commands })
  window.shop = {
   async getState() { return state }, subscribe() { return () => {} },
   async command(command) {
    commands.push(command)
    if (command.type === 'get-runtime-info') return { ok: true, data: { localTest, platform: 'win32' } }
    if (command.type === 'bilibili-input-info') return { ok: true, data: input }
    if (command.type === 'bilibili-input-save') { input = { ...input, configured: true }; return { ok: true } }
    if (command.type === 'bilibili-input-start') { input = { ...input, state: 'connected', message: '已接通 B 站互动消息。' }; return { ok: true } }
    if (command.type === 'bilibili-input-stop') { input = { ...input, state: 'stopped' }; return { ok: true } }
    if (command.type === 'bilibili-input-clear') { input = { ...input, configured: false }; return { ok: true } }
    if (command.type === 'input-info') return { ok: true, data: { status: 'stopped', received: 0, rejected: 0, message: '尚未接入。' } }
    return { ok: true }
   },
   async openStage() {}, async exportLogs() { return { ok: true } },
  }
 }, { state, localTest, configured })
 await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
 await page.getByRole('navigation').getByRole('button', { name: '直播连接', exact: true }).click()
 return page.getByTestId('bilibili-connection')
}

test('B站凭据不回填，局部保存清空输入，仅手动连接', async ({ page }) => {
 const panel = await openConnections(page)
 await expect(panel).toContainText('已有安全保存的配置')
 for (const name of ['B 站开发密钥 ID', 'B 站开发密钥 Secret', 'B 站项目 ID', 'B 站主播身份码']) await expect(panel.getByLabel(name, { exact: true })).toHaveValue('')
 await expect(panel.getByLabel('B 站开发密钥 Secret', { exact: true })).toHaveAttribute('type', 'password')
 await expect(panel.getByLabel('B 站主播身份码', { exact: true })).toHaveAttribute('type', 'password')
 await panel.getByLabel('B 站主播身份码', { exact: true }).fill('offline-test-identity')
 await panel.getByRole('button', { name: '保存连接凭据', exact: true }).click()
 await expect(panel.getByLabel('B 站主播身份码', { exact: true })).toHaveValue('')
 let commands = await page.evaluate(() => (window as any).__bilibiliCommands)
 expect(commands.find((command: any) => command.type === 'bilibili-input-save')).toEqual({ type: 'bilibili-input-save', accessKeyId: '', accessKeySecret: '', appId: '', identityCode: 'offline-test-identity' })
 expect(commands.some((command: any) => command.type === 'bilibili-input-start')).toBe(false)
 await panel.getByRole('button', { name: '连接 B 站互动', exact: true }).click()
 await expect(panel).toContainText('已接通 B 站互动消息')
 commands = await page.evaluate(() => (window as any).__bilibiliCommands)
 expect(commands.filter((command: any) => command.type === 'bilibili-input-start')).toHaveLength(1)
 for (const forbidden of ['start', 'open-capture', 'set-config', 'open-local-test']) expect(commands.some((command: any) => command.type === forbidden)).toBe(false)
})

test('B站首次凭据完整后才能保存，长项目ID不丢精度', async ({ page }) => {
 const panel = await openConnections(page, false, false)
 const save = panel.getByRole('button', { name: '保存连接凭据', exact: true })
 await expect(save).toBeDisabled()
 await panel.getByLabel('B 站开发密钥 ID', { exact: true }).fill('offline-test-key')
 await panel.getByLabel('B 站开发密钥 Secret', { exact: true }).fill('offline-test-secret')
 await panel.getByLabel('B 站项目 ID', { exact: true }).fill('1234567890123456789')
 await expect(save).toBeDisabled()
 await panel.getByLabel('B 站主播身份码', { exact: true }).fill('offline-test-identity')
 await save.click()
 await expect(panel.getByLabel('B 站项目 ID', { exact: true })).toHaveValue('')
 const commands = await page.evaluate(() => (window as any).__bilibiliCommands)
 expect(commands.find((command: any) => command.type === 'bilibili-input-save').appId).toBe('1234567890123456789')
})

test('独立本地测试禁止保存、启动与清除B站真实连接', async ({ page }) => {
 const panel = await openConnections(page, true)
 await expect(panel).toContainText('当前为独立本地测试')
 for (const name of ['保存连接凭据', '连接 B 站互动', '清除已存凭据']) await expect(panel.getByRole('button', { name, exact: true })).toBeDisabled()
 const commands = await page.evaluate(() => (window as any).__bilibiliCommands)
 expect(commands.some((command: any) => ['bilibili-input-save', 'bilibili-input-start', 'bilibili-input-clear'].includes(command.type))).toBe(false)
})
