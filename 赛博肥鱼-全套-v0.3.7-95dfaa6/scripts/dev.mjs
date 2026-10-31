import { createServer } from 'vite'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import electronPath from 'electron'

const renderer = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } })
let child
let stopping = false
let restarting = false
let rebuildPending = false
let debounce
const watchers = []

async function compile() {
  await build({ entryPoints: { main: 'apps/desktop/electron/main.ts', preload: 'apps/desktop/electron/preload.ts' }, outdir: 'dist/electron', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*'], sourcemap: true })
}
function launch() {
  const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(electronPath, ['.'], { stdio: 'inherit', env })
  child.on('error', error => { console.error('无法启动桌面小店：', error.message); void shutdown(1) })
  child.on('exit', code => { if (!restarting && !stopping) void shutdown(code || 0) })
}
async function restart() {
  if (restarting) { rebuildPending = true; return }
  restarting = true
  try {
    await compile()
    if (child && child.exitCode === null) {
      await new Promise(resolve => {
        const previous = child
        const timer = setTimeout(() => { previous.kill('SIGKILL'); resolve() }, 4000)
        previous.once('exit', () => { clearTimeout(timer); resolve() })
        previous.kill('SIGTERM')
      })
    }
    if (!stopping) launch()
  } catch (error) { console.error('桌面程序构建失败，保存修正后会重试：', error.message) }
  finally { restarting = false; if (rebuildPending) { rebuildPending = false; void restart() } }
}
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  clearTimeout(debounce)
  for (const watcher of watchers) watcher.close()
  child?.kill('SIGTERM')
  await renderer.close()
  process.exit(code)
}
process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
try {
  await compile()
  await renderer.listen()
  launch()
  for (const directory of ['apps/desktop/electron', 'packages/core/src', 'packages/shared/src']) {
    watchers.push(watch(directory, { recursive: true }, () => { clearTimeout(debounce); debounce = setTimeout(() => { void restart() }, 250) }))
  }
  console.log('赛博肥鱼已启动。关闭后台窗口或按 Ctrl+C 退出。')
} catch (error) { console.error('启动失败：', error.message); await shutdown(1) }
