import {randomUUID} from 'node:crypto';
export const STRATEGY_CARDS=[
  {id:'first-war',name:'进攻开局与首战准备',steps:['核对可达目标与收益','侦察参战方','补齐经济、舰队与占领能力','集结核对后开战'],exit:'准备超期或收益消失时缩小目标或更换对手'},
  {id:'repair-economy',name:'战前经济修复',steps:['读取库存、月净产和共享承诺','修复真实瓶颈','回读修复收益'],exit:'缺口解除后恢复备战；无法维持则收缩'},
  {id:'strong-neighbor',name:'强邻与机会调整',steps:['重查路线与参战关系','保护主力','比较候补目标'],exit:'威胁解除恢复进攻，否则终止旧战役'}
].map(card=>({...card,version:1,scope:{gameVersion:'需当前桥确认',empire:'需确认当前普通/蜂巢/机械政体',dlc:'未知',mods:'未知'},source:'STELLARIS_GESTALT_PLAN.md 第四、五节；工程基线',validation:'仅离线流程测试，未验证实机打法'}));

export function createCampaign(input,state){
  if(!Number.isSafeInteger(input?.target)||input.target<0||input.target>=0xffffffff||input.target===state.player?.country_id||typeof input.reason!=='string'||!input.reason.trim())throw Error('需要敌国 ID 和明确收益理由');
  if(!/^\d{4}\.\d{2}\.\d{2}$/.test(input.reviewDate)||input.reviewDate<=state.date)throw Error('必须设置未来游戏日期作为备战复查期限');
  return {id:randomUUID(),target:input.target,reason:input.reason.slice(0,300),phase:'prepare',createdDate:state.date,reviewDate:input.reviewDate,gaps:['核实版本、DLC、模组及当前帝国路线','核实目标路线、参战方、收益与力量','配置主力、目标与退出条件；殖民地才需要搭载陆军的运输舰'],history:[{date:state.date,phase:'select',reason:'保存目标和收益，候选尚待实机情报核验'}],status:'blocked',nextCheck:'inspect government / contacts / attack_options / route / military / wars'};
}

// Only observable transitions are automatic; no model-supplied "victory" flag.
export function reviewCampaign(c,state){
  if(!c)return;
  if(c.phase==='completed'||c.phase==='terminated')return;
  const wars=Array.isArray(state.wars)?state.wars:null;
  const war=wars?.find(w=>w.war_id===c.warId);
  const transition=(phase,reason)=>{if(c.phase!==phase)c.history.push({date:state.date,phase,reason});c.phase=phase;c.history=c.history.slice(-32);};
  if(c.warId!==undefined&&war){if(!c.execution||!['combat','peace'].includes(c.phase))transition('combat','当前战争仍存在；舰战胜利不能代替占领目标');c.status=c.decisionRequired?'review_required':c.execution?'active':'blocked';c.nextCheck=c.decisionRequired?c.nextCheck:c.execution?'核对战争目标、占领、损失与参战方；结束条件缺失时补查':'战争已绑定；campaign start补齐同一目标的实际主力、占领目标和预算（殖民地另需运输军），不再宣战';}
  else if(c.warId!==undefined&&wars){transition('recover','战争已从当前列表消失；尚需核对实际战果和损失');c.status='blocked';c.nextCheck='核对边界与真实收益，补员并修复经济；未经核对不能宣布首战完成';}
  else if(state.date>=c.reviewDate){c.status='review_required';c.nextCheck='准备期限已到：缩小目标、更换对手或明确终止；不无限追加军备';}
  c.lastEvidence={snapshotId:state.snapshotId,date:state.date};
}

// A visible decision obligation, not permission to declare war or invent intel.
export function conquestReview(state,{campaign=state.gestalt?.campaign,route='unknown'}={}){
 const c=campaign,active=c&&!['completed','terminated'].includes(c.phase),wars=Array.isArray(state.wars)?state.wars:null;
 const resources=['energy','alloys',...state.resources?.trade?['trade']:[],...state.resources?.food?['food']:[],...route==='regular'&&state.resources?.consumer_goods?['consumer_goods']:[]];
 const gaps=[];
 for(const key of resources){const r=state.resources?.[key],floor=c?.execution?.resourceFloors?.[key]??0;
  if(!Number.isFinite(r?.stockpile)||!Number.isFinite(r.net)||r.stockpile_known===false||r.net_known===false)gaps.push(key+'库存/净收支未知');
  else if(r.stockpile+Math.min(0,r.net)*3<floor)gaps.push(key+'不足以维持战役底线及三个月负净流量');
 }
 let stage=!wars?'verify_war_state':active?'advance_campaign':wars?.length?'assess_current_war':gaps.length?'prepare_capacity':c?'evaluate_next_target':'seek_target';
 if(active&&['prepare','muster','declare'].includes(c.phase))stage='prepare_campaign';
 if(active&&c.phase==='recover')stage='recover_then_reassess';
 return {objective:'主动进攻与持续征服',stage,advisoryOnly:true,automaticDeclaration:false,
  decisionRequired:true,nextCall:!wars?{tool:'observe',input:{}}:!active&&!wars.length&&!gaps.length?{tool:'inspect',input:{topic:'targets'}}:active&&c.execution?{tool:'campaign',input:{operation:'advance'}}:null,
  warStateKnown:wars!==null,campaignPhase:active?c.phase:null,target:active?c.target:null,
  economicGaps:gaps,campaignGaps:active?(c.gaps||[]).slice(0,6):[],
  priorOutcome:!active&&c?{phase:c.phase,verifiedGain:c.result?.success===true,warEnded:c.result?.warEnded===true,objectives:c.result?.objectives||[]}:null,
  next:!wars?'observe核对真实战争列表，未知不能当和平或授权宣战':active?c.nextCheck||'持续推进当前战役，核对真实战况、占领和议和；阻塞时修复明确缺口':
    wars?.length?'先核对实际战争与参战方，沿用现有战役链路，不另开重复战争':
    gaps.length?'为具体短缺建立可执行准备任务；缺口解除即重评目标，不等待全面正收入或满舰容':
    'inspect targets比较已知敌国、星系/殖民地收益与路线，选定后campaign select；补齐真实准备条件即campaign start推进，不无限转回内政',
  recheckWhen:['准备任务完成','路线、战争合法性或参战方变化','敌我实际战力或维护承受能力变化','和平结果和战后恢复完成'],
  acceptance:'真实战斗/占领、和平结果、取得的战果与战后下一目标评估；posted和运行时长不能代替'};
}
