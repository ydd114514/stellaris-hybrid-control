import {readFile,stat} from 'node:fs/promises';
import {hasProductionIdentity} from './game-voice-boundary.mjs';

// v1.5: advisory direction only; raw file actions are never dispatched.
// Advisory goals only. Never pass this file to apply_orders, a shell or a tool dispatcher.
export async function readStrategyAdvice(path,sessionId,now=Date.now()) {
  try {
    if((await stat(path)).size>32768)return;
    const raw=await readFile(path,'utf8');if(raw.length>32768)return;
    const x=JSON.parse(raw),clip=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
    if(x?.version!==1||x.source!=='cyberfish-ai-hub'||!sessionId||x.gameSessionId!==sessionId)return;
    if(!Number.isFinite(x.at)||now-x.at>300000||x.at-now>5000||!clip(x.id,100)||!clip(x.text,200))return;
    const goal={priority:['low','normal','high'].includes(x.priority)?x.priority:'normal',text:clip(x.text,200),focus:clip(x.focus,120),nextSteps:(Array.isArray(x.nextSteps)?x.nextSteps:[]).filter(x=>typeof x==='string').slice(0,3).map(x=>clip(x,100)),requiresFreshValidation:true};
    if(x.strategyContract&&typeof x.strategyContract==='object'){goal.focus=String(x.strategyContract.economyFocus??goal.focus).slice(0,120);goal.text=clip(x.strategyContract.reason,200)||goal.text;}
    if(['consumer_goods','food','alloys','energy','minerals','unity','research','defense'].includes(x.targetResource))goal.targetResource=x.targetResource;
    if(hasProductionIdentity(goal))return;
    // Provenance stays in the local receipt; only the neutral game goal is model-facing.
    return {id:clip(x.id,100),at:x.at,expiresAt:x.at+300000,goal};
  }catch{return;}
}
