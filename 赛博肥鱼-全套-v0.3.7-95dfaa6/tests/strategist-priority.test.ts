import {it,expect} from 'vitest'
import {createDirector,DEFAULT_DIRECTOR,type Directive} from '../packages/core/src/ai-director'
import {guardStrategistPriority} from '../packages/core/src/operator-progress'
import type {AiAgentConfig} from '../packages/shared/src/ai'

it('本人持续凝聚力目标同时约束参谋黑板、任务、指令与standing，真实危机和已完成阶段才允许临时偏移',async()=>{
 const now=1_000_000,note='战时要求：被入侵时造船打赢。平时经营要求：切实提高凝聚力净产和传统推进，不设固定月产或年份。'
 const snapshot={sessionId:'round-1',observedAt:now,stopped:false,state:{date:'2200.01.01',wars:[],
  resources:{energy:{stockpile:600,net:-1,net_known:true},unity:{stockpile:100,net:12,net_known:true}},
  operatorStanding:{version:1,source:'cyberfish-ai-hub',kind:'operator-standing',gameSessionId:'round-1',text:note,economyFocus:'unity_traditions'},
  ascensionPerks:{adopted:[]}}}
 const research={focus:'优先新增3个科研岗位',goals:['增加科研产出'],nextSteps:['核对科研岗位与劳动力缺口','凝聚力只要保持正数'],
  executionPlans:[{text:'核对科研岗位与劳动力缺口'}],operator:{economyFocus:'research',status:'done',until:{date:'',condition:''},evidence:'凝聚力已经为正'},
  directive:{text:'优先新增3个科研岗位',targetResource:'research'}}
 const agent:AiAgentConfig={id:'strategist',role:'strategist',label:'游戏参谋',enabled:true,providerId:'offline',model:'offline',temperature:0,maxTokens:1000,thinking:false}
 const directives:Directive[]=[],reviews:any[]=[]
 const director=createDirector({now:()=>now,agents:()=>[agent],config:()=>({...DEFAULT_DIRECTOR,strategyNote:note}),readSnapshot:async()=>snapshot,
  call:async()=>({text:JSON.stringify(research),usage:{},latencyMs:0}),onDirective:d=>directives.push(d),onReview:r=>reviews.push(r)})
 director.start();await director.tick();await new Promise<void>(done=>setImmediate(done))
 const first=director.board.plan.nextSteps[0]!
 expect(first).toContain('持续提高凝聚力净产')
 expect(director.board.plan.nextSteps).toContain('核对科研岗位与劳动力缺口')
 expect(director.board.plan.nextSteps.join('；')).not.toContain('保持正数')
 expect(director.board.executionTasks?.tasks[0]).toMatchObject({text:first,status:'pending'})
 expect(director.board.executionTasks?.tasks.some(t=>t.text==='核对科研岗位与劳动力缺口')).toBe(true)
 expect(directives[0]).toMatchObject({targetResource:'unity',text:first,nextSteps:director.board.plan.nextSteps})
 expect(reviews[0]?.operator).toMatchObject({economyFocus:'unity_traditions',status:'blocked'})
 expect(first).not.toMatch(/600|2250/);director.stop()

 const guard=(state:any,at=now)=>guardStrategistPriority(research,{note,snapshot:{...snapshot,observedAt:at,state:{...snapshot.state,...state}},now})
 expect(guard({wars:[{war_id:1}]}).directive.targetResource).toBe('research')
 expect(guard({resources:{energy:{stockpile:60,net:-10,net_known:true}}}).directive.targetResource).toBe('research')
 for(const row of [{stockpile:61,net:-10,net_known:true},{stockpile:10,net:-10,net_known:false},{stockpile:undefined,net:-10,net_known:true}]){
  expect(guard({resources:{energy:row}}).directive.targetResource).toBe('unity')
 }
 expect(guard({wars:[{war_id:1}]},now-60001).directive.targetResource).toBe('unity')
 expect(guard({wars:[{war_id:1}]}).operator.economyFocus).toBe('unity_traditions')
 const concrete='核对营养补贴实际维护费，确认收益低且允许停用时关闭，并回读凝聚力净产'
 expect(guardStrategistPriority({...research,directive:{text:concrete,targetResource:'unity'}},{note,snapshot,now}).directive.text).toBe(concrete)
 const stageNote='先持续提高凝聚力，第三个飞升后转科研'
 for(const count of [2,3]){
  const output=guardStrategistPriority(research,{note:stageNote,snapshot:{...snapshot,state:{...snapshot.state,ascensionPerks:{adopted:Array.from({length:count},(_,i)=>({key:`ap_${i}`}))}}},now})
  expect(output.directive.targetResource).toBe(count===3?'research':'unity')
 }
 expect(guardStrategistPriority(research,{note:'科研优先，不再主拉凝聚力',snapshot,now})).toBe(research)
})
