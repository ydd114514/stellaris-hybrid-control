import test from 'node:test'
import assert from 'node:assert/strict'
import {createFastPlayer,validateTurn,buildTurnTool} from '../src/fast-player.mjs'
import {parseHudLabels} from '../src/hud.mjs'

function harness(decisions,{fetch:customFetch,maxRequests=decisions.length,targets=[]}={}){
  let sequence=0,paused=true,stopped=false;const calls={actions:[],clocks:[],requests:[],events:[]}
  const driver={
    async observe(){return{id:`frame-${++sequence}`,imageBase64:Buffer.from(`picture-${sequence}`).toString('base64'),mimeType:'image/png',width:2560,height:1440,paused,hud:{gameDate:`2200.01.${String(sequence).padStart(2,'0')}`,paused,targets}}},
    async execute(action,options){calls.actions.push({action,options});return{ok:true,message:'输入已发送'}},
    async setRunning(running,options){paused=!running;calls.clocks.push({running,options});return{ok:true,running,message:'clock'}},
    info:()=>({paused,stopped}),
    async stop(){stopped=true;paused=true;return{ok:true,paused:true,released:true}},
  }
  const fetch=async(url,options)=>{
    const request=JSON.parse(options.body);calls.requests.push(request)
    if(customFetch)return customFetch(url,options,calls)
    const decision=decisions[calls.requests.length-1]
    return{ok:true,status:200,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',id:'turn',function:{name:'play_turn',arguments:JSON.stringify(decision)}}]}}],usage:{total_tokens:100}})}
  }
  const player=createFastPlayer({driver,apiKey:'fake-key',fetch,maxRequests,onEvent:event=>calls.events.push(event)})
  return{player,calls,driver}
}
const click=(x=200)=>({type:'click',x,y:300,button:'left',count:1,explanation:'选科研船',nextGoal:'安排调查'})

test('continuous play keeps one fresh image per request and resumes only once',async()=>{
  const{player,calls}=harness([click(),click(500),click(700)])
  const result=await player.run()
  assert.equal(result.status,'checkpoint');assert.equal(result.actions,3);assert.equal(result.requests,3)
  assert.deepEqual(calls.clocks.map(row=>row.running),[true]);assert.equal(result.cleanup.paused,true)
  assert.equal(new Set(calls.actions.map(row=>row.options.observationId)).size,3)
  for(const request of calls.requests){
    const images=request.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='image_url')
    assert.equal(images.length,1);assert.equal(request.thinking.type,'disabled')
  }
  assert.notEqual(calls.requests[0].messages[1].content[1].image_url.url,calls.requests[1].messages[1].content[1].image_url.url)
})
test('malformed model action is rejected, then a fresh turn recovers',async()=>{
  const{player,calls}=harness([{...click(),x:2000},click()])
  const result=await player.run()
  assert.equal(result.status,'checkpoint');assert.equal(result.errors,1);assert.equal(calls.actions.length,1)
  assert.equal(calls.events.some(row=>row.type==='recovery'),true)
})
test('stopping while the request is in flight prevents a late click and pauses cleanup',async()=>{
  let started,finish;const ready=new Promise(resolve=>{started=resolve})
  const{player,calls}=harness([click()],{fetch:async()=>{
    started();return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'play_turn',arguments:JSON.stringify(click())}}]}}]})})})
  }})
  const pending=player.run();await ready;player.stop();finish();const result=await pending
  assert.equal(result.status,'cancelled');assert.equal(calls.actions.length,0);assert.equal(result.cleanup.paused,true)
})
test('repeated same-point clicks are bounded and model is told to change approach',async()=>{
  const{player,calls}=harness([click(),click(),click(),click()])
  const result=await player.run();assert.equal(result.actions,2)
  assert.match(calls.requests[3].messages[1].content[0].text,/未继续点击/)
})
test('console, system shortcuts, pause and save/load keys are unavailable to generic actions',()=>{
  for(const key of ['SPACE','SPACEBAR','Ctrl+S','F5','F9','`','Win+R'])assert.throws(()=>validateTurn({type:'key',key,explanation:'',nextGoal:''}))
  assert.throws(()=>validateTurn({...click(),file:'unexpected'}))
  assert.equal(validateTurn({type:'clock',running:true,explanation:'继续',nextGoal:'发展'}).running,true)
})
test('HUD parses genuine pause and speed labels, validates OCR calendar corrections',()=>{
  assert.deepEqual(parseHudLabels([{text:'暂停'},{text:'2200，0L01'}]).gameDate,'2200.01.01')
  assert.equal(parseHudLabels([{text:'常速 2200.02.16'}]).paused,false)
  assert.equal(parseHudLabels([{text:'2200.99.99'}]).gameDate,null)
  assert.equal(parseHudLabels([{text:'无法识别'}]).paused,null)
})
test('semantic clicks use current local target coordinates rather than model-supplied coordinates',async()=>{
  const{player,calls}=harness([{type:'click_target',target:'t0',explanation:'选择科研船',nextGoal:'调查'}],{targets:[{id:'t0',text:'科研船',x:923.83,y:363.89}]})
  const result=await player.run();assert.equal(result.actions,1)
  assert.deepEqual(calls.actions[0].action,{type:'click',x:923.83,y:363.89,button:'left',count:1})
})
test('outliner ship selection requires an actually present unique matching label',async()=>{
  const turn={type:'select_ship',shipType:'science',explanation:'选科研船',nextGoal:'调查'}
  const present=harness([turn],{targets:[{id:'t0',text:'科研船',x:923.83,y:363.89},{id:'t1',text:'工程船',x:923.83,y:334.73}]})
  assert.equal((await present.player.run()).actions,1);assert.equal(present.calls.actions[0].action.y,363.89)
  const absent=harness([turn],{targets:[{id:'t0',text:'工程船',x:923,y:334}]})
  assert.equal((await absent.player.run()).actions,0);assert.equal(absent.calls.actions.length,0)
})
test('tool schema stays constant as visible target IDs change, with target membership enforced locally',async()=>{
  assert.deepEqual(buildTurnTool({targets:[{id:'t1'}]}),buildTurnTool({targets:Array.from({length:90},(_,i)=>({id:`t${i}`})),blockedResearch:true}))
  const{player,calls}=harness([{type:'click_target',target:'t99',explanation:'目标',nextGoal:'继续'}],{targets:[{id:'t0',text:'科研船',x:923,y:360}]})
  assert.equal((await player.run()).actions,0);assert.equal(calls.actions.length,0)
})
