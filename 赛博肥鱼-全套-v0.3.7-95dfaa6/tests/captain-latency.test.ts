import {afterEach,describe,expect,it} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename,dirname,join,resolve} from 'node:path'
import {createDirector,DEFAULT_DIRECTOR} from '../packages/core/src/ai-director'
import {createStellarisAi} from '../apps/desktop/electron/stellaris-ai'
import type {AiAgentConfig} from '../packages/shared/src/ai'
import type {Fetch} from '../packages/core/src/ai-providers'

const host:AiAgentConfig={id:'host',role:'host',label:'场控',enabled:true,providerId:'deepseek',model:'offline',temperature:1,maxTokens:600,thinking:false}
const event=(id:string)=>({id,kind:'chat' as const,platform:'bilibili' as const,user:{id,name:'测试'+id},text:'测试问题'+id,at:Date.now()})
const reply={text:'{"replies":[{"text":"先稳住后勤，再看下一步。"}]}',usage:{inputTokens:10,outputTokens:10},latencyMs:1}
const roots:string[]=[],services:ReturnType<typeof createStellarisAi>[]=[]
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms))
afterEach(async()=>{
 await Promise.all(services.splice(0).map(s=>s.dispose()))
 for(const root of roots.splice(0)){if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('fish-latency-'))throw Error('Unexpected cleanup path');await rm(root,{recursive:true,force:true})}
})
async function service(fetcher:Fetch){
 const directory=await mkdtemp(join(tmpdir(),'fish-latency-'));roots.push(directory)
 const s=createStellarisAi({dataDirectory:directory,basic:true,getProject:async()=>undefined,overlayPort:0,tickMs:60000,secrets:{available:()=>true,encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()},fetch:fetcher})
 services.push(s)
 await s.action({type:'save-key',id:'deepseek',key:'offline-key-only'})
 await s.action({type:'save-director',director:{...s.view().director,idleCommentSeconds:0}})
 expect((await s.action({type:'start-chat'})).ok).toBe(true)
 return s
}

describe('bounded low-latency audience scheduling',()=>{
 it('the first turn is immediate even at clock zero, while following turns retain the configured gap',async()=>{
  let now=0,calls=0
  const d=createDirector({now:()=>now,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,idleCommentSeconds:0}),readSnapshot:async()=>undefined,call:async()=>{calls++;return reply}})
  d.start();d.feed(event('first'));await d.tick();expect(calls).toBe(1);expect(d.status().lastHostAt).toBe(0)
  d.feed(event('first'));d.feed(event('second'));now=7999;await d.tick();expect(calls).toBe(1)
  now=8000;await d.tick();expect(calls).toBe(2);expect(d.status().pending).toBe(0)
 })
 it('an event burst wakes the service without its minute-long fallback tick and remains one batch',async()=>{
  let calls=0,prompt=''
  const s=await service(async(_url,init)=>{calls++;prompt=init.body||'';return {ok:true,status:200,json:async()=>({choices:[{message:{content:reply.text}}],usage:{prompt_tokens:10,completion_tokens:10}})}})
  s.feed(event('first'));s.feed(event('second'));s.feed(event('first'))
  await expect.poll(()=>calls,{timeout:1000,interval:20}).toBe(1)
  expect(prompt).toContain('测试问题first');expect(prompt).toContain('测试问题second');expect(prompt).toContain('不凑字数')
  await wait(80);expect(calls).toBe(1)
  s.feed(event('third'));await wait(100);expect(calls).toBe(1)
 })
 it('stop before the coalescing deadline cancels the event wake instead of creating a late request',async()=>{
  let calls=0
  const s=await service(async()=>{calls++;throw Error('No request should start')})
  s.feed(event('first'));await s.action({type:'stop'});await wait(100)
  expect(calls).toBe(0);expect(s.view().status.running).toBe(false)
 })
 it('a provider backoff is not bypassed by further messages or duplicate events',async()=>{
  let calls=0
  const s=await service(async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '60'},json:async()=>({error:{message:'offline throttle'}})}})
  s.feed(event('first'));await expect.poll(()=>calls,{timeout:1000,interval:20}).toBe(1)
  await expect.poll(()=>s.view().status.health?.host?.consecutiveFailures,{timeout:1000,interval:20}).toBe(1)
  for(let n=0;n<6;n++)s.feed(event(n%2?'first':'next'))
  await wait(100);expect(calls).toBe(1);expect(s.view().status.pending).toBe(2)
 })
 it('concurrent ticks and queued events cannot exceed the shared request budget',async()=>{
  let now=100000,calls=0,release!:()=>void
  const d=createDirector({now:()=>now,agents:()=>[host],config:()=>({...DEFAULT_DIRECTOR,maxRequestsPerHour:1,batchSize:1,idleCommentSeconds:0}),readSnapshot:async()=>undefined,call:async()=>{calls++;return new Promise(done=>{release=()=>done(reply)})}})
  d.start();d.feed(event('first'));const pending=d.tick();await Promise.resolve();await Promise.resolve()
  d.feed(event('second'));expect(d.tick()).toBe(pending);expect(calls).toBe(1)
  release();await pending;now+=8000;await d.tick();expect(calls).toBe(1);expect(d.status()).toMatchObject({pending:1,hourRequests:1})
 })
})
