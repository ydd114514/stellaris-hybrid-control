import {evaluateStrategyGoals,extractStrategyMetrics} from './strategy-brief.mjs';
import {surveyGameDay as gameDay} from './survey-idle-policy.mjs';
import {STRATEGY_DIMENSIONS} from './strategy-contract.mjs';

const growthMetrics=['pops','research_monthly','fleet_power'];
const goalKeys=contract=>(contract?.goals??[]).map(({metric,target,byDate})=>JSON.stringify([metric,target,byDate])).sort();
export function strategyPlanChanged(previous,next){
 return Object.keys(STRATEGY_DIMENSIONS).some(key=>previous?.[key]!==next?.[key])||
  JSON.stringify(goalKeys(previous))!==JSON.stringify(goalKeys(next));
}

export class NativeStrategyReview {
 constructor(){this.lastDay=null;this.lastSignals=null;this.lastMetrics=null;this.stalledReviews=0;}
 signals(state){
  const critical=Object.entries(state.resources??{}).filter(([key,r])=>['energy','minerals','food','consumer_goods','alloys'].includes(key)&&Number.isFinite(r?.stockpile)&&r?.net<0&&r.stockpile/-r.net<=6).map(([key])=>key).sort();
  const unity=state.strategy?.unityProgress;
  const unityHealth=unity?.focused?{stagnating:unity.stagnating===true,scalingBehind:unity.scalingBehind===true,maintenancePressure:unity.maintenancePressure===true,maintenanceBand:Number.isFinite(unity.maintenanceShare)?Math.floor(unity.maintenanceShare*10):null}:null;
  return JSON.stringify({intent:state.nativeIntent?{status:state.nativeIntent.status,targetResource:state.nativeIntent.targetResource,requestedFocus:state.nativeIntent.requestedFocus}:null,advice:(state.adviceExecution?.tasks??[]).filter(t=>["pending","working","verifying","blocked"].includes(t.status)).map(t=>[t.id,t.status,t.reason]),wars:(state.wars??[]).map(w=>w.war_id??w.id).sort(),events:(state.pendingEvents??[]).map(e=>e.window_id??e.title),diplomacy:(state.pendingDiplomacy??[]).map(p=>p.proposal??p.id),critical,unityHealth,colonies:state.capacities?.colonies??null,ascensionPerks:(state.ascensionPerks?.adopted??[]).map(x=>x.key).sort(),user:state.operatorMessages??[],standing:state.operatorStanding?{text:state.operatorStanding.text,economyFocus:state.operatorStanding.economyFocus,until:state.operatorStanding.until}:null,direction:state.operationalGoal?.text??'',targetResource:state.operationalGoal?.targetResource??null});
 }
 due(state,{fresh=true}={}){const current=gameDay(state.date),signals=this.signals(state),reasons=[];
  if(this.lastDay===null)reasons.push('initial_strategy');
  else if(current!==null&&current-this.lastDay>=180)reasons.push('six_month_review');
  if(this.lastSignals!==null&&signals!==this.lastSignals)reasons.push('strategic_event');
  if(state.countryAIControl?.reviewDue&&reasons.length===0)reasons.push('native_country_ai_review_due');
  if(fresh&&reasons.length&&this.stallCount(state)>=2)reasons.push('stagnation');
  return reasons;
 }
 stallCount(state){
  const current=extractStrategyMetrics(state);
  const goals=evaluateStrategyGoals(state.strategyContract?.goals,current,state.date);
  const noGrowth=growthMetrics.every(key=>Number.isFinite(current[key])&&
   Number.isFinite(this.lastMetrics?.[key])&&current[key]<=this.lastMetrics[key]);
  return noGrowth&&goals.length&&goals.every(goal=>Number.isFinite(goal.progress)&&goal.progress<0.8)?this.stalledReviews+1:0;
 }
 acknowledge(state,{changed=false}={}){
  if(changed)this.stalledReviews=0;
  else if(this.due(state,{fresh:false}).length)this.stalledReviews=this.stallCount(state);
  this.lastDay=gameDay(state.date);
  this.lastSignals=this.signals(state);
  this.lastMetrics=extractStrategyMetrics(state);
 }
}
