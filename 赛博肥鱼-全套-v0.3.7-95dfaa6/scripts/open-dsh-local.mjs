import {existsSync} from 'node:fs';import {spawn} from 'node:child_process';import {resolve,dirname,join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
export function localLaunchPlan({root,localAppData=process.env.LOCALAPPDATA,rollback=false,exists=existsSync,speech=false}={}){
 const source=resolve(root),exe=rollback?join(localAppData||'','Programs/CyberfishDSH/0.3.16/大肥鱼 DSH.exe'):join(source,'node_modules/electron/dist/electron.exe');
 const main=join(source,'dist/dsh/electron/main.cjs'),renderer=join(source,'dist/dsh/renderer/stellaris.html'),controller=resolve(source,'../stellaris-player');
 const required=rollback?[exe]:[exe,main,renderer,join(controller,'scripts/autoplay-native.mjs'),join(controller,'scripts/desktop-preflight.mjs')];
 const missing=required.filter(p=>!exists(p));
 return {ok:missing.length===0,mode:rollback?'rollback-0.3.16':'local-source',executable:exe,args:[...(!rollback?[main]:[]),...(speech?['--speech']:[])],cwd:source,controller:rollback?null:controller,missing,environment:rollback?{}:{CYBERFISH_LOCAL_SOURCE:'1'}};
}
export async function runLocalLauncher(args=process.argv.slice(2),{spawnProcess=spawn,output=console.log,env=process.env,root=resolve(dirname(fileURLToPath(import.meta.url)),'..')}={}){
 if(args.some(a=>!['--launch','--check','--rollback','--speech'].includes(a)))throw Error('不支持的启动参数');
 if(args.includes('--launch')&&args.includes('--check'))throw Error('检查模式不能同时启动桌面');
 const plan=localLaunchPlan({root,localAppData:env.LOCALAPPDATA,rollback:args.includes('--rollback'),speech:args.includes('--speech')});
 if(!plan.ok)throw Error('启动文件缺失，请先构建本机DSH源码；可用 --rollback 回退0.3.16。缺失：'+plan.missing.join('、'));
 if(!args.includes('--launch')){output(JSON.stringify({...plan,launched:false,realModelCalls:0}));return plan;}
 const childEnv={...env,...plan.environment};delete childEnv.ELECTRON_RUN_AS_NODE;delete childEnv.VITE_DEV_SERVER_URL;
 const child=spawnProcess(plan.executable,plan.args,{cwd:plan.cwd,env:childEnv,detached:true,windowsHide:true,stdio:'ignore'});
 await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runLocalLauncher().catch(e=>{console.error(e.message);process.exitCode=1;});
