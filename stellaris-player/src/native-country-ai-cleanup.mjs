import {nativeCountryScope} from './native-country-ai.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function assertNativeCountryScope(state,expected){
 if(state?.success!==true||state.world_generation_tracking!==true||state.single_local_human_guard!==true||
  !expected||!Number.isSafeInteger(expected.world_generation)||!same(nativeCountryScope(state),expected))
  throw Error('国家 AI 清理的世界代次或本国身份改变');
}
// Stop only a durably recorded native lease. Never enable or resume anything.
export async function cleanupNativeCountryAI({rpc,expectedScope,expectedGeneration,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=60}){
 const read=async()=>{
  const state=await rpc('get_country_ai_state');assertNativeCountryScope(state,expectedScope);
  if(state.paused!==true)throw Error('国家 AI 清理尚未确认暂停');
  const lease=await rpc('country_ai_lease',{action:'status'});
  if(lease?.success!==true)throw Error('国家 AI 清理状态不可读');
  return {state,lease};
 };
 const closed=({state,lease})=>state.global_flags?.human_ai===false&&state.global_flags?.force_human_ai===false&&
  (lease.phase==='idle'&&lease.routine_gate?.armed!==true&&lease.observation?.armed!==true||
   lease.phase==='stopped'&&lease.routine_gate?.armed===false&&lease.observation?.armed===false&&lease.observation?.commands_drained===true);
 const result=({state,lease})=>({confirmed:true,phase:'human',owner:'human',ordinaryOrdersBlocked:false,paused:true,
  nativePhase:lease.phase,actualFlags:state.global_flags,generation:null,stopReason:lease.stop_reason??null});
 let observed=await read();if(closed(observed))return result(observed);
 if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration!==observed.lease.generation||
  !same(nativeCountryScope({precondition:observed.lease.baseline}),expectedScope))
  throw Error('缺少本轮已持久化国家 AI 代次，不猜测或收回其他委派');
 const request=await rpc('country_ai_lease',{action:'stop',generation:expectedGeneration});
 if(request?.success!==true)throw Error('国家 AI 关闭请求未确认，不重复发送');
 for(let i=0;i<attempts;i++){
  observed=await read();if(observed.lease.generation!==expectedGeneration)throw Error('国家 AI 清理期间委派代次改变');
  if(closed(observed))return result(observed);
  if(i+1<attempts)await wait(50);
 }
 throw Error('国家 AI 关闭、暂停或命令排空尚未确认');
}
