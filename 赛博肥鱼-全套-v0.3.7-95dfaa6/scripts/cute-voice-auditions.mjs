/** One explicitly requested voice design per run; without --generate no key is read. */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const directory = dirname(fileURLToPath(import.meta.url)), project = dirname(directory)
const plan = JSON.parse(await readFile(join(directory, 'cute-voice-auditions-plan.json'), 'utf8'))
const option = name => {
  const direct = process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return direct || (index >= 0 ? process.argv[index + 1] : '') || ''
}
const sampleId = option('sample') || '01'
const sample = plan.directions.find(value => value.id === sampleId.padStart(2, '0'))
if (!sample) throw new Error('请选择01、02或03组；每次只生成一组。')
if (!process.argv.includes('--generate')) {
  console.log(`幼态动漫女声计划：${plan.directions.length}个方向，同段${plan.text.length}字；未读取密钥、未调用API。`)
  console.log(plan.text)
  for (const value of plan.directions) console.log(`${value.id} ${value.name}：${value.prompt}`)
  console.log(`首次默认只生成01组，目标模型${plan.targetModel}，直接使用设计返回的WAV预览，不追加语音合成。`)
  console.log('生成首样：node scripts/cute-voice-auditions.mjs --generate --workspace <北京业务空间ID>')
  console.log('另两组保留为备选；确认首样后可显式指定 --sample 02 或 --sample 03，每次仍只有一组。')
  process.exit(0)
}
const workspace = option('workspace')
if (!/^[a-zA-Z0-9-]{1,100}$/.test(workspace)) throw new Error('请明确提供北京业务空间ID。')
if (process.argv.includes('--all')) throw new Error('请先试听单组结果；此工具不会批量生成。')
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replaceAll(/[^0-9]/g, '')
const output = join(project, '.local', 'cute-voice-auditions', `${stamp}-${sample.id}-${process.pid}`)
const helper = join(project, '.local', 'cute-voice-auditions', 'helper.cjs')
await mkdir(output, { recursive: true, mode: 0o700 })
await build({ entryPoints: [join(directory, 'cute-voice-auditions-runner.ts')], outfile: helper, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*'], logLevel: 'silent' })
const electron = fileURLToPath(new URL('../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', import.meta.url))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
console.log(`准备设计${sample.id}「${sample.name}」；最多1次设计请求，不自动重试，不追加付费合成，不改直播设置。`)
const child = spawn(electron, [helper, '--generate', `--project=${project}`, `--output=${output}`, `--workspace=${workspace}`, `--sample=${sample.id}`], { env, stdio: 'inherit' })
child.on('error', () => { console.error('无法启动本项目的声音设计试听工具。'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
