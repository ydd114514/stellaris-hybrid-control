import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile,open,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {appendFileSync} from 'node:fs';
import {makeCompactGameCheckpoint} from '../../src/game-checkpoint.mjs';
import {confirmedHostStop,hostStopExitCode} from '../../src/dsh-host-stop.mjs';
import {runtimeContinuation} from '../../src/runtime-continuation.mjs';

const nativeDirectory=resolve(process.env.CYBERFISH_NATIVE_DIRECTORY||'.local/native-bridge');
const require=createRequire('C:/Users/YDD/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json');
const {BasicCompactionEngine}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-compaction-basic')).href);
const {createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);

export default class GameCompaction extends BasicCompactionEngine {
  static Config=BasicCompactionEngine.Config;
  static inject=BasicCompactionEngine.inject;
  constructor(ctx,config={}) {
    const effective={...config,thresholdRatio:config.thresholdRatio??0.032,retainTokens:config.retainTokens??4000,
      headroomTokens:config.headroomTokens??4096,maxTokens:1600,compactionRetries:0,auto:true};
    delete effective.retainRatio;
    super(ctx,effective);
    appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'ready',thresholdRatio:this.config.thresholdRatio,retainTokens:this.config.retainTokens})+'\n');
    let hadAgentError=false,hostStopping=false;
    ctx.on('agent/error',()=>{hadAgentError=true;});
    const onStop=async message=>{
      if(hostStopping||!process.connected)return;
      try{
        const checkpoint=JSON.parse(await readFile(resolve(nativeDirectory,'latest-session.json'),'utf8'));
        const completion=JSON.parse(await readFile(resolve(nativeDirectory,'stop-complete.json'),'utf8'));
        const request=JSON.parse(await readFile(resolve(nativeDirectory,'stop-request.json'),'utf8'));
        if(!confirmedHostStop(message,{runId:process.env.CYBERFISH_CONTROLLER_RUN,checkpoint,completion,request}))return;
        const exit=ctx.get('appExit');if(typeof exit!=='function')return;
        hostStopping=true;const code=hostStopExitCode(completion,hadAgentError);
        appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'host_stop_requested',code,sessionId:checkpoint.sessionId})+String.fromCharCode(10));
        process.off('message',onStop);if(process.connected)process.disconnect();
        exit(code);
      }catch{/* Parent retains a bounded forced-exit fallback. */}
    };
    process.on('message',onStop);ctx.on('dispose',()=>process.off('message',onStop));
    let steps=0;
    ctx.on('agent/pre-step',({agent},next)=>{if(++steps%5===0){const m=ctx.tokenMeter.measure(agent.session);appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'pressure',tokens:m.totalTokens})+'\n');}return next();});
    let previousSnapshot=null,stalled=0;
    ctx.on('agent/turn-stopping',async({agent,signal})=>{
      if(signal.aborted||agent.inbox.nextStep.length)return;
      try {
        const checkpoint=JSON.parse(await readFile(resolve(nativeDirectory,'latest-session.json'),'utf8'));
        const lock=JSON.parse(await readFile(resolve(nativeDirectory,'controller.lock'),'utf8'));
        if(lock.sessionId!==checkpoint.sessionId||lock.parentPid!==process.pid)return;
        process.kill(lock.pid,0);
        let stopAt=0;try{stopAt=(await stat(resolve('.local/STOP'))).mtimeMs;}catch{}
        const continuation=runtimeContinuation(checkpoint,{stopAt});if(!continuation)return;
        stalled=previousSnapshot===checkpoint.state.snapshotId?stalled+1:0;previousSnapshot=checkpoint.state.snapshotId;
        if(stalled>=2)return; // Let the supervisor recycle a genuinely stalled actor.
        agent.inject(createUserMessage({content:[{type:'text',text:continuation.text}],source:{kind:'cyberfish-runtime',form:'notice',summary:'当前授权测试时长未到，继续同一游戏和控制器'}}));
        appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'continue_same_run',sessionId:checkpoint.sessionId,remaining:continuation.remaining})+'\n');
      }catch{/* No valid live controller: let the existing supervisor recover. */}
    });
  }
  async summarize(input,agent,signal) {
    signal?.throwIfAborted();
    const checkpoint=JSON.parse(await readFile(resolve(nativeDirectory,'latest-session.json'),'utf8'));
    const file=await open(resolve(nativeDirectory,`session-${checkpoint.sessionId}.jsonl`));let rows=[];
    try{const size=(await file.stat()).size,offset=Math.max(0,size-1024*1024),buffer=Buffer.alloc(size-offset);await file.read(buffer,0,buffer.length,offset);
      rows=buffer.toString('utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    }finally{await file.close();}
    const summary=[{type:'text',text:makeCompactGameCheckpoint(checkpoint,rows)}];
    appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'local_summary',sessionId:checkpoint.sessionId,chars:summary[0].text.length,modelCalls:0})+'\n');
    // Official override seam: a local template, no auxiliary model request.
    return {summary,provider:'cyberfish-local',model:'authoritative-game-checkpoint-v2'};
  }
  async compactIfNeeded(agent,trigger,signal) {
    const before=this.ctx.tokenMeter.measure(agent.session).totalTokens;
    const result=await super.compactIfNeeded(agent,trigger,signal);
    if(result)appendFileSync(resolve(nativeDirectory,'local-compaction.jsonl'),JSON.stringify({at:Date.now(),stage:'compacted',trigger,beforeTokens:before,afterTokens:this.ctx.tokenMeter.measure(agent.session).totalTokens,modelCalls:0})+'\n');
    return result;
  }
}
