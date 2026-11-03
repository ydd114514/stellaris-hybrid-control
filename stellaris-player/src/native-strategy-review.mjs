import {evaluateStrategyGoals,extractStrategyMetrics,isUnfinishedStrategyGoal} from './strategy-brief.mjs';
import {surveyGameDay as gameDay} from './survey-idle-policy.mjs';
import {STRATEGY_DIMENSIONS} from './strategy-contract.mjs';

const PERIODIC_REVIEW_DAYS=180;
const MIN_STAGNATION_DAYS=150;
export const MIN_PERIODIC_REVIEW_MS=180000;
const growthMetrics=['pops','research_monthly','fleet_power'];
const goalKeys=contract=>(contract?.goals??[]).map(({metric,target,byDate})=>JSON.stringify([metric,target,byDate])).sort();
export function strategyPlanChanged(previous,next){
 return Object.keys(STRATEGY_DIMENSIONS).some(key=>previous?.[key]!==next?.[key])||
  JSON.stringify(goalKeys(previous))!==JSON.stringify(goalKeys(next));
}

function maintenanceBand(share,previous){
 if(!Number.isFinite(share))return previous;
 if(previous===null||share>=(previous+1)/10)return Math.floor(share*10);
 // A downward move needs five percentage points beyond the boundary.
 return share<(previous-0.5)/10?Math.floor((share+0.05)*10):previous;
}

export class NativeStrategyReview {
 constructor({now=Date.now,minIntervalMs=MIN_PERIODIC_REVIEW_MS}={}){
  this.now=now;this.minIntervalMs=minIntervalMs;
  this.lastDay=null;this.lastPeriodicAt=null;this.lastPeriodicSample=null;
  this.lastSignals=null;this.lastAdverse=[];this.lastMaintenanceBand=null;
  this.lastMetrics=null;this.stalledReviews=0;
 }
 signals(state){
  const critical=Object.entries(state.resources??{}).filter(([key,r])=>['energy','minerals','food','consumer_goods','alloys'].includes(key)&&Number.isFinite(r?.stockpile)&&r?.net<0&&r.stockpile/-r.net<=6).map(([key])=>key).sort();
  return JSON.stringify({wars:(state.wars??[]).map(w=>w.war_id??w.id).sort(),events:(state.pendingEvents??[]).map(e=>e.window_id??e.title),
   diplomacy:(state.pendingDiplomacy??[]).map(p=>p.proposal??p.id),critical,colonies:state.capacities?.colonies??null,
   ascensionPerks:(state.ascensionPerks?.adopted??[]).map(x=>x.key).sort(),user:state.operatorMessages??[],
   standing:state.operatorStanding?{text:state.operatorStanding.text,economyFocus:state.operatorStanding.economyFocus,until:state.operatorStanding.until}:null,
   direction:state.operationalGoal?.text??'',targetResource:state.operationalGoal?.targetResource??null});
 }
 adverseSignals(state){
  const status=state.nativeIntent?.status,unity=state.strategy?.unityProgress;
  return [
   ...(state.adviceExecution?.tasks??[]).filter(t=>t.status==='blocked').map(t=>'task:'+t.id),
   ...(['blocked','stalled'].includes(status)?['intent:'+status]:[]),
   ...(unity?.focused&&unity.stagnating===true?['unity:stagnating']:[]),
   ...(unity?.focused&&unity.scalingBehind===true?['unity:scaling_behind']:[]),
  ];
 }
 periodicReason(state){
  const current=gameDay(state.date);
  if(this.lastDay===null)return 'initial_strategy';
  if(current!==null&&current-this.lastDay>=PERIODIC_REVIEW_DAYS&&this.now()-this.lastPeriodicAt>=this.minIntervalMs)return 'six_month_review';
 }
 due(state,{fresh=true}={}){
  const periodic=this.periodicReason(state),reasons=periodic?[periodic]:[];
  const adverse=this.adverseSignals(state);
  // Recovery is quiet. Forget recovered conditions so re-entry can wake again.
  this.lastAdverse=this.lastAdverse.filter(signal=>adverse.includes(signal));
  const share=state.strategy?.unityProgress?.maintenanceShare;
  const band=maintenanceBand(share,this.lastMaintenanceBand);
  if(this.lastSignals!==null&&(this.signals(state)!==this.lastSignals||adverse.some(signal=>!this.lastAdverse.includes(signal))||
   this.lastMaintenanceBand!==null&&band!==this.lastMaintenanceBand))reasons.push('strategic_event');
  if(fresh&&periodic==='six_month_review'&&this.stallCount(state)>=2)reasons.push('stagnation');
  return reasons;
 }
 stallCount(state){
  const current=extractStrategyMetrics(state),previous=this.lastPeriodicSample;
  const date=gameDay(state.date);
  if(!previous||date===null||date-previous.day<MIN_STAGNATION_DAYS)return this.stalledReviews;
  const goals=evaluateStrategyGoals(state.strategyContract?.goals,current,state.date,state.strategyGoalProgress).filter(isUnfinishedStrategyGoal);
  const noGrowth=growthMetrics.every(key=>Number.isFinite(current[key])&&
   Number.isFinite(previous.metrics[key])&&current[key]<=previous.metrics[key]);
  return noGrowth&&goals.length&&goals.every(goal=>Number.isFinite(goal.progress)&&goal.progress<0.8)?this.stalledReviews+1:0;
 }
 acknowledge(observed,{current=observed,changed=false}={}){
  const reasons=observed.strategyWakeReasons??[this.periodicReason(observed)];
  const periodic=reasons.includes('initial_strategy')||reasons.includes('six_month_review');
  if(periodic){
   this.stalledReviews=changed?0:this.stallCount(observed);
   this.lastDay=gameDay(current.date)??gameDay(observed.date);
   this.lastPeriodicAt=this.now();
   const day=gameDay(observed.date);
   if(day!==null)this.lastPeriodicSample={day,metrics:extractStrategyMetrics(observed)};
  }
  this.lastSignals=this.signals(current);
  this.lastAdverse=this.adverseSignals(current);
  this.lastMaintenanceBand=maintenanceBand(current.strategy?.unityProgress?.maintenanceShare,this.lastMaintenanceBand);
  this.lastMetrics=extractStrategyMetrics(observed);
 }
}
