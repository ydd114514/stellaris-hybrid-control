import {it,expect} from 'vitest'
import {NativeColonyAudit} from '../../stellaris-player/src/native-colony-audit.mjs'
import {OperationalContext} from '../../stellaris-player/src/operational-context.mjs'
import {unityBottleneckPlan} from '../packages/core/src/unity-bottlenecks'
import {digestSnapshot} from '../packages/core/src/ai-prompts'
import {guardStrategistPriority} from '../packages/core/src/operator-progress'

it('现有轮巡与岗位事实形成具体凝聚力闭环，未知不算零、缺人不堆空楼、已有施工不重复派单',async()=>{
 const now=100000,date='2204.01.01',calls:any[]=[]
 const state:any={date,player:{country_id:0,capital_system_id:1},colonies:[{colonies_summary:[{planet_id:2,name:'蜂巢首都'}]}],
  resources:{unity:{income:40,expense:5,net:35,net_known:true}},strategy:{unityProgress:{known:true,focused:true,stagnating:true}},
  operationalFacts:[]}
 const audit=new NativeColonyAudit()
 const options={rpc:async(method:string,params:any)=>{
  calls.push({method,...params});return {planet_id:2,name:'蜂巢首都',kpi:{pop_groups:100,amenities:5,housing:10},
   workforce_summary:{total_employed_workforce:20,total_effective_workforce:22,active_jobs_count:3,unemployed:0},
   monthly_production:{net:{unity:12}},construction_queue:[]}
 },onPlanet:()=>{}}
 state.colonyAudit=await audit.review(state,options)
 const context=new OperationalContext({now:()=>now})
 context.record('jobs',{success:true,planet_id:2,strata:[{jobs:[{job_key:'synapse_drone',current_workforce:20,max_workforce:30}]}]},{gameDate:date})
 state.operationalFacts=context.view({ownedPlanetIds:[2]})
 const deficit=unityBottleneckPlan(state,now)
 expect(deficit.facts.join('；')).toContain('20/30（不是凝聚力专属岗位）')
 expect(deficit.steps[0]).toContain('劳动力匹配');expect(deficit.steps[0]).toContain('避免继续堆空楼')
 expect(deficit.steps[0]).not.toContain('补查该星球jobs')
 const guarded=guardStrategistPriority({nextSteps:['先增加科研'],directive:{text:'科研优先',targetResource:'research'}},
  {note:'持续提高凝聚力净产',snapshot:{sessionId:'live-1',observedAt:now,state},now})
 expect(guarded.nextSteps[0]).toBe(deficit.steps[0])
 expect(guarded.executionPlans[0].text).toBe(deficit.steps[0])
 expect(guarded.directive).toMatchObject({targetResource:'unity',text:deficit.steps[0]})
 const digest=digestSnapshot({sessionId:'live-1',state:{...state,traditions:{noise:'x'.repeat(10000)}}},3500,now).text
 expect(digest).toContain('蜂巢首都[2]');expect(digest).toContain('劳动力匹配')
 expect(digest.indexOf('凝聚力瓶颈闭环')).toBeLessThan(100)

 const colony=state.colonyAudit.colonies[0]
 const plan=(patch:any)=>unityBottleneckPlan({...state,...patch},now)
 expect(plan({operationalFacts:[]}).steps[0]).toContain('仅补查该星球jobs')
 expect(plan({colonyAudit:{colonies:[{...colony,constructionCount:2}]}}).steps[0]).toContain('等真实完工，不重复排同类建设')
 expect(plan({colonyAudit:{colonies:[{...colony,amenities:-1}]}}).steps[0]).toContain('修复已知舒适度或住房缺口')
 context.record('jobs',{success:true,planet_id:2,strata:[{jobs:[{job_key:'synapse_drone',current_workforce:30,max_workforce:30}]}]},{gameDate:date})
 expect(plan({operationalFacts:context.view({ownedPlanetIds:[2]})}).steps[0]).toContain('已知岗位满员')
 const expense=plan({resources:{unity:{income:40,expense:30,net:10}}})
 expect(expense.steps[0]).toContain('复用已知法令和领袖费用');expect(expense.facts[0]).toContain('不能全算成法令维护')
 expect(plan({resources:{unity:{income:40,expense:30,expense_known:false}}}).steps[0]).not.toContain('支出')
 state.date='2204.02.01';state.colonyAudit=await audit.review(state,options)
 expect(calls).toHaveLength(1);expect(state.colonyAudit.colonies[0].ageDays).toBe(30)
 expect(unityBottleneckPlan(state,now).steps[0]).toContain('旧数据不当本轮改善依据')
 state.player.country_id=1;state.colonies=[]
 expect((await audit.review(state,options)).colonies).toEqual([])
})
