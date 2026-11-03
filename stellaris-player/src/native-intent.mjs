import {resolveStrategyDirection} from './strategy-direction.mjs';
import {nativeOwnerPolicy} from './native-country-ai-economic-policy.mjs';
import {surveyGameDay as day} from './survey-idle-policy.mjs';
import {nativeEconomyMetric,nativeEconomyFeedback,NATIVE_ECONOMY_REVIEW_DAYS} from './native-economy-feedback.mjs';

const resourceFor={unity_traditions:'unity',research:'research',alloys_military:'alloys',consumer_stability:'consumer_goods'};
const round=value=>Number.isFinite(value)?Math.round(value*100)/100:null;
const traditions=state=>Number.isFinite(state.traditions?.unlocked_traditions_count)?state.traditions.unlocked_traditions_count:null;

// All accepted input uses the same compiler. Raw audience text never acquires
// command authority; only the AI hub's already accepted goal/task IDs enter.
export function compileNativeIntent(state={},contract){
 const direction=resolveStrategyDirection({state,contract});
 const standing=state.operatorStanding,owner=state.userEconomicPolicy;
 const source=owner?'owner':standing?'owner':state.operationalGoal?'advice':'model';
 const targetResource=resourceFor[direction.requestedFocus]??state.operationalGoal?.targetResource??null;
 const objective=owner?.note??standing?.text??state.operationalGoal?.text??contract?.reason??direction.reason;
 const sourceId=owner?String(owner.updatedAt):standing?.id??state.operationalGoal?.id??'';
 const taskIds=(contract?.taskIds??[]).filter(x=>typeof x==='string').slice(0,12);
 const ownerPolicy=nativeOwnerPolicy(state,contract);
 // Continuous resource goals survive rephrasing, task replans and heartbeat /
 // standing rebinding. Ancillary fleet controls have their own application key
 // and cannot erase this resource goal's history. A changed economic focus /
 // owner objective establishes a different goal; concrete tasks retain identity.
 const key=targetResource?JSON.stringify([source,direction.requestedFocus,targetResource,owner?.priority??null,owner?.resourcePolicy??null]):
  JSON.stringify([source,sourceId,direction.requestedFocus,source==='model'?null:objective,[...taskIds].sort()]);
 return {version:1,source,objective:String(objective).slice(0,600),targetResource,requestedFocus:direction.requestedFocus,
  effectiveFocus:direction.contract.economyFocus,contract:direction.contract,lockedDimensions:direction.lockedDimensions,ownerPolicy,emergency:direction.emergency,
  taskIds,key,
  outcomeRule:targetResource?'持续改善实际净产或目标进度；方针已应用不代表目标已完成':'按明确的具体设置回执与后续结果分别判断，不将采纳等同于完成'};
}

/** Same-world effect feedback. No timer, model call, game command or invented
 * target. The existing strategy executor owns all native controls/corrections. */
