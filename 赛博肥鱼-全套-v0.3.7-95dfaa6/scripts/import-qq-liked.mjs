import {build} from 'esbuild'
import {spawn,execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,realpath} from 'node:fs/promises'
import {resolve,join,dirname,basename} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import electron from 'electron'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2)
if(args.some(a=>a!=='--run-real'&&a!=='--apply'&&!a.startsWith('--profile=')))throw Error('不支持的导入参数。')
const source=args.find(a=>a.startsWith('--profile='))?.slice('--profile='.length)
if(!args.includes('--run-real')||!source){console.log('使用 --run-real --profile=本机DSH资料目录 读取QQ“我喜欢”；加 --apply 才合并到本机轮播。不会打开窗口、改QQ歌单或播放声音。');process.exit(0)}
function requireClosed(){
 const count=execFileSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-Command',"@(Get-Process | Where-Object { $_.ProcessName -eq 'electron' -or $_.ProcessName -match '大肥鱼|群星控制器' }).Count"],{encoding:'utf8',windowsHide:true}).trim()
 if(count!=='0')throw Error('控制器仍在运行；请正常退出后再导入，避免歌单被内存中的旧数据覆盖。')
}
if(args.includes('--apply'))requireClosed()
const parent=join(root,'.local/test-data');await mkdir(parent,{recursive:true})
const temporary=await mkdtemp(join(parent,'liked-import-')),profile=join(temporary,'profile'),output=join(temporary,'catalog.json')
await mkdir(profile)
try{
 const runner=join(temporary,'runner.cjs')
 await build({entryPoints:[join(root,'scripts/import-qq-liked-runner.ts')],outfile:runner,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','@yakult-green-tea/qq-music-api/serverless'],logLevel:'silent'})
 const env={...process.env,CYBERFISH_IMPORT_SOURCE:resolve(source),CYBERFISH_IMPORT_PROFILE:profile,CYBERFISH_IMPORT_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
 const child=spawn(electron,[runner],{cwd:root,env,windowsHide:true,stdio:'ignore'})
 await new Promise((done,fail)=>{const timer=setTimeout(()=>{child.kill();fail(Error('读取我喜欢超时，未改歌单。'))},145000);child.once('error',e=>{clearTimeout(timer);fail(e)});child.once('close',code=>{clearTimeout(timer);code===0?done():fail(Error('读取我喜欢未完成，未改歌单。'))})})
 const result=JSON.parse(await readFile(output,'utf8'))
 if(!result.ok)throw Error(result.message)
 const bundle=await build({stdin:{contents:"export {mergeMusicRotation} from './packages/core/src/music-import'",resolveDir:root,loader:'ts'},write:false,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
 const {mergeMusicRotation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
 const file=join(resolve(source),'stellaris-music.json'),before=await readFile(file,'utf8')
 const merged=mergeMusicRotation(JSON.parse(before),result.tracks)
 let backup
 if(args.includes('--apply')){
  requireClosed()
  if(await readFile(file,'utf8')!==before)throw Error('轮播配置已变化，未覆盖，请重试。')
  const backups=join(root,'.local/qq-liked-backup');await mkdir(backups,{recursive:true})
  backup=join(backups,Date.now()+'-stellaris-music.json');await writeFile(backup,before,{flag:'wx',mode:0o600})
  const staging=file+'.liked-import.tmp';await writeFile(staging,JSON.stringify(merged.data),{flag:'wx',mode:0o600});await rename(staging,file)
  const saved=JSON.parse(await readFile(file,'utf8'));if(JSON.stringify(saved.bgmTrackIds)!==JSON.stringify(merged.data.bgmTrackIds))throw Error('轮播保存未能确认。')
 }
 console.log(JSON.stringify({saved:args.includes('--apply'),total:result.total,skippedMetadata:result.skipped,truncated:result.truncated,...merged.counts,rotationTotal:merged.data.bgmTrackIds.length,requests:result.requests,...(backup?{backup}:{}),qqPlaylistModified:false,audioStarted:false},null,2))
}finally{
 const target=await realpath(temporary)
 if(dirname(target)!==await realpath(parent)||!basename(target).startsWith('liked-import-'))throw Error('导入临时目录不正确。')
 await rm(target,{recursive:true,force:true})
}
