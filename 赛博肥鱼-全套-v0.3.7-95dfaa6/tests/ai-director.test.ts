import { describe, expect, it } from 'vitest'
import { createDirector, DEFAULT_DIRECTOR, type Directive, type Spoken } from '../packages/core/src/ai-director'
import { briefFor, restoreBlackboard, addSuggestion, applyStrategist } from '../packages/core/src/ai-blackboard'
import { digestSnapshot, HOST_SYSTEM, STRATEGIST_SYSTEM, strategistMessages } from '../packages/core/src/ai-prompts'
import type { AiAgentConfig } from '../packages/shared/src/ai'
import type { AiMessage } from '../packages/core/src/ai-providers'

const agents: AiAgentConfig[] = [
  { id: 'host', role: 'host', label: '场控老师', enabled: true, providerId: 'gemini', model: 'gemini-2.5-flash', temperature: 1, maxTokens: 600, thinking: false },
  { id: 'strategist', role: 'strategist', label: '游戏参谋', enabled: true, providerId: 'deepseek', model: 'deepseek-flash', temperature: 0.4, maxTokens: 1200, thinking: true },
]
const snapshot = { state: { date: '2230.05.01', resources: { energy: { amount: 300, net: 12.5 }, alloys: { amount: 80, net: -2 } }, capacities: { colonies: 4 }, military: { fleets: [{ total_ships: 6 }, { total_ships: 3 }] }, pendingEvents: [] }, metrics: { orders: 10, verified: 9 } }
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
const chat = (id: string, name: string, text: string, at: number) => ({ id, kind: 'chat' as const, platform: 'bilibili' as const, user: { id: name, name }, text, at })

function setup(reply: (agent: AiAgentConfig, messages: AiMessage[]) => unknown, config = { ...DEFAULT_DIRECTOR, replyIntervalSeconds: 5, idleCommentSeconds: 0 }) {
  let t = 1_000_000
  const calls: { agent: string; messages: AiMessage[] }[] = [], said: Spoken[] = [], directives: Directive[] = []
  const director = createDirector({ now: () => t, agents: () => agents, config: () => config, readSnapshot: async () => snapshot,
    call: async (agent, messages) => { calls.push({ agent: agent.id, messages }); return { text: JSON.stringify(reply(agent, messages)), usage: { inputTokens: 100, outputTokens: 20 }, latencyMs: 5 } },
    onSay: lines => said.push(...lines), onDirective: d => directives.push(d) })
  return { director, calls, said, directives, advance: (ms: number) => { t += ms }, now: () => t }
}

