import {readFile,writeFile} from 'node:fs/promises';
import {ModelView} from '../src/model-view.mjs';
const paths=process.argv.slice(2),reports=[];
for(const path of paths){
  const rows=(await readFile(path,'utf8')).split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const usages=rows.filter(row=>row.type==='status'&&row.phase==='step_end'&&row.usage).map(row=>row.usage);
  const sum=key=>usages.reduce((n,row)=>n+(row[key]||0),0);
  reports.push({file:path.split(/[\\/]/).at(-1),steps:usages.length,
    tokens:{uncachedInput:sum('inputTokens'),cachedInput:sum('cacheReadTokens'),output:sum('outputTokens')},
    peakContext:Math.max(0,...usages.map(row=>(row.inputTokens||0)+(row.cacheReadTokens||0))),
    lastContext:usages.length?(usages.at(-1).inputTokens||0)+(usages.at(-1).cacheReadTokens||0):0,
    toolCalls:rows.filter(row=>row.type==='tool_call').length,
    compactions:rows.filter(row=>/compact/i.test(row.phase||'')).length});
}
const checkpoint=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8'));
const states=(await readFile(`.local/native-bridge/session-${checkpoint.sessionId}.jsonl`,'utf8')).split('\n').filter(Boolean).flatMap(line=>{try{const row=JSON.parse(line);return row.type==='state'?[row.state]:[];}catch{return [];}});
const view=new ModelView();let fullBytes=0,deltaBytes=0;
for(const state of states){fullBytes+=Buffer.byteLength(JSON.stringify(state));deltaBytes+=Buffer.byteLength(JSON.stringify(view.project(state)));}
const result={reports,offlineProjection:{states:states.length,fullBytes,deltaBytes,reducedPercent:fullBytes?Math.round((1-deltaBytes/fullBytes)*100):0},note:'Token counts are provider-reported usage, not a monetary bill. Projection is an offline replay of the same states.'};
await writeFile('.local/native-bridge/usage-analysis.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
