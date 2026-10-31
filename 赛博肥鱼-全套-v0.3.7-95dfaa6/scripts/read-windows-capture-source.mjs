import {writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {join,resolve,sep} from 'node:path'
import electronPath from 'electron'
const root=process.cwd(),testRoot=join(root,'.local/test-data');await mkdir(testRoot,{recursive:true})
const profile=await mkdtemp(join(testRoot,'window-enum-')),helper=join(profile,'enumerate.cjs')
await writeFile(helper,`const {app,desktopCapturer}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const rows=(await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false})).filter(w=>w.name==='赛博肥鱼 · 抖音直播采集（9:16）');if(rows.length!==1)throw Error('采集窗口不是唯一可用窗口');console.log(JSON.stringify({id:rows[0].id,titleName:rows[0].name,handle:Number(rows[0].id.split(':')[1]),windowClass:'Chrome_WidgetWin_1',exe:'赛博肥鱼.exe',size:{x:540,y:960}}));app.quit()}).catch(()=>{console.error('未找到唯一的肥鱼采集窗口');app.exit(1)})`)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(electronPath,[helper],{env,stdio:['ignore','pipe','ignore'],windowsHide:true});let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s)
try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('读取肥鱼采集窗口信息失败。')))})
 const source=JSON.parse(output.trim());await writeFile('.local/windows-live-setup/capture-source.json',JSON.stringify(source,null,2));console.log(JSON.stringify(source))
}finally{if(!resolve(profile).startsWith(resolve(testRoot)+sep))throw Error('Invalid cleanup path');await rm(profile,{recursive:true,force:true})}
