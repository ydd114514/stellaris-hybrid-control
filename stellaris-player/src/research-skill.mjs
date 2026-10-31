import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { recognizeGameText } from './ocr.mjs'
import { parseResearchUi } from './research-ui.mjs'
import { planResearch } from './research-planner.mjs'

const names={physics:'物理学',society:'社会学',engineering:'工程学'}
const normalized=text=>String(text||'').replace(/\s+/g,'')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function mergeLabels(base,refined){
  let labels=[...base]
  for(const next of refined){
    const overlaps=label=>{
      const y=Math.min(label.y+label.height,next.y+next.height)-Math.max(label.y,next.y)
      const x=Math.min(label.x+label.width,next.x+next.width)-Math.max(label.x,next.x)
      return y>Math.min(label.height,next.height)*0.55&&x>Math.min(label.width,next.width)*0.55
    }
    const exactHeading=labels.find(label=>overlaps(label)&&/^(物理学|社会学|工程学)$/.test(normalized(label.text)))
    if(exactHeading)continue
    labels=labels.filter(label=>!overlaps(label));labels.push(next)
  }
  return labels
}

/** A complete, locally verified UI skill. DeepSeek chooses the technology,
 * while local code locates every button and handles the panel transitions.
 * No per-click image/model round trips and no game console/save edits.
 */
