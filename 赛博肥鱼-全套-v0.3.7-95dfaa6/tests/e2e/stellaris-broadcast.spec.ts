import { test, expect } from '@playwright/test'
test('Bilibili setup is manual and a connection test does not pretend the platform is live', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = []; Object.assign(window, { __broadcastCalls: calls })
    let info = { localTest: false, ready: false, previewUrl: 'http://127.0.0.1:17655/', overlayUrl: 'http://127.0.0.1:17655/overlay?voice=1', input: { status: 'stopped', message: '尚未连接真实直播间', received: 0, rejected: 0, endpoint: '' } }
    window.stellaris = { getStatus: async () => ({ phase: 'stopped', message: '离线测试', canStart: false, canStop: false }), start: async () => { throw Error('No real controller') }, stop: async () => { throw Error('No real controller') }, chooseProject: async () => { throw Error('No filesystem') },
      live: { info: async () => info, action: async action => { calls.push(action); if (action === 'prepare') info = { ...info, ready: true }; if (action === 'start') info = { ...info, input: { ...info.input, status: 'listening', message: '尚未连接真实直播间' } }; return { ok: true, info, message: action === 'test' ? '测试通过，没有插入假弹幕' : '设置已更新' } } } }
  })
  await page.goto('/stellaris.html'); await page.getByRole('button', { name: 'B 站直播', exact: true }).click()
  const panel = page.getByTestId('stellaris-broadcast'); await expect(panel).toBeVisible()
  expect(await page.evaluate(() => (window as any).__broadcastCalls)).toEqual([])
  await panel.getByRole('button', { name: '准备直播画面', exact: true }).click(); await expect(panel).toContainText('本机画面已就绪')
  await panel.getByRole('button', { name: '开启本地弹幕接入', exact: true }).click(); await expect(panel).toContainText('尚未连接真实直播间')
  await panel.getByRole('button', { name: '测试本地接入', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('没有插入假弹幕')
  expect(await page.evaluate(() => (window as any).__broadcastCalls)).toEqual(['prepare', 'start', 'test'])
})
