import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import electronPath from 'electron'

const profile = await mkdtemp(join(tmpdir(), 'cyber-fish-smoke-'))
const artifacts = join(process.cwd(), '.local', 'artifacts')
const packaged = process.argv.includes('--packaged')
await mkdir(artifacts, { recursive: true })
let application
const env = { ...process.env, CYBER_FISH_TEST_DATA_DIR: profile }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
async function launch() {
  const executablePath = packaged ? (process.env.CYBER_FISH_PACKAGED_APP || join(process.cwd(), process.platform === 'win32' ? 'release/win-unpacked/赛博肥鱼.exe' : 'release/mac-arm64/赛博肥鱼.app/Contents/MacOS/赛博肥鱼')) : electronPath
  const args = packaged ? [`--user-data-dir=${profile}`] : ['.']
  const instance = await electron.launch({ executablePath, args, env, timeout: 30000 })
  await expect.poll(() => instance.windows().length, { timeout: 20000 }).toBe(2)
  await Promise.all(instance.windows().map(page => page.waitForURL(/file:/, { timeout: 20000 })))
  return instance
}
try {
  application = await launch()
  if (packaged) {
    const provider = await application.evaluate(async ({ app }) => {
      const { createRequire } = process.getBuiltinModule('module')
      const requireApp = createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'))
      const module = requireApp('@yakult-green-tea/qq-music-api/serverless')
      return typeof module.handleRequest
    })
    expect(provider).toBe('function') // Loading the module performs no QQ request.
  }
  const windows = application.windows()
  const control = windows.find(page => new URL(page.url()).searchParams.get('view') === 'console') || windows[0]
  const stage = windows.find(page => new URL(page.url()).searchParams.get('view') === 'stage') || windows[1]
  await control.waitForFunction(() => !!window.shop)
  const isolation = await control.evaluate(() => ({ bridge: typeof window.shop.command, node: typeof window.require }))
  expect(isolation).toEqual({ bridge: 'function', node: 'undefined' })
  const encrypted = await control.evaluate(async () => (await window.shop.getState()).credentials.encrypted)
  const dummyKey = 'offline-smoke-credential-only-not-a-real-key'
  const keyResult = await control.evaluate(async key => window.shop.command({ type: 'save-key', provider: 'deepseek', key }), dummyKey)
  expect(keyResult.ok).toBe(encrypted)
  if (encrypted) {
    const keyFile = await readFile(join(profile, 'credentials.enc.json'), 'utf8')
    expect(keyFile).not.toContain(dummyKey)
  }
  const result = await control.evaluate(async () => {
    const state = await window.shop.getState()
    state.config.mode = 'manual'
    state.config.demo = true
    state.config.voice.enabled = false
    state.config.idle.enabled = false
    state.config.vote.enabled = true
    await window.shop.command({ type: 'set-config', config: state.config })
    await window.shop.command({ type: 'start' })
    await window.shop.command({ type: 'inject', event: { id: 'smoke-event', kind: 'chat', user: { id: 'smoke-viewer', name: '测试熟客' }, text: '这么晚还开着门吗？', at: Date.now() } })
    return true
  })
  expect(result).toBe(true)
  await expect.poll(async () => control.evaluate(async () => (await window.shop.getState()).drafts.length), { timeout: 15000 }).toBeGreaterThan(0)
  await control.evaluate(async () => {
    const state = await window.shop.getState()
    await window.shop.command({ type: 'approve', id: state.drafts[0].id })
    await window.shop.command({ type: 'set-viewer', viewer: { id: 'smoke-viewer', name: '测试熟客', visits: 1, note: '重启保存检查', blocked: false, gifts: 0 } })
  })
  await expect.poll(async () => control.evaluate(async () => (await window.shop.getState()).history.length), { timeout: 10000 }).toBeGreaterThan(0)
  await expect(stage.locator('[data-testid=stage]')).toHaveAttribute('data-loaded', 'true', { timeout: 20000 })
  await control.screenshot({ path: join(artifacts, 'electron-console.png') })
  await stage.screenshot({ path: join(artifacts, 'electron-stage.png') })
  await application.close()
  application = await launch()
  const reloaded = application.windows().find(page => new URL(page.url()).searchParams.get('view') === 'console') || application.windows()[0]
  await reloaded.waitForFunction(() => !!window.shop)
  const persisted = await reloaded.evaluate(async () => {
    const state = await window.shop.getState()
    return { running: state.running, speaking: state.stage.speaking, viewer: state.viewers.find(viewer => viewer.id === 'smoke-viewer')?.note, keySaved: state.credentials.deepseek }
  })
  expect(persisted).toEqual({ running: false, speaking: false, viewer: '重启保存检查', keySaved: encrypted })
  console.log('Electron 验证通过：双窗口、隔离桥、模拟互动、审批、SQLite重启保存、密钥加密且可重启读取。截图位于 .local/artifacts/。')
} finally {
  await application?.close().catch(() => {})
  const cleanupTarget = await realpath(profile)
  if (dirname(cleanupTarget) !== await realpath(tmpdir()) || !basename(cleanupTarget).startsWith('cyber-fish-smoke-')) throw new Error('Unexpected smoke-test cleanup path')
  await rm(profile, { recursive: true, force: true })
}
