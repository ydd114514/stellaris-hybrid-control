import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {supervisorCleanup} from '../src/supervisor-cleanup.mjs';
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'fish-supervisor-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const binding={pid:12,creationTime:34},sessionId='test',file=join(directory,'gestalt-'+'a'.repeat(24)+'.json');
 const checkpoint={sessionId,started:100,binding,taskStateFile:file,state:{date:'2200.01.01',player:{country_id:0,capital_system_id:0}}};
 const state={version:1,identity:JSON.stringify([12,34,0,0]),surveyControl:{records:{0:{fleetId:0,sessionId,owner:'unknown',desired:true,pending:true}}}};
 await writeFile(file,JSON.stringify(state));await writeFile(join(directory,'latest-session.json'),JSON.stringify(checkpoint));
 let enabled=true;const calls=[];
 const rpc=async(m,p)=>{calls.push({m,p});
  if(m==='get_status')return {in_game:true,is_paused:true,date:{formatted:'2200.01.01'}};
  if(m==='get_galaxy_overview')return {player:{country_id:0,capital_system_id:0}};
  if(m==='get_fleet_automation')return {known:true,automation_enabled:enabled,order_chain_complete:true};
  if(m==='set_survey_automation'){const saved=JSON.parse(await readFile(file));assert.equal(saved.surveyControl.records[0].pending,true);enabled=false;}
  return {success:true};
 };
 return {directory,file,checkpoint,calls,rpc,identity:async()=>binding};
}
test('durable pending intent is found even if old checkpoint had no delegation state',async t=>{
 const f=await fixture(t);const r=await supervisorCleanup({...f,started:90});
 assert.equal(r.paused,true);assert.equal(r.survey[0].confirmed,true);
 assert.equal(JSON.parse(await readFile(f.file)).surveyControl.records[0].owner,'manual');
 const checkpoint=JSON.parse(await readFile(join(f.directory,'latest-session.json')));
 assert.equal(checkpoint.stopped,true);assert.equal(checkpoint.state.surveyControl.records[0].owner,'manual');
 assert.equal(f.calls.filter(x=>x.m==='set_survey_automation').length,1);
 assert.equal(r.worldLineageVerified,false);
});
test('a replaced process is never given old fleet cleanup commands',async t=>{
 const f=await fixture(t);const r=await supervisorCleanup({...f,started:90,identity:async()=>({pid:99,creationTime:34})});
 assert.match(r.error,/绑定改变/);assert.equal(f.calls.some(x=>x.m==='set_survey_automation'),false);
});

