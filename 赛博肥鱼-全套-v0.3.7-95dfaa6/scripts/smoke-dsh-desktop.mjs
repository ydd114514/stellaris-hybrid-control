// Real Electron + isolated profile. All controller operations are disabled here.
import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
const profile = await mkdtemp(join(tmpdir(), 'cyberfish-dsh-desktop-'))
const artifacts = join(process.cwd(), '.local/artifacts'); await mkdir(artifacts, { recursive: true })
const packaged = process.argv.includes('--packaged')
const requestedExecutable=process.argv.find(x=>x.startsWith('--executable='))?.slice('--executable='.length)
const executablePath = packaged ? requestedExecutable ? resolve(requestedExecutable) : join(process.cwd(), 'release/dsh-desktop-0.3.6/win-unpacked/大肥鱼 DSH.exe') : electronPath
const env = { ...process.env, CYBER_FISH_TEST_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE
let application
try {
  application = await electron.launch({ executablePath, args: packaged ? ['--dsh-offline-test'] : ['dist/dsh/electron/main.cjs', '--dsh-offline-test'], env, timeout: 30000 })
  await expect.poll(() => application.windows().length).toBe(1)
  const page = await application.firstWindow(); await page.waitForURL(/stellaris\.html/)
  await expect(page.getByTestId('dsh-desktop')).toBeVisible()
  await expect(page.getByTestId('controller-message')).toContainText('独立本地测试')
  await expect(page.getByRole('button', { name: '启动大肥鱼', exact: true })).toBeDisabled()
  const status = await page.evaluate(async () => {
    const a = await window.stellaris.getStatus(), b = await window.stellaris.start(), c = await window.stellaris.stop()
    return { a, b, c, node: typeof window.require }
  })
  expect(status.node).toBe('undefined'); expect(status.a.localTest).toBe(true); expect(status.b.ok).toBe(false); expect(status.c.ok).toBe(false)
  await page.screenshot({ path: join(artifacts, packaged ? 'dsh-desktop-packaged-offline.png' : 'dsh-desktop-offline.png') })
  await page.getByRole('button', { name: 'B 站直播', exact: true }).click()
  await expect(page.getByTestId('stellaris-broadcast')).toBeVisible()
  await expect(page.getByRole('button', { name: '准备直播画面', exact: true })).toBeDisabled()
  await expect(page.getByTestId('connect-bilibili')).toBeDisabled()
  const live = await page.evaluate(async () => ({ info: await window.stellaris.live.info(), result: await window.stellaris.live.action('start') }))
  expect(live.info.localTest).toBe(true); expect(live.result.ok).toBe(false); expect(live.info.input.status).toBe('stopped')
  await page.screenshot({ path: join(artifacts, packaged ? 'dsh-bilibili-packaged-offline.png' : 'dsh-bilibili-offline.png'), fullPage: true })
  await page.getByRole('button', {name:'AI 中枢',exact:true}).click()
  await expect(page.getByTestId('stellaris-ai')).toBeVisible()
  await expect(page.getByTestId('director-start')).toBeDisabled()
  await expect(page.getByTestId('agent-strategist').getByRole('combobox',{name:'模型',exact:true})).toBeVisible()
  const ai=await page.evaluate(async()=>({view:await window.stellaris.ai.view(),result:await window.stellaris.ai.action({type:'start'})}))
  expect(ai.view.localTest).toBe(true);expect(ai.view.status.running).toBe(false);expect(ai.result.ok).toBe(false)
  await page.screenshot({path:join(artifacts,packaged?'dsh-ai-packaged-offline.png':'dsh-ai-offline.png'),fullPage:true})
  await page.getByRole('button',{name:'舰长语音与聊天',exact:true}).click()
  const speech=await page.evaluate(()=>window.stellaris.speech.view())
  expect(speech.localTest).toBe(true);expect(speech.enabled).toBe(false)
  await expect(page.getByTestId('captain-speech')).toBeVisible()
  console.log('DSH桌面验收通过：独立窗口、受限IPC、隔离测试资料；未启动控制器、群星或真实API。')
} finally {
  await application?.close().catch(() => {})
  const path = await realpath(profile)
  if (dirname(path) !== await realpath(tmpdir()) || !basename(path).startsWith('cyberfish-dsh-desktop-')) throw new Error('Unexpected test profile')
  await rm(path, { recursive: true, force: true })
}
