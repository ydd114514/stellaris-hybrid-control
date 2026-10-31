import {clip} from './ai-blackboard'

/** Read only the session's allowlisted, recent factual digest, never raw native replies. */
export function operationalFactLines(state:any,now:number,maxChars=1100):string[] {
  const topics=new Set(['planet','buildings','jobs','government','traditions','ascension','military','research','zones','upgrades'])
  let left=Math.max(0,maxChars);const result:string[]=[]
  for(const row of Array.isArray(state?.operationalFacts)?state.operationalFacts.slice(0,10):[]) {
    if(!topics.has(row?.topic)||!Number.isFinite(row.observedAt)||now-row.observedAt>60000||row.observedAt>now+5000)continue
    if(row.topic==='military'&&row.basis) {
      const current=state.capacities?.naval_capacity
      if(Number.isFinite(current?.used)&&Number.isFinite(row.basis.navalUsed)&&current.used!==row.basis.navalUsed||Number.isFinite(current?.capacity)&&Number.isFinite(row.basis.navalCapacity)&&current.capacity!==row.basis.navalCapacity)continue
    }
    const prefix=`近期查询/${row.topic}（操作前重新核验）：`
    if(left<prefix.length+20)continue
    const facts=clip(row.facts,Math.min(500,left-prefix.length))
    if(!facts)continue
    result.push(prefix+facts);left-=facts.length+prefix.length
  }
  return result
}

export function capabilityLines(state:any):string[] {
  if(state?.capabilities?.version!==1)return ['当前控制器未报告能力清单，不能保证升级首府、改革或改装等操作可执行。']
  const list=Array.isArray(state.capabilities.limitations)?state.capabilities.limitations:[]
  return list.slice(0,5).map((x:unknown)=>clip(x,90)).filter(Boolean)
}
