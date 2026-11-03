import {legacyStrategyContractSchema,validateStrategyContract} from './strategy-contract.mjs';
import{performance}from'node:perf_hooks'

/** Slow-changing strategy from player-owned facts. No screen coordinates or
 * executable code; the running local controller continues the game meanwhile.
 */
export async function planStrategy({apiKey,context,goal,model='deepseek-v4-pro',fetch:fetchImpl=globalThis.fetch,signal,timeoutMs=15000}={}){
  const started=performance.now(),controller=new AbortController(),cancel=()=>controller.abort()
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  const timer=setTimeout(cancel,timeoutMs)
  const parameters=legacyStrategyContractSchema

  try{
    const payload={
      model,thinking:{type:'disabled'},max_tokens:1024,tool_choice:'required',stream:false,
      messages:[
        {role:'system',content:'你是v1.5大肥鱼战略指挥。原生国家AI自己执行全部日常操作。只输出StrategyContract的三维方针、最多4个保留决定和一句公开理由；不要给建设、科研、造船、舰队移动等逐条任务。宣战议和外交用现有合法参数，原生AI保持开启。低频每6游戏月或战争/危机/资源告急/用户新方向时复查。未知信息不捏造，不调用桌面。'},
        {role:'user',content:JSON.stringify({goal,playerFacts:context,readingRule:'原生AI持续运营；无关键决定oneOffActions=[]，不要请求日常派单。'})},
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
    const contract=validateStrategyContract(value,undefined,{requireGoals:false})
    if(JSON.stringify(value).includes(apiKey))throw new Error()
    return{ok:true,...contract,usage:data.usage,elapsedMs:Math.round(performance.now()-started)}
  }catch{return{ok:false,error:controller.signal.aborted?'战略请求超时或取消，保持现有目标。':'战略响应无效，保持现有目标。'}}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
