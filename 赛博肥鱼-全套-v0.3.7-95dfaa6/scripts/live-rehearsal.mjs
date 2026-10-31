#!/usr/bin/env node
import { access, cp, mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentsList = process.argv.slice(2)
const value = name => argumentsList.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
const integer = (name, fallback, minimum, maximum) => {
  const supplied = value(name)
  const result = supplied === undefined ? fallback : Number(supplied)
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`${name} 需要是 ${minimum}–${maximum} 范围内的整数。`)
  return result
}

try {
  const duration = integer('duration-seconds', 240, 30, 1800)
  const dialogueLimit = integer('max-dialogue-calls', 18, 1, 200)
  const ttsLimit = integer('max-tts-calls', 18, 1, 240)
  const interactive = argumentsList.includes('--interactive')
  const enableWarmup = argumentsList.includes('--enable-warmup')
  const enableAIChatter = argumentsList.includes('--enable-ai-chatter')
  const tracksFile = value('tracks') ? resolve(project, value('tracks')) : undefined
  if (tracksFile && !tracksFile.startsWith(join(project, '.local') + sep)) throw new Error('测试歌曲清单必须保存在本项目的 .local 目录中。')
  const plan = [
    `纯测试直播：${duration} 秒，DeepSeek 最多 ${dialogueLimit} 次、千问配音最多 ${ttsLimit} 次。`,
    '使用独立测试资料目录，只读本项目已保存的服务配置和加密凭据；主小店会暂停让出声音，设置与密钥保持。',
    '真实音频：小店 → BlackHole 2ch → 精确捕获 BlackHole 输入 → Mac 内建/mini 扬声器回听。',
    '只允许指定虚拟声卡输入，缺设备、拒绝录音授权或路由失败立即停止，不使用默认或物理麦克风。',
    interactive ? '互动排练：根据实际回答持续编排假观众；只读取本轮 control/inbox.json 的白名单事件，不执行固定场景、店长自动切歌或自动投票。' : '模拟聊天、玩法语音介绍、进场、礼物连击/去重与口粮增减、刁难、越狱、16人涌入、小心心排歌、受保护切歌及QQ背景歌单。',
    tracksFile ? 'QQ 歌曲由指定清单和本项目已保存的登录态提供，报告按真实播放回执判断是否成功。' : '尚未指定歌曲清单：点歌音源部分将明确记录为未执行，不声称已经播放 QQ 音乐。',
    '真实抖音输入关闭，不对外开播；停止后保存两家实际用量，缺失 token 用量标记 unknown。',
    enableWarmup ? '揽客语音测试已选择：空闲45秒后按核心主动发声间隔与额度限制；可与 AI 闲聊开关同时使用。' : '揽客语音测试默认关闭；需要时显式添加 --enable-warmup。',
    enableAIChatter ? '主动 AI 闲聊已显式开启：至少间隔120秒，每小时最多24轮，小剧场按额度均匀分配；仍受本轮实际请求预算约束，仅配合 --run-real 才会调用真实服务。' : '主动 AI 闲聊默认关闭；需要时显式添加 --enable-ai-chatter。',
  ]
  if (!argumentsList.includes('--run-real')) {
    console.log(plan.join('\n'))
    console.log('\n当前仅显示计划，没有读取凭据或调用服务。确认运行时加 --run-real；可选 --tracks=.local/歌曲清单.json。')
    process.exit(0)
  }
  const renderer = join(project, 'dist/renderer/index.html'), preload = join(project, 'dist/electron/preload.cjs')
  await Promise.all([access(renderer), access(preload)])
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const runDirectory = join(project, '.local/live-rehearsals', runId)
  await mkdir(runDirectory, { recursive: true, mode: 0o700 })
  // Keep this run's renderer immutable while an installation package is built.
  await cp(join(project, 'dist/renderer'), join(runDirectory, 'ui/renderer'), { recursive: true })
  await cp(preload, join(runDirectory, 'ui/preload.cjs'))
  if (interactive) await mkdir(join(runDirectory, 'control'), { mode: 0o700 })
  const { build } = await import('esbuild')
  const { default: electronPath } = await import('electron')
  const entry = join(runDirectory, 'runner.cjs')
  await build({ entryPoints: [join(project, 'scripts/live-rehearsal-runner.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*', '@yakult-green-tea/qq-music-api/serverless'], sourcemap: false, logLevel: 'silent' })
  const args = [entry, '--run-real', `--project=${project}`, `--run-dir=${runDirectory}`, `--duration-seconds=${duration}`, `--max-dialogue-calls=${dialogueLimit}`, `--max-tts-calls=${ttsLimit}`, ...(tracksFile ? [`--tracks=${tracksFile}`] : []), ...(interactive ? ['--interactive'] : []), ...(enableWarmup ? ['--enable-warmup'] : []), ...(enableAIChatter ? ['--enable-ai-chatter'] : []), ...(argumentsList.includes('--close-on-finish') ? ['--close-on-finish'] : [])]
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.CYBER_FISH_TEST_DATA_DIR
  const child = spawn(electronPath, args, { cwd: project, env, detached: true, stdio: 'ignore' })
  let exited = false, failedToLaunch = false
  child.once('exit', () => { exited = true }); child.once('error', () => { failedToLaunch = true }); child.unref()
  let interruptedAt = 0
  const stop = () => { interruptedAt ||= Date.now(); child.kill('SIGTERM') }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  console.log(plan.join('\n'))
  console.log(`\n测试窗口正在准备，实时进度：${join(runDirectory, 'progress.json')}`)
  console.log(`本轮目录：${runDirectory}\n脱敏实时对话：${join(runDirectory, 'live-state.json')}`)
  if (interactive) console.log(`模拟观众批次：${join(runDirectory, 'control/inbox.json')}\n独立观众入口：control/inbox-cat.json、inbox-worker.json、inbox-music.json\n批次回执：control/ack.json、ack-cat.json、ack-worker.json、ack-music.json；最新回执 control/last-ack.json`)
  const report = join(runDirectory, 'report.json'), markdown = join(runDirectory, 'report.md')
  const deadline = Date.now() + (duration + 180) * 1000
  while (true) {
    try {
      const result = JSON.parse(await readFile(report, 'utf8'))
      console.log(`\n测试已停止：${result.status || '请查看报告'}\n中文报告：${markdown}\n完整报告：${report}`)
      if (result.status === 'failed') process.exitCode = 1
      break
    } catch { /* The runner writes the final report atomically. */ }
    if (failedToLaunch || exited) throw new Error(`测试进程提前退出，请查看 ${runDirectory}；没有继续调用服务。`)
    if (interruptedAt && Date.now() - interruptedAt > 25000) throw new Error(`测试已收到停止信号，请查看 ${runDirectory} 中的最终状态。`)
    if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error(`测试等待超时，已要求停止。请查看 ${runDirectory}。`) }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '测试脚本未能启动。'
  console.error(message.replace(/https?:\/\/\S+/g, '[服务地址]'))
  process.exitCode = 1
}
