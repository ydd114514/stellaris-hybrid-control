import {ECONOMY_FOCUSES} from './operator-standing.mjs';
import {ownerConsolidation} from './expansion-health.mjs';

const resourceFocus={unity:'unity_traditions',consumer_goods:'consumer_stability',food:'consumer_stability',alloys:'alloys_military',defense:'alloys_military',research:'research',energy:'balanced',minerals:'balanced'};
export function ascensionEconomyStage(state={}){
 const text=[state.operatorStanding?.text,...(state.operatorMessages??[])].filter(x=>typeof x==='string').join(' ');
 if(!/凝聚/.test(text)||!/第?三(?:个|项|次)?\s*飞升/.test(text)||!/(?:后|再).*科研/.test(text))return;
 const adopted=state.ascensionPerks?.adopted;
 const known=Array.isArray(adopted)&&adopted.length<=8&&adopted.every(x=>typeof x?.key==='string'&&x.key.startsWith('ap_'));
 const count=known?new Set(adopted.map(x=>x.key)).size:null;
 return {count,focus:count!==null&&count>=3?'research':'unity_traditions'};
}
export function resolveStrategyDirection({state={},standing=state.operatorStanding,contract}={}){
 const base=contract??{economyFocus:'balanced',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'维持均衡经营'};
 const stage=ascensionEconomyStage(state);
 const unityFirst=state.userEconomicPolicy?.priority==='unity_first';
 const standingFocus=ECONOMY_FOCUSES.includes(standing?.economyFocus)?standing.economyFocus:undefined;
 const adviceResource=state.operationalGoal?.targetResource;
 const adviceFocus=Object.hasOwn(resourceFocus,adviceResource)?resourceFocus[adviceResource]:undefined;
 const requested=unityFirst?'unity_traditions':stage?.focus??standingFocus??adviceFocus??base.economyFocus;
 const shortage=Object.entries(state.resources??{}).find(([key,r])=>['energy','minerals','alloys','food','consumer_goods'].includes(key)&&Number.isFinite(r?.stockpile)&&Number.isFinite(r?.net)&&r.net<0&&Math.max(0,r.stockpile)/-r.net<=6);
 const war=(state.wars??[]).length>0;
 const explorationOnly=state.userEconomicPolicy?.militaryPolicy==='exploration_until_threat'&&!war&&!state.warGoalsWindow;
 const health=state.strategy?.expansionHealth;
 const digesting=health?.date===state.date&&health?.consolidate===true;
 const ownerConsolidating=ownerConsolidation(state);
 let economyFocus=requested,reason=standing?.economyFocus?'按当前要求调整经济重点':state.operationalGoal?.targetResource?'按当前持续目标调整经济重点':base.reason;
 if(shortage){economyFocus=['food','consumer_goods'].includes(shortage[0])?'consumer_stability':'balanced';reason='核心资源将在六个月内耗尽，临时保供；余量恢复后自动恢复原方针';}
 else if(war){economyFocus='alloys_military';reason='战争期间临时优先军工；战争结束且资源脱险后自动恢复原方针';}
 else if(standing?.economyFocus)reason='常驻要求有效，执行原方针；退出条件达到后等待本人确认';
 if(unityFirst&&!shortage&&!war)reason='本人最新要求凝聚力最高优先，其他资源仅按实际缺口保供；不主动追求合金、科研盈余产能';
 else if(stage&&!shortage&&!war)reason=stage.count===null?'已选飞升天赋数尚未确认，保持凝聚力重点':stage.count>=3?'第三个飞升天赋已实际选完，按既定要求转科研':'已选'+stage.count+'个飞升天赋，持续主攻凝聚力，基础资源按缺口补足';
 if(!shortage&&!war){
  if(ownerConsolidating)reason+='；按本人要求先巩固现有疆域';
  else if(digesting)reason+='；暂缓普通扩张，'+health.reasons.slice(0,2).join('；');
 }
 if(['hive','machine'].includes(state.empireType)&&economyFocus==='consumer_stability'){
  economyFocus='balanced';
  reason+='；格式塔不使用消费品，维持均衡方针';
 }
 const effective={...base,economyFocus,
  ...(shortage||war||digesting||ownerConsolidating?{expansionStance:'consolidate'}:{}),
  ...(war?{militaryStance:'prepare_war'}:explorationOnly?{militaryStance:'peaceful'}:{}),
  ...(explorationOnly?{oneOffActions:(base.oneOffActions??[]).filter(a=>a.type!=='declare_war')}:{}),reason:reason.slice(0,300)};
 if(effective.militaryStance!=='prepare_war')delete effective.warTarget;
 const lockSources={
  economyFocus:shortage?'紧急保供':war?'战争':unityFirst||stage||standingFocus?'本人要求':adviceFocus?'参谋目标':null,
  expansionStance:shortage?'紧急保供':war?'战争':ownerConsolidating?'本人要求':digesting?'建设消化':null,
  militaryStance:war?'战争':explorationOnly?'本人要求':null,
 };
 const lockedDimensions={};
 for(const [dimension,by] of Object.entries(lockSources)){
  if(by)lockedDimensions[dimension]={value:effective[dimension],by};
 }
 return {contract:effective,requestedFocus:requested,emergency:!!shortage||war,reason:effective.reason,lockedDimensions};
}
