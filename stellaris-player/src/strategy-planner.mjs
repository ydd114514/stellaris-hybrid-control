import{performance}from'node:perf_hooks'

/** Slow-changing strategy from player-owned facts. No screen coordinates or
 * executable code; the running local controller continues the game meanwhile.
 */
export async function planStrategy({apiKey,context,goal,model='deepseek-v4-pro',fetch:fetchImpl=globalThis.fetch,signal,timeoutMs=15000}={}){
  const started=performance.now(),controller=new AbortController(),cancel=()=>controller.abort()
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  const timer=setTimeout(cancel,timeoutMs)
  const parameters={
    type:'object',additionalProperties:false,required:['objective','briefPublicExplanation','nextTasks','avoid'],
    properties:{
      objective:{type:'string',maxLength:400},briefPublicExplanation:{type:'string',maxLength:200},
      nextTasks:{type:'array',maxItems:4,items:{type:'string',maxLength:160}},
      avoid:{type:'array',maxItems:4,items:{type:'string',maxLength:160}},
    },
  }
  try{
    const payload={
      model,thinking:{type:'disabled'},max_tokens:1024,tool_choice:'required',stream:false,
      messages:[
        {role:'system',content:'你是群星玩家的战略决策器。主动进攻和持续征服是目标：结合已知敌国、路线、实际战力、合法战争条件和收益主动选敌，保存战役并推动具体备战缺口；条件具备就开战，不等所有资源正收入、满舰容或完美条件。已有战役优先持续推进战斗、占领和议和，战后核对实际领土收益、安排恢复并评估下一目标，不能永久退回内政。posted、模拟与运行时长不证明战果。仅依据玩家自身的实际状态制定下一小阶段可执行目标，不能作弊、捏造敌方信息或指挥桌面坐标。游戏继续正常运行，本地执行器负责操作。科研船已有survey_planet_order表示正在调查，不要反复重选或打断；等待其完成期间安排其他任务。母星系资源站可能开局就全部建成，不能要求反复在无可建资源的太阳系建站；可以发展星球、补充舰船，或等待邻近星系调查完成后正常建设前哨并扩张。空/未知科研队列需用界面核对，已完成科技应选下一项。矿物/合金/影响力库存与月收支决定建设，不能将任务回执当作已完成。仅返回一个短期目标、一句公开说明、最多4条下一步任务和最多4条应避免的重复动作。'},
        {role:'user',content:JSON.stringify({goal,playerFacts:context,readingRule:'queueKnown=false仅表示未知，不能直接称为空槽；先让执行器核对界面。若现有目标没有可执行操作，主动换到可推进的任务。'})},
      ],
      tools:[{type:'function',function:{name:'set_strategy',parameters}}],
    }
    const response=await fetchImpl('https://api.deepseek.com/chat/completions',{
      method:'POST',redirect:'error',signal:controller.signal,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload),
    })
    if(!response.ok)return{ok:false,error:`战略请求HTTP ${response.status}`}
    const data=await response.json()
    if(controller.signal.aborted)return{ok:false,error:'战略请求已取消。'}
    const calls=data.choices?.[0]?.message?.tool_calls
    if(data.choices?.[0]?.finish_reason!=='tool_calls'||calls?.length!==1||calls[0].function?.name!=='set_strategy')throw new Error()
    const value=JSON.parse(calls[0].function.arguments)
    if(typeof value.objective!=='string'||!value.objective.trim()||value.objective.length>400||typeof value.briefPublicExplanation!=='string'||value.briefPublicExplanation.length>200||!['nextTasks','avoid'].every(key=>Array.isArray(value[key])&&value[key].length<=4&&value[key].every(text=>typeof text==='string'&&text.length<=160)))throw new Error()
    if(JSON.stringify(value).includes(apiKey))throw new Error()
    return{ok:true,...value,usage:data.usage,elapsedMs:Math.round(performance.now()-started)}
  }catch{return{ok:false,error:controller.signal.aborted?'战略请求超时或取消，保持现有目标。':'战略响应无效，保持现有目标。'}}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
