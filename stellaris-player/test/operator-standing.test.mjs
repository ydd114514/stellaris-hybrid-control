import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readOperatorStanding} from '../src/operator-standing.mjs';
test('operator standing preserves the full 600 character note',async t=>{
 const root=await mkdtemp(join(tmpdir(),'standing-long-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'operator-standing.json');
 const text='前'.repeat(590)+'末尾退出条件',base={version:1,source:'cyberfish-ai-hub',kind:'operator-standing',id:'o-long',gameSessionId:'s',text,economyFocus:null,until:{},setAt:1,refreshedAt:1000};
 await writeFile(path,JSON.stringify(base));assert.equal((await readOperatorStanding(path,'s',1000)).text,text);
 await writeFile(path,JSON.stringify({...base,text:'字'.repeat(601)}));assert.equal((await readOperatorStanding(path,'s',1000)).text.length,600);
});
import {readStrategyAdvice} from '../src/strategy-advice.mjs';
import {NativeGame} from '../src/native-game.mjs';
test('standing refresh lasts indefinitely; expired, oversized, foreign and deleted input is withdrawn from messages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'standing-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'operator-standing.json'),now=10000000;
 const base={version:1,source:'cyberfish-ai-hub',kind:'operator-standing',id:'o-1',gameSessionId:'s',text:'前期主拉凝聚力',economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:'两棵传统树完成'},setAt:1,refreshedAt:now,secret:'ignored'};
 await writeFile(path,JSON.stringify(base));const standing=await readOperatorStanding(path,'s',now);
 assert.equal(standing.economyFocus,'unity_traditions');assert.equal(standing.secret,undefined);assert.equal(standing.setAt,1);
 for(const patch of [{version:2},{source:'other'},{kind:'other'},{gameSessionId:'old'},{refreshedAt:now-180001},{refreshedAt:now+5001},{text:''},{text:'x'.repeat(33000)}]){
  await writeFile(path,JSON.stringify({...base,...patch}));assert.equal(await readOperatorStanding(path,'s',now),undefined);
 }
 await writeFile(path,JSON.stringify(base));
 const game=Object.create(NativeGame.prototype);Object.assign(game,{directory:join(root,'../controller'),guidanceFile:join(root,'missing'),sessionId:'s',now:()=>now,binding:{pid:1}});
 // Match the controller's sibling commentary directory without using real user data.
 game.directory=join(root,'controller');
 const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'commentary'));await writeFile(join(root,'commentary/operator-standing.json'),JSON.stringify(base));
 const state={};await game.refreshOperatorStanding(state);assert.deepEqual(state.operatorMessages,[base.text]);
 await rm(join(root,'commentary/operator-standing.json'));await game.refreshOperatorStanding(state);assert.deepEqual(state.operatorMessages,[]);assert.equal(state.operatorStanding,undefined);
});
test('advisory goals follow refreshed timestamps, with ten minute inactivity expiry',async t=>{
 const root=await mkdtemp(join(tmpdir(),'advice-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'directive.json');
 const base={version:1,source:'cyberfish-ai-hub',gameSessionId:'s',id:'d1',text:'优先凝聚力',at:1000};
 await writeFile(path,JSON.stringify(base));assert.ok(await readStrategyAdvice(path,'s',301001));assert.equal(await readStrategyAdvice(path,'s',601001),undefined);
 await writeFile(path,JSON.stringify({...base,at:601000}));assert.ok(await readStrategyAdvice(path,'s',1000000));
});
