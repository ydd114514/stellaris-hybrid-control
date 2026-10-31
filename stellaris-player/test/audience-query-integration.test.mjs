import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

// The parent simulates the AI host's JSON file contract. A real, independent
// Node process executes NativeGame.serviceAudienceQueries and AudienceQueryBridge.
// No native game is started: only inspect is replaced, and any native RPC fails.
const worker=`
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from ${JSON.stringify(pathToFileURL(resolve('src/native-game.mjs')).href)};
const config=JSON.parse(process.argv[1]);let now=config.now;
await mkdir(join(config.directory,'native-bridge'),{recursive:true});
const rpcCalls=[],inspectionCalls=[];
const game=new NativeGame({directory:join(config.directory,'native-bridge'),now:()=>now,
 pipe:{request:async(method)=>{rpcCalls.push(method);throw Error('Integration test forbids game RPC');},close(){}},processReader:async()=>{throw Error('Integration test forbids game process inspection');}});
game.sessionId=config.gameSessionId;game.lastState=config.state;
game.journal=join(config.directory,'native-bridge','query-journal.jsonl');
game.inspect=async query=>{
 inspectionCalls.push(query);
 if(config.waitForRelease){
  process.stdout.write(JSON.stringify({event:'inspect-started',query})+'\\n');
  let release;const deadline=Date.now()+5000;
  while(Date.now()<deadline){try{release=JSON.parse(await readFile(join(config.directory,'release.json'),'utf8'));break;}catch{await delay(5);}}
  if(!release)throw Error('Test release timed out');
  if(release.stop)game.stopped=true;if(typeof release.now==='number')now=release.now;
 }
 return config.answers?.[query.topic+':'+(query.id??'')]||config.answer;
};
const emitted=[];
for(let n=0;n<(config.polls||1);n++)emitted.push(...await game.serviceAudienceQueries());
process.stdout.write(JSON.stringify({event:'finished',emitted,inspectionCalls,rpcCalls})+'\\n');
`;

