import {clip} from './ai-blackboard'

const known=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)
/** Existing readbacks → bounded diagnoses. No orders, guessed vacancies or new RPCs. */
export function unityBottleneckPlan(state:any,now:number):{facts:string[];steps:string[]}{
 const facts:string[]=[],steps:string[]=[]
 const u=state?.resources?.unity
 if(u?.income_known!==false&&u?.expense_known!==false&&known(u?.income)&&u.income>0&&known(u?.expense)&&u.expense/u.income>=.5){
  facts.push(`全国凝聚力收入${u.income}、支出${u.expense}；支出来源尚须按已知法令和领袖费用区分，不能全算成法令维护`)
  steps.push('提高凝聚力净产：复用已知法令和领袖费用，只补查未知支出；合法调整经核验的低收益项，再回读支出与净产')
 }
 const colonies=(Array.isArray(state?.colonyAudit?.colonies)?state.colonyAudit.colonies:[]).filter((c:any)=>
  Number.isSafeInteger(c?.planetId)&&known(c.ageDays)&&c.ageDays>=0&&c.ageDays<=180)
 const risk=(c:any)=>(known(c.amenities)&&c.amenities<0?4:0)+(known(c.housing)&&c.housing<0?4:0)+(known(c.unemployed)&&c.unemployed>0?2:0)
 for(const c of [...colonies].sort((a:any,b:any)=>risk(b)-risk(a)||a.ageDays-b.ageDays).slice(0,2)){
  const name=clip(c.name,20)||`星球${c.planetId}`,detail:string[]=[]
  if(known(c.popGroups))detail.push(`人口组${c.popGroups}`)
  if(known(c.unemployed))detail.push(`失业${c.unemployed}`)
  if(known(c.amenities))detail.push(`舒适度${c.amenities}`)
  if(known(c.housing))detail.push(`住房${c.housing}`)
  if(known(c.unityNet))detail.push(`凝聚力净贡献${c.unityNet}`)
  if(known(c.constructionCount))detail.push(`施工${c.constructionCount}项`)
  const row=(Array.isArray(state?.operationalFacts)?state.operationalFacts:[]).find((r:any)=>r.topic==='jobs'&&r.entityId===c.planetId&&r.gameDate===state.date&&
   known(r.observedAt)&&now-r.observedAt>=0&&now-r.observedAt<=60000&&r.economy?.workforceKnown===true)
  const jobs=row?.economy,filled=jobs&&known(jobs.employedWorkforce)&&known(jobs.capacityWorkforce)&&jobs.capacityWorkforce>=jobs.employedWorkforce
  if(filled)detail.push(`全星球岗位劳动力${jobs.employedWorkforce}/${jobs.capacityWorkforce}（不是凝聚力专属岗位）`)
  facts.push(`${name}[${c.planetId}]，${clip(c.observedDate,20)}核对：${detail.join('、')||'人口、岗位与产出明细未知'}`)
  if(c.ageDays>0){steps.push(`提高${name}凝聚力净产：已有历史明细，先更新该星球当前瓶颈；旧数据不当本轮改善依据`);continue}
  if(known(c.amenities)&&c.amenities<0||known(c.housing)&&c.housing<0){
   steps.push(`提高${name}凝聚力有效产出：先让原生AI修复已知舒适度或住房缺口，复用已有队列；回读缺口、岗位填充与净产`)
  }else if(known(c.constructionCount)&&c.constructionCount>0){
   steps.push(`提高${name}凝聚力净产：已有施工，核对是否解决瓶颈并等真实完工，不重复排同类建设；回读岗位与净产`)
  }else if(filled&&jobs.employedWorkforce<jobs.capacityWorkforce){
   steps.push(`提高${name}凝聚力净产：已知全星球岗位尚未填满，优先让原生AI解决劳动力匹配，避免继续堆空楼；回读填充与净产`)
  }else if(filled&&jobs.capacityWorkforce>0){
   steps.push(`提高${name}凝聚力净产：已知岗位满员，核对真实可用凝聚力容量与升级候选，交原生AI建设；回读容量和净产，不重复设优先`)
  }else{
   steps.push(`提高${name}凝聚力净产：岗位填充与容量未知，仅补查该星球jobs；再区分劳动力或容量瓶颈，交原生AI经营并回读净产`)
  }
 }
 return {facts:facts.slice(0,3),steps:steps.slice(0,3).map(s=>clip(s,100))}
}
