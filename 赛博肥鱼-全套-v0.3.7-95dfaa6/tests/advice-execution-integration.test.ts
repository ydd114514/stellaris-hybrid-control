import {expect,it} from 'vitest'
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {createBlackboard,addSuggestion} from '../packages/core/src/ai-blackboard'
import {executionTaskBatch,planExecutionTasks,syncExecutionTasks} from '../packages/core/src/advice-execution-tasks'
import {readStrategyAdvice} from '../../stellaris-player/src/strategy-advice.mjs'
import {AdviceExecution} from '../../stellaris-player/src/advice-execution.mjs'
import {applyDomesticEdict} from '../../stellaris-player/src/strategy-contract.mjs'

it('真实发布协议贯通中文采纳意见、控制器执行回读和中控结果，重复续发不重建已完成任务',async()=>{
 const now=1000000,parent=resolve('.local/test-data');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'advice-integration-'))
 try{
  const board=createBlackboard();addSuggestion(board,{id:'s-1',name:'观众',text:'关闭科研补贴',at:now})
  Object.assign(board.audience.suggestions[0]!,{status:'adopted',executionGameSessionId:'game-1'})
  planExecutionTasks(board,{gameSessionId:'game-1',out:{},now,id:()=>`execution-1`})
  const tasks=executionTaskBatch(board,'game-1',now),file=join(root,'directive.json')
  await writeFile(file,JSON.stringify({version:1,source:'cyberfish-ai-hub',id:'directive-1',gameSessionId:'game-1',at:now,text:'核对维护收益并调整',executionTasks:tasks}))
  const advice=await readStrategyAdvice(file,'game-1',now);expect(advice).toBeDefined()
  const state={date:'2240.01.01',resources:{unity:{net:30}}},ledger=new AdviceExecution({now:()=>now})
  ledger.bind('game-1','world-1',state);ledger.ingest(advice!.executionTasks,state);ledger.start([tasks[0]!.id],state)
  let active=true,writes=0;const receipt:any={taskId:tasks[0]!.id}
  await applyDomesticEdict({action:{type:'toggle_edict',arguments:{edict_key:'research_subsidies',enabled:false}},receipt,
   rpc:async()=>({summary:{active_edicts_count:active?1:0},active_edicts:active?[{key:'research_subsidies',name:'科研补贴'}]:[],available_edicts:[{key:'research_subsidies',name:'科研补贴'}]}),
   write:async()=>{writes++;active=false;return {success:true}}})
  ledger.finish([tasks[0]!.id],{status:'applied',domesticActions:[receipt]},state)
  syncExecutionTasks(board,{sessionId:'game-1',observedAt:now,state:{adviceExecution:ledger.view()}},now)
  expect(board.audience.suggestions[0]!.execution).toMatchObject({status:'succeeded'})
  expect(board.audience.suggestions[0]!.execution!.evidence).toBeTruthy()
  ledger.ingest(advice!.executionTasks,state);expect(ledger.view().tasks).toHaveLength(1)
  expect(executionTaskBatch(board,'game-1',now+1)).toEqual([]);expect(writes).toBe(1)
 }finally{if(dirname(root)!==parent)throw Error('测试目录不符');await rm(root,{recursive:true,force:true})}
})
