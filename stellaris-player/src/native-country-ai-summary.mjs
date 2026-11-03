import {confirmedCountryAIHandoff} from './country-ai-handoff.mjs';
import {evaluateStrategyGoals,extractStrategyMetrics} from './strategy-brief.mjs';

const goalLabels={pops:'人口',colonies:'殖民地',systems:'星系',research_monthly:'科研月产',
 alloys_monthly:'合金月产',fleet_power:'舰队战力',naval_used_ratio:'舰容占用率'};
const goalStates={achieved:'已达成',near:'接近达成',pending:'未达成',overdue:'逾期未达成',unknown:'进度未知'};

export function strategyGoalLabel(metric){
 return typeof metric==='string'&&Object.hasOwn(goalLabels,metric)?goalLabels[metric]:null;
}
export function strategyGoalStatus(status){
 return typeof status==='string'&&Object.hasOwn(goalStates,status)?goalStates[status]:goalStates.unknown;
}
export function strategyGoalValue(metric,value){
 if(!Number.isFinite(value))return '未知';
 const ratio=metric==='naval_used_ratio';
 const numeric=ratio?value*100:value;
 return Number.isFinite(numeric)?String(Number(numeric.toPrecision(6)))+(ratio?'%':''):'未知';
}

export function nativeCountryAISummary(checkpoint,{actorActive=false}={}){
 const raw=checkpoint?.countryAIControl??checkpoint?.state?.countryAIControl;
 if(raw?.enabled!==true)return;
 const historical=checkpoint.stopped===true||!actorActive;
 const control=historical?checkpoint.cleanup?.countryAI:raw;
 const flags=control?.actualFlags;
 /** @type {'human'|'native'|'unconfirmed'} */
 let owner='unconfirmed';
 if(historical?confirmedCountryAIHandoff(control):control?.owner==='human'&&control.ordinaryOrdersBlocked===false&&
  control.paused===true&&flags?.human_ai===false&&flags?.force_human_ai===false&&['idle','stopped'].includes(control.nativePhase))owner='human';
 if(!historical&&control?.owner==='native'&&control.nativePhase==='running'&&control.ordinaryOrdersBlocked===true&&
  control.paused===false&&flags?.human_ai===true&&flags?.force_human_ai===true)owner='native';
 const domains=[...new Set((Array.isArray(raw.domains)?raw.domains:[]).filter(x=>['native_country_operations','research','planet_construction'].includes(x)))];
 const message=historical?(owner==='human'?'上轮已确认收回国家 AI，游戏当时暂停。':'上轮国家 AI 交接未确认，需先核对游戏。'):
  owner==='native'?'原生 AI 运营中，大肥鱼负责方针、宣战、议和和外交。':
  owner==='human'?'国家 AI 已交回控制，关键干预后可由大肥鱼重新委派。':'国家 AI 控制权待核对，经营派单保持封口。';
 const contract=checkpoint.strategyContract??checkpoint.state?.strategyContract;
 const goals=Array.isArray(contract?.goals)?contract.goals.filter(goal=>strategyGoalLabel(goal?.metric)&&
  Number.isFinite(goal?.target)&&typeof goal?.byDate==='string'&&/^\d{4}\.\d{2}\.\d{2}$/.test(goal.byDate)).slice(0,3):[];
 const goalProgress=evaluateStrategyGoals(goals,goals.length?extractStrategyMetrics(checkpoint.state??{}):{},checkpoint.state?.date).map(goal=>({
  label:strategyGoalLabel(goal.metric)??'',target:strategyGoalValue(goal.metric,goal.target),
  current:strategyGoalValue(goal.metric,goal.current),byDate:goal.byDate,
  progress:goal.progress===null?null:strategyGoalValue('naval_used_ratio',Math.max(0,goal.progress)),
  status:strategyGoalStatus(goal.status),
 }));
 const counts=raw.commandCounts??{};
 const blocked=Object.values(counts).reduce((n,x)=>n+(Number(x?.blocked)||0),0);
 return {owner,historical,domains,message,steering:contract?{economyFocus:contract.economyFocus,expansionStance:contract.expansionStance,militaryStance:contract.militaryStance}:null,lastStrategyReason:typeof contract?.reason==='string'?contract.reason.slice(0,300):'',blockedCommands:blocked,reviewDue:!historical&&control?.reviewDue===true,goals:goalProgress};
}
