const compact=text=>String(text||'').replace(/[^\p{L}\p{N}\p{Script=Han}]/gu,'')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const classes={science:'shipclass_science_ship',construction:'shipclass_constructor'}
const names={science:/科研船/,construction:/工程船/}
const menus={survey:/^调查恒星系$/,outpost:/^建造恒星基地$/,mining:/^建造.*开采站(?:[（(].*)?$/,research_stations:/^建造.*研究站(?:[（(].*)?$/}

export function createFleetSkill({driver,observe,onEvent=()=>{},settle=delay,signal}={}){
  const check=()=>{if(signal?.aborted)throw new DOMException('舰船技能已停止。','AbortError')}
  const action=async(image,value)=>{check();const receipt=await driver.execute(value,{observationId:image.id,signal});onEvent({type:'action',skill:'fleet',action:value,observationId:image.id,ok:receipt?.ok===true});await settle(180);check();return observe(`fleet-${value.type}`)}
  const click=(image,target,button='left')=>action(image,{type:'click',x:target.x,y:target.y,button,count:1})
  async function select(image,shipType){
    if(image.hud?.selectedShipType===shipType)return image
    let targets=image.hud?.targets||[]
    const own=image.gameContext?.player?.fleets?.filter(fleet=>fleet.shipClass===classes[shipType])||[]
    let matching=targets.filter(target=>target.x>850&&names[shipType].test(target.text))
    if(!matching.length&&own.length===1){
      const name=compact(own[0].name).replace(/^[A-Z]+/,'')
      if(name.length>=2)matching=targets.filter(target=>target.x>850&&compact(target.text).endsWith(name.length>4?name.slice(-4):name))
    }
    if(!matching.length){
      const header=targets.find(target=>target.x>850&&target.text.replace(/\s/g,'')==='通用舰船')
      const next=header&&targets.filter(target=>target.x>850&&/船坞/.test(target.text)&&target.y>header.y).sort((a,b)=>a.y-b.y)[0]
      if(header&&next&&next.y-header.y<45){image=await click(image,header);targets=image.hud?.targets||[];matching=targets.filter(target=>target.x>850&&names[shipType].test(target.text))}
    }
    if(matching.length!==1)throw new Error('没有唯一的己方舰船文字目标，未猜测位置。')
    return click(image,matching[0])
  }
  async function prepare(image,shipType){
    check()
    if(!classes[shipType])throw new Error('未知舰船类型。')
    image=await select(image,shipType)
    if(image.hud?.mapMode==='system')image=await action(image,{type:'key',key:'M'})
    if(image.hud?.mapMode!=='galaxy')throw new Error('尚未确认银河地图，未对星系下单。')
    return image
  }
  async function order(image,{order,star}){
    check()
    if(!menus[order])throw new Error('未知舰船订单。')
    const original=image.hud?.stars?.find(target=>target.id===star)
    if(!original)throw new Error('星系不在本轮可见星核目标中。')
    image=await prepare(image,order==='survey'?'science':'construction')
    const matching=(image.hud?.stars||[]).filter(target=>original.unnamed?Math.hypot(target.x-original.x,target.y-original.y)<4:compact(target.name)===compact(original.name))
    if(matching.length!==1)throw new Error('界面变化后未重新确认目标星系，未使用旧坐标。')
    image=await click(image,matching[0],'right')
    const items=(image.hud?.targets||[]).filter(target=>menus[order].test(String(target.text).replace(/\s+/g,'')))
    if(items.length!==1)throw new Error('当前星系菜单没有唯一可核验的对应命令；可能尚未调查、无可建设资源或条件不足。')
    image=await click(image,items[0])
    const result={status:'sent_pending_verification',order,starName:original.name,message:'已通过真实菜单发送订单；需由舰船任务、资源变化或后续己方状态确认，尚不宣称建造完成。'}
    onEvent({type:'fleet-order',...result})
    return{image,result}
  }
  return{prepare,order}
}
