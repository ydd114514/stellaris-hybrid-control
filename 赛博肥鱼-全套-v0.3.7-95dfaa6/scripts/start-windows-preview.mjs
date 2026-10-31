import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
if(!process.argv.includes('--apply')){console.log('使用 --apply 打开小店与直播伴侣的本地预览。只在伴侣未直播、未录制时重新绑定当前窗口；从不开始直播或录制。');process.exit(0)}
if(process.platform!=='win32')throw Error('此启动器仅用于 Windows。')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CYBER_FISH_TEST_DATA_DIR;delete env.VITE_DEV_SERVER_URL
const base=join(process.env.APPDATA,'webcast_mate'),artifacts=join(root,'.local/windows-live-setup'),exe=join(root,'release/win-unpacked/赛博肥鱼.exe')
const pwsh='C:/Program Files/PowerShell/7/pwsh.exe',adminScript=join(root,'scripts/native/companion-preview-admin.ps1')
const admin=action=>execFileSync(pwsh,['-NoProfile','-File',adminScript,'-Action',action,'-FishPath',exe],{encoding:'utf8',windowsHide:true,env}).trim()
async function requireIdle(){const {roomStore:r}=JSON.parse(await readFile(join(base,'WBStore/roomStore.json'),'utf8'));if(r.status!==4||r.recordStatus!==4)throw Error('伴侣正在直播、录制或切换状态，已停止重配。请先结束当前操作。')}
await requireIdle()
const observed=JSON.parse(admin('Inspect'))
if(!observed.fishRunning)admin('StartFish')
let capture
for(let attempt=0;attempt<12;attempt++){
 try{const out=execFileSync(process.execPath,[join(root,'scripts/read-windows-capture-source.mjs')],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});capture=JSON.parse(out.trim());break}catch{await delay(400)}
}
if(!capture?.handle)throw Error('未找到唯一的小店采集窗口。请在小店后台打开直播窗口后重试。')
await requireIdle()
const sourcePath=join(base,'WBStore/sourceStore.json'),doc=JSON.parse(await readFile(sourcePath,'utf8'))
const sources=Object.values(doc.sourceStore.sceneSource.scene4?.data||{}).filter(s=>s.type==='window'&&s.payload.exe==='赛博肥鱼.exe'&&s.payload.titleName===capture.titleName)
if(sources.length!==1)throw Error('找不到唯一的已配置小店素材，没有覆盖现有场景。')
admin('StopCompanion');await delay(350)
await mkdir(artifacts,{recursive:true});await copyFile(sourcePath,join(artifacts,'source-before-preview-launch.json'))
const source=sources[0];Object.assign(source.payload,{handle:capture.handle,compatible:true,enableMagCapture:false});source.transform.size=capture.size
doc.sourceStore.currentScene='scene4';doc.sourceStore.streamScene='scene4'
await writeFile(sourcePath,JSON.stringify(doc))
admin('StartCompanion')
console.log(JSON.stringify({opened:true,captureHandle:capture.handle,title:capture.titleName,scene:'肥鱼小店 · 本地预览',publicBroadcast:false,recordingStarted:false}))
