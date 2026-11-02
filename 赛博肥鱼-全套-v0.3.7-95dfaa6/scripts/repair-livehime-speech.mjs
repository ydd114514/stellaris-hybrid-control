import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'

/** Change only the local DSH overlay's audio settings, preserving other sources. */
export function repairSpeechSource(collection){
  const changes=[]
  for(const source of collection.sources??[]){
    if(source.id!=='browser_source'||!source.name?.includes('大肥鱼')||!source.settings)continue
    let url;try{url=new URL(source.settings.url)}catch{continue}
    if(url.origin!=='http://127.0.0.1:17655'||url.pathname!=='/overlay')continue
    const before={url:source.settings.url,reroute_audio:source.settings.reroute_audio,muted:source.muted,monitoring_type:source.monitoring_type}
    url.searchParams.set('voice','1')
    source.settings.url=url.href
    source.settings.reroute_audio=true
    source.muted=false
    // OBS/LiveHime: monitor locally AND send to the output, with one audio owner.
    source.monitoring_type=2
    const after={url:source.settings.url,reroute_audio:source.settings.reroute_audio,muted:source.muted,monitoring_type:source.monitoring_type}
    if(JSON.stringify(before)!==JSON.stringify(after))changes.push({name:source.name,before,after})
  }
  return changes
}

export function run(args=process.argv.slice(2)){
  if(args.some(a=>a!=='--apply'&&!a.startsWith('--profile=')&&!a.startsWith('--backup-dir=')))throw Error('不支持的参数。')
  const profile=args.find(a=>a.startsWith('--profile='))?.slice('--profile='.length)
  if(!profile)throw Error('请通过 --profile= 指定直播姬账号配置目录。默认只预览；--apply 才保存。')
  const apply=args.includes('--apply')
  if(apply){
    if(process.platform!=='win32')throw Error('仅在本机 Windows 上保存直播姬配置。')
    const running=execFileSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-Command',"@(Get-Process | Where-Object { $_.ProcessName -match 'livehime|bililive|直播姬' }).Count"],{encoding:'utf8',windowsHide:true}).trim()
    if(running!=='0')throw Error('请先正常退出直播姬，避免覆盖正在使用的配置。')
  }
  const plan=['untitledv2.json','Scene Collection/support_group_collection.json'].map(file=>{
    const path=join(resolve(profile),file),original=readFileSync(path,'utf8'),collection=JSON.parse(original),changes=repairSpeechSource(collection)
    return {file,path,original,collection,changes}
  })
  if(!plan.some(p=>p.collection.sources?.some(s=>s.id==='browser_source'&&s.name?.includes('大肥鱼')&&s.settings?.url?.startsWith('http://127.0.0.1:17655/overlay'))))throw Error('未找到本机大肥鱼框面网页源，不保存。')
  const changed=plan.filter(p=>p.changes.length)
  if(apply&&changed.length){
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
    const backup=resolve(args.find(a=>a.startsWith('--backup-dir='))?.slice('--backup-dir='.length)||join(root,'.local/livehime-speech-backup',new Date().toISOString().replace(/[:.]/g,'-')))
    mkdirSync(backup,{recursive:true})
    for(const p of changed)writeFileSync(join(backup,p.file.replaceAll('/','__')),p.original,{flag:'wx'})
    for(const p of changed){
      if(readFileSync(p.path,'utf8')!==p.original)throw Error('直播姬配置已发生变化，请退出后重试。')
      const temp=join(dirname(p.path),basename(p.path)+'.dsh-speech.tmp')
      writeFileSync(temp,JSON.stringify(p.collection,null,2)+'\n',{flag:'wx'})
      renameSync(temp,p.path)
    }
    console.log(JSON.stringify({saved:true,backup,changes:changed.map(({file,changes})=>({file,changes}))},null,2))
  }else console.log(JSON.stringify({saved:false,alreadyCorrect:!changed.length,changes:changed.map(({file,changes})=>({file,changes}))},null,2))
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{run()}catch(e){console.error(e.message);process.exitCode=1}}
