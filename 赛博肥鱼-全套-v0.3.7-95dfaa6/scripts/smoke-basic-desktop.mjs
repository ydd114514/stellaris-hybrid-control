import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const profile = await mkdtemp(join(tmpdir(), 'feiyu-basic-ui-'))
const executablePath = resolve('release/群星控制器大肥鱼-基础版-0.4.0/win-unpacked/群星控制器大肥鱼.exe')
const env = { ...process.env, CYBER_FISH_TEST_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ executablePath, args: ['--dsh-offline-test'], env, timeout: 45000 })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '群星控制器大肥鱼', exact: true })).toBeVisible()
  expect(await app.evaluate(({ app }) => app.getName())).toBe('群星控制器大肥鱼')
  await page.getByText('首次使用：配置游戏 AI 密钥', { exact: true }).click()
  await expect(page.getByLabel('游戏 DeepSeek 密钥', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'AI 中枢', exact: true }).click()
  const view = await page.evaluate(() => window.stellaris.ai.view())
  expect(view.basic).toBe(true); expect(view.agents.map(a => a.label)).toEqual(['大肥鱼'])
  expect(view.providers.map(p => [p.id, p.hasKey])).toEqual([['deepseek', false]])
  expect(view.presets.map(p => p.id)).toEqual(['deepseek'])
  await expect(page.getByTestId('agent-host')).toBeVisible()
  await expect(page.getByTestId('agent-strategist')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ 对战席位', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('DeepSeek 密钥', { exact: true })).toBeVisible()
  expect(await page.getByLabel('DeepSeek 密钥', { exact: true }).inputValue()).toBe('')
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('中转'); expect(text).not.toContain('OpenRouter')
  const music = await page.evaluate(() => window.stellaris.music.view())
  expect(music.enabled).toBe(false)
  const speech = await page.evaluate(() => window.stellaris.speech.view())
  expect(speech.enabled).toBe(false); expect(speech.hasKey).toBe(false); expect(speech.config.voice).toBe('Cherry')
  await mkdir('.local/artifacts', { recursive: true })
  await page.screenshot({ path: '.local/artifacts/群星控制器大肥鱼-基础版-AI中枢.png', fullPage: true })
  console.log('基础版打包程序验收通过：新名称、仅官方服务、仅大肥鱼、两处空密钥输入框、无个人音色、自动功能关闭。')
} finally { await app?.close().catch(() => {}); if (profile.startsWith(join(tmpdir(), 'feiyu-basic-ui-'))) await rm(profile, { recursive: true, force: true }) }
