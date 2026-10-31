/** Read-only song selection. No authorization is read until --select is explicit. */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
if (!process.argv.includes('--select')) {
  console.log('只读QQ选曲：晴天 周杰伦、雨的印记 Yiruma、小星星 纯音乐；最多3次搜索，不取音频地址、不刷新或退出账号。')
  console.log('未读取授权、未请求QQ音乐。执行：node scripts/select-rehearsal-qq.mjs --select')
  process.exit(0)
}
const folder = join(project, '.local/live-rehearsals')
const helper = join(folder, 'select-qq-helper.cjs')
await mkdir(folder, { recursive: true, mode: 0o700 })
await build({ entryPoints: [join(project, 'scripts/select-rehearsal-qq-runner.ts')], outfile: helper, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*', '@yakult-green-tea/qq-music-api/serverless'], logLevel: 'silent' })
const electron = join(project, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [helper, '--select', `--project=${project}`], { env, stdio: 'inherit' })
child.on('error', () => { console.error('无法启动本项目的只读QQ选曲工具。'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
