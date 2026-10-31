import {readFile,writeFile} from 'node:fs/promises';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const rows=async path=>(await readFile(path,'utf8')).split('\n').flatMap(x=>{try{return[JSON.parse(x)]}catch{return[]}});
const baseline=await json('.local/token-optimization/baseline.json');
const current=await json('.local/native-bridge/latest-session.json');
const dsh=await json('.local/native-bridge/dsh/current.json');
const horizon=Number(process.argv[2]||0);
async function analyze(checkpoint,eventFile){
  const game=await rows(`.local/native-bridge/session-${checkpoint.sessionId}.jsonl`),events=await rows(eventFile);
  const allStates=game.filter(x=>x.type==='state'),first=allStates[0];
  const cutoff=horizon?Date.parse(first.at)+horizon*1000:Infinity;
  const selectedGame=game.filter(x=>Date.parse(x.at)<=cutoff);
  const states=selectedGame.filter(x=>x.type==='state'),last=states.at(-1);
  const seconds=first&&last?(Date.parse(last.at)-Date.parse(first.at))/1000:0;
  const stateTimes=new Map(allStates.map(x=>[x.state.snapshotId,Date.parse(x.at)])),inspectTimes=new Map();
  for(const row of game.filter(x=>x.type==='inspect')){const key=JSON.stringify(row.result);if(!inspectTimes.has(key))inspectTimes.set(key,[]);inspectTimes.get(key).push(Date.parse(row.at));}
  let lastTime=Date.parse(first.at),matchedResultTimes=0,totalResults=0;
  const selectedEvents=[];
  for(const event of events){
    if(event.type==='tool_result'){
      totalResults++;
      try{const value=typeof event.result==='string'?JSON.parse(event.result):event.result;
        const time=stateTimes.get(value?.state?.snapshotId||value?.snapshotId);
        const candidates=inspectTimes.get(JSON.stringify(value));
        while(candidates?.length&&candidates[0]<lastTime)candidates.shift();
        const at=time??candidates?.shift();if(at!==undefined){lastTime=at;matchedResultTimes++;}
      }catch{}
    }
    if(lastTime<=cutoff)selectedEvents.push(event);
  }
  const usage=selectedEvents.filter(x=>x.type==='status'&&x.phase==='step_end'&&x.usage).map(x=>x.usage);
  const sum=key=>usage.reduce((n,x)=>n+(Number(x[key])||0),0);
  const calls=new Map();let bytes=0,stateBytes=0,stateResults=0,deltaCount=0;
  for(const e of selectedEvents){
    if(e.type==='tool_call')calls.set(e.callId,e.tool);
    if(e.type!=='tool_result')continue;
    const text=typeof e.result==='string'?e.result:JSON.stringify(e.result);bytes+=Buffer.byteLength(text);
    try{const value=typeof e.result==='string'?JSON.parse(e.result):e.result;const state=value.state||value;
      if(state.view){stateBytes+=Buffer.byteLength(JSON.stringify(state));stateResults++;if(state.protocol==='merge-v2')deltaCount++;}
    }catch{}
  }
  const receipts=selectedGame.filter(x=>x.type==='receipt'),verified=receipts.filter(x=>x.verification?.verified===true);
  const types={};for(const r of verified)types[r.command]=(types[r.command]||0)+1;
  const stepCount=usage.length,noncache=sum('inputTokens'),cache=sum('cacheReadTokens'),output=sum('outputTokens');
  const perMinute=n=>seconds?Math.round(n/seconds*600)/10:null;
  const tokens={uncachedInput:noncache,cachedInput:cache,output,totalInput:noncache+cache,cachePercent:noncache+cache?Math.round(cache/(noncache+cache)*1000)/10:0};
  return {session:checkpoint.sessionId,events:eventFile,observedSeconds:Math.round(seconds),startDate:first?.state?.date,endDate:last?.state?.date,
    windowSeconds:horizon||null,timestampAlignment:{matchedResultTimes,totalResults,unmatchedResults:totalResults-matchedResultTimes},
    stopped:checkpoint.stopped,uncertain:checkpoint.uncertain,stepCount,toolCalls:calls.size,bytes,stateBytes,stateResults,deltaCount,
    meanStateBytes:stateResults?Math.round(stateBytes/stateResults):null,meanInputTokens:stepCount?Math.round(tokens.totalInput/stepCount):null,tokens,
    ratePerMinute:{steps:perMinute(stepCount),uncachedInput:perMinute(noncache),cachedInput:perMinute(cache),output:perMinute(output),verifiedOrders:perMinute(verified.length)},
    accepted:receipts.filter(x=>x.response?.success===true).length,verified:verified.length,verifiedTypes:types,
    rejected:selectedGame.filter(x=>x.type==='rejected'||x.type==='receipt'&&x.response?.success!==true).length,unknown:selectedGame.filter(x=>x.type==='unknown').length,
    panelCleanup:selectedGame.filter(x=>x.type==='presentation_complete'&&x.response?.success===true).length};
}
const before=await analyze(baseline.checkpoint,baseline.dsh.events),after=await analyze(current,dsh.events);
if(before.session===after.session)throw new Error('Optimized worker has not started yet');
const report={before,after,change:{meanStateBytesPercent:before.meanStateBytes?Math.round((1-after.meanStateBytes/before.meanStateBytes)*1000)/10:null,
  meanInputTokensPercent:before.meanInputTokens?Math.round((1-after.meanInputTokens/before.meanInputTokens)*1000)/10:null},
  note:'Sequential runs in the same world, different in-game situations and durations. Provider-reported usage, not a matched-task A/B test or guaranteed monetary saving. Compare quality and cache categories; never charge cached tokens at uncached price.'};
await writeFile('.local/token-optimization/live-comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