describe('AI director', () => {
  it('参谋先复盘局势，场控读到参谋的话题并成批回弹幕', async () => {
    const { director, calls, said, advance } = setup(agent => agent.role === 'strategist'
      ? { date: '2230.05.01', summary: '经济稳定，合金略亏。', threats: ['合金赤字'], goals: ['扩张到6颗星球'], focus: '先补合金再扩张', nextSteps: ['新建合金厂'], talkingPoint: '舰长的合金快不够了', suggestions: [], directive: null }
      : { replies: [{ to: '阿黎', text: '阿黎来啦，合金正在补！' }], toStrategist: [], mood: '热闹', hotTopics: ['合金'] })
    expect(director.start().ok).toBe(true)
    director.feed(chat('1', '阿黎', '舰长晚上好', 1)); director.feed(chat('1', '阿黎', '重复', 1)); director.feed(chat('2', '小明', '点歌 晴天', 2))
    await director.tick(); await settle()
    expect(calls.map(c => c.agent).sort()).toEqual(['host', 'strategist'])
    advance(6000); director.feed(chat('3', '小明', '现在在干嘛', 3)); await director.tick(); await settle()
    const hostCall = calls.filter(c => c.agent === 'host').at(-1)!
    expect(hostCall.messages[0]!.content).toContain(HOST_SYSTEM)
    expect(hostCall.messages[1]!.content).toContain('先补合金再扩张'); expect(hostCall.messages[1]!.content).toContain('舰长的合金快不够了')
    expect(hostCall.messages[1]!.content).toContain('"name":"小明","firstVisit":true,"text":"现在在干嘛"')
    expect(calls.filter(c => c.agent === 'host')[0]!.messages[1]!.content).not.toContain('点歌')
    expect(said.map(s => s.text)).toContain('按上次游戏记录，阿黎来啦，合金正在补！')
    expect(director.board.audience).toMatchObject({ mood: '热闹', hotTopics: ['合金'] })
  })
  it('观众建议经场控转给参谋，参谋判断后场控下一轮公布，并给控制器下达指令', async () => {
    let round = 0
    const { director, calls, directives, advance } = setup((agent, messages) => {
      if (agent.role === 'host') return round++ === 0 ? { replies: [{ to: '老王', text: '这个主意我转给参谋！' }], toStrategist: [{ name: '老王', text: '去打旁边的机械帝国' }], mood: '期待开战', hotTopics: [] } : { replies: [{ to: '老王', text: '参谋说先攒舰队，三年后再打！' }], toStrategist: [] }
      const pending = /\[(s[0-9a-z-]+)\] 老王/.exec(messages[1]!.content)
      return { summary: '军力不足。', focus: '先攒舰队', nextSteps: ['造 5 艘护卫舰'], talkingPoint: '', suggestions: pending ? [{ id: pending[1], decision: 'adopted', reply: '会打，但要等舰队到 20 艘' }] : [], directive: pending ? { priority: 'high', text: '优先建造护卫舰，准备对机械帝国开战' } : null }
    })
    director.start(); director.feed(chat('1', '老王', '去打旁边的机械帝国！', 1))
    await director.tick(); await settle()
    expect(director.board.audience.suggestions).toMatchObject([{ name: '老王', status: 'new' }])
    advance(21000); await director.tick(); await settle()
    expect(director.board.audience.suggestions[0]).toMatchObject({ status: 'adopted', reply: '会打，但要等舰队到 20 艘' })
    expect(directives).toMatchObject([{ priority: 'high', text: '优先建造护卫舰，准备对机械帝国开战', focus: '先攒舰队' }])
    // No new danmaku, but the verdict must still be announced on the next host turn.
    advance(1000); await director.tick(); await settle()
    const hostCalls = calls.filter(c => c.agent === 'host')
    expect(hostCalls).toHaveLength(2); expect(hostCalls[1]!.messages[1]!.content).toContain('纳入计划，效果待确认：会打，但要等舰队到 20 艘')
  })
  it('快照没变时参谋不重复花钱；超过每小时上限就停止调用', async () => {
    const { director, calls, advance } = setup(agent => agent.role === 'host' ? { replies: [{ to: '', text: '收到' }] } : { summary: '稳', focus: '种田', nextSteps: [] }, { ...DEFAULT_DIRECTOR, replyIntervalSeconds: 3, idleCommentSeconds: 0, strategyIntervalSeconds: 30, maxRequestsPerHour: 10 })
    director.start(); await director.tick(); await settle(); advance(31000); await director.tick(); await settle()
    expect(calls.filter(c => c.agent === 'strategist')).toHaveLength(1)
    for (let n = 0; n < 20; n++) { director.feed(chat(`m${n}`, `观众${n}`, `弹幕${n}`, n)); advance(4000); await director.tick(); await settle() }
    expect(calls.length).toBe(10); expect(director.status().message).toContain('本小时已用满 10 次')
  })
  it('建议只触发一次紧急复盘，两次未决后回退，过期恢复建议不触发紧急循环',async()=>{
    const {director,calls,advance,now}=setup(()=>({suggestions:[]}))
    director.start();director.board.audience.suggestions.push({id:'s1',name:'观众',text:'先造舰',at:now(),status:'new'})
    for(let n=0;n<360;n++){await director.tick();await settle();advance(10000)}
    expect(calls.filter(c=>c.agent==='strategist').length).toBeLessThanOrEqual(22)
    expect(director.board.audience.suggestions[0]).toMatchObject({status:'answered',attempts:2})
    director.stop()
    const stale=setup(()=>({suggestions:[]}));stale.director.board.audience.suggestions.push({id:'old',name:'观众',text:'旧建议',at:stale.now()-31*60000,status:'new'})
    stale.director.start();await stale.director.tick();await settle()
    expect(stale.calls[0]?.messages[1]?.content).not.toContain('有观众建议等待判断')
    expect(stale.director.board.audience.suggestions[0]?.status).toBe('answered');stale.director.stop()
  })
  it('参谋失败按20、40、80秒退避，耗尽角色额度不阻塞场控',async()=>{
    let t=1000000;const strategyTimes:number[]=[],said:Spoken[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents,config:()=>({...DEFAULT_DIRECTOR,maxRequestsPerHour:10,idleCommentSeconds:0}),readSnapshot:async()=>snapshot,onSay:l=>said.push(...l),call:async agent=>{
      if(agent.role==='strategist'){strategyTimes.push(t);throw new Error('离线失败')}
      return{text:'{"replies":[{"text":"回应观众"}]}',usage:{},latencyMs:0}
    }})
    director.start()
    for(let n=0;n<180;n++){await director.tick();await settle();t+=1000}
    expect(strategyTimes.map(x=>x-strategyTimes[0]!)).toEqual([0,20000,60000])
    director.feed(chat('after-quota','观众','怎么发展？',t));await director.tick();await settle()
    expect(said).toHaveLength(1);expect(director.status().roleRequests).toMatchObject({strategist:3,host:1});director.stop()
  })
  it('恢复黑板后新建议编号唯一，旧编号决定只影响原建议',()=>{
    const board=restoreBlackboard({audience:{suggestions:[{id:'s1',name:'旧观众',text:'先补科研',at:1000000,status:'new'}]}})
    addSuggestion(board,{id:'s1',name:'新观众',text:'先造舰',at:1000001})
    expect(new Set(board.audience.suggestions.map(s=>s.id)).size).toBe(2)
    applyStrategist(board,{suggestions:[{id:'s1',decision:'adopted',reply:'先补科研'}]},'strategist',1000002)
    expect(board.audience.suggestions.find(s=>s.name==='旧观众')?.status).toBe('adopted')
    expect(board.audience.suggestions.find(s=>s.name==='新观众')?.status).toBe('new')
  })
  it('明确公布待宣布结论，成功后不重复，失败或无有效发言继续保留',async()=>{
    let t=1000000,attempt=0;const prompts:string[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(0,1),config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>snapshot,call:async(_a,m)=>{
      prompts.push(m[1]!.content);attempt++;if(attempt===1)throw new Error('离线失败')
      return{text:JSON.stringify({replies:attempt===2?[]:[{text:'老王，现在先补科研。'}]}),usage:{},latencyMs:0}
    }})
    director.board.audience.suggestions.push({id:'s1',name:'老王',text:'先补科研',at:t,status:'adopted',reply:'科研落后，要补进度'})
    director.start()
    for(let n=0;n<3;n++){await director.tick();await settle();expect(prompts[n]).toContain('【刚有结论、请用自己的口吻告诉对应观众】');t+=31000}
    expect(director.board.audience.suggestions[0]?.announcedAt).toBeTruthy()
    director.feed(chat('next','观众','你好',t));await director.tick();await settle()
    expect(prompts[3]).not.toContain('科研落后，要补进度');expect(prompts[3]).not.toContain('请公布这些结论')
    expect(restoreBlackboard(director.board).audience.suggestions[0]?.announcedAt).toBeTruthy();director.stop()
  })
  it('场控失败的弹幕只重排一次，过期和停止轮次不重排',async()=>{
    let t=1000000;const prompts:string[]=[];let release!:()=>void
    const director=createDirector({now:()=>t,agents:()=>agents.slice(0,1),config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>snapshot,call:async(_a,m)=>{prompts.push(m[1]!.content);throw new Error('离线失败')}})
    director.start();director.feed(chat('retry','观众','为什么缺粮？',t));await director.tick();await settle()
    expect(director.status().pending).toBe(1);t+=31000;await director.tick();await settle()
    expect(prompts[1]).toContain('为什么缺粮？');expect(director.status().pending).toBe(0)
    director.feed(chat('expired','观众','旧弹幕',t-61000));t+=61000;await director.tick();await settle();expect(director.status().pending).toBe(0);director.stop()
    const stopped=createDirector({now:()=>t,agents:()=>agents.slice(0,1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>snapshot,call:()=>new Promise((_ok,fail)=>{release=()=>fail(new Error('离线失败'))})})
    stopped.start();stopped.feed(chat('stop','观众','你好',t));await stopped.tick();await settle();stopped.stop();stopped.start();release();await settle();expect(stopped.status().pending).toBe(0);stopped.stop()
  })
  it('礼物洪峰保留提问，同人同礼物合并计数，省略数准确',async()=>{
    const {director,calls,now}=setup(()=>({replies:[]}))
    director.start()
    for(let n=0;n<30;n++)director.feed({id:`g${n}`,kind:'gift',platform:'bilibili',user:{id:`u${n}`,name:`礼物观众${n}`},giftName:'小花',count:1,at:now()+n})
    director.feed(chat('question','提问观众','为什么不补科研？',now()+31));await director.tick();await settle()
    const prompt=calls.find(c=>c.agent==='host')!.messages[1]!.content
    expect(prompt).toContain('为什么不补科研？');expect(prompt).toContain('另有 19 条已省略')
    director.stop()
    const merged=setup(()=>({replies:[]}));merged.director.start()
    for(let n=0;n<3;n++)merged.director.feed({id:`m${n}`,kind:'gift',platform:'bilibili',user:{id:'same',name:'同一观众'},giftName:'小花',count:2,at:merged.now()+n})
    await merged.director.tick();await settle()
    const combined=merged.calls.find(c=>c.agent==='host')!.messages[1]!.content
    expect(combined.match(/同一观众 送了/g)).toHaveLength(1);expect(combined).toContain('×6');expect(combined).toContain('共 3 条');merged.director.stop()
  })
  it('参谋失败不提交快照签名，相同快照在退避后重试成功',async()=>{
    let t=1000000,calls=0
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>snapshot,call:async()=>{if(++calls===1)throw new Error('离线失败');return{text:'{"focus":"恢复经营"}',usage:{},latencyMs:0}}})
    director.start();await director.tick();await settle();t+=19000;await director.tick();await settle();expect(calls).toBe(1)
    t+=1000;await director.tick();await settle();expect(calls).toBe(2);expect(director.board.plan.focus).toBe('恢复经营');director.stop()
  })
  it('停止重启后即使快照未变，也重新执行开场复盘并清除退避',async()=>{
    let t=1000000;const prompts:string[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>snapshot,call:async(_a,m)=>{prompts.push(m[1]!.content);if(prompts.length===2)throw new Error('离线失败');return{text:'{}',usage:{},latencyMs:0}}})
    director.start();await director.tick();await settle();director.stop();t+=1000;director.start();await director.tick();await settle();director.stop()
    t+=1000;director.start();await director.tick();await settle()
    expect(prompts).toHaveLength(3);for(const prompt of prompts)expect(prompt).toContain('开场第一次复盘');director.stop()
  })
  it('非法JSON只计一次请求，保留token统计且错误不泄漏原文',async()=>{
    const director=createDirector({now:()=>1000000,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>snapshot,call:async()=>({text:'sk-offline-private',usage:{inputTokens:42,outputTokens:8},latencyMs:0})})
    director.start();await director.tick();await settle()
    expect(director.status().usage.strategist).toMatchObject({requests:1,failed:1,inputTokens:42,outputTokens:8})
    expect(JSON.stringify(director.feedItems())).not.toContain('sk-offline-private');director.stop()
  })
  it('场控读取快照时取消不占请求额度',async()=>{
    let release!:(value:unknown)=>void,calls=0
    const director=createDirector({now:()=>1000000,agents:()=>agents.slice(0,1),config:()=>DEFAULT_DIRECTOR,readSnapshot:()=>new Promise(done=>release=done),call:async()=>{calls++;return{text:'{}',usage:{},latencyMs:0}}})
    director.start();director.feed(chat('c','观众','你好',1000000));await director.tick();director.stop();release(snapshot);await settle()
    expect(calls).toBe(0);expect(director.status().hourRequests).toBe(0)
  })
  it('首次观众缓存最多保留5000人并淘汰最早观众',async()=>{
    const {director,calls,now}=setup(()=>({replies:[]}))
    director.start();for(let n=0;n<5001;n++)director.feed(chat(`many-${n}`,`观众${n}`,'你好',now()))
    director.feed(chat('return','观众0','怎么发展？',now()+1));await director.tick();await settle()
    expect(calls.find(c=>c.agent==='host')?.messages[1]?.content).toContain(''+JSON.stringify({name:'观众0',firstVisit:true}).slice(1,-1));director.stop()
  })
  it('连续两轮空指令保留之前目标并续期，换局不续发旧指令',async()=>{
    let t=1000000,calls=0,sessionId='game-1';const directives:Directive[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({...snapshot,sessionId,state:{...snapshot.state,date:String(t)}}),onDirective:d=>directives.push(d),call:async()=>({text:JSON.stringify({focus:'凝聚力优先',directive:++calls===1?{text:'优先凝聚力',priority:'high',targetResource:'unity'}:null}),usage:{},latencyMs:0})})
    director.start();for(let n=0;n<3;n++){await director.tick();await settle();t+=200000}
    expect(directives).toHaveLength(3);expect(directives.map(d=>d.at)).toEqual([1000000,1200000,1400000]);expect(new Set(directives.map(d=>d.id)).size).toBe(1)
    for(const d of directives)expect(d).toMatchObject({text:'优先凝聚力',priority:'high',targetResource:'unity',gameSessionId:'game-1'})
    sessionId='game-2';await director.tick();await settle();expect(directives).toHaveLength(3);director.stop()
  })
  it('主播要求优先且自行安排的复查点不冒充完成条件，解析结果保持私有结构',async()=>{
    const prompt=strategistMessages({board:restoreBlackboard({}),snapshot:'星历2200.01.01',note:'开局主拉凝聚力',now:1000000,reason:'开场'})
    expect(prompt[0]?.content).toContain('高于本地战略的默认排序，高于观众建议')
    expect(STRATEGIST_SYSTEM).toContain('六个月内耗尽');expect(STRATEGIST_SYSTEM).toContain('只能作为复查点');expect(STRATEGIST_SYSTEM).toContain('不能替主播创造完成条件')
    const reviews:any[]=[]
    const director=createDirector({now:()=>1000000,agents:()=>agents.slice(1),config:()=>({...DEFAULT_DIRECTOR,strategyNote:'开局主拉凝聚力'}),readSnapshot:async()=>snapshot,onReview:r=>reviews.push(r),call:async()=>({text:JSON.stringify({operator:{economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:'完成首个传统树'},status:'on_track',evidence:'凝聚力月产增加'}}),usage:{},latencyMs:0})})
    director.start();await director.tick();await settle();expect(reviews[0]).toMatchObject({operatorNote:'开局主拉凝聚力',operator:{economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:'完成首个传统树'},status:'on_track'}});director.stop()
  })
  it('资源超过16项仍保留凝聚力与传统进度',()=>{
    const resources:any=Object.fromEntries(Array.from({length:20},(_,i)=>[`r${i}`,{amount:100,net:1}]))
    resources.unity={amount:500,net:30}
    const digest=digestSnapshot({state:{date:'2200.01.01',resources,traditions:{adopted:3,next_cost:400}}})
    expect(digest.text).toContain('unity 500（+30.0/月）');expect(digest.text).toContain('传统进度');expect(digest.text).toContain('adopted');expect(digest.resourceNet?.unity).toBe(30)
  })
  it('执行摘要区分已提交和已回读，不把设置回执当发展目标完成',()=>{
    const execution={date:'2240.01.01',status:'attention',steeringConfirmed:true,domesticActions:[{edictKey:'research_subsidies',enabled:false,status:'posted',confirmed:false}]}
    const pending=digestSnapshot({state:{strategyExecution:execution}}).text
    expect(pending).toContain('结果未确认');expect(pending).not.toContain('该次已核验关闭')
    const confirmed=digestSnapshot({state:{strategyExecution:{...execution,status:'applied',domesticActions:[{...execution.domesticActions[0],status:'confirmed',confirmed:true}]}}}).text
    expect(confirmed).toContain('该次已核验关闭');expect(confirmed).toContain('不代表发展目标完成')
  })
  it('保存新主播要求即使快照不变也会触发新解释',async()=>{
    let t=1000000,note='先科研';const prompts:string[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>({...DEFAULT_DIRECTOR,strategyNote:note}),readSnapshot:async()=>snapshot,call:async(_a,m)=>{prompts.push(m[1]!.content);return{text:'{}',usage:{},latencyMs:0}}})
    director.start();await director.tick();await settle();note='前期凝聚力';t+=1000;await director.tick();await settle()
    expect(prompts).toHaveLength(2);expect(prompts[1]).toContain('主播要求已更新');expect(prompts[1]).toContain('前期凝聚力');director.stop()
  })
  it('600字中控要求保留到提示词与回传，末尾修改也立即触发复查',async()=>{
    let t=1000000,note='前'.repeat(570)+'旧退出条件必须完整保留';const prompts:string[]=[],reviews:any[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>({...DEFAULT_DIRECTOR,strategyNote:note}),readSnapshot:async()=>snapshot,onReview:r=>reviews.push(r),call:async(_a,m)=>{prompts.push(m[1]!.content);return{text:'{}',usage:{},latencyMs:0}}})
    director.start();await director.tick();await settle()
    expect(prompts[0]).toContain(note);expect(reviews[0].operatorNote).toBe(note)
    note='前'.repeat(570)+'新退出条件必须完整保留';t+=1000;await director.tick();await settle()
    expect(prompts).toHaveLength(2);expect(prompts[1]).toContain(note);expect(reviews[1].operatorNote).toBe(note)
    director.stop()
  })
  it('模型raw done不能越过实际停滞诊断公开宣告完成，真实三飞升阶段仍能结束',async()=>{
    for(const stageReached of [false,true]){
      const reviews:any[]=[],note=stageReached?'凝聚力优先，第三个飞升后转科研':'持续拉凝聚力'
      const cp={...snapshot,sessionId:'game-1',state:{...snapshot.state,strategyContract:{economyFocus:'unity_traditions'},strategy:{version:3,unityProgress:{known:true,focused:true,net:30,targetNet:400,deadlineYear:2250,targetMet:false,stagnating:true,reasons:['四年未推进传统']}},ascensionPerks:{adopted:Array.from({length:stageReached?3:2},(_,i)=>({key:'ap_'+i}))}}}
      const d=createDirector({now:()=>1000000,agents:()=>agents.slice(1),config:()=>({...DEFAULT_DIRECTOR,strategyNote:note}),readSnapshot:async()=>cp,onReview:r=>reviews.push(r),call:async()=>({text:JSON.stringify({operator:{economyFocus:'unity_traditions',until:{condition:'阶段目标完成'},status:'done',evidence:'已切换档位'}}),usage:{},latencyMs:0})})
      d.start();await d.tick();await settle()
      expect(reviews[0]?.operator.status).toBe(stageReached?'done':'blocked')
      expect(d.board.notes.some(n=>n.text.includes('退出条件已达到'))).toBe(stageReached)
      d.stop()
    }
  })
  it('停止后迟到的回复被丢弃，不再说话', async () => {
    let release!: () => void
    const said: Spoken[] = []
    const director = createDirector({ now: () => 100_000, agents: () => agents.slice(0, 1), config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, onSay: l => said.push(...l),
      call: (_agent, _messages, signal) => new Promise((done, fail) => { release = () => done({ text: '{"replies":[{"to":"","text":"迟到"}]}', usage: {}, latencyMs: 1 }); signal.addEventListener('abort', () => fail(new Error('aborted'))) }) })
    director.start(); director.feed(chat('1', 'a', 'hi', 1))
    const pending = director.tick(); await Promise.resolve(); await Promise.resolve()
    director.stop(); release(); await pending
    expect(said).toEqual([]); expect(director.status()).toMatchObject({ running: false, busy: [] })
  })
  it('未配置模型时拒绝启动并说明原因', () => {
    const director = createDirector({ agents: () => [{ ...agents[0]!, model: '' }], config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, call: async () => { throw new Error('不应调用') } })
    expect(director.start()).toMatchObject({ ok: false, message: expect.stringContaining('选好服务商和模型') })
  })
  it('读取快照期间停止再启动，旧轮次不能恢复调用', async () => {
    let release!: (value: unknown) => void
    const calls: string[] = []
    const director = createDirector({ now: () => 1000000, agents: () => agents, config: () => DEFAULT_DIRECTOR,
      readSnapshot: () => new Promise(done => { release = done }),
      call: async agent => { calls.push(agent.id); return { text:'{}', usage:{}, latencyMs:0 } } })
    director.start();const old=director.tick();director.stop();director.start();release(snapshot);await old
    expect(calls).toEqual([]);expect(director.status().hourRequests).toBe(0);director.stop()
  })
  it('快照摘要包含关键字段，黑板提示参谋没判断前不要编造', () => {
    const digest = digestSnapshot(snapshot)
    expect(digest.text).toContain('星历 2230.05.01'); expect(digest.text).toContain('energy 300（+12.5/月）'); expect(digest.text).toContain('舰队 2 支，共 9 艘')
    expect(digestSnapshot(undefined)).toEqual({ text: '', signature: '' })
    const director = createDirector({ agents: () => agents, config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, call: async () => { throw new Error() } })
    expect(briefFor(director.board, 'host', 0)).toContain('不要编造')
  })
  it('经济与战争变化触发复盘，快照编号和无关大字段不会扩大摘要', () => {
    const base={...snapshot,sessionId:'game-1',state:{...snapshot.state,resources:{energy:{stockpile:300,net:12.5}},snapshotId:'a',raw:'x'.repeat(100000)}}
    const a=digestSnapshot(base)
    expect(a.text).toContain('energy 300（+12.5/月）');expect(a.gameSessionId).toBe('game-1');expect(a.text.length).toBeLessThanOrEqual(3500)
    expect(digestSnapshot({...base,metrics:{orders:99},state:{...base.state,snapshotId:'b'}}).signature).toBe(a.signature)
    expect(digestSnapshot({...base,state:{...base.state,resources:{energy:{stockpile:299,net:-1}}}}).signature).not.toBe(a.signature)
    expect(digestSnapshot({...base,state:{...base.state,wars:[{id:1}]}}).signature).not.toBe(a.signature)
    expect(digestSnapshot({...base,stopped:true}).gameSessionId).toBeUndefined()
  })
  it('参谋摘要保留当前战略瓶颈和恢复条件，不因矿物盈余忽略修复',()=>{
    const digest=digestSnapshot({...snapshot,state:{...snapshot.state,strategy:{version:1,route:'regular',focus:'消化疆域，修复内政',ordinaryExpansionAllowed:false,priorities:['先查消费品和食物岗位填充'],resumeWhen:'赤字改善后重评'}}})
    expect(digest.text).toContain('普通扩张暂缓');expect(digest.text).toContain('消费品和食物岗位填充');expect(digest.text).toContain('赤字改善后重评');expect(digest.text.length).toBeLessThanOrEqual(3500)
  })
  it('参谋建议绑定读取的当前游戏局，缓存未知量单独统计',async()=>{
    let t=1000000,calls=0;const directives:Directive[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({...snapshot,sessionId:'game-1'}),onDirective:d=>directives.push(d),
      call:async()=>({text:JSON.stringify({focus:'先补科研',directive:{priority:'normal',text:'优先科研和探索',targetResource:'research'}}),latencyMs:1,usage:++calls===1?{inputTokens:100,outputTokens:20,cachedTokens:80,cacheWriteTokens:10}:{inputTokens:100,outputTokens:20}})})
    director.start();await director.tick(); await settle();expect(directives[0]?.gameSessionId).toBe('game-1');expect(directives[0]?.targetResource).toBe('research')
    t+=200000;director.board.audience.suggestions.push({id:'s1',text:'看看科研',name:'观众',at:t,status:'new'});await director.tick(); await settle()
    expect(director.status().usage.strategist).toMatchObject({requests:2,inputTokens:200,cachedTokens:80,cacheWriteTokens:10,cacheUsageMissing:1});director.stop()
  })
})
