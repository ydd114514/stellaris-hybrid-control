import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {executionStatus} from '../src/execution-status.mjs';
const root=resolve('.local/hybrid-control'),names=(await readdir(root)).filter(n=>/^dsh-live-\d+$/.test(n)).sort();
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return null;}};
let directory;
for(const name of names.reverse()){const candidate=join(root,name);if((await read(join(candidate,'manifest.json')))?.execute===true&&await read(join(candidate,'native/latest-session.json'))){directory=candidate;break;}}
if(!directory)throw Error('没有已启动的DSH试点');
const native=join(directory,'native');
const c=await read(join(native,'latest-session.json')),current=await read(join(native,'dsh/current.json'));
let usage=[];try{usage=(await readFile(join(directory,'model-usage.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);}catch{}
let lastEvents=[];if(c?.sessionId)try{lastEvents=(await readFile(join(native,`session-${c.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse).slice(-8).map(x=>({type:x.type,command:x.command,reason:x.reason}));}catch{}
let errors=[];for(const p of [join(directory,'supervisor.stderr.log'),current?.stderr].filter(Boolean))try{const s=await readFile(p,'utf8');errors.push(...s.split('\n').filter(x=>/error|failed|exception/i.test(x)).slice(-5).map(x=>x.slice(0,240)));}catch{}
const report=await read(join(directory,'report.json'));
const runtime=executionStatus(c);
console.log(JSON.stringify({directory,controller:current?.pid,sessionId:c?.sessionId,date:runtime.date,dateSource:runtime.source,decisionDate:c?.state?.date,finalVerifiedDate:c?.cleanup?.date,paused:runtime.paused,executionKnown:runtime.known,stopped:c?.stopped,survey:c?.state?.surveyControl,remaining:c?.stopped?0:Number.isFinite(c?.ends)?Math.max(0,Math.round((c.ends-Date.now())/1000)):null,modelRequests:Math.max(0,...usage.map(x=>x.id)),modelCompleted:usage.filter(x=>x.status==='completed').length,lastEvents,errors,report:report&&{started:report.started,ended:report.ended,stopReason:report.stopReason,exitCode:report.exitCode,usage:report.model?.usage}},null,2));
