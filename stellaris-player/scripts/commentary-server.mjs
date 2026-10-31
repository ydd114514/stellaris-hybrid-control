import http from 'node:http';
import {readFile,writeFile,mkdir,stat,open,readdir,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JsonlTail} from '../src/jsonl-tail.mjs';
import {planCaption,planHistoryItem,SurveyCaptionTracker,dshPhase,audienceState} from '../src/commentary.mjs';
import {audienceEvent} from '../src/audience.mjs';
import {GameNotebook} from '../src/game-notebook.mjs';
import {createApiBalanceMonitor} from '../src/api-balance.mjs';
import {loadDeepSeekKey} from '../src/credentials.mjs';
import {readAudienceGuidance} from '../src/audience-guidance.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const testRoot=process.env.CYBERFISH_COMMENTARY_TEST_ROOT;
process.chdir(testRoot?resolve(testRoot):root);
const directory=resolve('.local/commentary');await mkdir(directory,{recursive:true});
const clients=new Set(),started=Date.now();let lastPlan='',lastPlanAt=0;
let previewPath=null;
let savedNotebook={};try{savedNotebook=JSON.parse(await readFile(join(directory,'notebook.json'),'utf8'));}catch{}
const notebook=new GameNotebook(savedNotebook);
const recentPlans=[];
// Backfill only actual native observations/verified receipts. No historical voice replay.
const journalRoot=resolve('.local/native-bridge');
try {
  const journals=await Promise.all((await readdir(journalRoot)).filter(n=>/^session-.*\.jsonl$/.test(n)).map(async n=>({path:join(journalRoot,n),mtime:(await stat(join(journalRoot,n))).mtimeMs})));
  const rows=[];
  for(const j of journals.sort((a,b)=>a.mtime-b.mtime).slice(-6)){
    const file=await open(j.path);
    try{const size=(await file.stat()).size,start=Math.max(0,size-4*1024*1024),buf=Buffer.alloc(size-start);await file.read(buf,0,buf.length,start);let date=null;
      for(const line of buf.toString('utf8').split('\n'))try{const r=JSON.parse(line);if(r.type==='state')date=r.state?.date||null;if(r.type==='intent'){const item=planHistoryItem(r,date);if(item)recentPlans.push(item);}if(['state','receipt'].includes(r.type)&&r.at>notebook.lastAt)rows.push(r);}catch{}
    }finally{await file.close();}
  }
  for(const row of rows.sort((a,b)=>a.at.localeCompare(b.at)))notebook.consume(row);
}catch{/* New installation may have no native journal yet. */}
async function saveNotebook(){if(!notebook.dirty)return;const path=join(directory,'notebook.json');await writeFile(path+'.tmp',JSON.stringify(notebook.serialize(),null,2));await rename(path+'.tmp',path);notebook.dirty=false;}
await saveNotebook();
const restoredPlans=[...new Map(recentPlans.sort((a,b)=>b.at-a.at).map(p=>[p.id,p])).values()].slice(0,6);
let state={phase:'等待接入',caption:restoredPlans[0]?.text||'让我看看，这一局该怎么打。',history:restoredPlans,game:null,audio:null,voiceEnabled:false,sequence:0,audience:{messages:[]},notebook:notebook.publicEntries(),previewFrameAt:0,apiBalance:{status:testRoot?'disabled':'loading',display:'—',updatedAt:null}};
function emit(){state.sequence++;const packet=`data: ${JSON.stringify(state)}\n\n`;for(const c of clients)c.write(packet);}
const balance=createApiBalanceMonitor({enabled:!testRoot,getKey:()=>loadDeepSeekKey(),onUpdate:value=>{state.apiBalance=value;emit();}});
void balance.refresh();const balanceTimer=setInterval(()=>void balance.refresh(),300000);balanceTimer.unref();
function line(message,item) {
  if(!message?.text) return;
  if(message.kind==='plan' && message.text===lastPlan && Date.now()-lastPlanAt<20000) return;
  if(message.kind==='plan'){lastPlan=message.text;lastPlanAt=Date.now();state.caption=message.text;}
  state.phase=message.phase||state.phase;
  item ||= {id:randomUUID(),at:Date.now(),kind:message.kind,text:message.text,date:null};
  state.history=[item,...state.history.filter(x=>x.id!==item.id)].slice(0,6);emit();
}
const nativeTail=new JsonlTail(),dshTail=new JsonlTail(),audienceTail=new JsonlTail({readInitial:true}),surveyCaptions=new SurveyCaptionTracker();let polling=false;
function acceptFrame(frame) {
  const path=typeof frame?.path==='string'?resolve(frame.path):'';
  const allowed=resolve(process.env.LOCALAPPDATA||'C:/Users/YDD/AppData/Local','Temp/Cyberfish/native-frames');
  if(path.startsWith(allowed+'\\') && /^\d+-\d+\.bmp$/.test(path.split(/[\\/]/).at(-1))){previewPath=path;state.previewFrameAt=Date.now();}
}
async function findPreview(checkpoint) {
  if(previewPath)return;
  const path=resolve('.local/native-bridge',`session-${checkpoint.sessionId}.jsonl`),file=await open(path);
  try{const size=(await file.stat()).size,offset=Math.max(0,size-2*1024*1024),buffer=Buffer.alloc(size-offset);await file.read(buffer,0,buffer.length,offset);
    for(const line of buffer.toString('utf8').split('\n').reverse()){try{const row=JSON.parse(line);if(row.type==='picture_evidence'){acceptFrame(row.frame);break;}}catch{}}
  }finally{await file.close();}
}
async function poll(){
  if(polling)return;polling=true;
  try {
    state.audienceGuidance=await readAudienceGuidance(directory);
    const checkpoint=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8'));
    let active=false;
    try {const lock=JSON.parse(await readFile('.local/native-bridge/controller.lock','utf8'));process.kill(lock.pid,0);active=true;}catch{}
    state.game=audienceState({...checkpoint,stopped:checkpoint.stopped||!active},Date.now(),{updatedAt:(await stat('.local/native-bridge/latest-session.json')).mtimeMs});
    if(state.game?.ended)state.phase='本局结束';else if(!active || checkpoint.stopped)state.phase='游戏控制已暂停';
    await nativeTail.read(resolve('.local/native-bridge',`session-${checkpoint.sessionId}.jsonl`),row=>{
      notebook.consume(row);
      if(row.type==='intent')line(planCaption(row),planHistoryItem(row,notebook.previous?.date));
      if(row.type==='survey_control')line(surveyCaptions.consume(row));
      if(row.type==='picture_evidence')acceptFrame(row.frame);
      if(row.type==='modal_deferred')state.phase='先处理眼前事件';
    });
    const current=JSON.parse(await readFile('.local/native-bridge/dsh/current.json','utf8'));
    await dshTail.read(current.events,row=>{const phase=dshPhase(row);if(phase && active && !checkpoint.stopped)state.phase=phase;});
    try{await audienceTail.read(resolve('.local/commentary/audience.jsonl'),input=>{if(!Number.isFinite(input.at)||input.at<started)return;const row=audienceEvent(input);if(row?.type==='chat')state.audience.messages=[...state.audience.messages,row].slice(-10);});}catch{}
    state.notebook=notebook.publicEntries();await saveNotebook();
    if(!previewPath)await findPreview(checkpoint);
  }catch{/* During checkpoint replacement keep the last complete public state. */}
  finally{emit();polling=false;}
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const json=(code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method==='GET' && ['/','/overlay'].includes(url.pathname)){const html=await readFile(join(root,'public/commentary.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(html);}
  if(req.method==='GET' && url.pathname==='/playback-caption.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(await readFile(join(root,'public/playback-caption.js')));}
  if(req.method==='GET' && url.pathname==='/control-status.mjs'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(await readFile(join(root,'public/control-status.mjs')));}
  if(req.method==='GET' && url.pathname==='/fatfish.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});return res.end(await readFile(join(root,'public/fatfish.svg')));}
  if(req.method==='GET' && url.pathname==='/assets/feiyu-captain-v1.png'){res.writeHead(200,{'content-type':'image/png','cache-control':'public,max-age=3600'});return res.end(await readFile(join(root,'public/assets/feiyu-captain-v1.png')));}
  if(req.method==='GET' && url.pathname==='/assets/feiyu-captain-animated-v1.gif'){res.writeHead(200,{'content-type':'image/gif','cache-control':'public,max-age=3600'});return res.end(await readFile(join(root,'public/assets/feiyu-captain-animated-v1.gif')));}
  if(req.method==='GET' && url.pathname==='/preview/game.bmp'){
    try{if(!previewPath)throw 0;const info=await stat(previewPath);if(info.size>32*1024*1024)throw 0;const bytes=await readFile(previewPath);res.writeHead(200,{'content-type':'image/bmp','cache-control':'no-store'});return res.end(bytes);}catch{return json(404,{error:'No recent game preview'});}
  }
  if(req.method==='GET' && url.pathname==='/health')return json(200,{application:'cyberfish-commentary',version:'0.3',captionProtocol:'actual-playback-v1',pid:process.pid});
  if(req.method==='GET' && url.pathname==='/api/state')return json(200,state);
  if(req.method==='GET' && url.pathname==='/events'){
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive'});res.write(`data: ${JSON.stringify(state)}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='POST' && url.pathname==='/api/voice'){
    if(req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'Local controls only'});
    req.resume();return json(200,{enabled:false,message:'配音已取消，仅显示思考字幕。'});
  }
  return json(404,{error:'Not found'});
});
const requestedPort=Number(process.env.CYBERFISH_COMMENTARY_PORT||17655);
await new Promise((done,fail)=>{server.once('error',fail);server.listen(requestedPort,'127.0.0.1',done);});
const port=server.address().port;
await writeFile(join(directory,'server.json'),JSON.stringify({pid:process.pid,started,url:`http://127.0.0.1:${port}`,overlay:`http://127.0.0.1:${port}/overlay`},null,2));
await poll();const timer=setInterval(()=>void poll(),750);
const ping=setInterval(()=>{for(const c of clients)c.write(': ping\n\n');},15000);
function stop(){clearInterval(timer);clearInterval(ping);clearInterval(balanceTimer);balance.stop();for(const c of clients)c.end();server.close();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log(JSON.stringify({stage:'commentary_ready',preview:`http://127.0.0.1:${port}`,overlay:`http://127.0.0.1:${port}/overlay`,voice:'disabled / captions only'}));
