import {build} from 'esbuild'
import electron from 'electron'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {spawn} from 'node:child_process'

if(!process.argv.includes('--generate')){
  console.log('生成6句当前直播声音小样，最多6次TTS请求，不自动重试，不播放、不连接直播。执行需 --generate。')
  process.exit(0)
}
const calm=process.argv.includes('--calm')
const naturalCompare=process.argv.includes('--natural-compare')
const relaxedDesign=process.argv.includes('--relaxed-design')
const baselineCompare=process.argv.includes('--baseline-compare')
const designAccess=process.argv.includes('--design-access')
const compareKeys=process.argv.includes('--compare-voice-keys')
const keyStdin=process.argv.includes('--key-stdin')
const ordinaryCheck=process.argv.includes('--ordinary-key-check')
const inspectAccess=process.argv.includes('--inspect-model-access')
const grantVoiceDesign=process.argv.includes('--grant-voice-design')
const candidateKeyFile=process.argv.find(x=>x.startsWith('--candidate-key-file='))?.slice('--candidate-key-file='.length)
const workspaceId=process.argv.find(x=>x.startsWith('--workspace-id='))?.slice('--workspace-id='.length)
if(workspaceId&&!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspaceId))throw Error('业务空间ID格式无效。')
const keyPipeFile=process.argv.find(x=>x.startsWith('--key-pipe-file='))?.slice('--key-pipe-file='.length)
let keyPipe=''
if(keyPipeFile){
  const input=JSON.parse(await readFile(resolve(keyPipeFile),'utf8'))
  if(typeof input.pipe!=='string'||!/^\\\\\.\\pipe\\cyberfish-voice-key-[a-f0-9-]{36}$/i.test(input.pipe))throw Error('密钥管道地址无效。')
  keyPipe=input.pipe
}
if([calm,naturalCompare,relaxedDesign,baselineCompare].filter(Boolean).length>1)throw Error('试听方向不能同时选择。')
const output=resolve('../语音小样/2026-11-02/'+(baselineCompare?'原声线-撤回调音对照-':relaxedDesign?'直播台词-松弛原创四调-':naturalCompare?'直播台词-自然三调对照-':calm?'直播台词-冷静二调-':'直播台词-')+Date.now())
await mkdir(output,{recursive:true})
await build({entryPoints:['scripts/voice-live-samples-runner.ts'],outfile:join(output,'runner.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','node:*'],logLevel:'silent'})
const env={...process.env}
delete env.ELECTRON_RUN_AS_NODE
delete env.CYBER_FISH_TEST_DATA_DIR
const child=spawn(electron,[join(output,'runner.cjs'),'--generate','--output='+output,'--project='+resolve('.'),...(calm?['--calm']:[]),...(naturalCompare?['--natural-compare']:[]),...(relaxedDesign?['--relaxed-design']:[]),...(baselineCompare?['--baseline-compare']:[]),...(designAccess?['--design-access']:[]),...(compareKeys?['--compare-voice-keys']:[]),...(keyStdin?['--key-stdin']:[]),...(keyPipe?['--key-pipe='+keyPipe]:[]),...(ordinaryCheck?['--ordinary-key-check']:[]),...(inspectAccess?['--inspect-model-access']:[]),...(grantVoiceDesign?['--grant-voice-design']:[]),...(candidateKeyFile?['--candidate-key-file='+resolve(candidateKeyFile)]:[]),...(workspaceId?['--workspace-id='+workspaceId]:[])],{env,windowsHide:true,stdio:[keyStdin?'pipe':'ignore','pipe','pipe']})
if(keyStdin){child.stdin.on('error',()=>{});process.stdin.pipe(child.stdin)}
child.stdout.pipe(process.stdout)
// Chromium diagnostics can contain paths; only the runner's sanitized messages are public.
child.stderr.resume()
const timer=setTimeout(()=>child.kill(),relaxedDesign?450000:330000)
const code=await new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail)})
if(keyStdin){process.stdin.unpipe(child.stdin);process.stdin.pause()}
clearTimeout(timer)
await writeFile(resolve('.local/latest-live-voice-samples.json'),JSON.stringify({output,exitCode:code},null,2))
console.log('试听目录：'+output)
process.exitCode=typeof code==='number'?code:1
