import test from 'node:test';
import assert from 'node:assert/strict';
import {audienceEvent} from '../src/audience.mjs';
test('audience feed rejects empty events and bounds visible external text',()=>{
  assert.equal(audienceEvent({type:'other'}),null);assert.equal(audienceEvent({type:'chat',name:'',text:'hello'}),null);
  const row=audienceEvent({type:'chat',name:'鱼友\u0000',text:'嗨'.repeat(200),platform:'bilibili'});assert.equal(row.name,'鱼友');assert.equal(row.text.length,160);
  assert.equal(audienceEvent({type:'gift',name:'鱼友',gift:'小星星',count:-1}).count,1);
});
