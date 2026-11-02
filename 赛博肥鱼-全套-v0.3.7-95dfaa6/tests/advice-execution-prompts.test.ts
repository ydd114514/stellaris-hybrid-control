import {expect,it} from 'vitest'
import {restoreBlackboard} from '../packages/core/src/ai-blackboard'
import {digestSnapshot,hostMessages} from '../packages/core/src/ai-prompts'

it('执行受阻后给观众的说明使用实际回执，不复述原先立即完成的承诺',()=>{
 const messages=hostMessages({board:restoreBlackboard({}),danmaku:[],dropped:0,recentReplies:[],note:'',idle:false,now:1000,
  announce:[{id:'suggestion-1',name:'观众',text:'关掉低收益法令',at:500,status:'adopted',reply:'马上办完',execution:{taskId:'task-1',status:'blocked',reason:'当前法令清单读取不完整，尚未发送调整',updatedAt:1000}}]})
 const prompt=messages[1]!.content
 expect(prompt).toContain('当前法令清单读取不完整，尚未发送调整')
 expect(prompt).not.toContain('马上办完')
})

it('任务回执进入摘要且只认当前游戏局，不把别局的设置结果带过来',()=>{
 const state={adviceExecution:{version:1,gameSessionId:'game-1',tasks:[{id:'task-1',source:'audience',text:'核查旧法令维护负担',status:'verifying',reason:'已调整设置，继续看后续收支',updatedAt:1000}]}}
 expect(digestSnapshot({sessionId:'game-1',state}).text).toContain('核查旧法令维护负担')
 expect(digestSnapshot({sessionId:'game-1',state}).text).toContain('跟踪效果')
 expect(digestSnapshot({sessionId:'game-2',state}).text).not.toContain('核查旧法令维护负担')
})

it('议程选择按真实议程回执说明，发动未确认不冒充增益已生效',()=>{
 const text=digestSnapshot({state:{strategyExecution:{date:'2240.01.01',status:'attention',steeringConfirmed:true,domesticActions:[
  {type:'set_council_agenda',targetName:'无限机遇',status:'confirmed',confirmed:true},
  {type:'launch_council_agenda',targetName:'无限机遇',status:'unknown',confirmed:false}
 ]}}}).text
 expect(text).toContain('无限机遇：该次已核验议程选择')
 expect(text).toContain('无限机遇：结果未确认')
})
