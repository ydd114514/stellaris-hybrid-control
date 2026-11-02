import {it,expect} from 'vitest'
import {createBlackboard,restoreBlackboard,addSuggestion,briefFor} from '../packages/core/src/ai-blackboard'
import {executionTaskBatch,planExecutionTasks,syncExecutionTasks} from '../packages/core/src/advice-execution-tasks'
import {createDirector,DEFAULT_DIRECTOR,type Directive} from '../packages/core/src/ai-director'
import type {AiAgentConfig} from '../packages/shared/src/ai'

function planned(){
 const board=createBlackboard();addSuggestion(board,{id:'s-1',name:'甲',text:'减少不合适的法令维护',at:900})
 Object.assign(board.audience.suggestions[0]!,{status:'adopted',executionGameSessionId:'game-1'})
 board.plan.nextSteps=['核查首府的凝聚力岗位'];let n=0
 const plan=()=>planExecutionTasks(board,{gameSessionId:'game-1',out:{executionPlans:[{suggestionId:'s-1',text:'核对收益后停用不合适的维护法令'},{suggestionId:'invented',text:'不得转成任务'}]},now:1000,id:()=>`execution-${++n}`})
 plan();return {board,plan}
}
it('采纳意见绑定独立稳定任务，改写回复和反复复盘不会重建，淘汰显示条目不丢任务',()=>{
 const {board,plan}=planned(),first=board.executionTasks!.tasks[0]!.id
 expect(board.executionTasks!.tasks).toHaveLength(2);expect(board.executionTasks!.tasks.some(t=>t.text==='不得转成任务')).toBe(false)
 plan();expect(board.executionTasks!.tasks[0]!.id).toBe(first);expect(board.executionTasks!.tasks).toHaveLength(2)
 for(let i=0;i<14;i++)addSuggestion(board,{id:`new-${i}`,name:'乙',text:'建议'+i,at:1100+i})
 expect(board.audience.suggestions.some(s=>s.id==='s-1')).toBe(false)
 const restored=restoreBlackboard(JSON.parse(JSON.stringify(board)))
 expect(executionTaskBatch(restored,'game-1',1200).some(t=>t.id===first)).toBe(true)
})
it('十二项传输分包公平续发，活跃旧任务不因下一轮步骤改变被挤掉',()=>{
 const {board}=planned();let n=10
 board.plan.nextSteps=Array.from({length:14},(_,i)=>'处理已有殖民地'+i)
 planExecutionTasks(board,{gameSessionId:'game-1',out:{},now:1100,id:()=>`execution-${++n}`})
 const first=executionTaskBatch(board,'game-1',1200),second=executionTaskBatch(board,'game-1',1300)
 expect(first).toHaveLength(12);expect(new Set([...first,...second].map(t=>t.id)).size).toBe(16)
 expect(board.executionTasks!.tasks).toHaveLength(16)
})
it('只认新鲜同局匹配回执，有依据才成功，终态不因旧任务续发复活',()=>{
 const {board}=planned(),task=board.executionTasks!.tasks[0]!
 const snapshot=(patch:any={})=>({sessionId:'game-1',observedAt:2000,state:{adviceExecution:{version:1,gameSessionId:'game-1',tasks:[{...task,updatedAt:2000,status:'succeeded',reason:'法令回读关闭',...patch}]}}})
 syncExecutionTasks(board,snapshot(),2000);expect(task.status).toBe('pending')
 syncExecutionTasks(board,{...snapshot({evidence:'当前法令清单已不含该项'}),observedAt:1},70000);expect(task.status).toBe('pending')
 syncExecutionTasks(board,snapshot({text:'别的目标',evidence:'不能借用别的目标回执'}),2000);expect(task.status).toBe('pending')
 syncExecutionTasks(board,snapshot({evidence:'当前法令清单已不含该项'}),2000);expect(task.status).toBe('succeeded')
 expect(board.audience.suggestions[0]!.execution).toMatchObject({taskId:task.id,status:'succeeded',evidence:'当前法令清单已不含该项'})
 expect(briefFor(board,'host',2000)).toContain('实际结果已确认')
 syncExecutionTasks(board,snapshot({status:'pending',updatedAt:2100}),2100);expect(task.status).toBe('succeeded')
 expect(executionTaskBatch(board,'game-1',2200).some(t=>t.id===task.id)).toBe(false)
})
it('新游戏不会续发旧局的已采纳意见',()=>{
 const {board}=planned();syncExecutionTasks(board,{sessionId:'game-2',observedAt:2000,state:{}},2000)
 expect(board.executionTasks).toBeUndefined();expect(board.audience.suggestions[0]!.execution).toBeUndefined()
 board.plan.nextSteps=[];planExecutionTasks(board,{gameSessionId:'game-2',out:{},now:2000,id:()=>`unused`})
 expect(executionTaskBatch(board,'game-2',2000)).toEqual([])
})
it('仅有经济方向而没有步骤时也建稳定任务，既有步骤不遮住新的方向',()=>{
 const {board}=planned();let n=20
 const plan=()=>planExecutionTasks(board,{gameSessionId:'game-1',out:{directive:{text:'持续提高凝聚力净产'}},now:1100,id:()=>`execution-${++n}`})
 plan();plan()
 expect(board.executionTasks!.tasks.filter(t=>t.text==='持续提高凝聚力净产')).toHaveLength(1)
})
it('没有方向指令时，真实采纳意见仍发布任务，控制器进展进入黑板和观众条目',async()=>{
 let now=1000000;const board=createBlackboard(),directives:Directive[]=[],agent:AiAgentConfig={id:'strategist',role:'strategist',label:'参谋',enabled:true,providerId:'test',model:'offline',temperature:0,maxTokens:1000,thinking:false}
 addSuggestion(board,{id:'s-1',name:'甲',text:'核查凝聚力维护',at:now})
 let receipt:any
 const director=createDirector({board,now:()=>now,agents:()=>[agent],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({sessionId:'game-1',observedAt:now,state:{date:'2240.01.01',adviceExecution:receipt}}),call:async()=>({text:JSON.stringify({suggestions:[{id:'s-1',decision:'adopted',reply:'先核查收益'}],nextSteps:['查看凝聚力收入和支出'],directive:null}),usage:{},latencyMs:0}),onDirective:d=>directives.push(d)})
 director.start();await director.tick();await new Promise<void>(resolve=>setImmediate(resolve))
 expect(directives).toHaveLength(1);const task=directives[0]!.executionTasks!.find(t=>t.source==='audience')!
 expect(task).toMatchObject({suggestionId:'s-1',text:'核查凝聚力维护'})
 now+=1000;receipt={version:1,gameSessionId:'game-1',tasks:[{...task,status:'blocked',reason:'当前具体维护明细未知，继续核查',updatedAt:now}]}
 await director.tick();await new Promise<void>(resolve=>setImmediate(resolve))
 expect(board.audience.suggestions[0]!.execution).toMatchObject({taskId:task.id,status:'blocked',reason:'当前具体维护明细未知，继续核查'})
 director.stop()
})
it('任务分包由无模型心跳快速送齐，之后一分钟续期，过期或跨局快照封口',async()=>{
 let now=1000000,calls=0,sessionId='game-1',stale=false;const board=createBlackboard(),directives:Directive[]=[]
 board.executionTasks={gameSessionId:sessionId,tasks:Array.from({length:20},(_,i)=>({id:`execution-${i}`,source:'strategist',text:`经营已有殖民地${i}`,at:now,status:'pending',reason:'待安排',updatedAt:now}))}
 const agent:AiAgentConfig={id:'strategist',role:'strategist',label:'参谋',enabled:true,providerId:'test',model:'offline',temperature:0,maxTokens:1000,thinking:false}
 const director=createDirector({board,now:()=>now,agents:()=>[agent],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({sessionId,observedAt:stale?now-61000:now,state:{date:'2240.01.01'}}),call:async()=>{calls++;return{text:'{}',usage:{},latencyMs:0}},onDirective:d=>directives.push(d)})
 const tick=async()=>{await director.tick();await new Promise<void>(resolve=>setImmediate(resolve))}
 director.start();await tick();expect(directives).toHaveLength(1);expect(directives[0]!.executionTasks).toHaveLength(12)
 now+=1000;await tick();expect(directives).toHaveLength(1)
 now+=2001;await tick();expect(directives).toHaveLength(2)
 expect(new Set(directives.flatMap(d=>d.executionTasks!.map(t=>t.id))).size).toBe(20);expect(calls).toBe(1)
 now+=1000;await tick();expect(directives).toHaveLength(2)
 now+=60000;await tick();expect(directives).toHaveLength(3);expect(calls).toBe(1)
 stale=true;now+=60000;await tick();expect(directives).toHaveLength(3)
 stale=false;sessionId='game-2';now+=1000;await tick();expect(directives).toHaveLength(3);expect(board.executionTasks).toBeUndefined()
 director.stop()
})
