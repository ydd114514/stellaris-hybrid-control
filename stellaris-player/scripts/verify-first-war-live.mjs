// Exercise the production executor against the war already selected/configured
// by the controller. No target selection, console command or replacement orders.
import {mkdir,writeFile,appendFile,stat,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {recoveryPurchasePlan} from '../src/market-maintenance.mjs';
const minutes=Number(process.argv[2]||10);
if(!Number.isFinite(minutes)||minutes<=0||minutes>20)throw Error('实机验证时长需要0..20分钟');
const started=Date.now(),directory=resolve('.local/gestalt-live','executor-'+started);
await mkdir(directory,{recursive:true});
const game=new NativeGame({minutes});let reason='deadline',last='';
const evidence=async()=>{
 const s=game.lastState,c=game.gestalt.data.campaign;
 const row={at:Date.now(),date:s?.date,paused:s?.paused,campaign:c,metrics:game.metrics};
 await writeFile(join(directory,'latest.json'),JSON.stringify(row,null,2));
 const signature=JSON.stringify([s?.date,c?.phase,c?.status,c?.nextCheck]);
 if(signature!==last){last=signature;await appendFile(join(directory,'progress.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify({date:s?.date,phase:c?.phase,status:c?.status,nextCheck:c?.nextCheck,orders:game.metrics.orders}));}
};
try{
 await game.start();
 if(process.argv.includes('--replacement'))await game.campaign({operation:'revise',...JSON.parse(await readFile('.local/gestalt-live/current/replacement.json','utf8'))});
 if(process.argv.includes('--retry-previous')){
  const previous=game.gestalt.data.campaign;
  if(previous?.phase!=='terminated'||previous.result?.warEnded!==true)throw Error('只可在已结束、已核对的失利战役后重试同一AI目标');
  const year=Number(game.lastState.date.slice(0,4));
  await game.campaign({operation:'select',target:previous.target,reason:previous.reason+'；保留AI已选目标，在用户授权的独立条件下复测失败接口',reviewDate:`${year+4}.01.01`});
  await game.campaign({operation:'start',...previous.execution,finishDate:`${year+8}.01.01`});
 }
 if(!game.gestalt.data.campaign?.enabled)throw Error('没有由现有控制器配置的活动战役；验证器不会代选敌或创建战役');
 const acknowledge=async()=>{
  const events=await game.rpc('get_active_events');
  if(!Array.isArray(events)||!events.length)return true;
  for(const e of events){
   if(e.event_key==='galcom.2'){
    const decline=e.options?.find(o=>o.index===1&&o.is_valid===true);if(!decline)return false;
    const r=await game.apply({requestId:'decline-community-'+Date.now(),snapshotId:game.snapshotId,orders:[{command:'resolve_event',arguments:{window_id:e.window_id,option_index:1}}],explanation:'我先专注眼前的战争，暂不参加共同体。'});if(r.orders[0]?.status!=='posted')return false;continue;
   }
   if(e.kind==='first_contact_information'){
    const r=await game.apply({requestId:'close-contact-info-'+Date.now(),snapshotId:game.snapshotId,orders:[{command:'resolve_event',arguments:{window_id:e.window_id,option_index:0}}],explanation:'我关闭已经读完的信息面板，继续当前任务。'});if(r.orders[0]?.status!=='posted')return false;continue;
   }
   // A notification with exactly one valid displayed option has no strategic
   // branch to invent; persist its normal engine response. Multi-choice events
   // other than the explicit test policy above still stop for a real decision.
   if(e.options?.length!==1||e.options[0].is_valid!==true)return false;
   const r=await game.apply({requestId:'war-notification-'+e.window_id+'-'+Date.now(),snapshotId:game.snapshotId,orders:[{command:'resolve_event',arguments:{window_id:e.window_id,option_index:e.options[0].index}}],explanation:'我确认当前通知，继续核对战役实际进展。'});if(r.orders[0]?.status!=='posted')return false;
  }
  return true;
 };
 if(!await acknowledge())throw Error('有需模型判断的事件，验证器不代选');
 if(process.argv.includes('--recovery-topup')){
  if(game.gestalt.data.campaign.phase!=='recover')throw Error('补充恢复交易仅用于战后恢复');
  // Explicit local test-operator budget revision after debugging exhausted the
  // automated purchase limit. Paid normal trades, maximum two, no console grant.
  for(let n=0;n<2;n++){
   const plan=recoveryPurchasePlan(game.lastState.resources,game.gestalt.data.campaign.execution.resourceFloors,await game.rpc('get_market'));
   if(!plan.order)break;
   const r=await game.apply({requestId:'recovery-replan-'+started+'-'+n,snapshotId:game.snapshotId,orders:[plan.order],explanation:'我用正常市场补充恢复预算，继续核对补员和回港。'});
   if(r.orders[0]?.verification?.verified!==true)throw Error('恢复预算交易未确认，不能继续声称资源已补足');
  }
 }
 await game.apply({requestId:'live-test-speed-'+started,snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:4}}],explanation:'我加快测试局时间，继续核对首战实际结果。'});
 while(Date.now()-started<minutes*60000){
  try{if((await stat('.local/STOP')).mtimeMs>=started){reason='operator_stop';break;}}catch{}
  await game.watch(20);await evidence();
  const c=game.gestalt.data.campaign;
  if(['completed','terminated'].includes(c.phase)){reason=c.phase;break;}
  if(game.lastState.pendingEvents?.length||game.lastState.warGoalsWindow){if(await acknowledge())continue;reason='decision_required';break;}
 }
}catch(error){reason='error: '+error.message;console.error(reason);process.exitCode=1;}
finally{
 await game.stop();await evidence();
 await writeFile(join(directory,'report.json'),JSON.stringify({started,ended:Date.now(),reason,cleanup:game.cleanup,campaign:game.gestalt.data.campaign,modelCalls:0},null,2));
 console.log(JSON.stringify({directory,reason,cleanup:game.cleanup}));
}
