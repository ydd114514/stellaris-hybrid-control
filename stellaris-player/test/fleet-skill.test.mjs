import test from'node:test'
import assert from'node:assert/strict'
import{createFleetSkill}from'../src/fleet-skill.mjs'
const star={id:'s0',name:'巴纳德星',x:471,y:196}
const initial={id:'image1',hud:{mapMode:'galaxy',selectedShipType:'construction',stars:[star],targets:[]}}
function harness(frames,signal){
  const calls=[],events=[];let count=0
  const skill=createFleetSkill({signal,driver:{async execute(action,options){calls.push({action,options});return{ok:true}}},observe:async()=>frames[Math.min(count++,frames.length-1)],settle:async()=>{},onEvent:event=>events.push(event)})
  return{skill,calls,events}
}
test('fleet order uses a live star, a real menu item and reports only pending verification',async()=>{
  const menu={id:'image2',hud:{...initial.hud,targets:[{id:'t0',text:'建造恒星基地',x:490,y:210}]}}
  const done={id:'image3',hud:{...initial.hud,targets:[]}},h=harness([menu,done])
  const result=await h.skill.order(initial,{order:'outpost',star:'s0'})
  assert.equal(result.result.status,'sent_pending_verification')
  assert.deepEqual(h.calls.map(call=>call.action),[{type:'click',x:471,y:196,button:'right',count:1},{type:'click',x:490,y:210,button:'left',count:1}])
  assert.deepEqual(h.calls.map(call=>call.options.observationId),['image1','image2'])
  assert.equal(h.events.filter(event=>event.type==='action').length,2)
})
test('an absent or ambiguous construction menu never leads to a guessed selection',async()=>{
  const h=harness([{id:'image2',hud:{...initial.hud,targets:[{id:'t0',text:'移动到这里',x:490,y:210}]}}])
  await assert.rejects(h.skill.order(initial,{order:'outpost',star:'s0'}),/没有唯一/)
  assert.equal(h.calls.length,1)
})
test('a stale star ID and cancellation prohibit all inputs',async()=>{
  const h=harness([]);await assert.rejects(h.skill.order(initial,{order:'survey',star:'s99'}),/本轮/);assert.equal(h.calls.length,0)
  const controller=new AbortController();controller.abort();const cancelled=harness([],controller.signal)
  await assert.rejects(cancelled.skill.order(initial,{order:'outpost',star:'s0'}),{name:'AbortError'});assert.equal(cancelled.calls.length,0)
})
test('a busy ship can be located by its resolved owned name even when its type line becomes a progress bar',async()=>{
  const image={id:'image1',hud:{mapMode:'galaxy',targets:[{id:'t0',text:'UNS信风',x:923,y:353}]},gameContext:{player:{fleets:[{shipClass:'shipclass_science_ship',name:'UNS信风'}]}}}
  const next={id:'image2',hud:{mapMode:'galaxy',selectedShipType:'science'}},h=harness([next])
  const result=await h.skill.prepare(image,'science');assert.equal(result.id,'image2');assert.equal(h.calls.length,1);assert.equal(h.calls[0].action.y,353)
})
