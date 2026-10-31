import test from 'node:test';
import assert from 'node:assert/strict';
import {GameNotebook} from '../src/game-notebook.mjs';
const sample=(date,p=900,net=10,wars=[])=>({date,military:{fleets:[{military_power:p}]},resources:{alloys:{net}},wars,colonies:[{colonies_summary:[{planet_id:3,name:'地球'}]}]});
const row=(n,state)=>({type:'state',at:new Date(1800000000000+n*1000).toISOString(),state});
test('initial state is a baseline, future power and war transitions are factual',()=>{
  const b=new GameNotebook();b.consume(row(1,sample('2200.01.01',6000,10,[{war_id:7}])));assert.equal(b.entries.length,0);
  b.consume(row(2,sample('2201.01.01',11000,10,[{war_id:8}])));
  assert.equal(b.entries.length,3);assert.match(b.entries[2].text,/1万/);assert.ok(!b.entries.some(e=>/胜利/.test(e.text)));
});
test('economic recovery requires an observed deficit and two positive readings',()=>{
  const b=new GameNotebook();b.consume(row(1,sample('2200.01.01',900,-20)));b.consume(row(2,sample('2200.02.01',900,10)));assert.equal(b.entries.length,0);
  b.consume(row(3,sample('2200.03.01',900,12)));assert.match(b.entries[0].text,/盈余/);
});
test('only verified real zone and ascension receipts create notes, never model plans',()=>{
  const b=new GameNotebook();b.consume(row(1,sample('2200.01.01')));
  const r={type:'receipt',at:row(2,{}).at,command:'set_district_zone',response:{success:true,planet_id:3,district_id:0,slot:0,zone:'zone_foundry',zone_name:'重工业'},verification:{verified:false,phase:'construction_queue'}};
  b.consume(r);assert.equal(b.entries.length,0);r.verification.verified=true;b.consume(r);assert.match(b.entries[0].text,/地球开始建设/);assert.doesNotMatch(b.entries[0].text,/完成/);
  b.consume({type:'intent',at:row(3,{}).at,explanation:'征服了全宇宙'});assert.equal(b.entries.length,1);
  b.consume({...r,at:row(4,{}).at,command:'adopt_ascension_perk',response:{success:true,perk_key:'one',name:'星际主权'}});assert.match(b.entries[1].text,/星际主权/);
});
test('persisted cursor prevents replay, milestones deduplicate across restarts',()=>{
  const b=new GameNotebook();b.consume(row(1,sample('2200.01.01')));b.consume(row(2,sample('2200.02.01',1500)));
  const c=new GameNotebook(b.serialize());c.consume(row(1,sample('2200.01.01')));c.consume(row(2,sample('2200.02.01',1500)));c.consume(row(3,sample('2200.03.01',900)));c.consume(row(4,sample('2200.04.01',1500)));assert.equal(c.entries.length,1);
});
test('new colonies and encountered events are named, save reload resets the baseline',()=>{
  const b=new GameNotebook();b.consume(row(1,sample('2201.01.01')));
  const s=sample('2201.02.01');s.pendingEvents=[{title:'来自虚空的低语'}];s.colonies[0].colonies_summary.push({planet_id:8,name:'海蓝'});b.consume(row(2,s));
  assert.equal(b.entries.length,2);assert.match(b.entries[0].text,/海蓝/);assert.match(b.entries[1].text,/低语/);
  b.consume(row(3,sample('2200.01.01')));assert.equal(b.entries.length,3);assert.equal(b.entries[2].category,'航程');
});
