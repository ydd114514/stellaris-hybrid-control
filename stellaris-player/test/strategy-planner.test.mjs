import test from'node:test'
import assert from'node:assert/strict'
import{planStrategy}from'../src/strategy-planner.mjs'
const plan={objective:'调查完成后建前哨',briefPublicExplanation:'先确认星系调查完毕。',nextTasks:['等待调查','安排工程船'],avoid:['反复重选科研船']}
test('text strategy receives own-state data, no image or desktop action, and accepts one bounded plan',async()=>{
  let calls=0
  const result=await planStrategy({apiKey:'offline-key',context:{player:{fleets:[{currentOrders:[{type:'survey_planet_order'}]}]}},goal:'发展',fetch:async(url,request)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(request.body)
    assert.match(body.messages[0].content,/主动进攻.*持续征服/);assert.match(body.messages[0].content,/战后/);assert.equal(body.thinking.type,'disabled');assert.equal(JSON.stringify(body).includes('image_url'),false)
    return{ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'set_strategy',arguments:JSON.stringify(plan)}}]}}],usage:{total_tokens:100}})}
  }})
  assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.objective,plan.objective)
})
test('bad HTTP or invented tool results leave current strategy intact',async()=>{
  const failed=await planStrategy({apiKey:'offline-key',fetch:async()=>({ok:false,status:503})})
  assert.equal(failed.ok,false)
  const invalid=await planStrategy({apiKey:'offline-key',fetch:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'run_shell',arguments:'{}'}}]}}]})})})
  assert.equal(invalid.ok,false)
})
