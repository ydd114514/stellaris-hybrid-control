import {it,expect} from 'vitest'
import {createDirector,DEFAULT_DIRECTOR} from '../packages/core/src/ai-director'
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
const host:any={id:'host',role:'host',enabled:true,providerId:'test',model:'offline',label:'测试'}
const event=(id:string)=>({id,kind:'chat' as const,platform:'bilibili' as const,user:{id:'u',name:'观众'},text:'你好',at:1000000})
it('1000 concurrent arrivals stay bounded, duplicates and source-identity recipients cannot reach public speech',async()=>{
  let calls=0;const said:any[]=[]
  const director=createDirector({now:()=>1000000,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>undefined,onSay:lines=>said.push(...lines),call:async()=>{calls++;return{text:'{"replies":[{"to":"场控老师","text":"我先修消费品。"},{"to":"观众","text":"参谋让我扩张"}]}',usage:{},latencyMs:0}}})
  director.start();for(let i=0;i<1000;i++){director.feed(event(String(i)));director.feed(event(String(i)))}
  expect(director.status().pending).toBe(200);await director.tick();await settle();expect(calls).toBe(1);expect(said).toHaveLength(1);expect(said[0]).toMatchObject({to:'',text:'我先修消费品。'});director.stop()
})
it('overlapping scheduler ticks reserve each role before snapshot reads without cross-role waiting',async()=>{
  let t=1000000;const calls:string[]=[];const said:any[]=[];const signals:AbortSignal[]=[]
  let release!:(x:any)=>void
  const snapshot=new Promise(done=>{release=done})
  const strategist:any={...host,id:'strategist',role:'strategist'}
  const director=createDirector({now:()=>t,agents:()=>[host,strategist],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:()=>snapshot,onSay:lines=>said.push(...lines),call:async(agent,_messages,signal)=>{
    calls.push(agent.id);signals.push(signal)
    if(agent.role==='strategist')return new Promise(()=>{})
    return{text:'{"replies":[{"text":"收到问题"}]}',usage:{},latencyMs:0}
  }})
  director.start();director.feed(event('1'))
  await Promise.all(Array.from({length:10},()=>director.tick()))
  expect(director.status().busy.sort()).toEqual(['host','strategist']);expect(calls).toEqual([])
  release({state:{date:'2200.01.01'}});await settle()
  expect(calls.sort()).toEqual(['host','strategist']);expect(said).toHaveLength(1)
  t+=10000;director.feed(event('2'));await Promise.all(Array.from({length:10},()=>director.tick()));await settle()
  expect(calls.filter(x=>x==='host')).toHaveLength(2);expect(calls.filter(x=>x==='strategist')).toHaveLength(1);expect(said).toHaveLength(2)
  director.stop();expect(signals[0]!.aborted||signals[1]!.aborted).toBe(true)
})
