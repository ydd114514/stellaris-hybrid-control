import {readFile,writeFile,readdir} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {restoreModelView} from '../src/model-view.mjs';
const dir=resolve(process.argv[2]),native=join(dir,'native');
const checkpoint=JSON.parse(await readFile(join(native,'latest-session.json'),'utf8'));
const rows=(await readFile(join(native,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
const count=xs=>xs.reduce((o,k)=>(o[k]=(o[k]||0)+1,o),{});
const states=rows.filter(x=>x.type==='state').map(x=>x.state);
const report={sessionId:checkpoint.sessionId,firstDate:states[0]?.date,lastDate:states.at(-1)?.date,paused:checkpoint.state.paused,stopped:checkpoint.stopped,
 inspections:count(rows.filter(x=>x.type==='inspect').map(x=>x.topic)),commands:count(rows.filter(x=>x.type==='receipt').map(x=>x.command)),
 delegationOperations:count(rows.filter(x=>x.type==='survey_control').map(x=>x.operation)),
 pauses:rows.filter(x=>x.type==='decision_guard_pause').map(x=>({date:x.gameDate,reasons:x.reasons,pauseAlreadyPresent:x.pauseAlreadyPresent})),
 alerts:[...new Map(states.flatMap(s=>s.alerts||[]).map(x=>[x.type,x])).values()],
 finalSurvey:checkpoint.state.surveyControl};
const current=JSON.parse(await readFile(join(native,'dsh/current.json'),'utf8'));
const events=(await readFile(current.events,'utf8')).trim().split('\n').flatMap(x=>{try{return [JSON.parse(x)];}catch{return [];}});
report.dshEventKinds=count(events.map(x=>x.type||x.event||Object.keys(x).join(',')));
report.toolCalls=count(events.filter(x=>x.type==='tool_call').map(x=>x.tool));
report.watchRequests=events.filter(x=>x.type==='tool_call'&&x.tool==='mcp__stellaris__watch').map(x=>x.input?.seconds);
const watchIds=new Set(events.filter(x=>x.type==='tool_call'&&x.tool==='mcp__stellaris__watch').map(x=>x.callId));
let previous;report.watchResults=[];
for(const event of events.filter(x=>x.type==='tool_result')){
 try{const r=JSON.parse(event.result),view=r.state||r;
  if(view.view==='full'||view.view==='delta')previous=restoreModelView(previous,view);
  if(watchIds.has(event.callId))report.watchResults.push({date:previous?.date,reasons:previous?.wakeReasons,policy:previous?.waitPolicy,needsAttention:previous?.needsAttention});
 }catch{if(watchIds.has(event.callId))report.watchResults.push({unparsed:true});}
}
report.systemReads=rows.filter(x=>x.type==='inspect'&&x.topic==='system').map(x=>({at:x.at,id:x.result?.id,name:x.result?.name,surveyed:x.result?.surveyed,visibleBodies:x.result?.planets?.length,surveyedBodies:x.result?.planets?.filter(p=>p.surveyed).length}));
await writeFile(join(dir,'behavior-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
