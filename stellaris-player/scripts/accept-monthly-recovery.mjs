// Bounded paused-only integration: abandon a controller process after durable
// registration, then explicitly recover that old request. No desktop/model/load.
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
const seed=process.argv.includes('--seed');
const resume=process.argv.find(x=>x.startsWith('--resume='))?.slice(9);
const directory=seed?resolve(process.argv[3]):resume?resolve(resume):resolve('.local/monthly-recovery-acceptance-'+Date.now());
const metadata=resolve(directory,'abandoned-session.json');
const tuple=o=>JSON.stringify([o.order_id,o.resource,o.action,o.amount,o.price_limit??o.max_unit_price]);
if(seed){
 const game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});
 await game.start({keepPaused:true});const before=await game.monthlySnapshot();
 assert.equal(before.status.is_paused,true);
 assert.equal(before.market.monthly_trades.some(o=>o.resource==='minerals'||o.resource==='food'),false,'测试槽被占用，不覆盖既有订单');
 assert.equal((await game.rpc('set_monthly_trade',{resource:'minerals',action:'sell',amount:1,price_limit:0})).success,true);
 const manual=await game.monthlySnapshot(),sentinel=manual.market.monthly_trades.find(o=>o.resource==='minerals'&&o.action==='sell'&&o.amount===1);
 assert.ok(sentinel);await writeFile(metadata,JSON.stringify({before,sentinel},null,2));
 await game.observe();const owned=await game.monthlyTrade({operation:'execute',requestId:'abandoned-food-order',snapshotId:game.snapshotId,change:{operation:'set',resource:'food',action:'buy',amount:1,priceLimit:4}});
 assert.equal(owned.status,'order_registered');
 const data={before,sentinel,owned,previousSessionId:game.sessionId,requestId:'abandoned-food-order',controllerPid:process.pid,binding:game.binding};
 await writeFile(metadata,JSON.stringify(data,null,2));await game.log({type:'test_controller_abandoned_after_durable_order',requestId:data.requestId});
 game.pipe.close();
 // Deliberately bypass cooperative cleanup in this child only. Game remains paused.
 await new Promise(done=>process.stdout.write(JSON.stringify({seeded:true,metadata})+'\n',done));process.exit(0);
}else{
 await mkdir(directory,{recursive:true});let game,data,sentinelCancelAttempted=false;
 if(resume)try{await copyFile(resolve(directory,'report.json'),resolve(directory,'report-prior-'+Date.now()+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const report={startedAt:new Date().toISOString(),gameTimeAdvanced:false,manualLoads:0,realModelCalls:0};
 const cleanupSentinel=async()=>{
  if(sentinelCancelAttempted||!data?.sentinel||!game||game.stopped)return;
  const snapshot=await game.monthlySnapshot(),current=snapshot.market.monthly_trades.find(o=>o.order_id===data.sentinel.order_id);
  if(!current)return;
  assert.equal(tuple(current),tuple(data.sentinel),'哨兵订单已变更，不能擅自撤销');
  sentinelCancelAttempted=true;assert.equal((await game.rpc('set_monthly_trade',{order_id:current.order_id,cancel:true})).success,true);
  assert.equal((await game.monthlySnapshot()).market.monthly_trades.some(o=>o.order_id===current.order_id),false);
 };
 try{
  await ensureNativeGame({directory});
  let code=0;
  if(!resume){const env={...process.env,DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''},chunks=[];
  code=await new Promise((done,fail)=>{
   const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--seed',directory],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   child.on('error',fail);child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>chunks.push(c));child.on('close',done);
  });await writeFile(resolve(directory,'seed.log'),Buffer.concat(chunks));}
  data=JSON.parse(await readFile(metadata,'utf8'));assert.equal(code,0,'子控制器准备失败；保留暂停与已知意图');assert.ok(data.previousSessionId);
  report.abandoned=data;
  game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});await game.start({keepPaused:true});
  if(resume){
   const current=await game.monthlySnapshot();
   if(!current.market.monthly_trades.some(o=>tuple(o)===tuple(data.sentinel))){
    assert.equal(current.market.monthly_trades.some(o=>o.resource==='minerals'),false,'不覆盖现有矿物月度单');
    assert.equal((await game.rpc('set_monthly_trade',{resource:'minerals',action:'sell',amount:1,price_limit:0})).success,true);
    data.sentinel=(await game.monthlySnapshot()).market.monthly_trades.find(o=>o.resource==='minerals'&&o.action==='sell'&&o.amount===1);assert.ok(data.sentinel);await writeFile(metadata,JSON.stringify(data,null,2));report.sentinelRecreatedAfterHarnessAssertion=true;
   }
  }
  report.beforeRecovery=await game.monthlySnapshot();assert.equal(report.beforeRecovery.scope.gameDate,data.before.scope.gameDate);
  const inspection=await game.monthlyTrade({operation:'inspect'});report.inspection=inspection;
  assert.ok(inspection.recovery.records.some(r=>r.requestId===data.requestId));
  report.recovery=await game.monthlyTrade({operation:'recover',previousSessionId:data.previousSessionId,requestId:data.requestId,snapshotId:game.snapshotId});
  assert.equal(report.recovery.confirmed,true);assert.equal(report.recovery.controlReleased,true);assert.equal(report.recovery.automaticResume,false);
  report.afterRecovery=await game.monthlySnapshot();
  assert.equal(report.afterRecovery.market.monthly_trades.some(o=>o.order_id===data.owned.orderId),false);
  assert.ok(report.afterRecovery.market.monthly_trades.some(o=>tuple(o)===tuple(data.sentinel)),'收回旧请求不能撤销未归属订单');
  assert.equal(report.afterRecovery.scope.gameDate,data.before.scope.gameDate);
  await cleanupSentinel();report.afterCleanup=await game.monthlySnapshot();
  assert.deepEqual(report.afterCleanup.market.monthly_trades.map(tuple).sort(),data.before.market.monthly_trades.map(tuple).sort());
  await game.stop();report.cleanup=game.cleanup;assert.equal(report.cleanup.pauseConfirmed,true);assert.equal(report.cleanup.monthlyTrade.confirmed,true);report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{
  if(!data)try{data=JSON.parse(await readFile(metadata,'utf8'));}catch{}
  if(game&&!game.stopped){try{await cleanupSentinel();}catch(error){report.sentinelCleanupError=error.stack;}await game.stop();}
  report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));
 }
}
