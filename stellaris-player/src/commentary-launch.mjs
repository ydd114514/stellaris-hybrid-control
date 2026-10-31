import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export const COMMENTARY_CAPTION_PROTOCOL='actual-playback-v1';

/** Own overlay lifecycle only; injectable dependencies keep tests offline. */
export async function ensureCommentary(options={}) {
  const root=options.root||fileURLToPath(new URL('..',import.meta.url)),url='http://127.0.0.1:17655';
  const wait=options.wait||delay,currentPid=options.currentPid||process.pid;
  const getHealth=options.getHealth||async function(){
    let response;
    try{response=await fetch(url+'/health',{signal:AbortSignal.timeout(1500),redirect:'error'});}catch{return;}
    if(!response.ok)throw new Error('解说端口未能确认服务身份，不会重启该端口的程序。');
    try{return await response.json();}catch{throw new Error('解说端口返回了无法确认的服务信息，不会重启该端口的程序。');}
  };
  const readMetadata=options.readMetadata||async function(){
    const text=await readFile(join(root,'.local/commentary/server.json'),'utf8');
    if(text.length>65536)throw new Error('invalid_metadata');
    return JSON.parse(text.replace(/^\ufeff/,''));
  };
  const stopProcess=options.stopProcess||((pid)=>process.kill(pid,'SIGTERM'));
  const startServer=options.startServer||async function(){
    await mkdir(join(root,'.local/commentary'),{recursive:true});
    const output=openSync(join(root,'.local/commentary/server.log'),'a');
    try{
      const child=spawn(process.execPath,['scripts/commentary-server.mjs'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',output,output],env:{...process.env,DEEPSEEK_API_KEY:''}});
      await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();
    }finally{closeSync(output);}
  };
  async function health(){
    const data=await getHealth();
    if(!data)return;
    if(data.application!=='cyberfish-commentary')throw new Error('解说端口被其他程序占用，不会停止或重启该程序。');
    return data;
  }
  let existing=await health();
  if(existing?.captionProtocol===COMMENTARY_CAPTION_PROTOCOL)return {url,existing:true};
  let upgraded=false;
  if(existing){
    let metadata;try{metadata=await readMetadata();}catch{throw new Error('旧解说服务不支持语音同步，但无法核对本项目的进程记录；请手动关闭旧解说服务后重试。');}
    const pid=existing.pid;
    if(!Number.isSafeInteger(pid)||pid<=0||pid>2147483647||pid===currentPid||metadata?.pid!==pid||metadata?.url!==url)throw new Error('旧解说服务的进程或地址与本项目记录不一致，不会停止该进程；请手动检查解说服务。');
    // Recheck the port owner immediately before the one permitted termination.
    const checked=await health();
    if(checked?.captionProtocol===COMMENTARY_CAPTION_PROTOCOL)return {url,existing:true};
    if(checked&&checked.pid!==pid)throw new Error('解说端口的进程已变化，不会停止或重启新的进程。');
    if(checked){
      try{await stopProcess(pid);}catch(error){if(error?.code!=='ESRCH')throw new Error('无法停止已核对的旧解说服务；未启动重复服务，请手动关闭旧服务后重试。');}
      let released=false;
      for(let n=0;n<15;n++){
        await wait(200);const current=await health();
        if(!current){released=true;break;}
        if(current.captionProtocol===COMMENTARY_CAPTION_PROTOCOL)return {url,existing:true,upgraded:true};
        if(current.pid!==pid)throw new Error('解说端口已由另一进程接管，不会继续停止进程。');
      }
      if(!released)throw new Error('已核对的旧解说服务尚未退出；未启动重复服务，请稍后重试。');
    }
    upgraded=true;
  }
  await startServer();
  for(let n=0;n<15;n++){
    await wait(200);existing=await health();
    if(existing?.captionProtocol===COMMENTARY_CAPTION_PROTOCOL)return {url,existing:false,...(upgraded?{upgraded:true}:{})};
  }
  throw new Error('解说面板未能启动或未提供语音同步能力，详情见 .local/commentary/server.log');
}