async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'fish-query-cross-process-'));
  await mkdir(join(directory,'commentary'),{recursive:true});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const now=1000000,gameSessionId='game-1',state={date:'2324.05.01',player:{country_id:0},colonies:[{colonies_summary:[{planet_id:0},{planet_id:3}]}]};
  const file=join(directory,'commentary','audience-queries.json'),results=join(directory,'commentary','audience-query-results.json');
  const request=(id='query-1',extra={})=>({id,taskId:'q-task-1',topic:'upgrades',entityId:3,createdAt:now,expiresAt:now+60000,...extra});
  const envelope=(requests,extra={})=>({version:1,source:'cyberfish-ai-hub',runId:'run-1',gameSessionId,updatedAt:now,requests,...extra});
  const publish=async requestsOrEnvelope=>{const value=Array.isArray(requestsOrEnvelope)?envelope(requestsOrEnvelope):requestsOrEnvelope;await writeFile(file+'.host-tmp',JSON.stringify(value),'utf8');await rename(file+'.host-tmp',file);};
  const answer={success:true,planet_id:3,candidates:[{building_id:0,current_key:'building_capital',upgrade_key:'building_major_capital',can_upgrade:true}],privateSecret:'DO_NOT_PROPAGATE',reasoning_content:'DO_NOT_PROPAGATE_REASONING'};
  const run=(extra={},onStarted)=>new Promise((resolveChild,reject)=>{
    const config={directory,now,gameSessionId,state,answer,...extra};
    const child=spawn(process.execPath,['--input-type=module','-e',worker,JSON.stringify(config)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',errors='',buffer='',result,callbackError,started=false;
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Audience query child exceeded 10s'));},10000);
    child.stderr.on('data',b=>{errors+=b;});
    child.stdout.on('data',b=>{output+=b;buffer+=b;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;try{const value=JSON.parse(line);if(value.event==='finished')result=value;if(value.event==='inspect-started'&&!started){started=true;Promise.resolve(onStarted?.(value)).catch(error=>{callbackError=error;child.kill();});}}catch(error){callbackError=error;}}});
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.on('exit',code=>{clearTimeout(timeout);if(callbackError)return reject(callbackError);if(code!==0||!result)return reject(new Error('Query child failed: '+code+' '+errors+' '+output));resolveChild(result);});
  });
  const release=opts=>writeFile(join(directory,'release.json'),JSON.stringify(opts),'utf8');
  const readResults=async()=>{try{return JSON.parse(await readFile(results,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}};
  return {directory,file,results,now,gameSessionId,state,request,envelope,publish,run,release,readResults};
}

test('the real file contract carries run, session, query and task identity and publishes only allowlisted facts',async t=>{
  const f=await setup(t);await f.publish([f.request()]);
  const processResult=await f.run(),saved=await f.readResults();
  assert.deepEqual(processResult.inspectionCalls,[{topic:'upgrades',id:3}]);assert.deepEqual(processResult.rpcCalls,[]);
  assert.deepEqual({version:saved.version,source:saved.source,runId:saved.runId,gameSessionId:saved.gameSessionId},{version:1,source:'cyberfish-audience-query-results',runId:'run-1',gameSessionId:'game-1'});
  assert.deepEqual(saved.results.map(x=>({id:x.id,taskId:x.taskId,status:x.status})),[{id:'query-1',taskId:'q-task-1',status:'ok'}]);
  assert.match(saved.results[0].facts,/building_capital.*building_major_capital.*当前可升级/);
  assert.doesNotMatch(JSON.stringify(saved),/DO_NOT_PROPAGATE|reasoning_content|privateSecret/);
  const journal=await readFile(join(f.directory,'native-bridge','query-journal.jsonl'),'utf8');
  assert.match(journal,/audience_query_result/);assert.doesNotMatch(journal,/DO_NOT_PROPAGATE/);
});

test('persistent file deduplication survives a real process restart but a new run obtains new facts',async t=>{
  const f=await setup(t);await f.publish([f.request()]);assert.equal((await f.run()).inspectionCalls.length,1);
  const bytes=await readFile(f.results,'utf8');
  const second=await f.run();assert.deepEqual(second.inspectionCalls,[]);assert.deepEqual(second.emitted,[]);assert.equal(await readFile(f.results,'utf8'),bytes);
  await f.publish(f.envelope([f.request()],{runId:'run-2'}));
  const third=await f.run({answer:{planet_id:3,candidates:[]}});assert.equal(third.inspectionCalls.length,1);assert.equal((await f.readResults()).runId,'run-2');
});

test('expired and cross-session tasks produce scoped unavailability without any inspect or native writes',async t=>{
  const f=await setup(t);await f.publish([f.request('query-expired',{createdAt:f.now-60000,expiresAt:f.now})]);
  const expired=await f.run();assert.deepEqual(expired.inspectionCalls,[]);assert.equal(expired.emitted[0].reason,'expired');
  await f.publish(f.envelope([f.request('query-other-game')],{runId:'run-2',gameSessionId:'game-old'}));
  const foreign=await f.run();assert.deepEqual(foreign.inspectionCalls,[]);assert.equal(foreign.emitted[0].reason,'cross_session');
  assert.equal((await f.readResults()).gameSessionId,'game-old');assert.deepEqual(foreign.rpcCalls,[]);
});

test('entity zero remains valid; foreign planets, mutation fields and unsupported topics never reach inspect',async t=>{
  const f=await setup(t);await f.publish([
    f.request('q-zero',{taskId:'task-zero',topic:'planet',entityId:0}),
    f.request('q-foreign',{entityId:548}),
    f.request('q-command',{command:'apply_orders'}),
    f.request('q-shell',{topic:'shell',entityId:undefined})
  ]);
  const result=await f.run({answer:{planet_id:0,name:'地球',kpi:{housing:100,stability_percent:90}}});
  assert.deepEqual(result.inspectionCalls,[{topic:'planet',id:0}]);
  assert.equal(result.emitted.find(x=>x.id==='q-zero').taskId,'task-zero');
  assert.equal(result.emitted.find(x=>x.id==='q-foreign').reason,'invalid_entity');
  assert.equal(result.emitted.find(x=>x.id==='q-shell').reason,'unsupported');assert.ok(!result.emitted.some(x=>x.id==='q-command'));assert.deepEqual(result.rpcCalls,[]);
});

test('same query ID cannot be rebound to a different task through persisted results',async t=>{
  const f=await setup(t);await f.publish([f.request()]);await f.run();
  await f.publish([f.request('query-1',{taskId:'q-different-task'})]);
  const result=await f.run();assert.deepEqual(result.inspectionCalls,[]);assert.deepEqual(result.emitted,[]);
  assert.ok(!(await f.readResults()).results.some(x=>x.id==='query-1'&&x.taskId==='q-different-task'));
});

test('stop while inspect is awaited never writes or logs a late result',async t=>{
  const f=await setup(t);await f.publish([f.request()]);
  const result=await f.run({waitForRelease:true},()=>f.release({stop:true}));
  assert.deepEqual(result.emitted,[]);assert.equal(await f.readResults(),undefined);
  await assert.rejects(stat(join(f.directory,'native-bridge','query-journal.jsonl')),error=>error.code==='ENOENT');
});

test('replacing run or task, or withdrawing a same-run request during inspect prevents stale output',async t=>{
  for(const change of ['run','task','withdraw']) {
    const f=await setup(t);await f.publish([f.request()]);
    const result=await f.run({waitForRelease:true},async()=>{
      if(change==='run')await f.publish(f.envelope([f.request()],{runId:'new-run'}));
      else if(change==='task')await f.publish([f.request('query-1',{taskId:'replacement-task'})]);
      else await f.publish([]);
      await f.release({});
    });
    assert.deepEqual(result.emitted,[],change);assert.equal(await f.readResults(),undefined,change);
  }
});

test('a read that outlives task expiry cannot publish an ok result',async t=>{
  const f=await setup(t);await f.publish([f.request()]);
  const result=await f.run({waitForRelease:true},()=>f.release({now:f.now+60001}));
  assert.ok(!result.emitted.some(x=>x.status==='ok'));
  assert.ok(!(await f.readResults())?.results.some(x=>x.status==='ok'));
});

test('restored result records are allowlisted before a new result rewrites the file',async t=>{
  const f=await setup(t);
  await writeFile(f.results,JSON.stringify({version:1,source:'cyberfish-audience-query-results',runId:'run-1',gameSessionId:'game-1',updatedAt:f.now,
    secretEnvelope:'DO_NOT_PROPAGATE',results:[{id:'old-query',taskId:'old-task',status:'ok',observedAt:f.now,facts:'已核实旧事实',privateSecret:'DO_NOT_PROPAGATE',reasoning_content:'DO_NOT_PROPAGATE_REASONING'}]}),'utf8');
  await f.publish([f.request()]);const result=await f.run();assert.equal(result.inspectionCalls.length,1);
  const saved=await f.readResults();assert.equal(saved.results.length,2);assert.doesNotMatch(JSON.stringify(saved),/DO_NOT_PROPAGATE|secretEnvelope|privateSecret|reasoning_content/);
});

test('a UTF-8 result file larger than the request limit still preserves deduplication across process restart',async t=>{
  const f=await setup(t);
  await writeFile(f.results,JSON.stringify({version:1,source:'cyberfish-audience-query-results',runId:'run-1',gameSessionId:'game-1',updatedAt:f.now,
    results:Array.from({length:15},(_,i)=>({id:`old-query-${i}`,taskId:`old-task-${i}`,status:'ok',observedAt:f.now,facts:'星'.repeat(1800)}))}),'utf8');
  await f.publish([f.request()]);assert.equal((await f.run()).inspectionCalls.length,1);
  const size=(await stat(f.results)).size;assert.ok(size>65536);assert.ok(size<=131072);
  const bytes=await readFile(f.results,'utf8'),again=await f.run();assert.deepEqual(again.inspectionCalls,[]);assert.equal(await readFile(f.results,'utf8'),bytes);
});
