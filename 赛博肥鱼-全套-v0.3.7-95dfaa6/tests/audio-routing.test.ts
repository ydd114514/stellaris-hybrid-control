import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveAudioBus, MusicAudio, getAudioBus } from '../apps/stage/music-audio'
import { StageAudio } from '../apps/stage/audio'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'

class FakeNode {
  links: unknown[]=[]
  automations:{value:number;at:number;timeConstant:number}[]=[];holds:number[]=[]
  gain={value:1,setTargetAtTime:(value:number,at=0,timeConstant=0)=>{this.gain.value=value;this.automations.push({value,at,timeConstant})},cancelAndHoldAtTime:(at:number)=>{this.holds.push(at)}}
  connect(target:unknown){this.links.push(target);return target}
  disconnect(target?:unknown){this.links=target?this.links.filter(x=>x!==target):[]}
}
class FakeAudio {
  static all:FakeAudio[]=[]
  srcObject:unknown;src='';autoplay=false;crossOrigin='';preload='';currentTime=0;duration=120;onplaying?:(()=>void)|null;onended?:()=>void;onerror?:()=>void
  paused=true;sinks:string[]=[];plays=0;loads=0
  constructor(src=''){this.src=src;FakeAudio.all.push(this)}
  async setSinkId(value:string){this.sinks.push(value)}
  async play(){this.paused=false;this.plays++}
  pause(){this.paused=true}
  removeAttribute(){this.src=''}
  load(){this.loads++}
}
class FakeContext {
  static all:FakeContext[]=[]
  state='running';currentTime=0;destination=new FakeNode();nodes:FakeNode[]=[];sinks:string[]=[];mediaSources=0;sinkId='';events=new Map<string,()=>void>();analysers:FakeNode[]=[];sources:FakeNode[]=[]
  constructor(){FakeContext.all.push(this)}
  createGain(){const n=new FakeNode();this.nodes.push(n);return n}
  createDynamicsCompressor(){return new FakeNode()}
  createMediaStreamDestination(){return Object.assign(new FakeNode(),{stream:{}})}
  createMediaElementSource(){this.mediaSources++;return new FakeNode()}
  addEventListener(name:string,callback:()=>void){this.events.set(name,callback)}
  removeEventListener(name:string){this.events.delete(name)}
  async setSinkId(value:string){this.sinks.push(value);this.sinkId=value;this.events.get('sinkchange')?.()}
  createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,getChannelData:()=>new Float32Array(length)}}
  createBufferSource(){const node=Object.assign(new FakeNode(),{buffer:undefined,onended:undefined as (()=>void)|undefined,start(){},stop(){}});this.sources.push(node);return node}
  createAnalyser(){const node=Object.assign(new FakeNode(),{fftSize:256,getFloatTimeDomainData:(array:Float32Array)=>array.fill(0)});this.analysers.push(node);return node}
  async resume(){this.state='running'}
  async close(){this.state='closed'}
}
const base=()=>({...defaultConfig.audio,mode:'test' as const,monitorEnabled:false})
beforeEach(()=>{
  FakeContext.all=[];FakeAudio.all=[]
  vi.stubGlobal('AudioContext',FakeContext);vi.stubGlobal('Audio',FakeAudio);vi.stubGlobal('window',globalThis)
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{})
})
afterEach(()=>{getAudioBus().dispose();vi.unstubAllGlobals();vi.useRealTimers()})