async function nativeFixture(t){
 const f=await fixture(t),scope={country_id:0,world_generation:0};let on=true;
 f.checkpoint.countryAIControl={enabled:true,generation:1,worldScope:scope};
 f.checkpoint.state.nativeWorldGeneration=0;
 await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const state=JSON.parse(await readFile(f.file));state.identity=JSON.stringify([12,34,0,0,0]);await writeFile(f.file,JSON.stringify(state));
 const old=f.rpc;
 f.rpc=async(m,p,context)=>{
  if(m==='get_country_ai_state')return {success:true,world_generation_tracking:true,single_local_human_guard:true,paused:true,
   precondition:scope,global_flags:{human_ai:on,force_human_ai:on}};
  if(m==='country_ai_lease'){
   f.calls.push({m,p,context});
   if(p.action==='stop'){
    assert.equal(p._expected_world_generation,0);assert.equal(p._expected_game_pid,12);assert.equal(p._expected_game_creation,34);
    assert.equal(context.supervisorCleanup,true);on=false;
   }
   return {success:true,phase:on?'running':'stopped',generation:1,baseline:scope,
    routine_gate:{armed:on},observation:{armed:on,commands_drained:true}};
  }
  return old(m,p,context);
 };
 return f;
}
test('native world zero survives durable identity checks and host exit stops the owned lease once',async t=>{
 const f=await nativeFixture(t);const r=await supervisorCleanup({...f,started:90});
 assert.equal(r.countryAI.confirmed,true);assert.equal(r.worldLineageVerified,true);assert.equal(r.paused,true);
 assert.equal(f.calls.filter(c=>c.m==='country_ai_lease'&&c.p.action==='stop').length,1);
 const cp=JSON.parse(await readFile(join(f.directory,'latest-session.json')));
 assert.equal(cp.countryAIControl.owner,'human');assert.equal(cp.state.countryAIControl.ordinaryOrdersBlocked,false);
});
test('missing durable native generation is unknown and never targets a guessed lease',async t=>{
 const f=await nativeFixture(t);delete f.checkpoint.countryAIControl.generation;
 await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const r=await supervisorCleanup({...f,started:90});assert.equal(r.countryAI.confirmed,false);assert.match(r.error,/持久化/);
 assert.equal(f.calls.some(c=>c.m==='country_ai_lease'&&c.p.action==='stop'),false);
});
test('another controller lock blocks even the initial supervisor pause',async t=>{
 const f=await fixture(t);await writeFile(join(f.directory,'controller.lock'),JSON.stringify({sessionId:'other'}));
 const r=await supervisorCleanup({...f,started:90});assert.match(r.error,/其他控制器/);
 assert.equal(f.calls.some(c=>c.m==='set_paused'||c.m==='set_survey_automation'),false);
});
test('checkpoint path cannot escape the controller directory',async t=>{
 const f=await fixture(t);f.checkpoint.taskStateFile=join(f.directory,'..','other.json');
 await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const r=await supervisorCleanup({...f,started:90});assert.match(r.error,/路径/);assert.equal(f.calls.some(x=>x.m==='set_survey_automation'),false);
});
test('timeout remains unknown and is not blindly replayed',async t=>{
 const f=await fixture(t);let writes=0;
 const rpc=async(m,p)=>{if(m==='set_survey_automation'){writes++;throw Error('timeout');}return f.rpc(m,p);};
 const r=await supervisorCleanup({...f,rpc,started:90});assert.equal(r.survey[0].confirmed,false);assert.equal(writes,1);
 assert.equal(JSON.parse(await readFile(f.file)).surveyControl.records[0].owner,'unknown');
});
test('supervisor cannot turn an empty read into proof that an unknown enable will never arrive',async t=>{
 const f=await fixture(t);let writes=0;
 const rpc=async(m,p)=>{if(m==='get_fleet_automation')return {known:true,automation_enabled:false,order_chain_complete:true};if(m==='set_survey_automation')writes++;return f.rpc(m,p);};
 const first=await supervisorCleanup({...f,rpc,started:90});assert.equal(first.survey[0].confirmed,false);assert.equal(first.surveyStatus,'unknown');
 const second=await supervisorCleanup({...f,rpc,started:90});assert.equal(second.survey[0].confirmed,false);assert.equal(writes,0);
 assert.equal(JSON.parse(await readFile(f.file)).surveyControl.records[0].owner,'unknown');
});
test('idle pipe connection is released before independent identity inspection',async t=>{
 const f=await fixture(t);let released=false;
 const r=await supervisorCleanup({...f,started:90,release:()=>{released=true;},identity:async()=>{assert.equal(released,true);return f.identity();}});
 assert.equal(r.survey[0].confirmed,true);
});
test('a prior supervisor round cannot clean the new round records',async t=>{
 const f=await fixture(t);f.checkpoint.controllerRunId='other';await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const r=await supervisorCleanup({...f,started:90,runId:'expected'});assert.match(r.error,/代次/);
 assert.equal(f.calls.some(x=>x.m==='set_survey_automation'),false);
});

test('supervisor removes a recorded monthly order after child exit and preserves a user order',async t=>{
 const f=await fixture(t),state=JSON.parse(await readFile(f.file));
 state.monthlyTrades=[{sessionId:'test',requestId:'m',status:'order_registered',ownedOrder:{order_id:0,resource:'food',action:'buy',amount:1,price_limit:2},reservation:{trade:2}}];
 await writeFile(f.file,JSON.stringify(state));
 const orders=[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2},{order_id:1,resource:'food',action:'sell',amount:5,max_unit_price:0}];
 const rpc=async(m,p)=>{
  if(m==='get_market')return {monthly_trades:orders,monthly_trade_country_id:0,monthly_trades_complete:true,active_monthly_trades_count:orders.length};
  if(m==='set_monthly_trade'){assert.equal(p.order_id,0);orders.shift();return {success:true};}
  return f.rpc(m,p);
 };
 const r=await supervisorCleanup({...f,rpc,started:90});assert.equal(r.monthlyTrade.confirmed,true);assert.deepEqual(orders.map(o=>o.order_id),[1]);
 assert.equal(JSON.parse(await readFile(f.file)).monthlyTrades[0].released,true);
});

test('supervisor publishes freshly cleaned monthly and colony state rather than leaving stale active checkpoint rows',async t=>{
 const f=await fixture(t),state=JSON.parse(await readFile(f.file));
 state.colonyRoutines=[{id:'housing',sessionId:'test',status:'waiting',actions:[]}];state.colonyUpgradeRoutines=[{id:'upgrade',sessionId:'test',status:'paused',actions:[]}];
 await writeFile(f.file,JSON.stringify(state));f.checkpoint.state.monthlyControl={sessionId:'test',counts:{registered:2,uncertain:0}};await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const r=await supervisorCleanup({...f,started:90});assert.equal(r.monthlyTrade.confirmed,true);
 const checkpoint=JSON.parse(await readFile(join(f.directory,'latest-session.json')));assert.equal(checkpoint.state.monthlyControl.counts.registered,0);assert.equal(checkpoint.state.colonyControl.records[0].status,'stopped');assert.equal(checkpoint.state.colonyUpgradeControl.records[0].status,'stopped');
});

