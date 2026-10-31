import { expect, test, type Page } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'
import type { StageState } from '../../packages/shared/src'

test.use({ timezoneId: 'Asia/Shanghai' })

async function prepare(page: Page, standalone = true) {
  const initial = createDefaultState()
  initial.running = true; initial.config.voice.enabled = false; initial.config.idle.enabled = false
  initial.config.look.timeOfDay = 'auto'; initial.config.look.scheme = 'claude'; initial.shop.scene = 'stars'
  initial.stage.muted = true; initial.stage.text = '时段切换排练'
  await page.addInitScript(state => {
    const listeners = new Set<(value: typeof state) => void>()
    const target = window as typeof window & { __timeState: () => typeof state; __setTimeStage: (patch: Partial<StageState>) => void; __setTimeScene: (scene: typeof state.shop.scene) => void; __timeEvents: { type: string; replyId?: string }[]; __timeAudioStarts: number }
    target.__timeEvents = []; target.__timeAudioStarts = 0
    target.__timeState = () => state
    const broadcast = () => { for (const listener of listeners) listener(JSON.parse(JSON.stringify(state))) }
    target.__setTimeStage = patch => { state = { ...state, stage: { ...state.stage, ...patch } }; broadcast() }
    target.__setTimeScene = scene => { state = { ...state, shop: { ...state.shop, scene } }; broadcast() }
    const audioStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, when = 0, offset = 0, duration?: number) { target.__timeAudioStarts++; if (duration === undefined) audioStart.call(this, when, offset); else audioStart.call(this, when, offset, duration) }
    window.shop = {
      async getState() { return state }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async command(command) {
        if (command.type === 'set-config') { state = { ...state, config: command.config }; broadcast() }
        if (command.type === 'stage-event') target.__timeEvents.push(command.event)
        return { ok: true }
      },
      async openStage() {}, async exportLogs() { return { ok: true } },
    }
  }, initial)
  if (standalone) await page.setViewportSize({ width: 540, height: 960 })
  await page.goto(standalone ? '/?view=stage' : '/')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
}

test('真实时钟跨过四段边界自动换景，太阳与夜空互斥且窗口不重载', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-25T21:59:59Z'))
  await prepare(page)
  await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'night')
  await expect(page.getByTestId('sky-moon')).toBeVisible(); await expect(page.getByTestId('night-stars')).toBeVisible()
  await page.evaluate(() => Object.assign(window, { __timeCanvas: document.querySelector('.character-layer canvas') }))
  for (const [instant, phase, title] of [
    ['2026-10-25T22:00:00Z', 'morning', '肥鱼晨光小店'],
    ['2026-10-26T02:00:00Z', 'day', '肥鱼日间小店'],
    ['2026-10-26T09:00:00Z', 'dusk', '肥鱼黄昏小店'],
    ['2026-10-26T12:00:00Z', 'night', '肥鱼深夜小店'],
  ]) {
    await page.clock.setFixedTime(new Date(instant!))
    await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', phase!)
    await expect(page.getByTestId('shop-title')).toHaveText('肥鱼茶话铺')
    await expect(page.getByTestId('sky-sun')).toHaveCount(phase === 'night' ? 0 : 1)
    await expect(page.getByTestId('sky-moon')).toHaveCount(phase === 'night' ? 1 : 0)
    await expect(page.getByTestId('night-stars')).toHaveCount(phase === 'night' ? 1 : 0)
    expect(await page.evaluate(() => (window as typeof window & { __timeCanvas: Element }).__timeCanvas === document.querySelector('.character-layer canvas'))).toBe(true)
    await expect(page.getByTestId('stage')).toHaveAttribute('data-scene', 'stars')
    await page.waitForTimeout(1300) // Let the one-second palette transition settle before visual verification.
    await page.screenshot({ path: info.outputPath(`shop-${phase}.png`) })
  }
  await page.evaluate(() => (window as typeof window & { __setTimeScene: (scene: 'fireflies') => void }).__setTimeScene('fireflies'))
  await expect(page.getByTestId('night-fireflies')).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-10-26T05:30:00Z'))
  await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'day')
  await expect(page.getByTestId('night-fireflies')).toHaveCount(0)
  await expect(page.getByTestId('stage')).toHaveAttribute('data-scene', 'fireflies')
  await page.evaluate(() => (window as typeof window & { __setTimeScene: (scene: 'snow') => void }).__setTimeScene('snow'))
  await expect(page.locator('.flake')).toHaveCount(36)
  await expect(page.getByTestId('sky-sun')).toBeVisible()
})

test('手动布景保留真实时钟、天气和配色，切回自动立即恢复白天', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-26T05:30:00Z'))
  await prepare(page, false)
  await page.getByRole('navigation').getByRole('button', { name: '形象与动作', exact: true }).click()
  const setting = page.getByTestId('shop-time-setting')
  await expect(setting).toContainText('13:30')
  await page.evaluate(() => (window as typeof window & { __setTimeScene: (scene: 'rain') => void }).__setTimeScene('rain'))
  await setting.getByRole('button', { name: '夜晚布景', exact: true }).click()
  await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'night')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-actual-time-phase', 'day')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-scene', 'rain')
  await expect(page.getByTestId('weather-rain')).toBeVisible()
  await expect(setting).toContainText('13:30'); await expect(setting).toContainText('手动布景')
  await expect(page.getByRole('button', { name: '形象 Claude · 暖陶橙', exact: true })).toHaveClass(/selected/)
  await setting.getByRole('button', { name: '跟随真实时间', exact: true }).click()
  await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'day')
  await expect(page.getByTestId('sky-sun')).toBeVisible(); await expect(page.getByTestId('sky-moon')).toHaveCount(0)
  await expect(page.getByTestId('weather-rain')).toBeVisible()
  await expect(setting).toContainText('按真实时间自动')
  await page.waitForTimeout(1300)
  await page.screenshot({ path: info.outputPath('daylight-and-controls.png') })
})

test('自动换景不会中断或重新开始正在播放的一句配音', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T01:59:59Z'))
  await prepare(page)
  await page.getByTestId('stage').click({ position: { x: 20, y: 20 } })
  const data = Buffer.alloc(24000 * 2 * 4).toString('base64')
  await page.evaluate(pcm => (window as typeof window & { __setTimeStage: (patch: Partial<StageState>) => void }).__setTimeStage({ speaking: true, muted: false, replyId: 'time-change-speech', text: '同一段声音会继续播放。', audio: { kind: 'pcm', data: pcm, sampleRate: 24000 } }), data)
  const starts = () => page.evaluate(() => (window as typeof window & { __timeAudioStarts: number }).__timeAudioStarts)
  await expect.poll(starts).toBe(1)
  await page.clock.setFixedTime(new Date('2026-10-26T02:00:00Z'))
  await expect(page.getByTestId('stage')).toHaveAttribute('data-time-phase', 'day')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __timeEvents: { type: string; replyId?: string }[] }).__timeEvents.filter(event => event.type === 'speech-ended' && event.replyId === 'time-change-speech').length)).toBe(1)
  expect(await starts()).toBe(1)
})
