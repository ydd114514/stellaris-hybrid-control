// Offline only; accepts an existing run directory, never contacts a game/model.
import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {analyzeHybridWorkEvidence} from '../src/hybrid-work-evidence.mjs';
if(!process.argv[2])throw Error('需要现有run目录');
const directory=resolve(process.argv[2]),checkpoint=JSON.parse(await readFile(join(directory,'native/latest-session.json'),'utf8'));
if(typeof checkpoint.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(checkpoint.sessionId))throw Error('会话标识未知');
const text=await readFile(join(directory,'native',`session-${checkpoint.sessionId}.jsonl`),'utf8'),events=[];let omittedLines=0;
for(const line of text.split('\n'))if(line.trim())try{events.push(JSON.parse(line));}catch{omittedLines++;}
const evidence={...analyzeHybridWorkEvidence(events),controllerStopped:checkpoint.stopped===true,omittedLines,logParseComplete:omittedLines===0,generatedAt:new Date().toISOString()};
await writeFile(join(directory,'work-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({path:join(directory,'work-evidence.json'),sessionKnown:evidence.sessionKnown,completed:evidence.completed?.byCommand,coexistenceSamples:evidence.sampledCoexistence?.count,nativeAlongsideSamples:evidence.nativeSurveyAlongsideQueue?.count,interventionCycles:evidence.interventionCycles?.length,omittedLines,acceptancePassed:false}));
