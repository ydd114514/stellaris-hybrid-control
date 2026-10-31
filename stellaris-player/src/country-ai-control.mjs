export const COUNTRY_AI_BRIDGE_VERSION='cyberfish-0.6.15-country-ai-p0-r2';
export const COUNTRY_AI_FEATURE='country_ai_paused_research_candidate';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pair=s=>({human_ai:s.global_flags.human_ai,force_human_ai:s.global_flags.force_human_ai});

/** P0 paused research adapter. This does not delegate or unpause an empire.
 * assertBinding must verify process creation identity and the caller's world binding;
 * the bridge adds a fresh paused snapshot CAS and exact local-player checks.
 */
export class CountryAIControl {
  constructor({rpc,assertBinding,record=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),polls=20}={}) {
    if(typeof rpc!=='function'||typeof assertBinding!=='function')throw Error('国家 AI 需要 RPC 和原会话身份检查');
    if(!Number.isInteger(polls)||polls<1||polls>100)throw Error('无效的状态回读上限');
    Object.assign(this,{rpc,assertBinding,record,wait,polls});this.phase='unbound';this.original=null;
  }
  async call(method,params={}) {await this.assertBinding();return this.rpc(method,params);}
  async status() {
    const ping=await this.call('ping');
    if(ping?.bridge_version!==COUNTRY_AI_BRIDGE_VERSION||!ping.features?.includes(COUNTRY_AI_FEATURE))
      throw Error('当前桥没有经过核实的国家 AI 暂停试验接口');
    const state=await this.call('get_country_ai_state');
    if(state?.success!==true)throw Error(state?.error||'国家 AI 状态不可读');
    return state;
  }
  async exclusive(fn) {
    if(this.busy)throw Error('国家 AI 交接正在进行');
    this.busy=true;try{return await fn();}finally{this.busy=false;}
  }
  async confirm(desired,post) {
    let state;
    for(let i=0;i<this.polls;i++) {
      state=await this.status();
      if(!state.paused||!state.single_local_human_guard)break;
      const receipt=post.phase==='already_observed'||(
        state.pending?.sequence===post.pending?.sequence&&state.pending?.phase==='readback_confirmed'&&
        state.pending?.execute_receipts===3&&state.pending?.identity_matches===true);
      if(receipt&&same(pair(state),desired)) {
        this.phase='paused_confirmed';
        await this.record({type:'country_ai_flags_confirmed',desired,state});
        return {phase:'paused_confirmed',state};
      }
      if(i+1<this.polls)await this.wait(50);
    }
    this.phase='unconfirmed';
    await this.record({type:'country_ai_flags_unconfirmed',desired,state,post});
    return {phase:'unconfirmed',state,post};
  }
  async setFrom(state,desired,{restore=false}={}) {
    if(!state.paused||!state.single_local_human_guard||!state.country_coverage_complete)
      throw Error('国家 AI 试验只允许暂停、完整本国身份和唯一人类国家');
    if(typeof desired.human_ai!=='boolean'||typeof desired.force_human_ai!=='boolean')throw Error('必须明确设置两个 AI 布尔值');
    // Persist the intention before a potentially ambiguous post. Recheck binding
    // after persistence; native snapshot CAS catches changed flags/world details.
    this.phase='posting';
    await this.record({type:'country_ai_flags_intent',original:this.original,desired,expected:state.precondition});
    let post;
    try {post=await this.call('set_country_ai_state',{...desired,expected:state.precondition,...(restore?{restore_previous:true}:{})});}
    catch(error){this.phase='unconfirmed';await this.record({type:'country_ai_post_unknown',message:error.message});throw error;}
    if(post?.success!==true&&!post?.pending){this.phase='rejected';throw Error(post?.error||'国家 AI 设置被拒绝');}
    return this.confirm(desired,post);
  }
  async setPausedResearchFlags(desired) {
    return this.exclusive(async()=>{
      if(this.original)throw Error('先恢复本轮原设置，不覆盖原设置记录');
      const state=await this.status();
      this.original={flags:pair(state),precondition:structuredClone(state.precondition)};
      return this.setFrom(state,desired);
    });
  }
  async restorePausedResearchFlags() {
    return this.exclusive(async()=>{
      if(!this.original)throw Error('没有本轮原设置，不能猜测恢复值');
      const state=await this.status();
      // Native snapshot is deliberately NOT a durable save identity. The caller
      // must retain its process/world binding and restore in the same paused date.
      const before={...this.original.precondition},now={...state.precondition};
      for(const key of ['sequence','global_flags']) {delete before[key];delete now[key];}
      if(!same(before,now))throw Error('国家 AI 原会话或暂停起点已改变，不恢复旧权限');
      const result=await this.setFrom(state,this.original.flags,{restore:true});
      if(result.phase==='paused_confirmed') {this.original=null;this.phase='restored';return {...result,phase:'restored'};}
      return result;
    });
  }
  delegate(){throw Error('持续国家 AI 托管尚未验收：重大决定边界与自主工作来源未完成');}
}
