import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTIONS, createDefaultState } from '../../packages/core/src/defaults'

type ReviewAction = 'stand' | 'nod' | 'shake' | 'bow' | 'turn'
type ReviewWindow = Window & typeof globalThis & {
  __headwearSetAction: (action: ReviewAction) => number
  __headwearErrors: string[]
  __headwearMicrophoneRequests: number
}

// The kit's nod/shake pulse lasts 700 ms, shorter than the action catalogue's
// overall duration. Sample the live gesture, then let its entire action finish.
// Turn eases its facing immediately, so its useful transition is also early.
const motions: { action: ReviewAction; activeMs: number; samplesMs: [number, number, number] }[] = [
  { action: 'stand', activeMs: 3000, samplesMs: [200, 1500, 2700] },
  { action: 'nod', activeMs: 700, samplesMs: [80, 300, 580] },
  { action: 'shake', activeMs: 700, samplesMs: [80, 300, 580] },
  { action: 'bow', activeMs: 1600, samplesMs: [160, 720, 1380] },
  { action: 'turn', activeMs: 1400, samplesMs: [40, 180, 480] },
]
const phases = ['early', 'middle', 'late'] as const

async function waitUntil(page: Page, startedAt: number, targetMs: number) {
  await page.evaluate(async ({ startedAt, targetMs }) => {
    const remaining = targetMs - (performance.now() - startedAt)
    if (remaining > 0) await new Promise<void>(done => setTimeout(done, remaining))
  }, { startedAt, targetMs })
}

test.use({
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 1,
  serviceWorkers: 'block',
  permissions: [],
})