export function createResearchSkill({driver,apiKey,model='deepseek-flash',recognize=recognizeGameText,parse=parseResearchUi,planner=planResearch,onEvidence=async()=>{},onEvent=()=>{},settle=sleep}={}){
  if(!driver)throw new Error('缺少群星本地驱动。')
  let image,ui,stopped=false,running=false
  const abort=()=>{if(stopped)throw new DOMException('科研技能已停止。','AbortError')}
  async function run({area='physics',context={},signal}={}){
    if(running)throw new Error('科研技能正在运行。')
    if(!names[area])throw new Error('未知科研领域。')
    running=true;const started=performance.now()
    const report={status:'error',skill:'select_research',area,actions:0,observations:0,modelRequests:0,modelMs:0,localMs:0,elapsedMs:0,candidates:[],choice:null,verified:false}
    const check=()=>{abort();if(signal?.aborted)throw new DOMException('科研技能已取消。','AbortError')}
    async function observe(stage,{full=false}={}){
      check();const at=performance.now();image=await driver.observe();check()
      const options=full?{signal}:{signal,region:{x:0,y:30,width:Math.min(image.width,1100),height:Math.min(image.height-30,800)},scale:2}
      let ocr
      if(!full){
        const tasks=[recognize(image,options),recognize(image,{signal,region:{x:30,y:170,width:Math.min(image.width-30,480),height:Math.min(image.height-170,500)},scale:4})]
        if(stage==='candidates')tasks.push(recognize(image,{signal,region:{x:520,y:175,width:Math.min(image.width-520,490),height:Math.min(image.height-175,390)},scale:4}))
        const [main,detail,selection]=await Promise.all(tasks)
        const preciseMain=(detail.labels||[]).filter(label=>{
          if(/^(物理学|社会学|工程学)$/.test(normalized(label.text)))return true
          const x=label.x*image.width/1000,y=label.y*image.height/1000
          return x>=35&&x<100&&[232,392,552].some(row=>Math.abs(y-row)<12)
        })
        const preciseChoices=(selection?.labels||[]).filter(label=>{
          const x=label.x*image.width/1000,y=label.y*image.height/1000
          return x>=525&&x<580&&[199,319,439,559].some(row=>Math.abs(y-row)<12)
        })
        ocr={...main,labels:mergeLabels(mergeLabels(main.labels||[],preciseMain),preciseChoices)}
      }else ocr=await recognize(image,options)
      check()
      if(!ocr.ok)throw new Error(ocr.message||'未识别到有效游戏文字。')
      ui=parse({labels:ocr.labels,width:image.width,height:image.height})
      report.observations++;report.localMs+=performance.now()-at
      await onEvidence({stage,image,ocr,ui});check()
      return ocr.labels
    }
    async function act(action){
      check();const at=performance.now()
      await driver.execute(action,{observationId:image.id,signal});report.actions++
      await settle(220);report.localMs+=performance.now()-at;check()
    }
    const click=target=>{
      const point=target?.click
      if(!point||![point.x,point.y].every(Number.isFinite))throw new Error('界面没有可核验的点击目标。')
      return act({type:'click',x:point.x,y:point.y,button:'left',count:1})
    }
    const areaState=()=>ui?.areas?.find(row=>row.area===area||row.id===area)
    try{
      let labels=await observe('initial')
      if(!ui.ok){
        // Only this exact, source-confirmed welcome window has a RETURN action.
        labels=await observe('check-welcome',{full:true})
        if(labels.some(row=>/征途.*星辰.*大海/.test(normalized(row.text)))){
          await act({type:'key',key:'ENTER'});await observe('welcome-closed')
        }
        if(!ui.ok){await act({type:'key',key:'F4'});await observe('technology-opened')}
      }
      if(!ui.ok)throw new Error('没有确认科技界面，未盲点或继续请求模型。')
      let current=areaState()
      if(current?.state==='researching'){
        report.status='already_researching';report.verified=true;report.currentTechnology=current.currentTechnology
        return report
      }
      if(!current?.idle)throw new Error(`没有确认${names[area]}处于待选科技状态。`)
      if(!(ui.selection?.area===area&&ui.choices?.length)){
        await click(current.researchButton||current.select||current);await observe('candidates')
      }
      if(ui.selection?.area!==area||!ui.choices?.length)throw new Error('没有确认完整可见的当前学科科技候选。')
      const choices=ui.choices.map(row=>({...row,label:row.text||row.label}))
      if(choices.some(row=>!row.label)||new Set(choices.map(row=>normalized(row.label))).size!==choices.length)throw new Error('科技候选名称缺失或重复，未猜选。')
      const candidates=choices.map((row,index)=>({id:`${area}-${index}-${createHash('sha256').update(row.label).digest('hex').slice(0,10)}`,label:row.label,actualCost:row.actualCost||null,knownEffects:row.knownEffects||[]}))
      report.candidates=candidates
      onEvent({type:'planning',skill:'select_research',area,candidates:candidates.map(row=>row.label)})
      report.modelRequests++
      const decision=await planner({apiKey,model,candidates,context:{...context,slot:names[area]},timeoutMs:10000,signal});check()
      report.modelMs=decision.elapsedMs||0;report.usage=decision.usage;report.httpStatus=decision.httpStatus
      if(!decision.ok)throw new Error(decision.error?.message||'DeepSeek 没有返回有效科研选择。')
      const index=candidates.findIndex(row=>row.id===decision.choice?.technologyId)
      if(index<0)throw new Error('模型返回了候选以外的科技。')
      report.choice={...decision.choice,label:candidates[index].label}
      onEvent({type:'decision',skill:'select_research',area,...report.choice})
      // The paused candidate panel stays in place during this single bounded
      // call. Native input rechecks process identity, focus and dimensions.
      await click(choices[index]);await observe('verified')
      current=areaState()
      if(current?.state!=='researching')throw new Error('输入已发送，但主面板尚未确认所选科技进入研究。')
      if(normalized(current.currentTechnology)!==normalized(candidates[index].label)){
        report.status='started_unconfirmed';report.currentTechnology=current.currentTechnology
        report.message='已确认该学科进入研究；OCR名称尚未与选择一致，等待后续画面/己方存档复核，不重复重选。'
        onEvent({type:'research-started',area,technology:current.currentTechnology,choiceVerified:false})
        return report
      }
      report.status='complete';report.verified=true;report.currentTechnology=current.currentTechnology
      onEvent({type:'completed',skill:'select_research',area,technology:current.currentTechnology})
    }catch(error){report.error=error instanceof Error?error.message:'科研技能失败。';report.status=error?.name==='AbortError'?'stopped':'error'}
    finally{report.elapsedMs=Math.round(performance.now()-started);report.localMs=Math.round(report.localMs);running=false}
    return report
  }
  return{run,stop(){stopped=true},info:()=>({running,stopped})}
}
