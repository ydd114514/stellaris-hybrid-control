import { expect, test } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

const songs = [
  { id: 'qq:001RainNight', title: '雨夜小店', artist: '排练歌手', source: 'shop-qqmusic://track/001RainNight', duration: 180 },
  { id: 'qq:002MoonLight', title: '月光晚安', artist: '另一位歌手', source: 'shop-qqmusic://track/002MoonLight', duration: 200 },
]
const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ3kAAAAASUVORK5CYII='

test('QQ 搜索结果先加入小店曲库，再排队，重复点击不会堆歌', async ({ page }, info) => {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false; state.config.music.autoStart = false
  await page.addInitScript(({ initial, tracks }) => {
    const callbacks = new Set<(state: typeof initial) => void>()
    const commands: string[] = []
    Object.assign(window, { __qqCommands: commands })
    window.shop = {
      async getState() { return initial }, subscribe(fn) { callbacks.add(fn); return () => callbacks.delete(fn) },
      async command(command) {
        commands.push(command.type)
        if (command.type === 'qq-status') return { ok: true, data: { loggedIn: false, loginPending: false, message: '离线 QQ 连接样本' } }
        if (command.type === 'qq-search') return { ok: true, data: { tracks } }
        if (command.type === 'music-set-tracks') initial.music.tracks = command.tracks
        if (command.type === 'music-request') initial.music.queue.push({ id: `request-${commands.length}`, trackId: command.trackId, userId: '__owner__', userName: '店长', at: Date.now(), status: 'queued' })
        for (const callback of callbacks) callback(structuredClone(initial))
        return { ok: true }
      },
      async openStage() {}, async exportLogs() { return { ok: true } },
    }
  }, { initial: state, tracks: songs })
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('navigation').getByRole('button', { name: '点歌台', exact: true }).click()
  const panel = page.getByTestId('qq-music')
  await panel.getByLabel('搜索 QQ 音乐', { exact: true }).fill('雨夜')
  await panel.getByRole('button', { name: '搜索 QQ 歌曲', exact: true }).click()
  const first = panel.locator('tbody tr', { hasText: '雨夜小店' })
  await first.getByRole('button', { name: '加入点歌队列', exact: true }).click()
  await expect(first.getByRole('button', { name: '已在曲库', exact: true })).toBeDisabled()
  await expect(first.getByRole('button', { name: '已在播放或排队', exact: true })).toBeDisabled()
  await expect(page.locator('.song-queue-row')).toHaveCount(1)
  await expect(page.locator('.song-queue-row')).toContainText('雨夜小店')
  await expect(page.getByTestId('jukebox-now')).toContainText('等待观众点歌就绪')
  await expect(page.locator('section.card').filter({ has: page.getByRole('heading', { name: '我的曲库', exact: false }) }).locator('tbody')).toContainText('QQ 音乐')
  const calls = await page.evaluate(() => (window as Window & { __qqCommands: string[] }).__qqCommands)
  expect(calls.filter(type => type.startsWith('music-'))).toEqual(['music-set-tracks', 'music-request'])
  await page.screenshot({ path: info.outputPath('qq-search-and-queue.png') })
})

test('QQ 扫码登录自动更新，离开点歌页后停止轮询', async ({ page }) => {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false
  await page.addInitScript(({ initial, qrDataUrl }) => {
    const commands: string[] = []
    Object.assign(window, { __qqCommands: commands, __qqConfirm: false })
    window.shop = {
      async getState() { return initial }, subscribe() { return () => {} },
      async command(command) {
        commands.push(command.type)
        if (command.type === 'qq-login-start') return { ok: true, data: { qrDataUrl, expiresAt: Date.now() + 120000, message: '请用 QQ 音乐 App 扫码' } }
        if (command.type === 'qq-login-poll' && (window as Window & { __qqConfirm: boolean }).__qqConfirm) return { ok: true, data: { loggedIn: true, loginPending: false, message: 'QQ 音乐登录成功' } }
        return { ok: true, data: { loggedIn: false, loginPending: command.type === 'qq-login-poll', message: command.type === 'qq-login-poll' ? '等待手机确认' : '尚未登录' } }
      },
      async openStage() {}, async exportLogs() { return { ok: true } },
    }
  }, { initial: state, qrDataUrl: qr })
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('navigation').getByRole('button', { name: '点歌台', exact: true }).click()
  await page.getByRole('button', { name: '扫码登录 QQ 音乐', exact: true }).click()
  await expect(page.getByAltText('QQ 音乐登录二维码', { exact: true })).toBeVisible()
  await expect(page.getByTestId('qq-music')).toContainText('等待手机确认')
  await page.evaluate(() => { (window as Window & { __qqConfirm: boolean }).__qqConfirm = true })
  await expect(page.getByRole('button', { name: '退出 QQ 音乐', exact: true })).toBeVisible()
  await expect(page.getByAltText('QQ 音乐登录二维码', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '退出 QQ 音乐', exact: true }).click()
  await page.evaluate(() => { (window as Window & { __qqConfirm: boolean }).__qqConfirm = false })
  await page.getByRole('button', { name: '扫码登录 QQ 音乐', exact: true }).click()
  await expect(page.getByTestId('qq-music')).toContainText('等待手机确认')
  await page.getByRole('navigation').getByRole('button', { name: '直播连接', exact: true }).click()
  const before = await page.evaluate(() => (window as Window & { __qqCommands: string[] }).__qqCommands.filter(type => type === 'qq-login-poll').length)
  await page.waitForTimeout(2400)
  const after = await page.evaluate(() => (window as Window & { __qqCommands: string[] }).__qqCommands.filter(type => type === 'qq-login-poll').length)
  expect(after).toBe(before)
})

test('浏览器排练明确提示 QQ 音乐需要桌面版，不向线上曲库发请求', async ({ page }) => {
  const qqRequests: string[] = []
  page.on('request', request => { if (/qq\.com|qqmusic\./.test(request.url())) qqRequests.push(request.url()) })
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('navigation').getByRole('button', { name: '点歌台', exact: true }).click()
  const panel = page.getByTestId('qq-music')
  await expect(panel).toContainText('浏览器仅供排练')
  await panel.getByLabel('搜索 QQ 音乐', { exact: true }).fill('晚安')
  await panel.getByRole('button', { name: '搜索 QQ 歌曲', exact: true }).click()
  await expect(panel).toContainText('浏览器排练不会登录或请求真实曲库')
  expect(qqRequests).toEqual([])
})
