// Offline protocol tests. Feedback below is synthetic HTTP input, not evidence
// of actual media playback; the separate interface rehearsal verifies that.
import {afterEach,describe,expect,it} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename,dirname,join,resolve} from 'node:path'
import {createStellarisSpeech} from '../apps/desktop/electron/stellaris-speech'

const roots:string[]=[],services:ReturnType<typeof createStellarisSpeech>[]=[]
const streams:AbortController[]=[]
const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',allowedOrigin='http://127.0.0.1:17655'
const secrets={available:()=>true,encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()}
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms))
const fixture=()=>({kind:'pcm' as const,data:Buffer.alloc(4800,1).toString('base64'),sampleRate:24000,characters:8,words:[],usage:{inputTokens:2,outputTokens:3}})
type Synthesize=NonNullable<Parameters<typeof createStellarisSpeech>[0]['synthesize']>
afterEach(async()=>{
 for(const stream of streams.splice(0))stream.abort()
 for(const service of services.splice(0))await service.dispose()
 for(const root of roots.splice(0)){if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('fish-playback-'))throw Error('Unexpected temporary profile');await rm(root,{recursive:true,force:true})}
})
async function setup(synthesize?:Synthesize){
 const root=await mkdtemp(join(tmpdir(),'fish-playback-'));roots.push(root)
 let calls=0
 const service=createStellarisSpeech({directory:root,getProject:async()=>undefined,tunedSamplesDirectory:resolve('assets/captain-tuned'),secrets,port:0,playbackOrigins:[allowedOrigin],synthesize:async options=>{calls++;options.onRequest?.();return synthesize?synthesize(options):fixture()}})
 services.push(service)
 expect((await service.action({type:'save-key',key:'offline-fixture-key'})).ok).toBe(true)
 const started=await service.action({type:'start'});expect(started.ok).toBe(true)
 const origin=new URL(started.view.playerUrl!).origin
 const post=(path:string,data:any={},client=owner)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({client,...data})})
 const playback=()=>fetch(origin+'/playback').then(r=>r.json())
 const enqueue=(id:string,text='尚未播放，不得提前显示。')=>service.say({id,text,kind:'host',at:Date.now()})
 return {service,origin,post,playback,enqueue,calls:()=>calls}
}
async function openStream(origin:string){
 const controller=new AbortController();streams.push(controller)
 const response=await fetch(origin+'/playback/events',{headers:{Origin:allowedOrigin},signal:controller.signal})
 expect(response.status).toBe(200);expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
 const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer=''
 return {controller,async next(){
  while(true){const boundary=buffer.indexOf('\n\n');if(boundary>=0){const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(raw.startsWith('data: '))return JSON.parse(raw.slice(6));continue}
   const part=await reader.read();if(part.done)throw Error('Caption event stream ended unexpectedly');buffer+=decoder.decode(part.value,{stream:true})}
 }}
}

