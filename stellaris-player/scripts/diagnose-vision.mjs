import{writeFile,mkdir}from'node:fs/promises'
import{createWindowsDriver}from'../src/driver.mjs'
import{readHud}from'../src/hud.mjs'
import{loadDeepSeekKey}from'../src/credentials.mjs'
import{buildTurnTool}from'../src/fast-player.mjs'
const driver=createWindowsDriver({pythonPath:'C:/Program Files/Python315/python.exe',gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',previewWidth:1280,readHud})
let image
try{image=await driver.observe();if(driver.info().paused===false)await driver.setRunning(false,{observationId:image.id})}
finally{console.log(JSON.stringify({cleanup:await driver.stop()}))}
const apiKey=await loadDeepSeekKey(),picture=image.modelImage||image
async function request(mode){
  const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000)
  let stage='headers',status
  try{
    const content=mode==='text'?'只回复OK':[{type:'text',text:'简短回答这张游戏画面是银河地图还是恒星系，不需要鼠标操作。'},{type:'image_url',image_url:{url:`data:${picture.mimeType};base64,${picture.imageBase64}`,detail:'original'}}]
    const payload={model:'deepseek-flash',thinking:{type:'disabled'},max_tokens:mode==='tool'?384:64,messages:[{role:'user',content:mode==='tool'?[{type:'text',text:'仅测试工具协议，不会操作游戏。请返回type=idle,seconds=0.2,explanation=测试,nextGoal=继续。'},...content.slice(1)]:content}]}
    if(mode==='tool'){payload.tools=[buildTurnTool({targets:Array.from({length:60},(_,i)=>({id:`t${i}`}))})];payload.tool_choice='required'}
    const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload)})
    status=response.status;stage='body';const data=await response.json()
    return{mode,ok:response.ok,status,elapsedMs:Date.now()-started,content:data.choices?.[0]?.message?.content,tool:data.choices?.[0]?.message?.tool_calls?.[0]?.function,usage:data.usage,remoteCode:data.error?.code}
  }catch{return{mode,ok:false,status,stage,elapsedMs:Date.now()-started,error:controller.signal.aborted?'timeout':'network'}}
  finally{clearTimeout(timer)}
}
const results=await Promise.all([request('tool')])
await mkdir('.local',{recursive:true});await writeFile('.local/vision-diagnostic.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results))
