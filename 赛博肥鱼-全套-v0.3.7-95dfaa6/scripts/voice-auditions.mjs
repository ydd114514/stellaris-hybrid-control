/** Explicit, bounded paid audition tool. Without --generate it only prints the plan. */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const directory = dirname(fileURLToPath(import.meta.url))
const project = dirname(directory)
const plan = JSON.parse(await readFile(join(directory, 'voice-auditions-plan.json'), 'utf8'))
if (!process.argv.includes('--generate')) {
  console.log(`千问声音对比计划：${plan.samples.length} 组，同段 ${plan.text.length} 字；未读取密钥，未调用 API。`)
  console.log(plan.text)
  for (const sample of plan.samples) console.log(`${sample.id} ${sample.name} · ${sample.style} · ${sample.model} / ${sample.voice}`)
  console.log('实际生成：node scripts/voice-auditions.mjs --generate --workspace <北京业务空间ID>')
  process.exit(0)
}

if (!Array.isArray(plan.samples) || plan.samples.length < 1 || plan.samples.length > 12) throw new Error('试听计划必须为 1–12 组。')
const workspaceArg = process.argv.find(value => value.startsWith('--workspace='))?.slice('--workspace='.length)
const workspaceIndex = process.argv.indexOf('--workspace')
const workspace = workspaceArg || (workspaceIndex >= 0 ? process.argv[workspaceIndex + 1] : '') || ''
if (workspace && !/^[a-zA-Z0-9-]+$/.test(workspace)) throw new Error('业务空间 ID 格式不正确。')
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replaceAll(/[^0-9]/g, '')
const output = join(project, '.local', 'voice-auditions', `${stamp}-${process.pid}`)
const helper = join(project, '.local', 'voice-auditions', 'helper.cjs')
await mkdir(output, { recursive: true, mode: 0o700 })
await build({ entryPoints: [join(directory, 'voice-auditions-runner.ts')], outfile: helper, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*'], logLevel: 'silent' })
const electron = fileURLToPath(new URL('../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', import.meta.url))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
console.log(`准备生成 ${plan.samples.length} 段短语音；第 1 段成功后才继续，无自动重试。`)
const child = spawn(electron, [helper, `--project=${project}`, `--output=${output}`, ...(workspace ? [`--workspace=${workspace}`] : [])], { env, stdio: 'inherit' })
child.on('error', () => { console.error('无法启动本项目的 Electron 试听工具。'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
