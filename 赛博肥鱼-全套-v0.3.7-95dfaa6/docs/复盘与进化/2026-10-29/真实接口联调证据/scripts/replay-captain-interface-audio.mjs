import {build} from 'esbuild'
import {mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {join,resolve,dirname,basename} from 'node:path'
import {spawn} from 'node:child_process'
import electronPath from 'electron'
if(!process.argv.includes('--run-playback-only')){console.log('Provide --run-playback-only --source=<the completed real-TTS directory>. This only replays its WAV; no model/TTS/network accounts are used.');process.exit(0)}
const root=process.cwd(),source=process.argv.find(x=>x.startsWith('--source='))?.slice(9)
if(!source)throw Error('Explicit source directory required')
const base=join(root,'.local/live-api-20261029/audio-replay'),directory=join(base,`run-${Date.now()}-${process.pid}`)
await mkdir(directory,{recursive:true});const file=join(directory,'main.cjs')
await build({entryPoints:[join(root,'scripts/replay-captain-interface-audio.ts')],outfile:file,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent'})
const env={...process.env,CAPTAIN_REPLAY_ROOT:root,CAPTAIN_REPLAY_OUTPUT:directory,CAPTAIN_REPLAY_SOURCE:resolve(source)};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(electronPath,[file],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output=''
child.stdout.on('data',b=>output+=b.toString());child.stderr.on('data',b=>output+=b.toString())
const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',done)})
await writeFile(join(directory,'run.log'),output)
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));report.childExitCode=code
for(const name of ['profile','services']){
 const target=join(directory,name);let found=false;try{await realpath(target);found=true}catch{}
 if(found){const absolute=await realpath(target);if(dirname(absolute)!==await realpath(directory)||basename(absolute)!==name)throw Error('Unsafe isolated cleanup target');await rm(absolute,{recursive:true,force:true})}
}
report.isolatedProfileRemoved=true;report.offlineFixtureRemoved=true
await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n')
await writeFile(join(base,'latest.json'),JSON.stringify({directory,passed:report.passed,finishedAt:report.finishedAt},null,2)+'\n')
console.log(JSON.stringify({directory,passed:report.passed,childExitCode:code,newModelRequests:report.newModelRequests,newTtsRequests:report.newTtsRequests,servedAudio:report.servedAudio,audio:report.audio,isolatedProfileRemoved:true,offlineFixtureRemoved:true,error:report.error},null,2));process.exitCode=code===0&&report.passed?0:1
