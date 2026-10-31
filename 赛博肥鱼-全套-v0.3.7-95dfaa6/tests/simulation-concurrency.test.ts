import {it,expect} from 'vitest'
import {createDirector,DEFAULT_DIRECTOR} from '../packages/core/src/ai-director'
const host:any={id:'host',role:'host',enabled:true,providerId:'test',model:'offline',label:'测试'}
const event=(id:string)=>({id,kind:'chat' as const,platform:'bilibili' as const,user:{id:'u',name:'观众'},text:'你好',at:1000000})
it('1000 concurrent arrivals stay bounded, duplicates and source-identity recipients cannot reach public speech',async()=>{
  let calls=0;const said:any[]=[]
  const director=createDirector({now:()=>1000000,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>undefined,onSay:lines=>said.push(...lines),call:async()=>{calls++;return{text:'{"replies":[{"to":"场控老师","text":"我先修消费品。"},{"to":"观众","text":"参谋让我扩张"}]}',usage:{},latencyMs:0}}})
  director.start();for(let i=0;i<1000;i++){director.feed(event(String(i)));director.feed(event(String(i)))}
  expect(director.status().pending).toBe(200);await director.tick();expect(calls).toBe(1);expect(said).toHaveLength(1);expect(said[0]).toMatchObject({to:'',text:'游戏实时状态未确认，我先修消费品。'});director.stop()
})
it('overlapping scheduler ticks coalesce to one paid request per role',async()=>{
  let calls=0;let release!:(x:any)=>void
  const snapshot=new Promise(done=>{release=done})
  const strategist:any={...host,id:'strategist',role:'strategist'}
  const director=createDirector({now:()=>1000000,agents:()=>[strategist],config:()=>DEFAULT_DIRECTOR,readSnapshot:()=>snapshot,call:async()=>{calls++;return{text:'{}',usage:{},latencyMs:0}}})
  director.board.audience.suggestions.push({id:'urgent',name:'观众',text:'先补消费品',at:1000000,status:'new'})
  director.start();const turns=Array.from({length:10},()=>director.tick());release({state:{date:'2200.01.01'}});await Promise.all(turns);expect(calls).toBe(1);director.stop()
})
