import {recoveryPurchasePlan} from './market-maintenance.mjs';
const validId=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const day=s=>{const m=/^(\d{4})\.(\d{2})\.(\d{2})$/.exec(s||'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):NaN;};
export function confirmedUncolonizedSystem(system,target){
 return system?.owner_id===target&&system.surveyed===true&&Number.isFinite(system.intel)&&system.intel>=3&&Array.isArray(system.planets)&&system.planets.length>0&&system.planets.every(p=>!validId(p.colony_id)&&!validId(p.owner_id));
}
export async function readFirstWarOutcome(c,{state,rpc,fleet}){
 if(!Array.isArray(state.wars))throw Error('战争状态未知，不能核对战果');
 const p=c.execution;
   const gains=[];const objectiveIds=[...new Set([...(c.baseline.objectives||[]).map(x=>x.planetId),...p.planets])];
   for(const planet of objectiveIds){const r=await rpc('get_invasion_state',{planet_id:planet});if(r.success!==true||r.planet_id!==planet)throw Error('战后边界未知，不能虚报收益');gains.push(r);}
   const systems=[];
   for(const b of c.baseline.systems||[]){const r=await rpc('get_system',{system_id:b.systemId});if(r.id!==b.systemId||!validId(r.owner_id))throw Error('战后星系所有权未知，不能虚报领土');systems.push({systemId:r.id,ownerId:r.owner_id});}
   const gainedSystems=systems.filter(r=>r.ownerId===state.player?.country_id&&(c.baseline.systems||[]).some(b=>b.systemId===r.systemId&&b.ownerId===c.target)).map(r=>r.systemId);
   const gained=gains.filter(r=>r.owned_by_player===true&&r.owner_id===state.player?.country_id&&(c.baseline.objectives||[]).some(b=>b.planetId===r.planet_id&&b.ownerId===c.target));
   const warEnded=c.warId!==undefined&&!state.wars.some(w=>w.war_id===c.warId);
   return {success:warEnded&&(gained.length>0||gainedSystems.length>0),gainedSystems,systems,requestedOutcome:c.outcome,outcome:null,outcomeVerified:false,gainedPlanets:gained.map(r=>r.planet_id),objectives:gains.map(r=>({planetId:r.planet_id,ownerId:r.owner_id,controllerId:r.controller_id})),shipsBefore:c.baseline.initialShips??c.baseline.ships,shipsAfter:fleet?.total_ships??null,sameFleet:c.baseline.initialFleetId===p.fleetId,warEnded};

}
export function configureFirstWar(c,input,state){
 for(const key of ['fleetId','rallySystem','targetSystem'])if(!validId(input[key]))throw Error('首战配置缺少有效 '+key);
 if(input.planets?.length&&!validId(input.transportId))throw Error('殖民地占领需要有效 transportId');
 if(input.fleetId===input.transportId)throw Error('主力舰队与运输舰必须不同');
 if(!Array.isArray(input.planets)||input.planets.length>8||!input.planets.every(validId))throw Error('首战需要明确planets数组，0..8个目标；空数组仅用于已确认无殖民地星系');
 if(typeof input.goalKey!=='string'||!/^[a-zA-Z0-9_]{1,100}$/.test(input.goalKey))throw Error('需要引擎当前合法的战争目标');
 if(!Number.isFinite(day(input.finishDate))||day(input.finishDate)<=day(c.reviewDate))throw Error('需要晚于备战期限的战争退出日期');
 if(input.minShips!==undefined&&(!Number.isSafeInteger(input.minShips)||input.minShips<1||input.minShips>10000))throw Error('最低舰船数需要1..10000整数');
 if(input.preparationTasks!==undefined&&(!Array.isArray(input.preparationTasks)||input.preparationTasks.length>128||input.preparationTasks.some(id=>typeof id!=='string'||id.length>100)))throw Error('准备任务依赖无效');
 const floors={energy:0,alloys:0,...(state.resources?.food?{food:0}:{}),...(state.resources?.trade?{trade:0}:{}),...(state.resources?.consumer_goods?{consumer_goods:0}:{}),...(input.resourceFloors||{})};if(Object.entries(floors).some(([k,n])=>!['energy','minerals','alloys','food','consumer_goods','trade','influence','unity','volatile_motes','exotic_gases','rare_crystals','living_metal','zro','dark_matter','nanites','astral_threads'].includes(k)||!Number.isFinite(n)||n<0))throw Error('资源底线无效');
 c.execution={fleetId:input.fleetId,transportId:input.transportId,rallySystem:input.rallySystem,targetSystem:input.targetSystem,planets:[...new Set(input.planets)],goalKey:input.goalKey,finishDate:input.finishDate,resourceFloors:floors,preparationTasks:input.preparationTasks||[],minShips:Math.max(1,Number(input.minShips)||1)};
 c.enabled=true;c.status='ready';c.gaps=[];c.actions={};c.baseline={ownedSystems:state.player?.owned_systems};return c;
}
function transition(c,state,phase,reason){if(c.phase!==phase)c.history.push({date:state.date,phase,reason});c.history=c.history.slice(-64);c.phase=phase;c.status='active';c.nextCheck=reason;}
function block(c,reason){c.status='blocked';c.gaps=[reason];c.nextCheck=reason;}
function economy(state,floors){for(const [r,floor]of Object.entries(floors)){const value=state.resources?.[r];if(!Number.isFinite(value?.stockpile)||!Number.isFinite(value?.net)||value.stockpile_known===false||value.net_known===false)return r+'库存或维护趋势未知';if(value.stockpile<floor)return r+'库存低于战役底线';if(value.net<0&&value.stockpile+value.net*3<floor)return r+'无法维持未来三个月的维护预算';}}

/** One bounded step, at most one gameplay command. Persisted action keys precede send. */
export async function advanceFirstWar(c,{state,rpc,send,save,tasks=[],records=[],isStopped=()=>false}){
 if(!c?.enabled||['completed','terminated'].includes(c.phase))return;
 if(isStopped())return;
 c.gaps=[];
 const p=c.execution,war=state.wars?.find(w=>w.war_id===c.warId);
 const evidence=(kind,entity,details)=>{c.observedEvidence??={};const key=kind+':'+entity;const previous=c.observedEvidence[key];c.observedEvidence[key]={kind,entity,firstDate:previous?.firstDate??state.date,lastDate:state.date,...details};};
 const action=async(key,order,context={})=>{
   let old=c.actions[key];
   const tracked=old?.trackingId&&records.find(r=>r.id===old.trackingId&&r.command===old.order?.command);
   if(tracked?.status==='completed'&&tracked.proof?.kind===({move_fleet:'fleet_at_destination',land_armies:'occupation_observed',reinforce_fleet:'reinforcement_arrived'})[order.command]&&['move_fleet','land_armies','reinforce_fleet'].includes(order.command)){
    c.actionHistory=[...(c.actionHistory||[]),{key,...structuredClone(old),completionProof:tracked.proof}].slice(-64);
    const attempts=(old.attempts??1)+1;if(attempts>8){block(c,'该目标已多次重新执行，需修订战役而非无限重发');return;}
    delete c.actions[key];old=undefined;context.attempts=attempts;
   }
   // A definitive refusal is safe to reconsider after a returned/MIA fleet has
   // acquired a different, revalidated starting position. Unknown sends never do.
   if(old&&['rejected','rejected_cached'].includes(old.status)&&order.command==='move_fleet'&&validId(context.systemId)&&old.sourceSystem!==context.systemId){delete c.actions[key];old=undefined;}
   if(old){
     if(['rejected','rejected_cached'].includes(old.status)){
       if(c.warId===undefined){transition(c,state,'terminated','战前动作被引擎明确拒绝，终止旧目标后可重新规划');c.result={success:false,reason:old.error||'engine_rejected'};}
       else if(c.phase!=='peace'&&c.phase!=='recover'){c.exitReason=old.error||'作战命令失败';transition(c,state,'peace','作战受阻，转为收缩议和');}
       else block(c,old.error||'议和或补员受阻，请修复条件后重新规划');
     }else block(c,'等待已发出动作回读：'+key+'；不重复发送');return;
   }
   c.actions[key]={status:'issued',order,snapshotId:state.snapshotId,sourceSystem:context.systemId,attempts:context.attempts??1,issuedDate:state.date};await save();
   if(isStopped())return;
   const result=await send(order),row=result?.orders?.[0];
   if(['deferred','duplicate_skipped','pending_confirmation','unconfirmed_not_replayed'].includes(row?.status)){delete c.actions[key];block(c,row.reason||row.note||'本地条件暂不满足，尚未发送');return;}
   c.actions[key].status=row?.status||'unknown';
   c.actions[key].verification=row?.verification;c.actions[key].trackingId=row?.tracking?.id;
   if(['rejected','rejected_cached'].includes(row?.status)){c.actions[key].error=row.error;block(c,row.error||'引擎拒绝动作，需修复或终止战役');}
   else c.nextCheck='命令已尝试提交，等待真实结果：'+key;
 };
 try {
  if(!Array.isArray(state.wars)){block(c,'战争状态未知，先重新观察');return;}
  if(c.warId!==undefined&&!war&&!['recover'].includes(c.phase))transition(c,state,'recover','战争结束已回读，核对战果、补员和经济');
  const exhausted=economy(state,p.resourceFloors);
  if(['prepare','muster','declare'].includes(c.phase)&&day(state.date)>=day(c.reviewDate)){transition(c,state,'terminated','备战超过投入期限，终止旧目标，允许选择替代敌国');c.result={success:false,reason:'preparation_timeout'};return;}
  const tactics=await rpc('get_fleet_tactics',{details:true});
  const fleet=tactics.fleets?.find(f=>f.fleet_id===p.fleetId);
  if(c.phase==='recover'){
   try{c.result=await readFirstWarOutcome(c,{state,rpc,fleet});}catch(error){block(c,error.message);return;}
   if(c.result.warEnded)evidence('war_ended',c.warId,{gainedPlanets:c.result.gainedPlanets,gainedSystems:c.result.gainedSystems,requestedOutcome:c.outcome,actualPeaceKindKnown:false});
  }
  if(!fleet){block(c,'主力舰队不存在或不可见，需要campaign revise重选实际主力；战后战果已单独回读');return;}
  if(fleet.in_combat===true||(!/未|没有|不在|not |no /i.test(fleet.status||'')&&/正在战斗|战斗中|交战中|in combat/i.test(fleet.status||'')))evidence('fleet_combat',p.fleetId,{systemId:fleet.system_id});
  const threatened=(fleet.total_ships<p.minShips)||!!exhausted;
  if(c.phase==='prepare'){
   if(exhausted){block(c,exhausted+'；先运行战前经济修复任务');return;}
   if(!p.preparationTasks.every(id=>tasks.some(t=>t.id===id&&t.status==='completed'))){block(c,'舰队、经济或科研准备任务尚未完成');return;}
   if(!Number.isFinite(fleet.total_ships)||fleet.total_ships<p.minShips){block(c,'实际到场舰船不足');return;}
   const target=await rpc('get_system',{system_id:p.targetSystem});
   if(target.owner_id!==c.target||!p.planets.every(id=>target.planets?.some(p=>p.id===id&&p.owner_id===c.target))){block(c,'目标星系及占领星球归属未知或已改变，先重新选择收益目标');return;}
   if(!p.planets.length&&!confirmedUncolonizedSystem(target,c.target)){block(c,'空登陆目标仅适用于完整情报确认的无殖民地星系');return;}
   c.baseline.systems??=[];if(!c.baseline.systems.some(b=>b.systemId===p.targetSystem))c.baseline.systems.push({systemId:p.targetSystem,ownerId:c.target,observedDate:state.date});
   c.baseline.objectives=[...(c.baseline.objectives||[])];for(const planetId of p.planets)if(!c.baseline.objectives.some(x=>x.planetId===planetId))c.baseline.objectives.push({planetId,ownerId:c.target,systemId:p.targetSystem,observedDate:state.date});
   if(p.goalKey==='wg_conquest'&&target.player_claims===0){await action('claim',{command:'claim_system',arguments:{system_id:p.targetSystem}});return;}
   if(p.goalKey==='wg_conquest'&&!Number.isFinite(target.player_claims)){block(c,'目标宣称状态未知，不能把登陆当作可保留的征服收益');return;}
   if(p.planets.length){
   const forces=await rpc('get_war_fleets');
   const transport=forces.fleets?.find(f=>f.fleet_id===p.transportId&&f.ship_class==='shipclass_transport');
   if(forces.success!==true||!transport||!(transport.embarked_armies>0)){block(c,'未确认实际搭载陆军的运输舰，先完成占领准备');return;}
   }
   const options=await rpc('get_attack_options',{country_id:c.target});
   if(!options.options?.some(o=>o.goal_key===p.goalKey&&o.legal===true)){block(c,'目标战争条件失效；重新选择合法目标');return;}
   const route=await rpc('find_path',{fleet_id:p.fleetId,to_system_id:p.rallySystem});
   if(route.reachable!==true){block(c,'集结路线未知或中断');return;}
   c.baseline.ships=fleet.total_ships;c.baseline.initialShips??=fleet.total_ships;c.baseline.initialFleetId??=p.fleetId;transition(c,state,'muster','准备完成，集结主力和运输舰');return;
  }
  if(c.phase==='muster'){
   if(exhausted){block(c,exhausted);return;}
   if(p.planets.length){
   const all=await rpc('get_war_fleets',{}),transport=all.fleets?.find(f=>f.fleet_id===p.transportId&&f.embarked_armies>0);
   if(!transport){block(c,'运输舰未回读，先补齐占领能力');return;}
   }
   const system=await rpc('get_system',{system_id:p.rallySystem});
   for(const id of [p.fleetId,...(p.planets.length?[p.transportId]:[])])if(!system.fleets?.some(f=>f.id===id&&f.own===true)){
    const route=await rpc('find_path',{fleet_id:id,to_system_id:p.rallySystem});
    if(route.reachable!==true){block(c,'舰队集结路线中断');return;}
    await action('muster-'+id,{command:'move_fleet',arguments:{fleet_id:id,system_id:p.rallySystem}});return;
   }
   transition(c,state,'declare','实际舰队均已到场，重新核对后宣战');return;
  }
  if(c.phase==='declare'){
   const observed=state.wars.find(w=>w.primary_defender_id===c.target&&w.player_side==='attacker'&&w.attacker_goal?.key===p.goalKey);
   if(observed){c.warId=observed.war_id;c.participants={attacker:observed.primary_attacker_id,defender:observed.primary_defender_id};transition(c,state,'combat','宣战已确认，继续战争目标与占领');return;}
   if(exhausted){block(c,exhausted);return;}
   await action('declare',{command:'declare_war',arguments:{country_id:c.target,goal_key:p.goalKey}});return;
  }
  if(c.phase==='combat'){
   if(war.primary_attacker_id!==c.participants?.attacker||war.primary_defender_id!==c.participants?.defender){block(c,'主参战方改变，暂停战役以重新评估');return;}
   if((fleet.total_ships<p.minShips)||exhausted){c.exitReason=exhausted||'实际舰船低于撤退底线';transition(c,state,'peace','损失或维护风险触发收缩，申请可兑现退出结果');return;}
   if(day(state.date)>=day(p.finishDate)){
    c.decisionRequired={kind:'exit_deadline',date:state.date};c.status='review_required';c.gaps=['退出期限已到，需要模型重新比较战况'];c.nextCheck='campaign revise明确延长finishDate并继续进攻，或inspect peace_options后由模型明确议和；期限不会自动投降';return;
   }
   delete c.decisionRequired;
   // Check actual ground results even if the navy has since moved or retreated.
   // Unknown ground intel must not prevent approaching a known objective.
   const objective=[];
   for(const planetId of p.planets){const r=await rpc('get_invasion_state',{planet_id:planetId});objective.push(r);}
   const known=objective.every(r=>r.success===true);
   if(known&&objective.length){
    c.objectives=objective;
    for(const r of objective){if(r.ground_combat===true)evidence('ground_combat',r.planet_id,{ownerId:r.owner_id});if(r.occupied_by_player===true||r.owned_by_player===true)evidence('occupation',r.planet_id,{ownerId:r.owner_id,controllerId:r.controller_id});}
    if(objective.every(r=>r.occupied_by_player===true||r.owned_by_player===true)){transition(c,state,'peace','指定占领目标已由真实控制权确认，申请战争结果');return;}
    if(objective.some(r=>r.ground_combat===true)){block(c,'地面战进行中，等待真实占领结果');return;}
   }
   const system=await rpc('get_system',{system_id:p.targetSystem});
   if(!p.planets.length&&validId(state.player?.country_id)&&(system.owner_id===state.player?.country_id||system.fleets?.some(f=>f.owner_id===state.player?.country_id&&f.ship_class==='shipclass_starbase'))){
    evidence('system_occupation',p.targetSystem,{ownerId:system.owner_id,starbaseControlConfirmed:true});transition(c,state,'peace','目标星系的实际星基控制权已确认，申请领土结果');return;
   }
   const observedFleet=system.fleets?.find(f=>f.id===p.fleetId&&(f.own===true||f.owner_id===state.player?.country_id));
   if(observedFleet?.stance==='aggressive')c.actions['attack-stance']={status:'observed',order:{command:'set_fleet_stance',arguments:{fleet_id:p.fleetId,stance:'aggressive'}},verification:{verified:true,phase:'fleet_stance_readback'}};
   if(!c.actions['attack-stance']){await action('attack-stance',{command:'set_fleet_stance',arguments:{fleet_id:p.fleetId,stance:'aggressive'}});return;}
   if(!system.fleets?.some(f=>f.id===p.fleetId&&f.own===true)){
    const route=await rpc('find_path',{fleet_id:p.fleetId,to_system_id:p.targetSystem});
    if(route.reachable!==true){c.decisionRequired={kind:'route_unavailable',date:state.date,knownUnreachable:route.reachable===false};c.status='review_required';c.gaps=['当前进攻路线未确认'];c.nextCheck='核对在途位置和真实路线，再由模型修订目标；未知/跃迁中不自动解释为战败或退出';return;}
    await action('attack',{command:'move_fleet',arguments:{fleet_id:p.fleetId,system_id:p.targetSystem}});return;
   }
   if(!p.planets.length){block(c,'主力已抵达，等待真实星基控制权；抵达不等于占领');return;}
   if(!known){block(c,objective.find(r=>r.success!==true)?.error||'占领情报未知');return;}
   // The normal military fleet move engages hostile fleets/starbases; ground victory is separate.
   const target=objective.find(r=>!r.occupied_by_player&&!r.owned_by_player);
   if(target.ground_combat===true){block(c,'地面战进行中，等待真实占领结果');return;}
   const legal=await rpc('get_landing_options',{fleet_id:p.transportId,planet_id:target.planet_id});
   if(legal.legal!==true){block(c,legal.reason||legal.error||'登陆条件未满足，先处理轨道防御或补军');return;}
   await action('land-'+target.planet_id,{command:'land_armies',arguments:{fleet_id:p.transportId,planet_id:target.planet_id}});return;
  }
  if(c.phase==='peace'){
   if(!p.planets.length&&Object.values(c.observedEvidence||{}).some(x=>x.kind==='system_occupation'&&x.entity===p.targetSystem)){
    const current=await rpc('get_system',{system_id:p.targetSystem}),starbase=current.fleets?.find(f=>f.ship_class==='shipclass_starbase');
    if(!validId(starbase?.owner_id)){block(c,'目标星基当前控制权未知，不能沿用旧占领提出战果');return;}
    if(starbase.owner_id!==state.player?.country_id){
     c.decisionRequired={kind:'occupation_lost',date:state.date,systemId:p.targetSystem,controllerId:starbase.owner_id};c.status='review_required';c.gaps=['目标星基已被其他国家重新控制'];c.nextCheck='先按新敌情评估夺回目标或修订战役；不继续把旧占领当作议和收益';return;
    }
   }
   const options=await rpc('get_peace_options',{war_id:c.warId});
   if(threatened)c.exitReason ||= exhausted||'损失或退出期限触发收缩';
   let preference=c.exitReason?['status_quo']:['demand_surrender','status_quo'];
   const first=c.actions['peace-'+preference[0]],sentDate=first?.issuedDate||c.history.filter(h=>h.phase==='peace').at(-1)?.date;
   // IsValid means a proposal may be sent, not that the AI will accept it. After
   // a bounded wait, try the alternative once; never replay an unknown proposal.
   if(first&&['posted','unknown','issued'].includes(first.status)&&day(state.date)-day(sentDate)>=90){
    if(preference.length===1){c.decisionRequired={kind:'peace_unaccepted',date:state.date};c.status='review_required';c.gaps=['维持现状提案未兑现'];c.nextCheck='模型重新评估继续进攻、修订退出日期或明确议和方式；等待不会自动投降';return;}
    preference=preference.slice(1);
   }
   const outcome=preference.find(o=>options.options?.some(x=>x.outcome===o&&x.legal===true));
   if(!outcome){block(c,'当前没有合法议和方式，等待外交变化或明确人工接管');return;}
   c.outcome=outcome;await action('peace-'+outcome,{command:'offer_peace',arguments:{war_id:c.warId,outcome}});return;
  }
  if(c.phase==='recover'){
   if(exhausted){
    const plan=recoveryPurchasePlan(state.resources,p.resourceFloors,await rpc('get_market'));
    if(!plan.order){block(c,plan.blocked||exhausted+'；继续战后经济修复');return;}
    const args=plan.order.arguments,quote=await rpc('get_market_quote',args),cash=state.resources?.[plan.settlement];
    if(quote.success!==true||quote.price_basis!=='engine_transaction_total'||quote.includes_fee!==true||quote.resource!==args.resource||quote.action!==args.action||quote.units!==args.units||quote.settlement_currency!==plan.settlement||!Number.isFinite(quote.total)||quote.total<=0||!Number.isFinite(cash?.stockpile)||!Number.isFinite(cash?.net)||cash.stockpile-quote.total+Math.min(0,cash.net)*3<(p.resourceFloors[plan.settlement]||0)){
      block(c,'恢复交易报价或结算储备不足，先修复经济任务');return;
    }
    let chunk=0;while(c.actions[`recover-buy-${args.resource}-${chunk}`]?.verification?.verified===true)chunk++;
    if(chunk>=8){block(c,'恢复采购达到上限，必须修复持续收支而非反复购买');return;}
    await action(`recover-buy-${args.resource}-${chunk}`,plan.order);return;
   }
   if(!validId(fleet.system_id)){block(c,'主力暂时失踪或正在跃迁，等待实际位置恢复后回港');return;}
   const homeSystem=validId(state.player?.capital_system_id)?state.player.capital_system_id:p.rallySystem;
   const home=await rpc('get_system',{system_id:homeSystem});
   if(!home.fleets?.some(f=>f.id===p.fleetId&&f.own===true)){
    const route=await rpc('find_path',{fleet_id:p.fleetId,to_system_id:homeSystem});
    if(route.reachable!==true){
      // Closed third-party borders can isolate the captured colony after peace.
      // Use the game's normal MIA return command; observe the delayed arrival.
      await action('return-mia',{command:'fleet_mia',arguments:{fleet_ids:[p.fleetId],type:'return_home'}});return;
    }
    await action('return-home',{command:'move_fleet',arguments:{fleet_id:p.fleetId,system_id:homeSystem}},{systemId:fleet.system_id});return;
   }
   c.recoverySystem=homeSystem;
   if(!Number.isFinite(c.baseline.ships)||!Number.isFinite(fleet.total_ships)){block(c,'补员基线或当前舰船数未知，先修订恢复配置');return;}
   if(fleet.total_ships<c.baseline.ships){await action('reinforce',{command:'reinforce_fleet',arguments:{fleet_id:p.fleetId}});return;}
   if(/维修|修理|repair/i.test(fleet.status||'')){block(c,'主力正在维修，待修复完成后重新评估');return;}
   c.recoveryEvidence={date:state.date,fleetId:p.fleetId,homeSystem,homePresenceConfirmed:true,maintenanceFloorsChecked:true,ships:fleet.total_ships,requiredShips:c.baseline.ships};
   transition(c,state,c.result.success?'completed':'terminated',c.result.success?'战果、补员与维护预算已回读，可以准备下一战':'战争结束但未获得已验证目标，记录失利并允许更换目标');c.enabled=false;c.nextCampaignReview={required:true,reason:'已核对本战结果和恢复情况，继续评估下一征服目标',afterDate:state.date,priorTarget:c.target,verifiedGainedPlanets:c.result.gainedPlanets,verifiedGainedSystems:c.result.gainedSystems};return;
  }
 }finally {await save();}
}
