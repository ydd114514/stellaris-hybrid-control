const settle=()=>new Promise<void>(resolve=>setImmediate(resolve))
import {describe,expect,it} from 'vitest'
import {createDirector,DEFAULT_DIRECTOR,type Spoken} from '../packages/core/src/ai-director'
import {createBlackboard,restoreBlackboard} from '../packages/core/src/ai-blackboard'
import {createAudienceTask,normalizeQuery,restoreAudienceTasks,syncAudienceTasks} from '../packages/core/src/audience-query-tasks'
import type {AiAudienceQueryBus,AiAgentConfig,AiBlackboard} from '../packages/shared/src/ai'
const host:AiAgentConfig={id:'host',role:'host',label:'场控老师',enabled:true,providerId:'offline',model:'offline',temperature:1,maxTokens:600,thinking:false}
const event={id:'event-1',kind:'chat' as const,platform:'bilibili' as const,text:'首都首府是什么等级？',user:{id:'u1',name:'观众甲'},at:1000000}
function fixture(options:{board?:AiBlackboard;reply?:(round:number,d:ReturnType<typeof createDirector>)=>unknown;publish?:(lines:Spoken[])=>unknown}={}){
  let now=1000000,sessionId='game-1',stopped=false,results:unknown,round=0
  const buses:AiAudienceQueryBus[]=[],said:Spoken[]=[]
  const snapshot=()=>({sessionId,observedAt:now,stopped,state:{date:'2324.05.01'}})
  const d=createDirector({now:()=>now,board:options.board,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>snapshot(),readQueryResults:async()=>results,
    onQueries:bus=>{buses.push(structuredClone(bus))},onSay:lines=>{if(options.publish)return options.publish(lines);said.push(...lines)},
    call:async()=>({text:JSON.stringify(options.reply?options.reply(++round,d):round++===0?{replies:[],queries:[{eventId:event.id,topic:'upgrades',entityId:3}]}:{replies:[{taskId:d.board.audience.tasks?.[0]?.id,text:'首府为行星首府，当前可以升级。'}]}),usage:{},latencyMs:0})})
  return {d,buses,said,snapshot,advance:(ms=8000)=>{now+=ms},now:()=>now,setSession:(s:string)=>{sessionId=s},setStopped:()=>{stopped=true},setResults:(value:unknown)=>{results=value},respond:(overrides:Record<string,unknown>={})=>{const bus=buses.filter(b=>b.requests.length).at(-1)!;const q=bus.requests[0]!;results={version:1,source:'cyberfish-audience-query-results',runId:bus.runId,gameSessionId:bus.gameSessionId,updatedAt:now,results:[{id:q.id,taskId:q.taskId,status:'ok',facts:'地球首府为行星首府，升级候选可用。',observedAt:now}],...overrides}}}
}
describe('观众只读问题闭环',()=>{
  it('问题绑定来源、只读查询得到事实后，发布确认才标已答复，采纳建议不算答复',async()=>{
    const x=fixture();x.d.start();x.d.feed(event);await x.d.tick();await settle()
    const task=x.d.board.audience.tasks![0]!
    expect(task).toMatchObject({status:'querying',sourceEventId:event.id,query:{topic:'upgrades',entityId:3},gameSessionId:'game-1'})
    expect(task.answerId).toBeUndefined();expect(x.said).toEqual([])
    const bus=x.buses.at(-1)!;expect(JSON.stringify(bus)).not.toContain(event.text);expect(JSON.stringify(bus)).not.toContain(event.user.name)
    x.d.board.audience.suggestions.push({id:'s1',name:'观众',text:'升级首府',at:x.now(),status:'adopted'})
    expect(task.status).toBe('querying')
    x.advance();x.respond();await x.d.tick();await settle()
    expect(task).toMatchObject({status:'answered',answerId:`answer-${task.id}`,answeredAt:x.now()})
    expect(x.said).toHaveLength(1);expect(x.said[0]).toMatchObject({taskId:task.id,text:'首府为行星首府，当前可以升级。'})
    x.advance();await x.d.tick();await settle();expect(x.said).toHaveLength(1)
    expect(x.d.feed(event)).toBe(false)
  })
  it('答复出口未保存时保持ready，重试使用同一个稳定答复ID',async()=>{
    const attempts:string[]=[]
    const x=fixture({publish:lines=>{attempts.push(lines[0]!.id);if(attempts.length===1)throw new Error('offline write failed')}})
    x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance();x.respond();await x.d.tick();await settle()
    expect(x.d.board.audience.tasks![0]!.status).toBe('ready')
    x.advance();await x.d.tick();await settle();expect(x.d.board.audience.tasks![0]!.status).toBe('answered')
    expect(attempts[1]).toBe(attempts[0])
  })
  it('同一提问的不同星球分别查询，同参数去重且每个子任务独立确认答复',async()=>{
    const x=fixture({reply:(round,d)=>round===1?{replies:[],queries:[{eventId:event.id,topic:'upgrades',entityId:3},{eventId:event.id,topic:'upgrades',entityId:215},{eventId:event.id,topic:'upgrades',entityId:3}]}:{replies:d.board.audience.tasks!.filter(t=>t.status==='ready').map(t=>({taskId:t.id,text:'这一颗首府的情况已核实。'}))}})
    x.d.start();x.d.feed(event);await x.d.tick();await settle();expect(x.d.board.audience.tasks).toHaveLength(2)
    const bus=x.buses.at(-1)!;x.advance();x.setResults({version:1,source:'cyberfish-audience-query-results',runId:bus.runId,gameSessionId:bus.gameSessionId,updatedAt:x.now(),results:bus.requests.map(q=>({id:q.id,taskId:q.taskId,status:'ok',facts:`星球${q.entityId}首府可升级。`,observedAt:x.now()}))})
    await x.d.tick();await settle();expect(x.d.board.audience.tasks!.every(t=>t.status==='answered')).toBe(true);expect(x.said).toHaveLength(2)
  })
  it('过期或其他run/session结果不能成为事实，超时后给明确终态答复',async()=>{
    const x=fixture({reply:(round,d)=>round===1?{replies:[],queries:[{eventId:event.id,topic:'research'}]}:{replies:[{taskId:d.board.audience.tasks![0]!.id,text:'这次查询超时了，暂时无法确认。'}]}})
    x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance();x.respond({runId:'foreign-run'});await x.d.tick();await settle()
    expect(x.d.board.audience.tasks![0]!.status).toBe('querying')
    x.respond({gameSessionId:'foreign-game'});await x.d.tick();await settle();expect(x.d.board.audience.tasks![0]!.facts).toBeUndefined()
    x.advance(60000);await x.d.tick();await settle();expect(x.d.board.audience.tasks![0]).toMatchObject({status:'answered',reason:'expired'})
    expect(x.said).toHaveLength(1)
  })
  it.each(['unavailable','timed_out'])('%s只能给固定失败说明，模型不能把受限问题编成成功答案',async status=>{
    const x=fixture({reply:(round,d)=>round===1?{replies:[],queries:[{eventId:event.id,topic:'government'}]}:{replies:[{taskId:d.board.audience.tasks![0]!.id,text:'你问的首府全部已升级完成，库存99999。'}]}})
    x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance()
    if(status==='unavailable'){const bus=x.buses.at(-1)!,q=bus.requests[0]!;x.setResults({version:1,source:'cyberfish-audience-query-results',runId:bus.runId,gameSessionId:bus.gameSessionId,updatedAt:x.now(),results:[{id:q.id,taskId:q.taskId,status:'unavailable',reason:'unsupported',observedAt:x.now()}]})}
    else x.advance(60000)
    await x.d.tick();await settle()
    expect(x.said).toHaveLength(1);expect(x.said[0]!.text).not.toContain('99999');expect(x.said[0]!.text).not.toContain('升级完成')
    expect(x.d.board.audience.tasks![0]!.answer).toBe(x.said[0]!.text)
  })
  it('模型不能引用不在当前批次的eventId，也不能把订单或任意参数混入查询',async()=>{
    const x=fixture({reply:()=>({replies:[],queries:[{eventId:'forged',topic:'jobs',entityId:3},{eventId:event.id,topic:'jobs',entityId:3,command:'delete_save'}]})})
    x.d.start();x.d.feed(event);await x.d.tick();await settle()
    expect(x.d.board.audience.tasks).toHaveLength(1);expect(x.d.board.audience.tasks![0]).toMatchObject({status:'unavailable',reason:'unsupported'})
    expect(x.buses.every(b=>b.requests.length===0)).toBe(true)
    expect(normalizeQuery({topic:'shell',entityId:3})).toBeUndefined()
    expect(normalizeQuery({topic:'military',entityId:3})).toBeUndefined()
  })
  it('停止清除请求并取消未答任务，旧结果或重投弹幕不能恢复旧答复',async()=>{
    const x=fixture();x.d.start();x.d.feed(event);await x.d.tick();await settle();x.respond();x.d.stop();await x.d.flushQueries()
    expect(x.buses.at(-1)?.requests).toEqual([]);expect(x.d.board.audience.tasks![0]?.status).toBe('cancelled')
    x.d.start();x.advance();await x.d.tick();await settle();expect(x.said).toEqual([]);expect(x.d.feed(event)).toBe(false)
  })
  it('切换游戏局取消旧问题，不将旧局事实公开成新局事实',async()=>{
    const x=fixture();x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance();x.respond();x.setSession('game-2');await x.d.tick();await settle()
    expect(x.d.board.audience.tasks![0]).toMatchObject({status:'cancelled',reason:'cross_session'})
    expect(x.said).toEqual([])
  })
  it('崩溃恢复保留问题，当前同局重新绑定新run和请求，不依赖重投弹幕',async()=>{
    const x=fixture();x.d.start();x.d.feed(event);await x.d.tick();await settle()
    const board=restoreBlackboard(JSON.parse(JSON.stringify(x.d.board))),old=structuredClone(board.audience.tasks![0]!)
    const y=fixture({board});y.d.start();await y.d.tick();await settle()
    expect(board.audience.tasks![0]).toMatchObject({id:old.id,status:'querying',gameSessionId:'game-1'})
    expect(board.audience.tasks![0]!.runId).not.toBe(old.runId);expect(y.buses.at(-1)?.requests).toHaveLength(1)
  })
  it('已确认公开的任务持久恢复后不会重复答复',async()=>{
    const x=fixture();x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance();x.respond();await x.d.tick();await settle()
    const board=restoreBlackboard(JSON.parse(JSON.stringify(x.d.board)))
    const y=fixture({board});y.d.start();await y.d.tick();await settle();expect(y.said).toEqual([]);expect(y.d.feed(event)).toBe(false)
  })
  it('模型反复不给最终答复时，三次机会后明确结束，不能无限承诺下轮',async()=>{
    const x=fixture({reply:round=>round===1?{replies:[],queries:[{eventId:event.id,topic:'government'}]}:{replies:[]}})
    x.d.start();x.d.feed(event);await x.d.tick();await settle();x.advance();x.respond()
    for(let n=0;n<3;n++){await x.d.tick();await settle();x.advance()}
    expect(x.d.board.audience.tasks![0]).toMatchObject({status:'answered',reason:'answer_unavailable',answerAttempts:3})
    expect(x.said).toHaveLength(1);expect(x.said[0]!.text).toContain('没能可靠回答')
  })
  it('任务、在途请求和恢复字段均有界，异常字段和重复ID不会进入持久状态',()=>{
    const board=createBlackboard()
    for(let n=0;n<60;n++)createAudienceTask(board,{id:`q-${n}`,requestId:`query-${n}`,runId:'run',event:{id:`e${n}`,name:'观众',text:'问题'},query:{topic:'government'},snapshot:{sessionId:'game-1',observedAt:1000,state:{}},now:1000})
    expect(board.audience.tasks).toHaveLength(32);expect(board.audience.tasks!.filter(t=>t.status==='querying')).toHaveLength(8)
    const task=board.audience.tasks![0]!
    expect(restoreAudienceTasks([{...task,command:'shell'},task])).toHaveLength(1)
    expect(JSON.stringify(restoreAudienceTasks([{...task,command:'shell'}]))).not.toContain('shell')
    const changed=syncAudienceTasks(board,{snapshot:{sessionId:'game-1',observedAt:90000,state:{}},results:{},runId:'run',now:90000,requestId:()=> 'query-new'})
    expect(changed).toBe(true);expect(board.audience.tasks!.filter(t=>t.status==='querying')).toHaveLength(0)
  })
})
