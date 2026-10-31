import { test, expect, type Page } from '@playwright/test'
import { createDefaultState, ACTIONS } from '../../packages/core/src/defaults'
import { FACES, type StageState } from '../../packages/shared/src'

async function openStage(page: Page) {
  const state = createDefaultState()
  state.config.voice.enabled = false
  state.stage.muted = true
  state.running = true
  await page.addInitScript(initial => {
    let state = initial
    const listeners = new Set<(value: typeof state) => void>()
    const target = window as typeof window & { __setStage: (stage: Partial<StageState>) => void; __stageEvents: unknown[]; __setDecorations: (value: string[]) => void }
    target.__stageEvents = []
    target.__setDecorations = decorations => { state = { ...state, shop: { ...state.shop, decorations } }; for (const listener of listeners) listener(state) }
    target.__setStage = stage => {
      state = { ...state, stage: { ...state.stage, ...stage, commandId: `${Date.now()}-${Math.random()}` } }
      for (const listener of listeners) listener(state)
    }
    window.shop = {
      async getState() { return state },
      async command(command) { if (command.type === 'stage-event') target.__stageEvents.push(command.event); return { ok: true } },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      async openStage() {},
      async exportLogs() { return { ok: true } },
    }
  }, state)
  await page.setViewportSize({ width: 540, height: 960 })
  await page.goto('/?view=stage')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true', { timeout: 20000 })
  await expect(page.locator('.stage-loading')).toHaveCount(0)
  await expect(page.locator('.character-layer foreignObject canvas')).toHaveCount(1)
  await page.waitForTimeout(100)
}
async function setStage(page: Page, stage: Partial<StageState>) {
  await page.evaluate(patch => (window as typeof window & { __setStage: (value: Partial<StageState>) => void }).__setStage(patch), stage)
}

test('DeepSeek 大肥鱼的 19 种表情和 18 个动作实际渲染并存档关键帧', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openStage(page)
  for (const face of FACES) {
    await setStage(page, { action: 'stand', face: face.id, station: 'counter', text: `${face.name} · 夜很长，小店的灯还亮着。` })
    await page.waitForTimeout(180)
    await page.screenshot({ path: info.outputPath(`expressions/${face.id}.png`) })
  }
  for (const action of ACTIONS.slice(0, 18)) {
    await setStage(page, { action: action.id, face: 'happy', station: 'counter', text: action.name })
    await page.waitForTimeout(30)
    await page.screenshot({ path: info.outputPath(`motions/${action.id}-0.png`) })
    await page.waitForTimeout(action.seconds * 500)
    await page.screenshot({ path: info.outputPath(`motions/${action.id}-05.png`) })
    await page.waitForTimeout(action.seconds * 500)
    await page.screenshot({ path: info.outputPath(`motions/${action.id}-1.png`) })
  }
  expect(errors).toEqual([])
  const render = await page.locator('.character-layer foreignObject canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height, hasContext: !!(canvas.getContext('webgl2') || canvas.getContext('webgl')) }))
  expect(render.width).toBeGreaterThan(100)
  expect(render.height).toBeGreaterThan(100)
  expect(render.hasContext).toBe(true)
})

test('四个点位会走到目的地，小店道具动作可预览', async ({ page }, info) => {
  test.setTimeout(180000)
  await openStage(page)
  for (const station of ['window', 'shelf', 'door', 'counter'] as const) {
    await setStage(page, { action: 'walk', station, text: `去${station}` })
    await expect(page.getByTestId('stage')).toHaveAttribute('data-station', station)
    await expect(page.getByTestId('stage')).toHaveAttribute('data-action', 'stand', { timeout: 14000 })
    await page.screenshot({ path: info.outputPath(`stations/${station}.png`) })
  }
  for (const action of ACTIONS.slice(18)) {
    await setStage(page, { action: action.id, face: 'happy', station: 'counter', text: action.name })
    await page.waitForTimeout(200)
    await expect(page.getByTestId('stage')).toHaveAttribute('data-action', action.id)
    await page.screenshot({ path: info.outputPath(`shop-actions/${action.id}-0.png`) })
    await page.waitForTimeout(action.seconds * 300)
    await page.screenshot({ path: info.outputPath(`shop-actions/${action.id}-05.png`) })
  }
  const events = await page.evaluate(() => (window as typeof window & { __stageEvents: { type: string }[] }).__stageEvents)
  expect(events.some(event => event.type === 'action-ended')).toBe(true)
})

test('长字幕有界，安全区与常驻 AI 标识会显示', async ({ page }) => {
  await openStage(page)
  await setStage(page, { text: '坐会儿吧，热水管够。'.repeat(12), speaking: false, face: 'happy' })
  await expect(page.locator('.speech-bubble')).toBeVisible()
  const bubble = await page.locator('.speech-bubble').textContent()
  expect(bubble!.length).toBeLessThanOrEqual(43)
  await expect(page.locator('.stage-overlay')).toContainText('AI 形象 · 实时互动')
})


test('配音等到站点到达才开始，同一句不会因为状态刷新而重播', async ({ page }) => {
  await openStage(page)
  await setStage(page, { action: 'watch_rain', station: 'window', muted: false, speaking: true, replyId: 'delayed-speech', text: '窗外下着雨，在这里坐一会儿吧。' })
  await page.waitForTimeout(200)
  const statuses = () => page.evaluate(() => (window as typeof window & { __stageEvents: { type: string }[] }).__stageEvents.filter(event => event.type === 'audio-status').length)
  expect(await statuses()).toBe(0)
  await expect(page.getByTestId('stage')).toHaveAttribute('data-action', 'watch_rain', { timeout: 14000 })
  await expect.poll(statuses).toBe(1)
  await setStage(page, { face: 'happy' })
  await page.waitForTimeout(200)
  expect(await statuses()).toBe(1)
})

test('每种永久装修分别改变舞台', async ({ page }, info) => {
  await openStage(page)
  for (const decoration of ['star_lamp', 'plant', 'neon']) {
    await page.evaluate(value => (window as typeof window & { __setDecorations: (value: string[]) => void }).__setDecorations([value]), decoration)
    await expect(page.locator(`[data-decoration="${decoration}"]`)).toBeVisible()
    await expect(page.locator('[data-decoration]')).toHaveCount(1)
  }
  await page.evaluate(() => (window as typeof window & { __setDecorations: (value: string[]) => void }).__setDecorations(['star_lamp', 'plant', 'neon']))
  await expect(page.locator('[data-decoration]')).toHaveCount(3)
  await page.screenshot({ path: info.outputPath('all-decorations.png') })
})

test('静音 PCM 通过真实 Web Audio 播放并发出精确完成回执', async ({ page }) => {
  await openStage(page)
  await page.getByTestId('stage').click({ position: { x: 20, y: 20 } })
  await setStage(page, { action: 'stand', station: 'counter', muted: false, speaking: true, replyId: 'silent-pcm', text: '夜很长。灯还亮着。', audio: { kind: 'pcm', data: Buffer.alloc(24000 * 2).toString('base64'), sampleRate: 24000, words: [{ text: '夜很长。', start: 0, end: .35 }, { text: '灯还亮着。', start: .5, end: 1 }] } })
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __stageEvents: { type: string; replyId?: string }[] }).__stageEvents.some(event => event.type === 'speech-ended' && event.replyId === 'silent-pcm'))).toBe(true)
  await expect(page.locator('.speech-bubble')).toContainText('夜很长。灯还亮着。')
})