test('invalid process, round or world is rejected before pause rather than pausing an unrelated game first',async t=>{
 for(const mode of ['process','round','country','rollback']){
  const f=await fixture(t);
  if(mode==='round'){f.checkpoint.controllerRunId='newer-round';await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));}
  const rpc=async(m,p)=>{
   if(mode==='country'&&m==='get_galaxy_overview')return {player:{country_id:1,capital_system_id:0}};
   if(mode==='rollback'&&m==='get_status')return {in_game:true,is_paused:true,date:{formatted:'2199.12.30'}};
   return f.rpc(m,p);
  };
  const r=await supervisorCleanup({...f,rpc,started:90,...(mode==='process'?{identity:async()=>({pid:99,creationTime:34})}:{}),...(mode==='round'?{runId:'old-round'}:{})});
  assert.ok(r.error);assert.equal(r.paused,false);assert.equal(f.calls.some(x=>x.m==='set_paused'||x.m==='set_survey_automation'||x.m==='set_monthly_trade'),false);
 }
});
test('process and world are checked again immediately before a cleanup write',async t=>{
 for(const mode of ['process','world']){
  const f=await fixture(t);let worlds=0;
  const rpc=async(m,p)=>{if(m==='get_galaxy_overview'&&++worlds>1&&mode==='world')return {player:{country_id:1,capital_system_id:0}};return f.rpc(m,p);};
  const r=await supervisorCleanup({...f,rpc,started:90,boundIdentity:async()=>mode==='process'?{pid:99,creationTime:34}:f.identity()});
  assert.ok(r.error);assert.equal(f.calls.some(x=>x.m==='set_paused'),false);assert.equal(r.pauseStateUnknown,true);
 }
});
test('process replacement after pause prevents the later fleet revoke and cannot report a final verified pause',async t=>{
 const f=await fixture(t);let checks=0;
 const r=await supervisorCleanup({...f,started:90,boundIdentity:async()=>++checks===1?f.identity():{pid:99,creationTime:34}});
 assert.equal(f.calls.filter(x=>x.m==='set_paused').length,1);assert.equal(f.calls.some(x=>x.m==='set_survey_automation'),false);assert.equal(r.survey[0].confirmed,false);assert.equal(r.paused,false);assert.equal(r.pauseStateUnknown,true);
 // The per-fleet catch records the mismatch; the final status must be scoped too.
 assert.ok(r.survey[0].error);
});
test('failed current-round cleanup replaces an earlier positive checkpoint claim with explicit unknown scope',async t=>{
 const f=await fixture(t);f.checkpoint.cleanup={paused:true,pauseConfirmed:true,surveyStatus:'confirmed'};await writeFile(join(f.directory,'latest-session.json'),JSON.stringify(f.checkpoint));
 const r=await supervisorCleanup({...f,started:90,identity:async()=>({pid:99,creationTime:34})});const cp=JSON.parse(await readFile(join(f.directory,'latest-session.json')));
 assert.equal(r.checkpointUpdated,true);assert.equal(cp.stopped,true);assert.equal(cp.cleanup.bindingConfirmed,false);assert.equal(cp.cleanup.paused,false);assert.equal(cp.runtimeStatus.paused,null);assert.equal(f.calls.some(c=>c.m==='set_paused'),false);
});
test('failed old cleanup cannot overwrite a newer controller checkpoint',async t=>{
 const f=await fixture(t),file=join(f.directory,'latest-session.json');
 const r=await supervisorCleanup({...f,started:90,identity:async()=>{await writeFile(file,JSON.stringify({...f.checkpoint,sessionId:'new',controllerRunId:'new-run',stopped:false}));return {pid:99,creationTime:34};}});
 const cp=JSON.parse(await readFile(file));assert.equal(cp.sessionId,'new');assert.equal(cp.stopped,false);assert.equal(r.checkpointUpdated,false);
});
test('supervisor invalidates a mutation when the verified bridge generation changes during its world read',async t=>{
 const f=await fixture(t);let epoch=1,statusReads=0;
 const rpc=async(m,p)=>{if(m==='get_status'&&++statusReads===2)epoch=2;return f.rpc(m,p);};
 // Initial snapshot is generation 1; alter it between the guarded status and world.
 const r=await supervisorCleanup({...f,rpc,started:90,boundIdentity:async()=>{epoch++;return f.identity();},connectionEpoch:()=>epoch});
 assert.match(r.error,/桥连接更换/);assert.equal(f.calls.some(c=>c.m==='set_paused'),false);
});
