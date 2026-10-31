import {COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,COUNTRY_AI_ECONOMY_FEATURES,COUNTRY_AI_POLICIES,normalizeCountryAIProtection} from './native-country-ai-economic-policy.mjs';
export const COUNTRY_AI_P1_BRIDGE_VERSION='cyberfish-0.6.16-country-ai-p1-r2';
export const COUNTRY_AI_P1_FEATURES=['country_ai_own_session_post_gate','country_ai_command_clone_lifetime','country_ai_native_queue_gate','country_ai_game_update_lease','country_ai_world_generation','country_ai_serialized_execution_receipts'];
const off=s=>s?.global_flags?.human_ai===false&&s?.global_flags?.force_human_ai===false;
const stopped=s=>s?.phase==='stopped'&&s.last_native_state?.paused===true&&off(s.last_native_state)&&s.routine_gate?.armed===false&&s.observation?.armed===false;
export const nativeCountryScope=s=>Object.fromEntries(Object.entries(s?.precondition||{}).filter(([k])=>!['date','sequence','global_flags'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
const scope=nativeCountryScope;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Uses the host's existing SerialWork idle/watch supervision. No routine order
 * selection occurs here. Native lease expiry protects a vanished/blocked host.
 */
export class NativeCountryAI {
  constructor({rpc,assertBinding,setDispatchFence,record=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),polls=60,allowEconomyCandidate=false}={}) {
    if([rpc,assertBinding,setDispatchFence].some(f=>typeof f!=='function'))throw Error('国家 AI 需要原会话检查和真实派单封口');
    if(!Number.isSafeInteger(polls)||polls<1||polls>100)throw Error('国家 AI 回读次数无效');
    Object.assign(this,{rpc,assertBinding,setDispatchFence,record,wait,polls});this.allowEconomyCandidate=allowEconomyCandidate===true;this.phase='human';this.active=false;
  }
  async call(method,params={}) {await this.assertBinding();return this.rpc(method,params);}
  async journal(event,{required=false}={}) {
    try{await this.record(event);}catch(error){this.evidenceIncomplete=true;if(required)throw error;}
  }
  async capabilities() {
    if(this.capabilityVerified)return;
    const ping=await this.call('ping');
    const economy=this.allowEconomyCandidate&&ping?.bridge_version===COUNTRY_AI_ECONOMY_CANDIDATE_VERSION&&COUNTRY_AI_ECONOMY_FEATURES.every(f=>ping.features?.includes(f));
    if((ping?.bridge_version!==COUNTRY_AI_P1_BRIDGE_VERSION&&!economy)||COUNTRY_AI_P1_FEATURES.some(f=>!ping.features?.includes(f)))
      throw Error('当前桥不具备国家 AI 提交限制、失联收权和世界代次接口');
    this.economyCapable=economy;
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
      supportedPolicies:this.capabilityVerified?Object.keys(COUNTRY_AI_POLICIES).filter(p=>this.economyCapable||!p.startsWith('economy')):[],
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
  async delegate({policy='research_and_planet_construction',maxGameDays=30,maxWallMs=120000,stopAtReview=false,protectedTargets={}}={}) {
    if(this.operation||this.active)throw Error('先完成当前国家 AI 接管，不覆盖已有控制权');
    if(!Object.hasOwn(COUNTRY_AI_POLICIES,policy)||(!this.allowEconomyCandidate&&policy.startsWith('economy'))||!Number.isInteger(maxGameDays)||maxGameDays<1||maxGameDays>720||!Number.isSafeInteger(maxWallMs)||maxWallMs<1000||maxWallMs>3600000)
      throw Error('国家 AI 试点范围或复查上限无效');
    const protection=normalizeCountryAIProtection(protectedTargets);
    if(!this.allowEconomyCandidate&&Object.values(protection).some(refs=>refs.length))throw Error('当前桥尚未开放经济目标保护');
    this.active=true;this.phase='preparing';this.cancelRequested=false;this.setDispatchFence(true);
    const work=this.performDelegate({policy,maxGameDays,maxWallMs,stopAtReview,protectedTargets:protection});this.operation=work;
    try{return await work;}finally{this.operation=undefined;}
  }
  async performDelegate(options) {
    try {
      await this.capabilities();
      if(!this.economyCapable&&(options.policy.startsWith('economy')||Object.values(options.protectedTargets).some(refs=>refs.length)))throw Error('实际加载桥未确认经济范围与保护能力');
      const before=await this.call('get_country_ai_state');
      if(before?.success!==true||before.paused!==true||before.single_local_human_guard!==true||!off(before))
        throw Error('委派前必须确认暂停、本国身份及原生国家 AI 关闭');
      this.saved={...options,scope:scope(before)};
      await this.journal({type:'country_ai_delegate_intent',policy:options.policy,before},{required:true});
      const prepared=await this.call('country_ai_lease',{action:'prepare',expected:before.precondition,policy:options.policy,max_game_days:options.maxGameDays,max_wall_ms:options.maxWallMs,stop_at_review:options.stopAtReview,
        ...(this.economyCapable?{protected_targets:options.protectedTargets}:{})});
      if(prepared?.success!==true||prepared.phase!=='prepared'||!Number.isSafeInteger(prepared.generation))throw Error(prepared?.error||'国家 AI 未准备好');
      this.generation=prepared.generation;this.last=prepared;
      await this.journal({type:'country_ai_lease_acquired',generation:this.generation,scope:this.saved.scope},{required:true});
      if(this.economyCapable){
        const protectedReadback=normalizeCountryAIProtection(prepared.routine_gate?.protected_targets??null);
        if(!same(protectedReadback,options.protectedTargets)||
          (options.policy.startsWith('economy')&&prepared.routine_gate?.economic_administration_allowed!==true)||
          (options.policy==='economy_and_ship_production'&&prepared.routine_gate?.ship_production_allowed!==true))
          throw Error('经济范围或关键目标保护未真实回读，不开启国家 AI');
        this.saved.protectionStatus='native_arm_confirmed';
      }
      if(this.cancelRequested)throw Error('国家 AI 委派已取消');
      const enabled=await this.call('country_ai_lease',{action:'enable',generation:this.generation});
      if(enabled?.success!==true)throw Error(enabled?.error||'国家 AI 开启结果未知');
      await this.poll(s=>s.phase==='ready_paused');
      const running=await this.call('country_ai_lease',{action:'run',generation:this.generation,limited_domain_pilot:true});
      if(running?.success!==true)throw Error(running?.error||'国家 AI 未获准持续运行');
      await this.poll(s=>s.phase==='running'&&s.last_native_state?.paused===false||stopped(s)&&s.run_confirmed===true);
      this.phase=this.active?'native':'human';await this.journal({type:'country_ai_delegate_confirmed',view:this.view()});return this.view();
    } catch(error) {
      this.phase=this.active?'unconfirmed':'human';await this.journal({type:'country_ai_delegate_failed',message:error.message});
      if(this.generation!==undefined)try {await this.stopNative();}catch(cleanup){error.countryAICleanupError=cleanup.message;}
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
    if(!this.allowEconomyCandidate||this.active||!this.saved||this.phase!=='human'||!Number.isSafeInteger(this.takeoverGeneration))
      throw Error('经济保护需要候选能力及本轮实际接管完成');
    if(typeof reason!=='string'||!reason.trim()||reason.trim().length>500)throw Error('关键保护需要1..500字的战略理由');
    if(protectedTargets===undefined)throw Error('必须明确给出保护目标；清空保护也需要显式对象及理由');
    const protection=normalizeCountryAIProtection(protectedTargets);
    const actual=await this.state();
    if(!this.economyCapable||!stopped(actual)||actual.generation!==this.takeoverGeneration||
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
  async acknowledgeReview(){
    if(!this.active||this.generation===undefined)throw Error('没有可继续的国家 AI 委派');
    const result=await this.call('country_ai_lease',{action:'acknowledge_review',generation:this.generation});
    if(result?.success!==true)throw Error(result?.error||'国家 AI 复查确认失败');this.last=result;return this.view();
  }
}
