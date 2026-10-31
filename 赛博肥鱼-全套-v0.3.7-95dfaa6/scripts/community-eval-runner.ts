/** Opt-in, windowless, text-only evaluation through the production director. */
import {app,safeStorage} from 'electron'
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {createDirector,DEFAULT_DIRECTOR} from '../packages/core/src/ai-director'
import {chat,aiFailure} from '../packages/core/src/ai-providers'
import {resolveStellarisProfile} from '../apps/desktop/electron/stellaris-profile'

const arg=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3)||''
if(!process.argv.includes('--run-real'))app.exit(0)
else {
 const root=resolve(arg('project')),output=resolve(arg('out'))
 if(!arg('project')||!arg('out')||!output.startsWith(join(root,'.local/community-eval')+sep+'run-'))throw Error('验收目录无效')
 const source=resolveStellarisProfile({sourceRoot:root,documents:app.getPath('documents'),appData:app.getPath('appData'),basic:false})
 const profile=join(output,'profile');mkdirSync(profile,{recursive:true})
 app.setName('群星控制器大肥鱼');app.setPath('userData',profile);app.setPath('sessionData',profile)
 app.commandLine.appendSwitch('disable-background-networking');app.on('window-all-closed',()=>{})
 const statePath=join(source,'Local State')
 if(existsSync(statePath)){const state=JSON.parse(readFileSync(statePath,'utf8'));if(state.os_crypt)writeFileSync(join(profile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}),{mode:0o600})}
 const repair=arg('suite')==='repair',common=repair||arg('suite')==='common',budget=common?80:12
 const ledgerPath=join(root,'.local/community-eval/common-budget-20261031.json')
 const report:any={version:1,suite:repair?'repair':common?'common':'initial',startedAt:new Date().toISOString(),limits:{requests:budget,requestedMaxOutputTokensPerRequest:600,retries:0},requests:0,groups:[],quality:'ungraded',windowsCreated:0,ttsRequests:0,platformRequests:0,sourceProfileWritten:false}
 const save=()=>writeFileSync(join(output,'results.json'),JSON.stringify(report,null,2),{mode:0o600})
 const hash=(file:string)=>createHash('sha256').update(readFileSync(join(source,file))).digest('hex')
 const files=['ai-hub.json','ai-keys.enc.json']
 async function main(){
  writeFileSync(join(output,'paid-run-guard.json'),JSON.stringify({at:Date.now()}),{flag:'wx',mode:0o600});save()
  const baseline=files.map(hash)
  if(!safeStorage.isEncryptionAvailable())throw Error('安全存储不可用')
  const settings=JSON.parse(readFileSync(join(source,'ai-hub.json'),'utf8'))
  const host=settings.agents?.find((a:any)=>a.role==='host'&&a.enabled)
  const provider=settings.providers?.find((p:any)=>p.id===host?.providerId&&p.enabled)
  if(!host?.model||!provider)throw Error('场控未配置')
  const record=JSON.parse(readFileSync(join(source,'ai-keys.enc.json'),'utf8'))
  const key=safeStorage.decryptString(Buffer.from(record[provider.id],'base64'))
  if(!key.trim())throw Error('凭据不可用')
  report.model=host.model;report.providerId=provider.id
  const casesFile=join(root,repair?'scripts/community-repair-cases.json':common?'scripts/community-common-cases.json':'scripts/community-eval-cases.json')
  const cases=JSON.parse(readFileSync(casesFile,'utf8'));report.casesSha256=createHash('sha256').update(readFileSync(casesFile)).digest('hex')
  const selected=arg('only')?arg('only').split(','):[]
  if(selected.some(id=>!cases.groups.some((g:any)=>g.id===id)))throw Error('未知样本编号')
  if(new Set(cases.groups.map((g:any)=>g.id)).size!==cases.groups.length||cases.groups.some((g:any)=>!Array.isArray(g.turns)||g.turns.length<1||g.turns.length>3))throw Error('样本格式无效')
  cases.groups=cases.groups.filter((g:any)=>!selected.length||selected.includes(g.id))
  if(cases.groups.reduce((n:number,g:any)=>n+g.turns.length,0)>budget)throw Error('样本数量超出预算')
  const ledger=common?(existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{limit:80,used:0}):undefined
  if(ledger&&(!Number.isSafeInteger(ledger.used)||ledger.used<0||ledger.limit!==80))throw Error('累计预算记录无效')
  if(ledger&&existsSync(ledgerPath+'.lock'))throw Error('同一预算已有运行或遗留锁，先核对记录')
  if(ledger)writeFileSync(ledgerPath+'.lock',String(process.pid),{flag:'wx',mode:0o600})
  const saveLedger=()=>{if(ledger)writeFileSync(ledgerPath,JSON.stringify(ledger),{mode:0o600})}
  saveLedger()
  try{
  for(const group of cases.groups){
   let clock=Date.now(),current:any
   const rows:any[]=[];report.groups.push({id:group.id,assess:group.assess,turns:rows,fixtureBackground:group.background,fixtureSpeakers:group.speakers})
   const director=createDirector({now:()=>clock,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>group.background?{state:group.background,observedAt:clock,stopped:false}:undefined,
    call:async(agent,messages,signal)=>{
     if(report.requests>=budget||(ledger&&ledger.used>=ledger.limit))throw Error('已达调用上限')
     report.requests++;if(ledger){ledger.used++;saveLedger();report.campaignUsed=ledger.used}save()
     const result=await chat((url,init)=>fetch(url,{...init,redirect:'error'}),{provider,key,model:agent.model,messages,json:true,temperature:agent.temperature,maxTokens:Math.min(600,agent.maxTokens||600),thinking:false,signal,timeoutMs:40000})
     current.usage=result.usage;current.latencyMs=result.latencyMs;save();return result
    },onSay:lines=>{current.replies=lines.map(x=>({to:x.to,text:x.text}));save();return true}})
   try{
    director.start()
    for(let n=0;n<group.turns.length;n++){
     current={input:group.turns[n],replies:[],status:'requested'};rows.push(current)
     const speaker=group.speakers?.[n]||'舰员'
     director.feed({id:group.id+'-'+n,kind:'chat',platform:'bilibili',user:{id:'eval-'+speaker,name:speaker},text:group.turns[n],at:clock})
     await director.tick()
     if(director.status().health?.host?.consecutiveFailures)throw Error('模型请求失败，停止且不重试')
     if(!current.replies.length)throw Error('本轮没有公开答复，停止且不虚构后续上下文')
     current.status='completed';clock+=9000;save()
    }
   }finally{director.stop()}
  }
  }finally{if(ledger){const {unlinkSync}=await import('node:fs');unlinkSync(ledgerPath+'.lock')}}
  report.sourceFilesUnchanged=files.every((file,n)=>hash(file)===baseline[n]);report.finishedAt=new Date().toISOString();save()
 }
 app.whenReady().then(main).then(()=>app.exit(0)).catch(error=>{report.failure=aiFailure(error).message;report.finishedAt=new Date().toISOString();save();app.exit(1)})
}
