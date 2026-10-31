// Identical journal replay: legacy top-level delta vs recursive delta.
// Not a provider token measurement or a gameplay simulation.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {ModelView,restoreModelView} from '../src/model-view.mjs';
const checkpoint=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8'));
const path=process.argv[2]||`.local/native-bridge/session-${checkpoint.sessionId}.jsonl`;
const rows=(await readFile(path,'utf8')).split('\n').flatMap(x=>{try{return[JSON.parse(x)]}catch{return[]}});
const view=new ModelView();let previous=null,count=0,memory={},oldBytes=0,newBytes=0,states=0;
const errors=[];
for(const row of rows){if(row.type!=='state'||!row.state)continue;const state=row.state;
  const complete=!previous||++count>=6;if(complete)count=0;
  const legacy={view:complete?'full':'delta'},unchanged=[];
  for(const[key,value]of Object.entries(state)){if(complete||['snapshotId','date','remainingSeconds','paused','speed'].includes(key)||!isDeepStrictEqual(previous?.[key],value))legacy[key]=value;else unchanged.push(key);}
  if(!complete){legacy.unchanged=unchanged;legacy.removed=Object.keys(previous).filter(k=>!Object.hasOwn(state,k));}
  previous=structuredClone(state);
  const projection=view.project(state);memory=restoreModelView(memory,projection);
  try{assert.deepEqual(memory,state);}catch(e){errors.push({snapshot:state.snapshotId,error:e.message.slice(0,150)});}
  oldBytes+=Buffer.byteLength(JSON.stringify(legacy));newBytes+=Buffer.byteLength(JSON.stringify(projection));states++;
}
const report={journal:path,states,reconstructedExactly:errors.length===0,errors,legacyBytes:oldBytes,recursiveBytes:newBytes,
  smallerPercent:Math.round((1-newBytes/oldBytes)*1000)/10,note:'Identical-state offline JSON bytes; not measured tokens or monetary savings. Full refresh remains every six observations, arrays replace as a whole.'};
await mkdir('.local/token-optimization',{recursive:true});await writeFile('.local/token-optimization/offline-comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!report.reconstructedExactly)process.exitCode=1;
