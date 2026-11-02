import {resolveStrategyDirection} from './strategy-direction.mjs';
import {nativeOwnerPolicy} from './native-country-ai-economic-policy.mjs';
import {surveyGameDay as day} from './survey-idle-policy.mjs';

const resourceFor={unity_traditions:'unity',research:'research',alloys_military:'alloys',consumer_stability:'consumer_goods'};
const net=(state,key)=>{
 const keys=key==='research'?['physics_research','society_research','engineering_research']:[key];
 return keys.every(k=>state.resources?.[k]?.net_known!==false&&Number.isFinite(state.resources?.[k]?.net))?keys.reduce((n,k)=>n+state.resources[k].net,0):null;
};
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
 return {version:1,source,objective:String(objective).slice(0,600),targetResource,requestedFocus:direction.requestedFocus,
  effectiveFocus:direction.contract.economyFocus,contract:direction.contract,ownerPolicy:nativeOwnerPolicy(state,contract),emergency:direction.emergency,
  taskIds,key:JSON.stringify([source,sourceId,direction.requestedFocus,source==='model'?null:objective,[...taskIds].sort()]),
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
  const currentDay=day(state.date),currentNet=intent.targetResource?net(state,intent.targetResource):null;
  const observed=state.economyObservedAt,fresh=Number.isFinite(observed)&&observed<=now+5000&&now-observed<=30000;
  if(currentDay===null||!binding)return {version:1,source:intent.source,objective:intent.objective,status:'blocked',reason:'当前世界或日期不可确认，不能证明目标落实'};
  let r=this.record;
  if(!r||r.binding!==binding||r.key!==intent.key||currentDay<r.lastDay){
   r=this.record={version:1,binding,key:intent.key,lastDay:currentDay,reviewDay:currentDay,
    baseline:{date:state.date,net:fresh?currentNet:null,traditions:traditions(state)},previousNet:fresh?currentNet:null,previousTraditions:traditions(state),effect:'pending'};
  }
  r.lastDay=currentDay;
  if(fresh&&r.baseline.net===null&&currentNet!==null){r.baseline={date:state.date,net:currentNet,traditions:traditions(state)};r.previousNet=currentNet;r.reviewDay=currentDay;}
  const currentTraditions=traditions(state),progress={netDelta:r.baseline.net!==null&&currentNet!==null?round(currentNet-r.baseline.net):null,
   traditionsGained:r.baseline.traditions!==null&&currentTraditions!==null?currentTraditions-r.baseline.traditions:null};
  // A completed tradition is real unity progress even while a new leader's
  // upkeep temporarily lowers net output. Other objectives do not inherit it.
  if(fresh&&!intent.emergency&&currentDay-r.reviewDay>=180){
   const gain=currentNet!==null&&r.previousNet!==null?currentNet-r.previousNet:null;
   const traditionGain=intent.targetResource==='unity'&&currentTraditions!==null&&r.previousTraditions!==null&&currentTraditions>r.previousTraditions;
   r.effect=gain===null?'unknown':gain>0||traditionGain?'progressing':'stalled';
   r.previousNet=currentNet;r.previousTraditions=currentTraditions;r.reviewDay=currentDay;
  }
  const controls={steeringConfirmed,ownerPolicyConfirmed};
  const needsOwnerPolicy=Object.values(intent.ownerPolicy).some(Boolean);
  const unsupported=needsOwnerPolicy&&!ownerPolicyConfirmed?['当前原生经营约束尚未回读确认']:[];
  const metricUnknown=intent.targetResource!==null&&(!fresh||currentNet===null);
  const status=intent.emergency?'suspended':controlError?'blocked':!steeringConfirmed?'pending':unsupported.length?'blocked':metricUnknown?'blocked':r.effect==='stalled'?'stalled':r.effect==='progressing'?'progressing':'applied';
  const reason=status==='suspended'?'真实战争或即将断供临时优先，原目标保留；脱险后恢复':controlError?String(controlError).slice(0,300):status==='pending'?'目标已解析，原生方针仍待实际应用':
   unsupported.length?unsupported[0]:metricUnknown?'目标的最新收支不可读，不能以旧数值声称改善':status==='stalled'?'本次观察期没有实际改善，必须调整措施；不能只重复相同方针':
   status==='progressing'?'观察到实际净产或传统推进；持续目标仍在执行，不自动宣布完成':'原生控制已应用，等待实际经营效果';
  return {version:1,source:intent.source,objective:intent.objective,targetResource:intent.targetResource,requestedFocus:intent.requestedFocus,effectiveFocus:intent.effectiveFocus,
   taskIds:intent.taskIds,controls,status,reason,baseline:{date:r.baseline.date,net:r.baseline.net},current:{date:state.date,net:fresh?currentNet:null},progress,
   correctiveAction:status==='stalled'?'先查实际岗位填充、目标施工和维护，调整对应原生预算/专精/法令；条件不足给出受阻原因':null,
   correction:correction??null,unsupported,outcomeRule:intent.outcomeRule};
 }
}
