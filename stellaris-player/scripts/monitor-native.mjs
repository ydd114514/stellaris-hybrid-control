import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='.local/native-bridge';
const checkpoint=JSON.parse(await readFile(join(root,'latest-session.json'),'utf8'));
const state=checkpoint.state;
const lines=(await readFile(join(root,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n');
const rows=lines.map(line=>JSON.parse(line));
const receipts=rows.filter(row=>['receipt','rejected','unknown','recovery'].includes(row.type));
console.log(JSON.stringify({session:checkpoint.sessionId,stopped:checkpoint.stopped,uncertain:checkpoint.uncertain,date:state.date,paused:state.paused,remaining:state.remainingSeconds,metrics:checkpoint.metrics,player:state.player,military:state.military,resources:state.resources,alerts:state.alerts,events:state.pendingEvents,
 recent:receipts.slice(-12).map(row=>({at:row.at,type:row.type,command:row.command,error:row.error,response:row.response,verification:row.verification})),
 diplomacy:rows.filter(row=>row.type==='inspect'&&row.topic==='diplomacy').slice(-2).map(row=>row.result),
 pictures:rows.filter(row=>row.type==='picture_evidence').slice(-3).map(row=>row.frame?.path)
},null,2));