describe('直播与本地监听隔离',()=>{
 it('关闭监听不重建context、不切换直播sink、不重连直播信号',async()=>{
  const bus=new LiveAudioBus(),config={...base(),mode:'live' as const,streamDeviceId:'virtual-card'}
  await bus.configure(config)
  const context=FakeContext.all[0],liveGain=context.nodes[2]
  expect(context.sinks).toEqual(['virtual-card']);expect(liveGain.links).toContain(context.destination)
  await bus.configure({...config,monitorEnabled:true,monitorDeviceId:'headphones'})
  expect(FakeContext.all).toHaveLength(1);expect(context.sinks).toEqual(['virtual-card']);expect(liveGain.links).toContain(context.destination)
  expect(FakeAudio.all[0].paused).toBe(false)
  await bus.configure(config)
  expect(FakeAudio.all[0].paused).toBe(true);expect(context.sinks).toEqual(['virtual-card']);expect(liveGain.links).toContain(context.destination)
  bus.dispose()
 })
 it('本地测试不会连系统native输出，监听默认关闭',async()=>{
  const bus=new LiveAudioBus();await bus.configure(base())
  const context=FakeContext.all[0]
  expect(context.sinks).toEqual([]);expect(context.nodes.some(node=>node.links.includes(context.destination))).toBe(false)
  expect(FakeAudio.all[0].paused).toBe(true);bus.dispose()
 })
 it('直播设备失效或选默认设备时静默停送，不回落扬声器',async()=>{
  const bus=new LiveAudioBus();await bus.configure({...base(),mode:'live',streamDeviceId:'virtual'})
  await bus.configure({...base(),mode:'live',streamDeviceId:'default'})
  const context=FakeContext.all[0]
  expect(bus.failure).toContain('专用虚拟声卡');expect(context.sinks).toEqual(['virtual']);expect(context.nodes[2].links).not.toContain(context.destination)
  bus.dispose()
 })
 it('说话自动压低音乐，紧急静音同时关闭两路输出',async()=>{
  const bus=new LiveAudioBus();await bus.configure({...base(),monitorEnabled:true,musicGain:.5,ducking:.2})
  const context=FakeContext.all[0];bus.setSpeaking(true);expect(context.nodes[1].gain.value).toBeCloseTo(.035)
  bus.setSpeaking(false);expect(context.nodes[1].gain.value).toBe(.5)
  bus.setMuted(true);expect(context.nodes[2].gain.value).toBe(0);expect(context.nodes[3].gain.value).toBe(0);bus.dispose()
 })
 it('音乐安静起播，语音快速压低、约半秒渐回，重复状态不重置包络',async()=>{
  const bus=new LiveAudioBus(),config={...base(),musicGain:.18,ducking:.2}
  await bus.configure(config)
  const music=FakeContext.all[0].nodes[1];expect(music.gain.value).toBe(.18);expect(music.automations).toHaveLength(0)
  bus.setSpeaking(true);expect(music.automations.at(-1)).toMatchObject({value:.035,timeConstant:.025})
  bus.setSpeaking(true);await bus.configure({...config,monitorGain:.4})
  expect(music.automations).toHaveLength(1)
  bus.setSpeaking(false);expect(music.automations.at(-1)).toMatchObject({value:.18,timeConstant:.17})
  expect(music.holds).toHaveLength(2);bus.dispose()
 })
 it('较轻的背景音乐只会继续变轻，不会被语音优先规则反向抬高',async()=>{
  const bus=new LiveAudioBus();await bus.configure({...base(),musicGain:.1,ducking:.2})
  bus.setSpeaking(true);expect(FakeContext.all[0].nodes[1].gain.value).toBeCloseTo(.02)
  await bus.configure({...base(),musicGain:0,ducking:.2});expect(FakeContext.all[0].nodes[1].gain.value).toBe(0);bus.dispose()
 })
 it('监听遵循直播总音量，避免本机有声而直播总线已静音',async()=>{
  const bus=new LiveAudioBus();await bus.configure({...base(),monitorEnabled:true,streamGain:.5,monitorGain:.8})
  const context=FakeContext.all[0];expect(context.nodes[3].gain.value).toBeCloseTo(.4)
  await bus.configure({...base(),monitorEnabled:true,streamGain:0,monitorGain:.8})
  expect(context.nodes[2].gain.value).toBe(0);expect(context.nodes[3].gain.value).toBe(0);bus.dispose()
 })
 it('设备事件确认声卡消失后断开native输出，不尝试默认输出',async()=>{
  const callbacks=new Set<()=>void>(),enumerateDevices=vi.fn(async()=>[])
  vi.stubGlobal('navigator',{mediaDevices:{addEventListener:(_name:string,callback:()=>void)=>callbacks.add(callback),removeEventListener:(_name:string,callback:()=>void)=>callbacks.delete(callback),enumerateDevices}})
  const bus=new LiveAudioBus();await bus.configure({...base(),mode:'live',streamDeviceId:'virtual'})
  callbacks.forEach(callback=>callback());await vi.waitFor(()=>expect(bus.failure).toContain('声卡已断开'))
  const context=FakeContext.all[0];expect(context.nodes[2].links).not.toContain(context.destination);expect(context.sinks).toEqual(['virtual'])
  bus.dispose();expect(callbacks.size).toBe(0)
 })
 it('浏览器把消失声卡改回默认sink时立即断路',async()=>{
  const bus=new LiveAudioBus();await bus.configure({...base(),mode:'live',streamDeviceId:'virtual'})
  const context=FakeContext.all[0];context.sinkId='';context.events.get('sinkchange')?.()
  expect(bus.failure).toContain('路由已改变');expect(context.nodes[2].links).not.toContain(context.destination);bus.dispose()
 })
 it('直播模式和关闭监听的本地模式都不调用系统朗读',async()=>{
  vi.useFakeTimers();const speak=vi.fn();vi.stubGlobal('speechSynthesis',{speak,cancel:vi.fn()})
  const player=new StageAudio(),state=createDefaultState().stage;state.speaking=true;state.audio={kind:'system'}
  const callbacks={progress:vi.fn(),amplitude:vi.fn(),ended:vi.fn(),status:vi.fn(),error:vi.fn()}
  await player.configure({...base(),mode:'live',streamDeviceId:'virtual'});await player.play(state,callbacks)
  expect(speak).not.toHaveBeenCalled();expect(callbacks.status).toHaveBeenCalledWith(expect.stringContaining('不会使用系统朗读'))
  await player.configure(base());await player.play(state,callbacks);expect(speak).not.toHaveBeenCalled();player.dispose()
 })
 it('监听开关和音乐暂停/恢复不会重载歌曲或重置播放位置',async()=>{
  const player=new MusicAudio(vi.fn()),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'https://example.test/song.wav'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one',startedAt:0};state.status='playing'
  await player.configure(state,base(),false,false)
  const context=FakeContext.all[0],element=FakeAudio.all[1];element.currentTime=37
  await player.configure(state,{...base(),monitorEnabled:true},true,false)
  expect(context.mediaSources).toBe(1);expect(element.currentTime).toBe(37)
  await player.configure({...state,status:'paused'},base(),false,false);expect(element.paused).toBe(true)
  await player.configure(state,base(),false,false);expect(element.currentTime).toBe(37);expect(context.mediaSources).toBe(1)
  player.dispose()
 })
 it('路由等待中的过期状态不能把当前讲话的音乐重新抬高',async()=>{
  const player=new MusicAudio(vi.fn()),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'https://example.test/song.wav'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one'};state.status='playing'
  await player.configure(state,{...base(),musicGain:.18},true,false)
  const music=FakeContext.all[0].nodes[1],before=music.automations.length
  let release!:()=>void
  vi.spyOn(FakeAudio.prototype,'setSinkId').mockImplementation(function(this:FakeAudio,value:string){this.sinks.push(value);return new Promise<void>(resolve=>release=resolve)})
  const config={...base(),musicGain:.18,monitorEnabled:true,monitorDeviceId:'headphones'}
  const old=player.configure(state,config,false,false)
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
  const current=player.configure(state,config,true,false)
  release();await Promise.all([old,current])
  expect(music.gain.value).toBeCloseTo(.035);expect(music.automations).toHaveLength(before)
  expect(FakeContext.all[0].mediaSources).toBe(1);player.dispose()
 })
 it('暂停取消旧play请求不会误报音乐失败或跳到下一首',async()=>{
  let rejectPlay!:(error:unknown)=>void
  vi.spyOn(FakeAudio.prototype,'play').mockImplementation(function(this:FakeAudio){this.paused=false;return this.src?new Promise<void>((_resolve,reject)=>rejectPlay=reject):Promise.resolve()})
  const events=vi.fn(),player=new MusicAudio(events),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'https://example.test/song.wav'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one',startedAt:0};state.status='playing'
  const pending=player.configure(state,base(),false,false)
  await vi.waitFor(()=>expect(rejectPlay).toBeTypeOf('function'))
  await player.configure({...state,status:'paused'},base(),false,false)
  rejectPlay(new DOMException('paused','AbortError'));await pending
  expect(events).not.toHaveBeenCalled();expect(FakeAudio.all[1].paused).toBe(true);player.dispose()
 })
 it('只有真实 playing 才回执开始，每首一次，暂停和换曲后的旧事件不能误报',async()=>{
  const events=vi.fn(),player=new MusicAudio(events),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'shop-qqmusic://track/001ABC'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one'};state.status='playing'
  await player.configure(state,base(),false,false)
  const first=FakeAudio.all[1],oldPlaying=first.onplaying!
  expect(events).not.toHaveBeenCalled()
  await player.configure({...state,status:'paused'},base(),false,false);oldPlaying()
  expect(events).not.toHaveBeenCalled()
  await player.configure(state,base(),false,false);first.onplaying!();first.onplaying!()
  expect(events.mock.calls).toEqual([[{type:'music-started',generationId:'one'}]])
  await player.configure({...state,current:{...state.current!,generationId:'two'}},base(),false,false)
  oldPlaying();expect(events).toHaveBeenCalledTimes(1)
  const second=FakeAudio.all[2],nextPlaying=second.onplaying!
  second.onplaying!();expect(events.mock.calls[1]).toEqual([{type:'music-started',generationId:'two'}])
  player.stop();nextPlaying();expect(events).toHaveBeenCalledTimes(2);player.dispose()
 })
 it('输出切换等待中到达的 playing 遵循最新暂停意图',async()=>{
  const events=vi.fn(),player=new MusicAudio(events),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'shop-qqmusic://track/001ABC'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one'};state.status='playing'
  await player.configure(state,base(),false,false)
  const element=FakeAudio.all[1],pending=player.configure({...state,status:'paused'},{...base(),monitorEnabled:true},false,false)
  element.onplaying!();expect(events).not.toHaveBeenCalled();await pending
  await player.configure(state,base(),false,false);element.onplaying!()
  expect(events).toHaveBeenCalledWith({type:'music-started',generationId:'one'});player.dispose()
 })
 it('换曲路由等待中旧 playing 不会报告已过期歌曲开始',async()=>{
  const events=vi.fn(),player=new MusicAudio(events),state=createDefaultState().music
  state.tracks=[{id:'song',title:'歌曲',artist:'本地',source:'shop-qqmusic://track/001ABC'}]
  state.current={id:'req',trackId:'song',userId:'owner',userName:'店长',at:0,status:'queued',generationId:'one'};state.status='playing'
  await player.configure(state,base(),false,false)
  const oldPlaying=FakeAudio.all[1].onplaying!,pending=player.configure({...state,current:{...state.current!,generationId:'two'}},{...base(),monitorEnabled:true},false,false)
  oldPlaying();expect(events).not.toHaveBeenCalled();await pending
  FakeAudio.all[2].onplaying!();expect(events).toHaveBeenCalledWith({type:'music-started',generationId:'two'});player.dispose()
 })
 it('一句PCM结束后释放buffer source和分析器连接',async()=>{
  const player=new StageAudio(),state=createDefaultState().stage
  state.speaking=true;state.audio={kind:'pcm',data:'AAAAAAAAAAA=',sampleRate:24000}
  const callbacks={progress:vi.fn(),amplitude:vi.fn(),ended:vi.fn(),status:vi.fn(),error:vi.fn()}
  await player.configure(base());await player.play(state,callbacks)
  const context=FakeContext.all[0];expect(context.analysers[0].links).toHaveLength(1)
  ;(context.sources[0] as FakeNode&{onended:()=>void}).onended()
  expect(context.sources[0].links).toHaveLength(0);expect(context.analysers[0].links).toHaveLength(0);expect(callbacks.ended).toHaveBeenCalledOnce();player.dispose()
 })
 it('PCM结束显式释放原生buffer和持有台词快照的回调，重复结束不再通知',async()=>{
  const player=new StageAudio(),state=createDefaultState().stage
  state.speaking=true;state.audio={kind:'pcm',data:'AQACAA==',sampleRate:24000}
  const callbacks={progress:vi.fn(),amplitude:vi.fn(),ended:vi.fn(),status:vi.fn(),error:vi.fn()}
  await player.configure(base());await player.play(state,callbacks)
  const source=FakeContext.all[0].sources[0] as FakeNode&{buffer:unknown;onended:()=>void},ended=source.onended
  expect(source.buffer).not.toBeNull();ended();ended()
  expect(source.buffer).toBeNull();expect(Reflect.get(player,'callbacks')).toBeUndefined();expect(callbacks.ended).toHaveBeenCalledOnce();player.dispose()
 })
 it('远端语音结束或打断后清src并load释放媒体缓冲，不把服务URL当本地文件',async()=>{
  const player=new StageAudio(),state=createDefaultState().stage
  state.speaking=true;state.audio={kind:'url',url:'https://voice.example.test/ephemeral.wav'}
  const callbacks={progress:vi.fn(),amplitude:vi.fn(),ended:vi.fn(),status:vi.fn(),error:vi.fn()}
  await player.configure(base());await player.play(state,callbacks)
  const element=FakeAudio.all[1],ended=element.onended!
  expect(element.src).toContain('ephemeral.wav');ended()
  expect(element.src).toBe('');expect(element.paused).toBe(true);expect(element.loads).toBe(1);expect(element.onended).toBeNull();expect(Reflect.get(player,'callbacks')).toBeUndefined()
  await player.play(state,callbacks);const next=FakeAudio.all[2];player.stop();expect(next.src).toBe('');expect(next.loads).toBe(1);expect(callbacks.ended).toHaveBeenCalledOnce();player.dispose()
 })
 it('路由resume仍在等待时打断立即结束play，迟到resume不能分配或启动PCM',async()=>{
  const player=new StageAudio(),state=createDefaultState().stage
  state.speaking=true;state.audio={kind:'pcm',data:'AQACAA==',sampleRate:24000}
  const callbacks={progress:vi.fn(),amplitude:vi.fn(),ended:vi.fn(),status:vi.fn(),error:vi.fn()}
  await player.configure(base());const context=FakeContext.all[0];let release!:()=>void
  vi.spyOn(context,'resume').mockImplementation(()=>new Promise<void>(resolve=>release=resolve))
  const playback=player.play(state,callbacks);await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
  player.stop();await playback;expect(context.sources).toHaveLength(0);expect(Reflect.get(player,'callbacks')).toBeUndefined()
  release();await Promise.resolve();await Promise.resolve();expect(context.sources).toHaveLength(0);expect(callbacks.error).not.toHaveBeenCalled();expect(callbacks.ended).not.toHaveBeenCalled();player.dispose()
 })
})
