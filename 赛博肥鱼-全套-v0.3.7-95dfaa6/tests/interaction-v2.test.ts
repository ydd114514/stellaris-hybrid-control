import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import type { LiveEvent } from '../packages/shared/src'
const live:ReturnType<typeof createRuntime>[]=[]
const runtime=(options:Parameters<typeof createRuntime>[0]={})=>{const rt=createRuntime(options);live.push(rt);return rt}
let n=0
const event=(text:string,user='a'):LiveEvent=>({id:`v2-${++n}`,kind:'chat',text,user:{id:user,name:user},at:Date.now()})
afterEach(()=>{live.splice(0).forEach(rt=>rt.dispose());vi.useRealTimers()})
const tracks=[{id:'rain',title:'雨夜',artist:'小店',source:'shop-media://track/rain'},{id:'stars',title:'星星',artist:'小店',source:'shop-media://track/stars'}]

describe('直播互动二次核验',()=>{
 it('点歌和切歌是本地命令，不消耗模型，也不会插断当前曲',async()=>{
  const fetch=vi.fn();const rt=runtime({fetch});const cfg=structuredClone(defaultConfig);cfg.demo=false;cfg.voice.enabled=false;cfg.music.globalCooldownSeconds=0
  await rt.command({type:'set-config',config:cfg});await rt.command({type:'music-set-tracks',tracks});await rt.command({type:'start'})
  await rt.command({type:'inject',event:event('点歌 雨夜','a')});const first=rt.getState().music.current!.generationId
  await rt.command({type:'inject',event:event('点歌 星星','b')});await rt.command({type:'inject',event:event('切歌','b')});await rt.flush()
  expect(fetch).not.toHaveBeenCalled();expect(rt.getState().music.current!.generationId).toBe(first);expect(rt.getState().queue).toHaveLength(0);expect(rt.getState().music.queue).toHaveLength(1)
 })
 it('已屏蔽观众不能偷偷改变提案或虚报礼物账本',async()=>{
  const rt=runtime();await rt.command({type:'inject',event:event('你好')});await rt.command({type:'set-viewer',viewer:{...rt.getState().viewers[0]!,blocked:true}});await rt.command({type:'start'})
  const beforeMusic=rt.getState().music.current
  await rt.command({type:'inject',event:event('提议 去海边')});await rt.command({type:'inject',event:event('送出了火箭')});await rt.command({type:'inject',event:event('点歌 雨夜')})
  expect(rt.getState().vote.suggestions).toHaveLength(0);expect(rt.getState().wallet.imagined).toBe(0);expect(rt.getState().music.current).toEqual(beforeMusic);expect(rt.getState().music.queue).toHaveLength(0)
 })
 it('持续送礼也不能让普通聊天永远排不到',async()=>{
  const rt=runtime();const cfg=structuredClone(defaultConfig);cfg.voice.enabled=false;await rt.command({type:'set-config',config:cfg})
  for(let i=0;i<5;i++)await rt.command({type:'inject',event:{id:`giftfair-${i}`,kind:'gift',user:{id:`supporter-${i}`,name:`支持者${i}`},giftId:'coffee',count:10,at:Date.now()}})
  await rt.command({type:'inject',event:event('今天很累，想说说话','free')});await rt.command({type:'start'});await rt.flush()
  const seen:string[]=[]
  for(let i=0;i<5;i++){const s=rt.getState();if(s.history[0])seen.push(s.history[0].viewerName||'');if(s.stage.replyId)await rt.command({type:'stage-event',event:{type:'speech-ended',replyId:s.stage.replyId}});await rt.flush()}
  expect(seen.slice(0,3)).toContain('free')
 })
 it('同一个人密集发不同弹幕也只保留三条待回应',async()=>{
  const rt=runtime();for(let i=0;i<20;i++)await rt.command({type:'inject',event:event(`不同弹幕${i}`)})
  expect(rt.getState().queue).toHaveLength(3);expect(rt.getState().queue.map(e=>e.text)).toContain('不同弹幕19')
 })
 it('直播模式禁止系统朗读漏到日常声音通道',async()=>{
  const rt=runtime();const cfg=structuredClone(defaultConfig);cfg.audio.mode='live';await rt.command({type:'set-config',config:cfg});await rt.command({type:'start'});await rt.command({type:'inject',event:event('你好')});await rt.flush()
  expect(rt.getState().stage.speaking).toBe(true);expect(rt.getState().stage.audio).toBeUndefined();expect(rt.getState().connection.voice).toContain('云配音')
 })
 it('监听切换不会取消正在生成的付费回复',async()=>{
  let resolve!:(r:Response)=>void;let started!:()=>void;const began=new Promise<void>(r=>started=r)
  const fetch=vi.fn(()=>new Promise<Response>(r=>{resolve=r;started()}));const rt=runtime({fetch:fetch as typeof globalThis.fetch,credentials:{get:()=> 'not-a-real-key',set(){},encrypted:true}})
  const cfg=structuredClone(defaultConfig);cfg.demo=false;cfg.voice.enabled=false;await rt.command({type:'set-config',config:cfg});await rt.command({type:'start'});await rt.command({type:'inject',event:event('你好')});await began
  cfg.audio.monitorEnabled=true;await rt.command({type:'set-config',config:cfg});resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({say:['没被打断'],face:'happy',action:'wave'})}}],usage:{prompt_tokens:10,completion_tokens:10}})));await rt.flush()
  expect(fetch).toHaveBeenCalledOnce();expect(rt.getState().stage.text).toBe('a，没被打断')
 })
 it('暂停与紧急静音会停止音乐，过期ended不能恢复播放',async()=>{
  const rt=runtime();await rt.command({type:'music-set-tracks',tracks});await rt.command({type:'music-play',trackId:'rain'});const gen=rt.getState().music.current!.generationId
  await rt.command({type:'pause'});expect(rt.getState().music.status).toBe('paused');await rt.command({type:'mute'});expect(rt.getState().music.status).toBe('stopped');await rt.command({type:'music-ended',generationId:gen});expect(rt.getState().music.current).toBeUndefined()
 })
 it('恢复营业仅恢复因营业暂停的音乐，店长主动暂停保持暂停',async()=>{
  const rt=runtime();await rt.command({type:'music-set-tracks',tracks});await rt.command({type:'start'});await rt.command({type:'music-play',trackId:'rain'})
  const gen=rt.getState().music.current!.generationId
  await rt.command({type:'pause'});await rt.command({type:'music-ended',generationId:gen});await rt.command({type:'start'})
  expect(rt.getState().music.status).toBe('playing');expect(rt.getState().music.current!.generationId).toBe(gen)
  await rt.command({type:'music-pause'});await rt.command({type:'pause'});await rt.command({type:'start'})
  expect(rt.getState().music.status).toBe('paused');expect(rt.getState().music.current!.generationId).toBe(gen)
 })
 it('舞台开始回执在主状态记录真实开声时间，暂停及旧歌曲回执不改状态',async()=>{
  let now=100000;const rt=runtime({now:()=>now})
  await rt.command({type:'music-set-tracks',tracks});await rt.command({type:'music-play',trackId:'rain'});const old=rt.getState().music.current!.generationId
  expect(rt.getState().music.current!.startedAt).toBeUndefined()
  now+=60000;await rt.command({type:'music-pause'});await rt.command({type:'music-started',generationId:old})
  expect(rt.getState().music.current!.startedAt).toBeUndefined();expect(rt.getState().music.status).toBe('paused')
  await rt.command({type:'music-resume'});await rt.command({type:'music-started',generationId:old})
  expect(rt.getState().music.current!.startedAt).toBe(now)
  await rt.command({type:'music-play',trackId:'stars'});await rt.command({type:'music-started',generationId:old})
  expect(rt.getState().music.current!.trackId).toBe('stars');expect(rt.getState().music.current!.startedAt).toBeUndefined()
 })
 it('从真实服务切回模拟模式后，迟到的付费回复不会播出',async()=>{
  let resolve!:(r:Response)=>void;let started!:()=>void;const began=new Promise<void>(r=>started=r)
  const fetch=vi.fn(()=>new Promise<Response>(r=>{resolve=r;started()}));const rt=runtime({fetch:fetch as typeof globalThis.fetch,credentials:{get:()=> 'not-a-real-key',set(){},encrypted:true}})
  const cfg=structuredClone(defaultConfig);cfg.demo=false;cfg.voice.enabled=false;await rt.command({type:'set-config',config:cfg});await rt.command({type:'start'});await rt.command({type:'inject',event:event('你好')});await began
  cfg.demo=true;await rt.command({type:'set-config',config:cfg});resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({say:['旧的付费回复不应播出'],face:'happy',action:'wave'})}}],usage:{prompt_tokens:10,completion_tokens:10}})));await rt.flush()
  expect(fetch).toHaveBeenCalledOnce();expect(rt.getState().stage.text).not.toContain('旧的付费回复');expect(rt.getState().history[0]!.source).toBe('mock')
 })
 it('配音生成过程中修改音色会取消旧配音，不会迟到播放',async()=>{
  let resolve!:(value:{audio:{kind:'pcm';data:string};characters:number})=>void;let started!:()=>void;const began=new Promise<void>(r=>started=r)
  const synthesize=vi.fn(()=>new Promise<{audio:{kind:'pcm';data:string};characters:number}>(r=>{resolve=r;started()}))
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({say:['旧音色台词'],face:'happy',action:'wave'})}}],usage:{prompt_tokens:10,completion_tokens:10}})))
  const rt=runtime({fetch:fetch as typeof globalThis.fetch,credentials:{get:()=> 'not-a-real-key',set(){},encrypted:true},voice:{synthesize}})
  const cfg=structuredClone(defaultConfig);cfg.demo=false;cfg.voice.provider='qwen';await rt.command({type:'set-config',config:cfg});await rt.command({type:'start'});await rt.command({type:'inject',event:event('你好')});await began
  cfg.voice.voice='another-voice';await rt.command({type:'set-config',config:cfg});resolve({audio:{kind:'pcm',data:'AAAA'},characters:5});await rt.flush()
  expect(synthesize).toHaveBeenCalledOnce();expect(rt.getState().stage.speaking).toBe(false);expect(rt.getState().stage.audio).toBeUndefined();expect(rt.getState().history).toHaveLength(0)
 })
 it('旧配置迁移默认本地测试且安静，并限制不安全的点歌参数',()=>{
  const cfg=validateConfig({voice:{outputDeviceId:'old-output'},music:{skipMinVotes:0,minPlaySeconds:0,skipRatio:0},audio:{monitorEnabled:false}})
  expect(cfg.audio.mode).toBe('test');expect(cfg.audio.monitorEnabled).toBe(false);expect(cfg.music.skipMinVotes).toBe(2);expect(cfg.music.minPlaySeconds).toBe(10);expect(cfg.music.skipRatio).toBe(.5)
  expect(createDefaultState().music.current).toBeUndefined()
 })
})
