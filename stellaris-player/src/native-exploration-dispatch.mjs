import {checkEconomicExploration,userEconomicOrderAllowed} from './user-economic-intervention.mjs';

const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
const generationId=n=>Number.isSafeInteger(n)&&n>=0;
const clip=value=>String(value??'').replace(/[\r\n]/g,' ').slice(0,300);
const reject=message=>{throw Object.assign(Error(message),{rejected:true,nativeWriteAttempted:false});};
const reads=new Set(['get_wars','get_fleet_tactics','get_system','find_path']);

/** The sole native-running owner exploration write boundary. No human-only
 * apply(), pause, global AI toggle or ordinary move_fleet RPC is used here.
 * state may be a function so policy withdrawal is rechecked after async reads.
 * assertScope must enforce current binding, STOP and command-session fences.
 * journal({phase:'prepared',...}) MUST be durable and reject duplicate/unknown
 * native intents; it may return {duplicate:true,trackingId} to refuse replay.
 * move uses the dedicated native lease exploration action, never a raw move.
 * register takes OrderTracker.register's normal input and returns its row.
 */
export async function dispatchNativeExploration({order,proof:selectionProof,requestId,binding,generation,state,readControl,assertScope,rpc,move,register,journal,captureBaseline}={}){
 let attempted=false,moveReturned=false,baseline,proof,current,canonical,wire,minimumIntel=0;
 const getState=async()=>typeof state==='function'?await state():state;
 const validateControl=async()=>{
  await assertScope({binding,generation,order:canonical});
  const control=await readControl();
  if(control?.binding!==binding||control.owner!=='native'||control.phase!=='running'||control.generation!==generation||control.protectionSupported!==true||
   !Array.isArray(control.protectedFleetIds)||!control.protectedFleetIds.includes(canonical.arguments.fleet_id))reject('本轮原生委派、代次或单舰探索保护未确认');
  minimumIntel=Number.isInteger(control.explorationMinimumIntel)&&control.explorationMinimumIntel>0?control.explorationMinimumIntel:0;
  current=await getState();if(!userEconomicOrderAllowed(canonical,current))reject('当前本人持续探索授权已撤回');
 };
 const event=(phase,extra={})=>({phase,requestId,binding,generation,order:canonical,proof,nativeWriteAttempted:attempted,...extra});
 const record=async(accepted)=>{
  const tracking=await register({requestId,order:canonical,response:accepted?{success:true}:{},verification:{verified:false,phase:accepted?'native_exploration_posted':'native_exploration_unknown'},beforeState:current,baseline});
  return typeof tracking?.id==='string'&&tracking.id?tracking.id:null;
 };
 try{
  const args=order?.arguments;
  if(order?.command!=='move_fleet'||!args||!id(args.fleet_id)||!id(args.system_id)||args.queue===true||Object.keys(args).some(key=>!['fleet_id','system_id','queue'].includes(key)))reject('持续探索仅允许现有单舰非队列移动命令');
  if(typeof binding!=='string'||!binding||!generationId(generation)||typeof requestId!=='string'||!requestId||requestId.length>180)reject('持续探索派单缺少当前会话、代次或稳定请求编号');
  if([readControl,assertScope,rpc,move,register,journal,captureBaseline].some(fn=>typeof fn!=='function'))reject('原生探索保护、正常检查、持久化或跟踪能力不完整');
  canonical={command:'move_fleet',arguments:{fleet_id:args.fleet_id,system_id:args.system_id}};
  await validateControl();
  const cache=new Map(),read=async(method,params={})=>{
   if(!reads.has(method))reject('探索写前核查仅允许既有只读接口');
   const key=JSON.stringify([method,params]);if(!cache.has(key))cache.set(key,Promise.resolve(rpc(method,params)));return cache.get(key);
  };
  // Selection proof is advisory. Always obtain a new complete ownership,
  // war, actual fleet task, path and known-risk proof immediately before write.
  proof=await checkEconomicExploration(canonical,current,read);
  if(!Array.isArray(proof?.route)||proof.route.length!==2||!id(proof.route[0])||proof.route[0]===args.system_id||proof.route[1]!==args.system_id)reject('持续探索原生例外仅允许完整可核查的相邻单跳');
  const origin=await read('get_system',{system_id:proof.route[0]});
  if(origin?.id!==proof.route[0]||!Array.isArray(origin.hyperlanes)||!origin.hyperlanes.some(link=>link.to===args.system_id))reject('真实起点未确认到目标的直接超空间航道');
  if(minimumIntel){const target=await read('get_system',{system_id:args.system_id});if(!Number.isInteger(origin.intel)||origin.intel<minimumIntel||!Number.isInteger(target?.intel)||target.intel<minimumIntel)reject(`当前原生移动需要起点与目标情报至少${minimumIntel}级，未知前沿尚无安全移动能力`);}
  baseline=await captureBaseline(canonical);
  await validateControl();
  const prepared=await journal(event('prepared',{baseline,selectionProof}));
  if(prepared?.duplicate===true)return {accepted:false,status:'unknown',unknown:true,automaticRetryAllowed:false,nativeWriteAttempted:false,trackingId:prepared.trackingId??null,error:'该请求已有未决或未知意图，未重放'};
  if(prepared===false||prepared?.prepared===false)reject('写前持久化未确认，未派探索');
  // The dedicated adapter performs commandScope again and the native action
  // CAS-checks generation, protected fleet, idle task, origin and adjacency.
  await validateControl();attempted=true;
  wire=await move({fleetId:args.fleet_id,systemId:args.system_id,fromSystemId:proof.route[0],generation,requestId});moveReturned=true;
  const result=wire?.movement_result;
  const matching=result?.request_id===requestId&&result.fleet_id===args.fleet_id&&result.system_id===args.system_id;
  if(matching&&result.success===false&&result.accepted===false&&result.phase==='rejected'){
   await journal(event('rejected',{response:wire,error:clip(result.error)}));
   return {accepted:false,rejected:true,status:'rejected',nativeWriteAttempted:true,error:clip(result.error??'引擎明确拒绝探索命令'),proof};
  }
  if(!matching||result.success!==true||result.accepted!==true||result.phase!=='posted')throw Error('原生移动投递没有本请求的明确 posted 回执');
  await validateControl();
  const trackingId=await record(true);
  if(!trackingId)throw Error('原生移动已投递但正常订单跟踪号缺失');
  await journal(event('posted',{response:wire,trackingId}));
  return {accepted:true,status:'posted',nativeWriteAttempted:true,trackingId,proof,response:wire};
 }catch(error){
  if(!attempted||!moveReturned&&error.nativeWriteAttempted===false){
   if(canonical&&typeof journal==='function')try{await journal(event('rejected',{error:clip(error.message),nativeWriteAttempted:false}));}catch{}
   return {accepted:false,rejected:true,status:'rejected',nativeWriteAttempted:false,error:clip(error.message)};
  }
  let trackingId=null;try{trackingId=await record(false);}catch{}
  if(typeof journal==='function')try{await journal(event('unknown',{response:wire,trackingId,error:clip(error.message)}));}catch{}
  return {accepted:false,status:'unknown',unknown:true,automaticRetryAllowed:false,nativeWriteAttempted:true,trackingId,error:clip(error.message),proof};
 }
}
