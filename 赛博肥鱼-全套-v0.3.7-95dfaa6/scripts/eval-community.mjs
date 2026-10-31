import {resolve,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdir,readFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2)
if(args.some(x=>x!=='--run-real'&&x!=='--suite=common'&&x!=='--suite=repair'&&!/^--only=[a-z0-9,-]+$/.test(x)))throw Error('不支持的参数')
if(args.filter(x=>x.startsWith('--suite=')).length>1)throw Error('只选择一套样本')
const repair=args.includes('--suite=repair'),common=repair||args.includes('--suite=common')
const casesPath=join(root,repair?'scripts/community-repair-cases.json':common?'scripts/community-common-cases.json':'scripts/community-eval-cases.json')
if(!args.includes('--run-real')){
 const cases=JSON.parse(await readFile(casesPath,'utf8'));const only=args.find(x=>x.startsWith('--only='))?.slice(7).split(',');const groups=cases.groups.filter(g=>!only||only.includes(g.id))
 console.log(JSON.stringify({status:'plan_only',groups:groups.length,plannedRequests:groups.reduce((n,g)=>n+g.turns.length,0),cumulativeRequestLimit:common?80:12,requestedMaxOutputTokensPerRequest:600,timeoutPerRequestMs:40000,retries:0,ttsRequests:0,platformRequests:0,windowsCreated:0,credentialsRead:false,cases:casesPath}))
}else{
 const output=join(root,'.local/community-eval','run-'+Date.now()+'-'+randomUUID().slice(0,8))
 await mkdir(output,{recursive:true})
 const {build}=await import('esbuild');const {default:electron}=await import('electron')
 const entry=join(output,'runner.cjs')
 await build({entryPoints:[join(root,'scripts/community-eval-runner.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','node:*'],logLevel:'silent'})
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
 console.log('结果目录：'+output)
 const child=spawn(electron,[entry,'--run-real','--project='+root,'--out='+output,...args.filter(x=>x.startsWith('--suite=')||x.startsWith('--only='))],{cwd:root,env,windowsHide:true,stdio:'ignore'})
 const timer=setTimeout(()=>child.kill(),common?2400000:540000)
 const stop=()=>child.kill();process.once('SIGINT',stop);process.once('SIGTERM',stop)
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)}).finally(()=>clearTimeout(timer))
 console.log(JSON.stringify({exitCode:code,results:join(output,'results.json'),quality:'requires_review_of_actual_replies'}));process.exitCode=code===0?0:1
}
