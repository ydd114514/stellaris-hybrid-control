import {build} from 'esbuild'
import {mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {join,resolve,dirname,basename} from 'node:path'
import {spawn} from 'node:child_process'
import electronPath from 'electron'
if(!process.argv.includes('--run-offline-sync')){console.log('Use --run-offline-sync --source=<existing real-TTS run>. Zero paid calls; hidden interface/audio verification only.');process.exit(0)}
const root=process.cwd(),source=process.argv.find(x=>x.startsWith('--source='))?.slice(9)
if(!source)throw Error('Explicit existing real-TTS source required')
const base=join(root,'.local/caption-sync-20261029'),directory=join(base,`run-${Date.now()}-${process.pid}`)
await mkdir(join(directory,'profile'),{recursive:true});const entry=join(directory,'main.cjs')
await build({entryPoints:[join(root,'scripts/test-captain-caption-sync.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',external:['electron','node:*'],logLevel:'silent'})
const env={...process.env,CAPTION_SYNC_ROOT:root,CAPTION_SYNC_OUTPUT:directory,CAPTION_SYNC_SOURCE:resolve(source)};delete env.ELECTRON_RUN_AS_NODE;delete env.CYBER_FISH_TEST_DATA_DIR
const child=spawn(electronPath,[entry],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output=''
child.stdout.on('data',b=>output+=b.toString());child.stderr.on('data',b=>output+=b.toString())
const timeout=setTimeout(()=>child.kill(),120000)
const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',done)});clearTimeout(timeout)
await writeFile(join(directory,'run.log'),output)
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));report.childExitCode=code
for(const folder of ['profile','services','ai-fixture']){const target=join(directory,folder);let found=false;try{await realpath(target);found=true}catch{}if(found){const canonical=await realpath(target);if(dirname(canonical)!==await realpath(directory)||basename(canonical)!==folder)throw Error('Unsafe isolated cleanup path');await rm(canonical,{recursive:true,force:true})}}
report.isolatedProfileRemoved=true;report.fixtureDataRemoved=true;await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n')
await writeFile(join(base,'latest.json'),JSON.stringify({directory,passed:report.passed,finishedAt:report.finishedAt},null,2)+'\n')
console.log(JSON.stringify({directory,passed:report.passed,childExitCode:code,timings:report.timings,checks:report.checks,newModelRequests:0,newTtsRequests:0,error:report.error},null,2));process.exitCode=code===0&&report.passed?0:1
