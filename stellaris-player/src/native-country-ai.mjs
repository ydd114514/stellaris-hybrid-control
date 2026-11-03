import {COUNTRY_AI_POLICIES,normalizeCountryAIProtection,normalizeNativeOwnerPolicy} from './native-country-ai-economic-policy.mjs';
export const COUNTRY_AI_EDICT_APPROVAL_FEATURE='country_ai_edict_approval';
export const COUNTRY_AI_P1_BRIDGE_VERSION='cyberfish-0.6.29-edict-approval';
export const COUNTRY_AI_LEADER_BUDGET_BRIDGE_VERSION='cyberfish-0.6.28-owner-leader-budget';
export const COUNTRY_AI_EXPLORATION_BRIDGE_VERSION='cyberfish-0.6.27-owner-exploration';
export const COUNTRY_AI_DIRECTOR_BRIDGE_VERSION='cyberfish-0.6.26-director-views';
export const COUNTRY_AI_PREVIOUS_BRIDGE_VERSION='cyberfish-0.6.25-owner-intent';
export const COUNTRY_AI_SUPPORTED_BRIDGE_VERSIONS=Object.freeze([COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_LEADER_BUDGET_BRIDGE_VERSION,COUNTRY_AI_EXPLORATION_BRIDGE_VERSION,COUNTRY_AI_DIRECTOR_BRIDGE_VERSION,COUNTRY_AI_PREVIOUS_BRIDGE_VERSION]);
export const DIRECTOR_BRIDGE_FEATURES=Object.freeze(['native_director_object_views','native_director_starbase_targets']);
export const COUNTRY_AI_FULL_FEATURE='country_ai_full_with_reserved';
export const COUNTRY_AI_P1_FEATURES=['country_ai_own_session_post_gate','country_ai_command_clone_lifetime','country_ai_native_queue_gate','country_ai_game_update_lease','country_ai_world_generation','country_ai_serialized_execution_receipts','country_ai_owner_intent'];
export function isCountryAIBridgeCompatible(ping){
  if(!COUNTRY_AI_SUPPORTED_BRIDGE_VERSIONS.includes(ping?.bridge_version)||!Array.isArray(ping.features))return false;
  // Presentation extensions never gate the native AI's existing lease/owner safeguards.
  // Their individual support flags control only whether the new views are requested.
  const required=[COUNTRY_AI_FULL_FEATURE,...COUNTRY_AI_P1_FEATURES];
  return required.every(feature=>ping.features.includes(feature));
}
const off=s=>s?.global_flags?.human_ai===false&&s?.global_flags?.force_human_ai===false;
const stopped=s=>s?.phase==='stopped'&&s.last_native_state?.paused===true&&off(s.last_native_state)&&s.routine_gate?.armed===false&&s.observation?.armed===false;
export const nativeCountryScope=s=>Object.fromEntries(Object.entries(s?.precondition||{}).filter(([k])=>!['date','sequence','global_flags'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
const scope=nativeCountryScope;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Uses the host's existing SerialWork idle/watch supervision. No routine order
 * selection occurs here. Native lease expiry protects a vanished/blocked host.
 */
export class NativeCountryAI {
  constructor({rpc,assertBinding,setDispatchFence,record=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),polls=60}={}) {
    if([rpc,assertBinding,setDispatchFence].some(f=>typeof f!=='function'))throw Error('国家 AI 需要原会话检查和真实派单封口');
    if(!Number.isSafeInteger(polls)||polls<1||polls>100)throw Error('国家 AI 回读次数无效');
    Object.assign(this,{rpc,assertBinding,setDispatchFence,record,wait,polls});this.phase='human';this.active=false;
  }
  async call(method,params={}) {await this.assertBinding();return this.rpc(method,params);}
  async journal(event,{required=false}={}) {
    try{await this.record(event);}catch(error){this.evidenceIncomplete=true;if(required)throw error;}
  }
  async capabilities() {
    if(this.capabilityVerified)return;
    const ping=await this.call('ping');
    const economy=isCountryAIBridgeCompatible(ping);
    if(!economy)
      throw Error('当前桥不具备国家 AI 提交限制、失联收权和世界代次接口');
    this.fullGateVerified=economy;
    this.ownerIntentSupported=ping.features.includes('country_ai_owner_intent');
    this.explorationSupported=[COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_LEADER_BUDGET_BRIDGE_VERSION,COUNTRY_AI_EXPLORATION_BRIDGE_VERSION].includes(ping.bridge_version)&&ping.features.includes('country_ai_owner_exploration');
    this.ownerLeaderBudgetSupported=ping.features.includes('country_ai_owner_leader_budget');
    this.directorObjectViewsSupported=ping.features.includes('native_director_object_views');
    this.directorStarbaseTargetsSupported=ping.features.includes('native_director_starbase_targets');
    this.capabilityVerified=true;
  }
  async state() {
    await this.capabilities();const result=await this.call('country_ai_lease',{action:'status'});
    if(result?.success!==true)throw Error(result?.error||'国家 AI 控制权不可读');
    if(this.active&&this.generation!==undefined&&(result.generation!==this.generation||
      this.saved?.scope&&!same(scope(result.last_native_state),this.saved.scope))){
      this.phase='unconfirmed';throw Error('国家 AI 回读代次或本国世界改变，保持派单封口');
    }
    this.last=result;this.confirmStopped(result);return result;
  }
  confirmStopped(state){
    if(!stopped(state))return false;
    if(this.active||this.generation!==undefined){this.takeoverGeneration=state.generation;this.active=false;this.phase='human';this.generation=undefined;this.setDispatchFence(false);}
    return true;
  }
  view() {
    const raw=this.last;
    const external=raw?.last_native_state?.global_flags?.human_ai||raw?.last_native_state?.global_flags?.force_human_ai;
    return {phase:this.phase,nativePhase:raw?.phase??null,owner:this.active?(this.phase==='native'&&raw?.phase==='running'?'native':'unconfirmed'):external?'unmanaged_native_ai':'human',
      ordinaryOrdersBlocked:this.active,generation:this.generation??null,
      domains:[...(COUNTRY_AI_POLICIES[this.saved?.policy]??[])],
      protectedTargets:structuredClone(this.saved?.protectedTargets??{}),
      ownerPolicy:structuredClone(raw?.routine_gate?.owner_policy??{}),ownerIntentSupported:this.ownerIntentSupported===true,ownerLeaderBudgetSupported:this.ownerLeaderBudgetSupported===true,explorationSupported:this.explorationSupported===true,
      explorationProtectedFleets:[...(raw?.routine_gate?.exploration_protected_fleets??[])],
      directorObjectViewsSupported:this.directorObjectViewsSupported===true,directorStarbaseTargetsSupported:this.directorStarbaseTargetsSupported===true,
      supportedPolicies:this.capabilityVerified?Object.keys(COUNTRY_AI_POLICIES):[],
      commandCounts:raw?.routine_gate?.command_counts??{},reservedPolicy:raw?.routine_gate?.reserved_policy??null,
      protectionStatus:this.saved?.protectionStatus==='pending_native_revalidation'?'pending_native_revalidation':
        this.saved?.protectionStatus==='native_arm_confirmed'?(this.active?'native_arm_confirmed':'inactive'):null,
      actualFlags:raw?.last_native_state?.global_flags??null,paused:raw?.last_native_state?.paused??null,
      nativeAdmitted:raw?.routine_gate?.admitted_to_native_validation??null,nativeBlocked:raw?.routine_gate?.blocked_before_native_queue??null,
      coverageFaults:raw?.routine_gate?.coverage_faults??null,stopReason:raw?.stop_reason??null,
      reviewDue:raw?.review_due===true,
      hardNativeBudget:false,autonomousWorkVerified:false,evidenceIncomplete:!!this.evidenceIncomplete};
  }
  async poll(until) {
    for(let i=0;i<this.polls;i++) {
      if(this.cancelRequested)throw Error('国家 AI 交接已请求停止');
      const state=await this.state();
      if(until(state))return state;
      if(['scope_unknown','stop_unconfirmed','world_reclaim_unconfirmed'].includes(state.phase))throw Error('国家 AI 控制权待确认');
      if(i+1<this.polls)await this.wait(50);
    }
    throw Error('国家 AI 结果未确认；不重放开启命令');
  }
  async delegate({policy='full_with_reserved',maxGameDays=180,maxWallMs=120000,stopAtReview=false,protectedTargets={},ownerPolicy={}}={}) {
    if(this.operation||this.active)throw Error('先完成当前国家 AI 接管，不覆盖已有控制权');
    if(!Object.hasOwn(COUNTRY_AI_POLICIES,policy)||!Number.isInteger(maxGameDays)||maxGameDays<1||maxGameDays>720||!Number.isSafeInteger(maxWallMs)||maxWallMs<1000||maxWallMs>3600000)
      throw Error('国家 AI 试点范围或复查上限无效');
    const protection=normalizeCountryAIProtection(protectedTargets),owner=normalizeNativeOwnerPolicy(ownerPolicy);
    this.active=true;this.phase='preparing';this.cancelRequested=false;this.setDispatchFence(true);
    const work=this.performDelegate({policy,maxGameDays,maxWallMs,stopAtReview,protectedTargets:protection,ownerPolicy:owner});this.operation=work;
    try{return await work;}finally{this.operation=undefined;}
  }
  async performDelegate(options) {
    let prepareRejected=false;
    try {
      await this.capabilities();
      if(!this.fullGateVerified&&(options.policy.startsWith('economy')||Object.values(options.protectedTargets).some(refs=>refs.length)))throw Error('实际加载桥未确认经济范围与保护能力');
      const before=await this.call('get_country_ai_state');
      if(before?.success!==true||before.paused!==true||before.single_local_human_guard!==true||!off(before))
        throw Error('委派前必须确认暂停、本国身份及原生国家 AI 关闭');
      this.saved={...options,scope:scope(before)};
      await this.journal({type:'country_ai_delegate_intent',policy:options.policy,before},{required:true});
      const prepared=await this.call('country_ai_lease',{action:'prepare',expected:before.precondition,policy:options.policy,max_game_days:options.maxGameDays,max_wall_ms:options.maxWallMs,stop_at_review:options.stopAtReview,
        ...(this.fullGateVerified?{protected_targets:options.protectedTargets}:{}),owner_policy:options.ownerPolicy});
      if(prepared?.success===false)prepareRejected=true;
      if(prepared?.success!==true||prepared.phase!=='prepared'||!Number.isSafeInteger(prepared.generation))throw Error(prepared?.error||'国家 AI 未准备好');
      this.generation=prepared.generation;this.last=prepared;
      await this.journal({type:'country_ai_lease_acquired',generation:this.generation,scope:this.saved.scope},{required:true});
      if(this.fullGateVerified){
        const protectedReadback=normalizeCountryAIProtection(prepared.routine_gate?.protected_targets??null);
        if(!same(protectedReadback,options.protectedTargets)||
          prepared.routine_gate?.reserved_policy!=='full_with_reserved')
          throw Error('经济范围或关键目标保护未真实回读，不开启国家 AI');
        this.saved.protectionStatus='native_arm_confirmed';
      }
      if(this.ownerIntentSupported&&!same(normalizeNativeOwnerPolicy(prepared.routine_gate?.owner_policy),options.ownerPolicy))throw Error('本人经营约束没有真实原生回读，不开启国家AI');
      if(this.cancelRequested)throw Error('国家 AI 委派已取消');
      const enabled=await this.call('country_ai_lease',{action:'enable',generation:this.generation});
      if(enabled?.success!==true)throw Error(enabled?.error||'国家 AI 开启结果未知');
      await this.poll(s=>s.phase==='ready_paused');
      const running=await this.call('country_ai_lease',{action:'run',generation:this.generation,full_with_reserved:true});
      if(running?.success!==true)throw Error(running?.error||'国家 AI 未获准持续运行');
      await this.poll(s=>s.phase==='running'&&s.last_native_state?.paused===false||stopped(s)&&s.run_confirmed===true);
      this.phase=this.active?'native':'human';await this.journal({type:'country_ai_delegate_confirmed',view:this.view()});return this.view();
    } catch(error) {
      this.phase=this.active?'unconfirmed':'human';await this.journal({type:'country_ai_delegate_failed',message:error.message});
      if(this.generation!==undefined)try {await this.stopNative();}catch(cleanup){error.countryAICleanupError=cleanup.message;}
      else if(prepareRejected)try {
        const state=await this.state(),native=state.last_native_state;
        if(state.phase==='idle'&&native?.success===true&&native.paused===true&&off(native)&&
          same(scope(native),this.saved.scope)&&state.routine_gate?.armed!==true&&state.observation?.armed!==true){
          this.active=false;this.phase='human';this.setDispatchFence(false);
        }
      }catch{} // Transport uncertainty and an armed/foreign lease remain fenced.
      // Without native-generation acquisition, an unexpected pre-existing AI
      // remains fenced; never declare it human-owned after an ambiguous failure.
      throw error;
    }
  }
  async stopNative() {
    await this.state();if(!this.active)return this.view();
    if(this.generation===undefined)throw Error('没有本轮原生代次，不猜测收权对象');
    this.phase='taking_over';
    const result=await this.call('country_ai_lease',{action:'stop',generation:this.generation});
    if(result?.success!==true)throw Error(result?.error||'国家 AI 收权请求未确认');
    for(let i=0;i<this.polls;i++) {
      const state=await this.state();
      if(stopped(state)) {
        this.confirmStopped(state);
        await this.journal({type:'country_ai_takeover_confirmed',state});return this.view();
      }
      if(state.phase==='scope_unknown')break;
      if(i+1<this.polls)await this.wait(50);
    }
    this.phase='unconfirmed';throw Error('国家 AI 关闭、暂停或队列交接尚未确认；派单继续封口');
  }
  async takeover() {
    this.cancelRequested=true;
    if(this.operation)await this.operation.catch(()=>{});
    if(!this.active)return this.view();
    this.cancelRequested=false;return this.stopNative();
  }
  async resume(options={}) {
    if(!this.saved||this.active)throw Error('没有可交还的同世界策略或仍在托管中');
    const state=await this.call('get_country_ai_state');
    if(!same(scope(state),this.saved.scope))throw Error('世界或玩家已改变，不恢复旧委派');
    return this.delegate({...this.saved,...options});
  }
  async protect({protectedTargets,reason}={}) {
    if(this.active||!this.saved||this.phase!=='human'||!Number.isSafeInteger(this.takeoverGeneration))
      throw Error('保护目标更新需要本轮紧急接管完成');
    if(typeof reason!=='string'||!reason.trim()||reason.trim().length>500)throw Error('关键保护需要1..500字的战略理由');
    if(protectedTargets===undefined)throw Error('必须明确给出保护目标；清空保护也需要显式对象及理由');
    const protection=normalizeCountryAIProtection(protectedTargets);
    const actual=await this.state();
    if(!this.fullGateVerified||!stopped(actual)||actual.generation!==this.takeoverGeneration||
      !same(scope(actual.last_native_state),this.saved.scope))throw Error('经济保护需要同世界本轮收权、暂停和AI关闭的真实回读');
    const previous=this.saved;
    this.saved={...previous,protectedTargets:protection,protectionStatus:'pending_native_revalidation'};
    try{await this.journal({type:'country_ai_protection_updated',reason:reason.trim(),protectedTargets:protection,
      scope:this.saved.scope,takeoverGeneration:this.takeoverGeneration},{required:true});}
    catch(error){this.saved=previous;throw error;}
    return this.view();
  }
  async heartbeat() {
    if(!this.active||this.operation)return this.view();
    const result=await this.call('country_ai_lease',{action:'heartbeat',generation:this.generation});
    if(result?.success!==true) {
      const state=await this.state();
      if(this.confirmStopped(state))return this.view();
      this.phase='unconfirmed';throw Error(result?.error||'国家 AI 监督心跳未确认');
    }
    this.last=result;
    if(stopped(result))this.confirmStopped(result);
    else if(result.phase!=='running')this.phase='unconfirmed';
    return this.view();
  }
  async setOwnerPolicy(value){
    const policy=normalizeNativeOwnerPolicy(value);
    if(!this.active||this.generation===undefined||!this.ownerIntentSupported)throw Error('本人经营方针需要当前支持意图约束的原生委派');
    await this.state();
    if(same(normalizeNativeOwnerPolicy(this.last?.routine_gate?.owner_policy),policy))return this.view();
    const result=await this.call('country_ai_lease',{action:'update_owner_policy',generation:this.generation,owner_policy:policy});
    if(result?.success!==true||result.generation!==this.generation||!same(scope(result.last_native_state),this.saved?.scope)||!same(normalizeNativeOwnerPolicy(result.routine_gate?.owner_policy),policy))throw Error('原生经营约束更新未确认，不把目标记作已落实');
    this.last=result;this.saved.ownerPolicy=policy;return this.view();
  }
  async explorationState(generation=this.generation,{allowPaused=false}={}){
    if(!this.explorationSupported||!this.active||this.operation||this.cancelRequested||generation!==this.generation)throw Error('持续探索需要当前支持逐舰探索的原生委派');
    const state=await this.state();
    if(!this.active||this.cancelRequested||this.operation||this.generation!==generation||state.phase!=='running'||state.generation!==generation||!same(scope(state.last_native_state),this.saved?.scope)||!allowPaused&&state.last_native_state?.paused!==false)throw Error('持续探索缺少同世界运行中的真实原生回读');
    const refs=state.routine_gate?.exploration_protected_fleets;
    if(!Array.isArray(refs)||refs.some(n=>!Number.isSafeInteger(n)||n<0||n>=0xffffffff))throw Error('探索舰队保护列表不可读');
    return state;
  }
  async setExplorationProtection({fleetId,enabled,generation=this.generation}={}){
    if(!Number.isSafeInteger(fleetId)||fleetId<0||fleetId>=0xffffffff||typeof enabled!=='boolean')throw Error('逐舰探索保护需要完整舰队引用和明确开关');
    const before=await this.explorationState(generation,{allowPaused:!enabled}),refs=before.routine_gate.exploration_protected_fleets;
    const added=enabled&&!refs.includes(fleetId),expected=[...new Set(enabled?[...refs,fleetId]:refs.filter(n=>n!==fleetId))].sort((a,b)=>a-b);
    if(!added&&enabled||!enabled&&!refs.includes(fleetId))return {confirmed:true,added:false,generation};
    const result=await this.call('country_ai_lease',{action:'update_exploration_protection',generation,fleet_id:fleetId,protected:enabled,expected_protected_targets:before.routine_gate.protected_targets});
    if(result?.success!==true||result.phase!=='running'||this.cancelRequested||!this.active||result.generation!==generation||!same(scope(result.last_native_state),this.saved?.scope)||!same([...(result.routine_gate?.exploration_protected_fleets??[])].sort((a,b)=>a-b),expected))throw Error(result?.error||'探索逐舰保护未真实回读确认');
    const previous=normalizeCountryAIProtection(before.routine_gate.protected_targets),actual=normalizeCountryAIProtection(result.routine_gate?.protected_targets);
    if(['jobs','colonies','shipyards'].some(key=>!same(previous[key],actual[key]))||(this.saved?.protectedTargets?.fleets??[]).some(ref=>!actual.fleets?.includes(ref)))throw Error('原有关键目标保护发生变化，停止探索');
    this.last=result;return {confirmed:true,added,generation};
  }
  async moveExplorationFleet({fleetId,systemId,fromSystemId,requestId,generation=this.generation}={}){
    if([fleetId,systemId,fromSystemId].some(n=>!Number.isSafeInteger(n)||n<0||n>=0xffffffff))throw Object.assign(Error('探索移动缺少完整舰队/星系引用'),{nativeWriteAttempted:false});
    if(typeof requestId!=='string'||!requestId||requestId.length>128)throw Object.assign(Error('探索移动缺少唯一请求编号'),{nativeWriteAttempted:false});
    const before=await this.explorationState(generation);
    if(!before.routine_gate.exploration_protected_fleets.includes(fleetId))throw Object.assign(Error('当前舰队未取得探索保护'),{nativeWriteAttempted:false});
    const result=await this.call('country_ai_lease',{action:'owner_exploration_move',generation,fleet_id:fleetId,system_id:systemId,expected_from_system_id:fromSystemId,request_id:requestId});
    if(result?.generation!==generation||!same(scope(result?.last_native_state),this.saved?.scope))throw Error('探索移动派发后世界或委派回读不符，结果未知且不重发');
    if(result?.success===true)this.last=result;
    return result;
  }
  async acknowledgeReview(){
    if(!this.active||this.generation===undefined)throw Error('没有可继续的国家 AI 委派');
    const result=await this.call('country_ai_lease',{action:'acknowledge_review',generation:this.generation});
    if(result?.success!==true)throw Error(result?.error||'国家 AI 复查确认失败');this.last=result;return this.view();
  }
}
