import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,mkdir,writeFile,utimes,unlink,rm,realpath} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
test('actual commentary HTTP output expires stale automation and does not trust a dead controller',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fish-commentary-stale-'));
 let child,exited;
 t.after(async()=>{
  if(child){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
  const actual=await realpath(dir);assert.equal(dirname(actual),await realpath(tmpdir()));assert.ok(basename(actual).startsWith('fish-commentary-stale-'));await rm(actual,{recursive:true,force:true});
 });
 const base=join(dir,'.local/native-bridge');await mkdir(join(base,'dsh'),{recursive:true});
 const old=Date.now()-60000,path=join(base,'latest-session.json');
 const cp={sessionId:'s',stopped:false,state:{date:'2200.01.01',paused:false,surveyControl:{records:{0:{fleetId:0,sessionId:'s',owner:'native',observedAt:old,observation:{orders:[{automation:false}]}}}}}};
 await writeFile(path,JSON.stringify(cp));await utimes(path,new Date(old),new Date(old));
 await writeFile(join(base,'controller.lock'),JSON.stringify({pid:process.pid}));
 await writeFile(join(base,'session-s.jsonl'),'');await writeFile(join(base,'dsh/events.jsonl'),'');
 await writeFile(join(base,'dsh/current.json'),JSON.stringify({events:join(base,'dsh/events.jsonl')}));
 child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/commentary-server.mjs',import.meta.url))],{env:{...process.env,CYBERFISH_COMMENTARY_TEST_ROOT:dir,CYBERFISH_COMMENTARY_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','ignore']});
 exited=new Promise(done=>child.once('exit',done));
 const address=await new Promise((done,fail)=>{
  const timer=setTimeout(()=>fail(Error('Offline commentary startup timed out')),5000);let out='';
  child.once('error',e=>{clearTimeout(timer);fail(e);});child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('\n')){clearTimeout(timer);try{done(JSON.parse(out.split('\n')[0]).preview);}catch(e){fail(e);}}});
 });
 const first=await (await fetch(address+'/api/state')).json();assert.deepEqual(first.game.surveyDelegation,{assigned:0,working:0,uncertain:1});
 assert.ok(first.game.updatedAt<Date.now()-30000);
 cp.state.surveyControl.records[0].observedAt=Date.now();cp.state.paused=true;
 cp.runtimeStatus={sessionId:'s',observedAt:Date.now(),date:'2200.02.01',paused:false};await writeFile(path,JSON.stringify(cp));
 let live;for(let n=0;n<12;n++){live=await(await fetch(address+'/api/state')).json();if(live.game?.surveyDelegation?.working===1)break;await delay(200);}
 assert.equal(live.game.paused,false);assert.equal(live.game.date,'2200.02.01');assert.equal(live.game.surveyDelegation.working,1);
 await unlink(join(base,'controller.lock'));
 let next;for(let n=0;n<12;n++){next=await(await fetch(address+'/api/state')).json();if(next.game.stopped)break;await delay(200);}
 assert.equal(next.game.stopped,true);assert.deepEqual(next.game.surveyDelegation,{assigned:0,working:0,uncertain:1});
 assert.equal(JSON.stringify(next.game).includes('fleetId'),false);
});
