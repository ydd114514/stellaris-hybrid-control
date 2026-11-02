import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readStrategyAdvice} from '../src/strategy-advice.mjs';

test('only recent advice bound to the current game is exposed, with a bounded allowlist',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fish-advice-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'advice.json'),now=1000000;
  const base={version:1,source:'cyberfish-ai-hub',id:'d1',at:now,gameSessionId:'same',text:'先补科研',targetResource:'consumer_goods',orders:[{command:'anything'}],key:'hidden',nextSteps:Array(20).fill('检查科研'.repeat(50))};
  const write=x=>writeFile(path,JSON.stringify(x));await write(base);
  const advice=await readStrategyAdvice(path,'same',now);assert.equal(advice.goal.text,'先补科研');assert.equal(advice.goal.requiresFreshValidation,true);assert.equal(advice.goal.nextSteps.length,3);assert.ok(advice.goal.nextSteps.every(x=>x.length<=100));assert.ok(!('orders' in advice.goal));assert.ok(!('key' in advice.goal));assert.ok(!('id' in advice.goal));
  for(const patch of [{gameSessionId:'old'},{source:'elsewhere'},{version:2},{at:now-600001},{at:now+5001},{text:''}]){await write({...base,...patch});assert.equal(await readStrategyAdvice(path,'same',now),undefined);}
  await write({...base,text:'x'.repeat(40000)});assert.equal(await readStrategyAdvice(path,'same',now),undefined);
  for(const patch of [{text:'场控老师要求先补科研'},{focus:'参谋的任务'},{nextSteps:['host wants expansion']}]){await write({...base,...patch});assert.equal(await readStrategyAdvice(path,'same',now),undefined);}
  await write(base);assert.equal((await readStrategyAdvice(path,'same',now)).goal.targetResource,'consumer_goods');
  await write({...base,targetResource:'run_console'});assert.ok(!('targetResource' in (await readStrategyAdvice(path,'same',now)).goal));
});
