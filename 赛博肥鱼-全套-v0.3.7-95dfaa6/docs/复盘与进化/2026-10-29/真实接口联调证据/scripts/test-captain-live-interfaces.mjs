#!/usr/bin/env node
// Explicit real-service interface rehearsal. This launcher has no desktop,
// browser automation, mouse, keyboard, or window activation dependency.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2)
const supplied=args.find(x=>x.startsWith('--test-message='))?.slice('--test-message='.length)
const testMessage=supplied===undefined?'舰长你好，今天先稳后勤还是急着扩张？用两句话说说你的打算。':supplied.trim()
const plan=[
  '接口联调计划：实际文本模型请求最多1次，实际千问TTS请求最多1次；不自动重试。',
  '只读本项目已保存的加密设置，运行资料、日志与证据均写入本轮独立目录，不修改真实用户资料。',
  '先检查真实B站房间输入；无可用真实消息时，由runner明确记录为本地注入测试，不能冒充平台观众。',
  '语音采用最后一版呆萌平常话；播放结果由实际音频与播放器回执判断，不自行伪造回执。',
  '不使用桌面控制，不模拟鼠标键盘，不显示、激活或聚焦窗口，不对外开播。',
]

if(!args.includes('--run-real')){
  console.log(plan.join('\n'))
  console.log('当前仅展示计划，未读取凭据、构建或启动进程、连接平台或调用收费接口。执行需显式添加 --run-real。')
  process.exit(0)
}

let directory,child,interrupted=false
try{
  if(!testMessage||testMessage.length>120||/[\u0000-\u001f\u007f]/.test(testMessage))throw Error('测试问题须为1至120字的单条文本。')
  const output=join(project,'.local/live-api-20261029')
  const runId=`run-${Date.now()}-${randomUUID().slice(0,8)}`
  directory=join(output,runId)
  const profile=join(directory,'profile')
  await mkdir(profile,{recursive:true,mode:0o700})
  const runner=join(project,'scripts/captain-live-interfaces-runner.ts')
  const entry=join(directory,'main.cjs')
  const source=await readFile(runner)
  const manifest={schemaVersion:1,date:'2026-10-29',timezone:'Asia/Shanghai',kind:'explicit-real-captain-interface-rehearsal',runId,createdAt:new Date().toISOString(),project,runDirectory:directory,isolatedProfile:profile,limits:{modelRequests:1,ttsRequests:1,automaticRetries:0},requiresRunnerPaidCallGuard:true,desktopControl:false,displayedWindows:false,streaming:false,inputPolicy:'Prefer a received real platform message; local fallback is explicitly labelled injection, never a claimed platform viewer.',testMessageCharacters:testMessage.length,testMessageSha256:createHash('sha256').update(testMessage).digest('hex'),runnerSha256:createHash('sha256').update(source).digest('hex')}
  await writeFile(join(directory,'launcher-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
  const {build}=await import('esbuild')
  const {default:electronPath}=await import('electron')
  await build({entryPoints:[runner],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','node:*'],sourcemap:false,logLevel:'silent'})
  const env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  delete env.CYBER_FISH_TEST_DATA_DIR
  delete env.VITE_DEV_SERVER_URL
  console.log(plan.join('\n'))
  console.log(`本轮独立记录：${directory}`)
  const began=Date.now()
  child=spawn(electronPath,[entry,'--run-real',`--project=${project}`,`--run-dir=${directory}`,`--test-message=${testMessage}`],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  // Runner output must already be sanitized. Keep it in this run's log rather
  // than echoing arbitrary upstream error bodies into the conversation.
  const chunks=[],errors=[]
  child.stdout.on('data',chunk=>chunks.push(Buffer.from(chunk)))
  child.stderr.on('data',chunk=>errors.push(Buffer.from(chunk)))
  const stop=()=>{interrupted=true;child?.kill('SIGTERM')}
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
  let spawnFailed=false
  const result=await new Promise(done=>{
    child.once('error',()=>{spawnFailed=true;done({code:null,signal:null})})
    child.once('close',(code,signal)=>done({code,signal}))
  })
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)
  await writeFile(join(directory,'launcher-stdout.log'),Buffer.concat(chunks),{mode:0o600})
  await writeFile(join(directory,'launcher-stderr.log'),Buffer.concat(errors),{mode:0o600})
  const final={schemaVersion:1,runId,runDirectory:directory,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-began,processId:child.pid,exitCode:result.code,signal:result.signal,spawnFailed,interrupted,runnerExitedSuccessfully:!spawnFailed&&result.code===0,passed:!spawnFailed&&result.code===0,automaticRetries:0,limits:manifest.limits,desktopControl:false,realServiceResult:'See the runner report; launcher exit alone does not prove platform input, model reply, synthesis, or audible playback.'}
  await writeFile(join(directory,'launcher-result.json'),JSON.stringify(final,null,2)+'\n',{mode:0o600})
  const latest=join(output,'latest.json'),temporary=join(output,`latest-${runId}.tmp`)
  await writeFile(temporary,JSON.stringify({runId,directory,launcherResult:join(directory,'launcher-result.json'),runnerExitedSuccessfully:final.runnerExitedSuccessfully,finishedAt:final.finishedAt},null,2)+'\n',{mode:0o600})
  await rename(temporary,latest)
  console.log(`接口联调进程已退出（${result.code??'无退出码'}），证据与费用记录请查看本轮目录；未自动重试。`)
  if(!final.runnerExitedSuccessfully)process.exitCode=1
}catch{
  const result={schemaVersion:1,finishedAt:new Date().toISOString(),runnerExitedSuccessfully:false,passed:false,message:'接口联调未完成；未自动重试。请检查本轮独立记录及runner配置，不输出凭据或上游原始错误。',automaticRetries:0,desktopControl:false}
  if(directory)await writeFile(join(directory,'launcher-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600}).catch(()=>{})
  console.error(result.message)
  process.exitCode=1
}