describe('captain playback-only subtitle protocol',()=>{
 it('keeps generating and ready text off captions, then clears text on pause, end, and stop',async()=>{
  let release!:(value:ReturnType<typeof fixture>)=>void
  const x=await setup(async()=>new Promise(done=>release=done))
  expect(x.enqueue('first')).toBe(true);await x.service.poll();expect(x.calls()).toBe(0)
  await x.post('/player/poll')
  await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('generating')
  expect(await x.playback()).toMatchObject({status:'idle',enabled:true});expect(x.service.readPlayback().text).toBeUndefined()
  expect(JSON.stringify(await x.playback())).not.toContain('尚未播放')
  release(fixture());await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('ready')
  expect((await x.playback()).text).toBeUndefined();expect(x.service.readPlayback().id).toBeUndefined()
  expect((await x.post('/player/feedback',{id:'first',kind:'started',mediaSequence:1})).status).toBe(200)
  expect(await x.playback()).toMatchObject({id:'first',text:'尚未播放，不得提前显示。',status:'playing'})
  expect((await x.post('/player/feedback',{id:'first',kind:'paused',mediaSequence:2})).status).toBe(200)
  expect(await x.playback()).toMatchObject({status:'paused'});expect(x.service.readPlayback().text).toBeUndefined()
  await x.post('/player/feedback',{id:'first',kind:'started',mediaSequence:3});expect(x.service.readPlayback().text).toBe('尚未播放，不得提前显示。')
  await x.post('/player/feedback',{id:'first',kind:'ended',mediaSequence:4});expect(x.service.readPlayback()).toMatchObject({status:'idle'});expect(x.service.readPlayback().text).toBeUndefined();expect(x.service.readPlayback().id).toBeUndefined()
  x.enqueue('second','停止后必须消失。');await expect.poll(()=>typeof release).toBe('function');await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('generating');release(fixture())
  await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('ready')
  await x.post('/player/feedback',{id:'second',kind:'started',mediaSequence:1});expect(x.service.readPlayback().id).toBe('second')
  await x.service.action({type:'stop'});expect(x.service.readPlayback()).toMatchObject({enabled:false,status:'idle'});expect(x.service.readPlayback().text).toBeUndefined()
 })
 it('rejects nonowners, obsolete IDs, and duplicate or reversed media sequences',async()=>{
  const x=await setup();await x.post('/player/poll');x.enqueue('first','第一段语音。')
  await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('ready')
  await x.post('/player/feedback',{id:'first',kind:'started',mediaSequence:10});const current=x.service.readPlayback()
  expect((await x.post('/player/feedback',{id:'first',kind:'ended',mediaSequence:11},other)).status).toBe(404)
  expect((await x.post('/player/feedback',{id:'old',kind:'ended',mediaSequence:11})).status).toBe(404)
  for(const mediaSequence of [10,9])expect((await x.post('/player/feedback',{id:'first',kind:'paused',mediaSequence})).status).toBe(409)
  expect(x.service.readPlayback()).toEqual(current)
  await x.post('/player/release');expect(x.service.readPlayback().text).toBeUndefined()
  await x.post('/player/poll',{},other);x.enqueue('second','第二段语音。')
  await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('ready')
  expect((await x.post('/player/feedback',{id:'second',kind:'started',mediaSequence:1},other)).status).toBe(200)
  expect((await x.post('/player/feedback',{id:'second',kind:'ended',mediaSequence:999})).status).toBe(404)
  expect((await x.post('/player/feedback',{id:'first',kind:'started',mediaSequence:999},other)).status).toBe(404)
  expect(x.service.readPlayback()).toMatchObject({id:'second',text:'第二段语音。',status:'playing'})
 })
 it('exposes read-only captions only to the configured loopback origins',async()=>{
  const x=await setup()
  const allowed=await fetch(x.origin+'/playback',{headers:{Origin:allowedOrigin}})
  expect(allowed.status).toBe(200);expect(allowed.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
  for(const origin of ['https://outside.invalid','http://localhost:17655','http://127.0.0.1:17656'])for(const endpoint of ['/playback','/playback/events']){
   const response=await fetch(x.origin+endpoint,{headers:{Origin:origin}});expect(response.status).toBe(403);expect(response.headers.get('access-control-allow-origin')).toBeNull()
  }
  expect(()=>createStellarisSpeech({directory:'unused',getProject:async()=>undefined,secrets,playbackOrigins:['https://outside.invalid']})).toThrow('字幕只允许本机来源')
 })
 it('pushes only playback state and heartbeat to SSE without acquiring an audio lease or requesting synthesis',async()=>{
  const x=await setup(),stream=await openStream(x.origin),first=await stream.next()
  expect(first).toMatchObject({version:1,status:'idle',enabled:true});expect(first.text).toBeUndefined()
  x.enqueue('not-a-player','只看字幕不能触发合成。');await x.service.poll();await delay(50)
  expect(x.calls()).toBe(0);expect((await x.service.view()).current).toBeUndefined()
  const heartbeat=await stream.next();expect(heartbeat).toEqual(first);expect(x.calls()).toBe(0)
 })
 it('wakes a waiting player immediately for ready audio, playback feedback, and stop',async()=>{
  let release!:(value:ReturnType<typeof fixture>)=>void
  const x=await setup(async()=>new Promise(done=>release=done));await x.post('/player/poll');x.enqueue('ready-wake')
  await expect.poll(async()=>(await x.service.view()).current?.phase).toBe('generating')
  const state=await(await x.post('/player/poll')).json();let settled=false
  const waiting=x.post('/player/poll',{afterRevision:state.revision}).then(r=>r.json()).then(s=>{settled=true;return s})
  await delay(40);expect(settled).toBe(false);const releasedAt=performance.now();release(fixture())
  const ready=await waiting;expect(performance.now()-releasedAt).toBeLessThan(700);expect(ready.current.audio).toBe('/audio/ready-wake');expect(ready.playback.text).toBeUndefined()
  const playbackWait=x.post('/player/poll',{afterRevision:ready.revision}).then(r=>r.json());await delay(30)
  await x.post('/player/feedback',{id:'ready-wake',kind:'started',mediaSequence:1});const started=await playbackWait
  expect(started.playback).toMatchObject({id:'ready-wake',status:'playing'})
  const stopWait=x.post('/player/poll',{afterRevision:started.revision}).then(r=>r.json());await delay(30)
  await x.service.action({type:'stop'});expect(await stopWait).toMatchObject({enabled:false,playback:{status:'idle'}});expect(x.calls()).toBe(1)
 })
})