export class NativeIntentExecution {
 constructor(){this.record=null;}
 restore(saved,binding){
  if(saved?.version!==1||saved.binding!==binding||typeof saved.key!=='string'||!Number.isFinite(saved.lastDay))return false;
  this.record=structuredClone(saved);return true;
 }
 serialize(){return this.record?structuredClone(this.record):null;}
 observe(intent,state,{binding,steeringConfirmed=false,ownerPolicyConfirmed=false,correction,controlError,now=Date.now()}={}){
  const currentDay=day(state.date),sample=nativeEconomyMetric(state,intent.targetResource),currentNet=sample.net;
  const observed=state.economyObservedAt,fresh=Number.isFinite(observed)&&observed<=now+5000&&now-observed<=30000;
  if(currentDay===null||!binding)return {version:1,source:intent.source,objective:intent.objective,status:'blocked',reason:'当前世界或日期不可确认，不能证明目标落实'};
  let r=this.record;
  if(!r||r.binding!==binding||r.key!==intent.key||currentDay<r.lastDay){
   r=this.record={version:1,binding,key:intent.key,lastDay:currentDay,reviewDay:currentDay,
    baseline:{date:state.date,net:fresh?currentNet:null,traditions:fresh?traditions(state):null},previousNet:fresh?currentNet:null,
    previousSample:fresh?sample:null,previousTraditions:fresh?traditions(state):null,lastProgressDay:currentDay,effect:'pending'};
  }
  r.lastDay=currentDay;
  if(fresh&&r.baseline.net===null&&currentNet!==null){r.baseline={date:state.date,net:currentNet,traditions:traditions(state)};r.previousNet=currentNet;r.previousSample=sample;r.reviewDay=currentDay;}
  if(intent.emergency){r.suspendedSince??=currentDay;}
  else if(Number.isFinite(r.suspendedSince)){
   // A crisis is not a failed normal-economy review window. Preserve the main
   // goal's baseline but start a fresh comparison after ordinary control returns.
   r.previousNet=fresh?currentNet:null;r.previousSample=fresh?sample:null;r.previousTraditions=fresh?traditions(state):null;
   r.reviewDay=currentDay;r.lastProgressDay=currentDay;r.feedbackMemory={};r.effect='pending';delete r.suspendedSince;
  }
  const currentTraditions=fresh?traditions(state):null,progress={netDelta:fresh&&r.baseline.net!==null&&currentNet!==null?round(currentNet-r.baseline.net):null,
   traditionsGained:r.baseline.traditions!==null&&currentTraditions!==null?currentTraditions-r.baseline.traditions:null};
  const evaluation=nativeEconomyFeedback(state,{targetResource:intent.targetResource,current:sample,previous:r.previousSample,
   currentDay,lastProgressDay:r.lastProgressDay??r.reviewDay,memory:r.feedbackMemory,fresh,now});
  r.feedbackMemory=evaluation.memory;
  // A completed tradition is real unity progress even while a new leader's
  // upkeep temporarily lowers net output. Other objectives do not inherit it.
  if(fresh&&!intent.emergency&&currentDay-r.reviewDay>=NATIVE_ECONOMY_REVIEW_DAYS){
   const gain=currentNet!==null&&r.previousNet!==null?currentNet-r.previousNet:null;
   const traditionGain=intent.targetResource==='unity'&&currentTraditions!==null&&r.previousTraditions!==null&&currentTraditions>r.previousTraditions;
   r.effect=(gain!==null&&gain>0)||traditionGain?'progressing':gain===null?'unknown':evaluation.feedback.wait?'waiting':'stalled';
   if(r.effect==='progressing'){r.lastProgressDay=currentDay;r.feedbackMemory={};}
   r.previousNet=currentNet;r.previousSample=sample;r.previousTraditions=currentTraditions;r.reviewDay=currentDay;
  }
  if(r.effect==='waiting'&&!evaluation.feedback.wait&&fresh)r.effect='stalled';
  const controls={steeringConfirmed,ownerPolicyConfirmed};
  const needsOwnerPolicy=Object.values(intent.ownerPolicy).some(Boolean);
  const unsupported=needsOwnerPolicy&&!ownerPolicyConfirmed?['当前原生经营约束尚未回读确认']:[];
  const metricUnknown=intent.targetResource!==null&&(!fresh||currentNet===null);
  const status=intent.emergency?'suspended':controlError?'blocked':!steeringConfirmed?'pending':unsupported.length?'blocked':metricUnknown?'blocked':r.effect==='stalled'?'stalled':r.effect==='progressing'?'progressing':'applied';
  const feedback=evaluation.feedback;
  const reason=status==='suspended'?'真实战争或即将断供临时优先，原目标保留；脱险后恢复':controlError?String(controlError).slice(0,300):status==='pending'?'目标已解析，原生方针仍待实际应用':
   unsupported.length?unsupported[0]:metricUnknown?'目标的最新收支不可读，不能以旧数值声称改善':status==='stalled'?'本次观察期没有实际改善，必须调整措施；不能只重复相同方针':
   status==='progressing'?'观察到实际净产或传统推进；持续目标仍在执行，不自动宣布完成':r.effect==='waiting'?
    (feedback.wait.kind==='construction'?'已观察到施工，处于有限完工观察期；待核验目标岗位和实际净产':'已核实空岗且无失业人口，处于有限填岗观察期；尚未证明净产改善'):'原生控制已应用，等待实际经营效果';
  return {version:1,source:intent.source,objective:intent.objective,targetResource:intent.targetResource,requestedFocus:intent.requestedFocus,effectiveFocus:intent.effectiveFocus,
   taskIds:intent.taskIds,controls,status,reason,baseline:{date:r.baseline.date,net:r.baseline.net},current:{date:state.date,net:fresh?currentNet:null},progress,
   feedback,correctiveAction:status==='stalled'?feedback.recommendations.map(x=>x.reason).slice(0,3).join('；'):null,
   correction:correction??null,unsupported,outcomeRule:intent.outcomeRule};
 }
}
