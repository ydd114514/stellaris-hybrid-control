export const WAR_COMMANDS=['declare_war','land_armies','offer_peace'];
export async function warActionProblem(order,rpc){
 const a=order.arguments;
 if(order.command==='declare_war'){
  const r=await rpc('get_attack_options',{country_id:a.country_id});
  if(!r.options?.some(o=>o.goal_key===a.goal_key&&o.legal===true))return '宣战条件已改变，先读取当前合法目标与参战风险';
 }
 if(order.command==='offer_peace'){
  const r=await rpc('get_peace_options',{war_id:a.war_id});
  if(!r.options?.some(o=>o.outcome===a.outcome&&o.legal===true))return '当前议和方式不合法，不能虚构战争结束';
 }
 if(order.command==='land_armies'){
  const r=await rpc('get_landing_options',{fleet_id:a.fleet_id,planet_id:a.planet_id});
  if(r.success!==true||r.legal!==true)return r.reason||r.error||'无法确认当前登陆条件';
 }
}
export function warProof(order,state,detail){
 const a=order.arguments;
 if(order.command==='declare_war'){
  const war=state.wars?.find(w=>w.primary_defender_id===a.country_id&&w.player_side==='attacker'&&w.attacker_goal?.key===a.goal_key);
  return {verified:!!war,completed:!!war,phase:'declaration_readback',warId:war?.war_id};
 }
 if(order.command==='offer_peace')return {verified:Array.isArray(state.wars)&&!state.wars.some(w=>w.war_id===a.war_id),phase:'peace_readback',completed:Array.isArray(state.wars)&&!state.wars.some(w=>w.war_id===a.war_id)};
 if(order.command==='land_armies')return {verified:detail?.success===true&&detail.planet_id===a.planet_id&&(detail.ground_combat===true||detail.occupied_by_player===true||detail.owned_by_player===true),completed:detail?.success===true&&detail.planet_id===a.planet_id&&(detail.occupied_by_player===true||detail.owned_by_player===true),phase:'invasion_readback'};
}

// Model-facing view only. Execution always rechecks the unmodified engine result.
export function attackOptionsView(raw,countryId,{goalKey}={}){
 if(raw?.country_id!==countryId)throw Error('战争目标国家身份未确认，不能沿用其他国家候选');
 if(!Array.isArray(raw.options))return {country_id:countryId,coverageKnown:false,options:null,legalGoals:null,error:raw.error||'战争目标覆盖未知'};
 if(goalKey!==undefined){
  const rows=raw.options.filter(o=>o.goal_key===goalKey);
  if(rows.length!==1)throw Error('当前引擎未返回唯一的该战争目标；不能编造目标');
  return {country_id:countryId,coverageKnown:true,detail:true,options:rows};
 }
 const options=raw.options.map(o=>({goal_key:o.goal_key,...(typeof o.name==='string'?{name:o.name}:{}),legal:typeof o.legal==='boolean'?o.legal:null,
  ...(o.legal===true||o.goal_key==='wg_conquest'?{reason:o.reason??null}:{reasonOmitted:typeof o.reason==='string'&&o.reason.length>0})}));
 return {country_id:countryId,coverageKnown:true,options,legalGoals:options.filter(o=>o.legal===true).map(o=>o.goal_key),
  next:'只使用legal=true的当前目标。wg_conquest受限时先核对完整原因与claim_quote；其他受限目标详情用inspect attack_options(id=国家ID,goal_key=当前key)。未知不是合法，宣称本身不表示已宣战。'};
}

export function campaignFleetRouting(order,campaign){
 const c=campaign,p=c?.execution;if(c?.enabled!==true||!p||['completed','terminated'].includes(c.phase))return;
 if(!['move_fleet','set_fleet_stance','follow_fleet','fleet_mia','land_armies'].includes(order.command))return;
 const owned=[p.fleetId,p.transportId].filter(n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff),a=order.arguments;
 if(!owned.includes(a.fleet_id)&&!a.fleet_ids?.some(id=>owned.includes(id)))return;
 return {kind:'campaign_routing',campaignId:c.id,phase:c.phase,nextCall:{tool:'campaign',arguments:{operation:'advance'}},
  instruction:'主力/运输舰已交给当前战役推进，不同时覆盖命令。改变目标或期限用campaign revise；确需直接接管先campaign terminate并给原因，停止自动执行后再按新快照操作。'};
}
