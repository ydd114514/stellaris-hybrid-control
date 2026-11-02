import type {AiOperatorJudgment,AiUnityProgress} from '../../shared/src/ai'
import {clip} from './ai-blackboard'
import {unityBottleneckPlan} from './unity-bottlenecks'

export function confirmedAscensionCount(adopted:unknown):number|null{
 if(!Array.isArray(adopted)||adopted.length>8||!adopted.every(x=>typeof x?.key==='string'&&x.key.startsWith('ap_')))return null
 return new Set(adopted.map(x=>x.key)).size
}

/** Normalize one strategist result before its board, tasks and directive split. */
export function guardStrategistPriority(out:Record<string,any>,{note,snapshot,now}:{note:string;snapshot:any;now:number}):Record<string,any>{
 const state=snapshot?.state??{},standing=state.operatorStanding
 const explicitResearchStage=/第?三(?:个|项|次)?\s*飞升/.test(note)&&/(?:后|再).*科研/.test(note)
 if(explicitResearchStage&&(confirmedAscensionCount(state.ascensionPerks?.adopted)??-1)>=3)return out
 const sameStanding=standing?.version===1&&standing.source==='cyberfish-ai-hub'&&standing.kind==='operator-standing'&&
  standing.gameSessionId===snapshot?.sessionId&&standing.text===note&&standing.economyFocus==='unity_traditions'
 const explicitUnity=note.split(/[。；;！？\n]/).some(clause=>
  /(?:提高|提升|持续|主攻|主拉|优先|加强|发展|增加|拉|好好|重点|切实).{0,16}凝聚|凝聚.{0,16}(?:净产|优先|重点|增长|发展|推进)/.test(clause)&&
  !/(?:不要|不再|不用|无需|不必|停止|取消|放弃).{0,8}(?:提高|提升|主攻|主拉|拉|发展|优先).{0,4}凝聚|凝聚.{0,8}(?:不再|无需|不用)(?:优先|提高|提升|发展)/.test(clause))
 if(!sameStanding&&!explicitUnity&&!explicitResearchStage)return out
 // The standing describes the owner's continuing goal, including during a
 // temporary emergency. It must not inherit a model's unrelated research focus.
 const operator={...(out.operator&&typeof out.operator==='object'?out.operator:{until:{date:'',condition:''},status:'blocked',evidence:'持续凝聚力目标尚需实际增长依据'}),economyFocus:'unity_traditions'}
 const live=!snapshot?.stopped&&Number.isFinite(snapshot?.observedAt)&&now-snapshot.observedAt>=0&&now-snapshot.observedAt<=60000
 const shortage=live&&['energy','minerals','alloys','food','consumer_goods'].some(key=>{
  const r=state.resources?.[key]
  return r?.net_known!==false&&r?.stockpile_known!==false&&Number.isFinite(r?.net)&&r.net<0&&
   Number.isFinite(r?.stockpile)&&Math.max(0,r.stockpile)/-r.net<=6
 })
 // War instructions in the note are conditional policy, never evidence of war.
 if(live&&(Array.isArray(state.wars)&&state.wars.length>0||shortage))return {...out,operator}
 const bottlenecks=unityBottleneckPlan(state,now)
 const step=bottlenecks.steps[0]??'持续提高凝聚力净产并推进传统；核对岗位、劳动力、维护与已有殖民地瓶颈，按实际净产和传统进展复查调整'
 const weakUnity=(text:string)=>/凝聚/.test(text)&&/(?:保持|维持|确保|只要).{0,8}(?:正数|正值|为正|正产|不亏|收支平衡)/.test(text)
 const steps=(Array.isArray(out.nextSteps)?out.nextSteps:[]).map((x:unknown)=>clip(x,100)).filter((x:string)=>x&&!weakUnity(x)&&x!==step)
 const plans=(Array.isArray(out.executionPlans)?out.executionPlans:[]).filter((p:any)=>clip(p?.text,200)&&!weakUnity(p.text)&&p.text!==step)
 const goals=(Array.isArray(out.goals)?out.goals:[]).map((x:unknown)=>clip(x,80)).filter((x:string)=>x&&!weakUnity(x))
 const directiveText=out.directive?.targetResource==='unity'&&clip(out.directive.text,200)&&!weakUnity(out.directive.text)?clip(out.directive.text,200):step
 return {...out,operator,focus:'持续提高凝聚力净产与传统推进，兼顾其他经营任务',
  goals:['提高凝聚力净产并推进传统，按实际效果持续调整',...goals].slice(0,5),
  nextSteps:[...new Set([step,...bottlenecks.steps.slice(1),...steps])].slice(0,6),executionPlans:[...(bottlenecks.steps.length?bottlenecks.steps.map(text=>({text})):[{text:step}]),...plans].slice(0,12),
  directive:{...(out.directive&&typeof out.directive==='object'?out.directive:{}),priority:out.directive?.priority==='high'?'high':'normal',text:directiveText,targetResource:'unity'}}
}

/** Game facts gate both public completion claims and private execution labels. */
export function guardOperatorProgress(judgment:AiOperatorJudgment|undefined,{note,progress,ascensionPerkCount,previousFocus}:{note:string;progress?:AiUnityProgress;ascensionPerkCount:number|null;previousFocus?:string|null}){
 if(!judgment)return judgment
 const explicitResearchStage=/第?三(?:个|项|次)?\s*飞升/.test(note)&&/(?:后|再).*科研/.test(note)
 const researchStageReached=explicitResearchStage&&ascensionPerkCount!==null&&ascensionPerkCount>=3
 const unityGoal=progress?.focused||judgment.economyFocus==='unity_traditions'||previousFocus==='unity_traditions'||/凝聚/.test(note)||explicitResearchStage
 if(!unityGoal||researchStageReached)return judgment
 if(progress?.known&&(progress.stagnating||progress.scalingBehind)&&['on_track','done'].includes(judgment.status)){
  return {...judgment,status:'blocked' as const,evidence:clip(progress.reasons.join('；')||'凝聚力实际增长或传统推进停滞，切换档位不代表目标已落实。',300)}
 }
 if(judgment.status==='done'){
  // A sustained goal has no implicit finishing line. A healthy trend can prove
  // progress, but neither an arbitrary until string nor missing warnings prove completion.
  const baseline=progress?.baseline
  const growing=progress?.known&&progress.net!==null&&progress.net>0&&baseline?.observedYears!==null&&baseline?.observedYears!==undefined&&baseline.observedYears>0&&((baseline.netGrowthPercent!==null&&baseline.netGrowthPercent>0)||(baseline.traditionsGained!==null&&baseline.traditionsGained>0))
  return {...judgment,status:growing?'on_track' as const:'blocked' as const,evidence:growing?'同局凝聚力有实际增长，持续目标仍需保持；尚未核实可结束本阶段的条件。':'尚无充分的同局增长或阶段完成依据，不能确认凝聚力要求已完成。'}
 }
 return judgment
}