for (const outfit of ['cowboy', 'ghost'] as const) {
  test(`${outfit} 头饰连续动作的早中后期全身关键帧`, async ({ page, baseURL }, info) => {
    test.setTimeout(120000)
    const pageErrors: string[] = []
    const resourceErrors: string[] = []
    const externalRequests: string[] = []
    const origin = new URL(baseURL || 'http://127.0.0.1:5173').origin
    const output = resolve('.local/headwear-review', outfit)
    mkdirSync(output, { recursive: true })

    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('response', response => {
      if (response.status() >= 400) resourceErrors.push(`${response.status()} ${response.url()}`)
    })
    page.on('requestfailed', request => {
      if (request.url().startsWith(origin + '/')) {
        resourceErrors.push(`${request.failure()?.errorText || '请求失败'} ${request.url()}`)
      }
    })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
        externalRequests.push(url.href)
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })

    // A fresh in-memory bridge never opens Electron userData or a real service.
    const state = createDefaultState()
    state.config.mode = 'manual'
    state.config.demo = false
    state.config.voice.enabled = false
    state.config.idle.enabled = false
    state.config.input.enabled = false
    state.config.music.enabled = false
    state.config.music.bgmEnabled = false
    state.config.music.autoStart = false
    state.config.audio.mode = 'test'
    state.config.audio.monitorEnabled = false
    state.config.look = { scheme: 'deepseek', outfit, timeOfDay: 'day' }
    state.running = true
    state.stage = { ...state.stage, action: 'stand', face: 'happy', station: 'counter', muted: true, speaking: false, text: '', commandId: 'headwear-initial' }
    state.shop.decorations = []
    state.history = []
    state.music.lastMessage = ''

    await page.addInitScript(initial => {
      let current = initial
      let sequence = 0
      const listeners = new Set<(value: typeof initial) => void>()
      const target = window as ReviewWindow
      target.__headwearErrors = []
      target.__headwearMicrophoneRequests = 0
      target.__headwearSetAction = action => {
        const startedAt = performance.now()
        current = {
          ...current,
          stage: { ...current.stage, action, face: current.config.look.outfit === 'ghost' ? 'neutral' : 'happy', commandId: `headwear-${++sequence}` },
        }
        for (const listener of listeners) listener(current)
        return startedAt
      }
      // Fail closed if a future stage change accidentally requests a microphone.
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          target.__headwearMicrophoneRequests++
          throw new Error('离线头饰视觉检查禁止请求实体麦克风')
        }
      }
      window.shop = {
        async getState() { return current },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        async command(command) {
          if (command.type === 'stage-event' && command.event.type === 'error') {
            target.__headwearErrors.push(command.event.message)
          }
          return { ok: true }
        },
        async openStage() {},
        async exportLogs() { return { ok: true } },
      }
    }, state)

    await page.goto('/?view=stage')
    const stage = page.getByTestId('stage')
    await expect(stage).toHaveAttribute('data-loaded', 'true', { timeout: 20000 })
    await expect(stage).toHaveAttribute('data-rendered-skin', `deepseek-${outfit}`)
    await expect(page.locator('.stage-loading')).toHaveCount(0)
    await expect(page.locator('.character-layer foreignObject canvas')).toHaveCount(1)
    const canvasSize = await page.locator('.character-layer foreignObject canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }))
    expect(canvasSize.width).toBeGreaterThan(100)
    expect(canvasSize.height).toBeGreaterThan(100)
    await page.waitForTimeout(900)

    // Keep one fixed viewport across all poses: locator.screenshot would wait for
    // the moving character's bounding box to settle and could miss the gesture.
    const clip = await stage.boundingBox()
    expect(clip).not.toBeNull()
    await page.screenshot({ path: resolve(output, '00-room-before.png'), clip: clip! })
    const isolation = await page.addStyleTag({ content: `
      .shop-scene, .counter-layer, .counter-props, .stage-overlay,
      .character-shadow { visibility: hidden !important; }
      html, body, #app, .standalone-stage, .fish-stage { background: transparent !important; }
    ` })
    const samples: {
      action: ReviewAction; phase: string; targetMs: number
      captureStartedMs: number; captureFinishedMs: number; file: string
    }[] = []
    const lateCaptures: string[] = []

    try {
      for (const { action, activeMs, samplesMs } of motions) {
        await test.step(`${outfit} / ${action} 完整连续播放`, async () => {
          const durationMs = ACTIONS.find(item => item.id === action)!.seconds * 1000
          const startedAt = await page.evaluate(action => (window as ReviewWindow).__headwearSetAction(action), action)
          await expect(stage).toHaveAttribute('data-action', action)
          for (const [index, targetMs] of samplesMs.entries()) {
            await waitUntil(page, startedAt, targetMs)
            const captureStartedMs = await page.evaluate(start => performance.now() - start, startedAt)
            const file = `${action}-${index + 1}-${phases[index]}-${targetMs}ms.png`
            await page.screenshot({
              path: resolve(output, file), clip: clip!, omitBackground: true,
              animations: 'allow', scale: 'css',
            })
            const captureFinishedMs = await page.evaluate(start => performance.now() - start, startedAt)
            samples.push({ action, phase: phases[index]!, targetMs, captureStartedMs, captureFinishedMs, file })
            const deadlineMs = samplesMs[index + 1] ?? activeMs
            if (captureFinishedMs >= deadlineMs) {
              lateCaptures.push(`${file} 截图在 ${Math.round(captureFinishedMs)}ms 才结束，错过 ${deadlineMs}ms 采样窗口`)
            }
          }
          // No restart between phases; let short pulses and their spring motion
          // recover before the next command can replace this one.
          await waitUntil(page, startedAt, durationMs + 300)
        })
      }
    } finally {
      await isolation.evaluate(element => (element as HTMLStyleElement).remove())
      const manifest = resolve(output, 'sampling.json')
      writeFileSync(manifest, JSON.stringify({
        outfit, skin: `deepseek-${outfit}`, viewport: { width: 540, height: 960 },
        review: '人工逐帧检查头饰与头部是否同向运动、是否漂移或穿插；截图采样本身不等于视觉正确性断言。',
        timing: '所有阶段属于同一次实时动作；captureStartedMs/captureFinishedMs 是截图调用的实际时间范围。',
        samples,
      }, null, 2) + '\n')
      await info.attach(`${outfit}-sampling`, { path: manifest, contentType: 'application/json' })
    }

    await expect(page.locator('.shop-scene')).toBeVisible()
    await expect(page.locator('.counter-layer')).toBeVisible()
    await expect(page.locator('.stage-overlay')).toBeVisible()
    await page.screenshot({ path: resolve(output, '99-room-restored.png'), clip: clip! })
    const fixture = await page.evaluate(() => ({ errors: (window as ReviewWindow).__headwearErrors, microphoneRequests: (window as ReviewWindow).__headwearMicrophoneRequests }))
    expect(pageErrors, '页面执行不得报错').toEqual([])
    expect(resourceErrors, '本地角色贴图与舞台资源不得加载失败').toEqual([])
    expect(externalRequests, '离线检查不得访问外部 API 或资源').toEqual([])
    expect(fixture.errors, '角色加载与动作执行不得报告错误').toEqual([])
    expect(fixture.microphoneRequests, '不得请求实体麦克风').toBe(0)
    expect(lateCaptures, '截图过慢时应重新采样，不能把动作结束后的画面当作连续关键帧').toEqual([])
  })
}
