const settle=()=>new Promise<void>(resolve=>setImmediate(resolve))
import {describe,expect,it} from 'vitest'
import {createDirector,DEFAULT_DIRECTOR} from '../packages/core/src/ai-director'
import {aiFailure,AiProviderError,chat,type AiChatResult,type Fetch} from '../packages/core/src/ai-providers'
import type {AiAgentConfig} from '../packages/shared/src/ai'

const host:AiAgentConfig={id:'host',role:'host',label:'场控老师',enabled:true,providerId:'custom',model:'offline',temperature:1,maxTokens:600,thinking:false}
const event=(id:string,at=1000000)=>({id,kind:'chat' as const,platform:'bilibili' as const,text:`问题${id}`,user:{id,name:id},at})
const reply:AiChatResult={text:'{"replies":[{"text":"收到"}]}',usage:{inputTokens:100,outputTokens:10},latencyMs:1}

describe('场控故障退避、队列与诊断',()=>{
  it('遵循限流等待，失败消息不丢失，恢复后按FIFO小批处理',async()=>{
    let now=1000000,calls=0
    const seen:string[]=[]
    const d=createDirector({now:()=>now,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,batchSize:1,idleCommentSeconds:0}),readSnapshot:async()=>undefined,
      call:async(_a,m)=>{calls++;seen.push(m[1]!.content);if(calls===1)throw new AiProviderError('unsafe reflected text',429,undefined,60000);return reply}})
    d.start();d.feed(event('1'));await d.tick();await settle()
    expect(d.status()).toMatchObject({pending:1,health:{host:{consecutiveFailures:1,nextRetryAt:1060000,circuitOpen:false,category:'rate_limit'}}})
    now+=59000;d.feed(event('2',now));await d.tick();await settle();expect(calls).toBe(1)
    now+=1000;await d.tick();await settle();expect(calls).toBe(2);expect(seen[1]).toContain('问题1');expect(seen[1]).not.toContain('问题2')
    expect(d.status()).toMatchObject({pending:1,health:{host:{consecutiveFailures:0,lastSuccessAt:1060000}}})
    now+=8000;await d.tick();await settle();expect(seen[2]).toContain('问题2');expect(d.status().pending).toBe(0)
    expect(JSON.stringify(d.status())).not.toContain('unsafe reflected text')
  })
  it('连续5次失败后暂停该角色，不无限重试，显式重新启动后恢复',async()=>{
    let now=1000000,calls=0,fail=true
    const d=createDirector({now:()=>now,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>undefined,call:async()=>{calls++;if(fail)throw new AiProviderError('offline network',undefined,'network');return reply}})
    d.start();d.feed(event('1'));await d.tick();await settle()
    for(const delay of [30000,60000,120000,240000]){now+=delay;d.feed(event(String(now),now));await d.tick();await settle()}
    expect(calls).toBe(5);expect(d.status()).toMatchObject({health:{host:{consecutiveFailures:5,circuitOpen:true}}})
    now+=3600000;await d.tick();await settle();expect(calls).toBe(5)
    d.stop();d.start();d.feed(event('2',now));fail=false;await d.tick();await settle();expect(calls).toBe(6)
  })
  it('服务商要求等10分钟时，不被本地5分钟退避上限提前唤醒',async()=>{
    let now=1000000,calls=0
    const d=createDirector({now:()=>now,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>undefined,call:async()=>{if(++calls===1)throw new AiProviderError('offline limit',429,undefined,600000);return reply}})
    d.start();d.feed(event('1'));await d.tick();await settle()
    expect(d.status().health?.host?.nextRetryAt).toBe(1600000)
    now+=300000;await d.tick();await settle();expect(calls).toBe(1)
    now+=299999;await d.tick();await settle();expect(calls).toBe(1)
    now+=1;d.feed(event('fresh',now));await d.tick();await settle();expect(calls).toBe(2)
    expect(aiFailure(new AiProviderError('offline',429,undefined,600000)).retryAfterMs).toBe(600000)
  })
  it('认证错误立即暂停，未知错误不将任意服务端文本暴露到状态或feed',async()=>{
    const d=createDirector({now:()=>1000000,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>undefined,call:async()=>{throw new AiProviderError('https://private.example token=secret',401)}})
    d.start();d.feed(event('1'));await d.tick();await settle()
    expect(d.status()).toMatchObject({health:{host:{circuitOpen:true,category:'authentication',httpStatus:401}},usage:{host:{requests:1,failed:1,usageMissing:1}}})
    expect(JSON.stringify([d.status(),d.feedItems()])).not.toContain('private.example')
    expect(aiFailure(new Error('sk-private-value'))).toMatchObject({category:'unknown',message:expect.not.stringContaining('sk-private')})
  })
  it.each(['不是JSON','{}','{"replies":"不是列表"}'])('非法结构回复%s只计一次请求，保留已报告用量和待处理消息',async text=>{
    const d=createDirector({now:()=>1000000,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>undefined,call:async()=>({...reply,text})})
    d.start();d.feed(event('1'));await d.tick();await settle()
    expect(d.status()).toMatchObject({pending:1,health:{host:{category:'invalid_response'}},usage:{host:{requests:1,failed:1,inputTokens:100,outputTokens:10,usageMissing:0}}})
  })
  it('停止取消后不恢复旧批次、不增加失败计数、不发迟到内容',async()=>{
    let release!:()=>void,called=0
    const d=createDirector({now:()=>1000000,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>undefined,call:async()=>new Promise<AiChatResult>(resolve=>{called++;release=()=>resolve(reply)})})
    d.start();d.feed(event('1'));const running=d.tick();await Promise.resolve();await Promise.resolve();expect(called).toBe(1)
    d.stop();d.start();release();await running
    expect(d.status()).toMatchObject({pending:0,health:{},usage:{}});expect(d.feedItems().filter(x=>x.kind==='host')).toEqual([])
  })
  it('游戏停止或快照过期单独标记，独立聊天继续运行',async()=>{
    let now=1000000,stopped=true,calls=0
    const d=createDirector({now:()=>now,agents:()=>[host],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({stopped,observedAt:now,state:{date:'2324.05.01'}}),call:async()=>{calls++;return reply}})
    d.start();d.feed(event('1'));await d.tick();await settle();expect(d.status()).toMatchObject({running:true,snapshot:{state:'stopped',gameDate:'2324.05.01'}})
    stopped=false;now+=8000;d.feed(event('2'));await d.tick();await settle();expect(d.status().snapshot?.state).toBe('live')
    now+=61000;expect(d.status().snapshot?.state).toBe('stale');expect(calls).toBe(2)
  })
  it('参谋在失败退避后可对相同快照重试，不被例行周期或相同签名吞掉',async()=>{
    let now=1000000,calls=0
    const strategist={...host,id:'strategist',role:'strategist' as const}
    const d=createDirector({now:()=>now,agents:()=>[strategist],config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({state:{date:'2200.01.01'}}),call:async()=>{if(++calls===1)throw new AiProviderError('offline',503);return {...reply,text:'{"focus":"先科研"}'}}})
    d.start();await d.tick();await settle();now+=30000;await d.tick();await settle();expect(calls).toBe(2);expect(d.status().health?.strategist?.lastSuccessAt).toBe(now)
  })
  it('服务商Retry-After与错误分类进入安全诊断，密钥和原始错误不进入诊断',async()=>{
    const fetcher:Fetch=async()=>({ok:false,status:429,headers:{get:()=> '120'},json:async()=>({error:{message:'private key sk-offline-secret https://hidden.example'}})})
    let caught:unknown
    try{await chat(fetcher,{provider:{id:'custom',name:'离线',kind:'openai',preset:'custom',baseUrl:'https://offline.example',enabled:true,models:[]},key:'sk-offline-secret',model:'offline',messages:[]})}catch(error){caught=error}
    expect(aiFailure(caught)).toMatchObject({category:'rate_limit',httpStatus:429,retryAfterMs:120000,retryable:true})
    expect(JSON.stringify(aiFailure(caught))).not.toContain('sk-offline');expect(JSON.stringify(aiFailure(caught))).not.toContain('hidden.example')
  })
})
