import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,basename,resolve} from 'node:path'
import {createStellarisMusic} from '../apps/desktop/electron/stellaris-music'
import {assessMusic,musicDenied} from '../packages/core/src/music-policy'
const roots:string[]=[],services:ReturnType<typeof createStellarisMusic>[]=[]
afterEach(async()=>{for(const service of services.splice(0))await service.dispose();for(const root of roots.splice(0)){if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('cyberfish-music-'))throw new Error('Unexpected test directory');await rm(root,{recursive:true,force:true})}vi.useRealTimers()})
async function setup(options:{disabled?:boolean;title?:string;lyrics?:string;saved?:unknown;failure?:string}={}){
 const root=await mkdtemp(join(tmpdir(),'cyberfish-music-'));roots.push(root)
 if(options.saved)await writeFile(join(root,'stellaris-music.json'),JSON.stringify(options.saved))
 const counters={provider:0,lyrics:0,stream:0,resolve:0}
 const s=createStellarisMusic({directory:root,disabled:options.disabled,provider:async()=>{
  counters.provider++;return {
   status:async()=>({loggedIn:true,loginPending:false,message:'离线假账号'}),
   loginStart:async()=>({qrDataUrl:'data:image/png;base64,AA==',expiresAt:Date.now()+120000,message:'离线假二维码'}),
   loginPoll:async()=>({loggedIn:true,loginPending:false,message:'离线假账号'}),
   resolve:async()=>{counters.resolve++;if(options.failure)throw new Error(options.failure);return {id:'qq:cleanMID',title:options.title||'陌生的星海',artist:'测试歌手',source:'shop-qqmusic://track/cleanMID'}},
   lyrics:async()=>{counters.lyrics++;return options.lyrics??'[00:01]Fly among the stars\n[00:02]A quiet ocean shines'},
   stream:async()=>{counters.stream++;return new Response('offline fake audio',{headers:{'content-type':'audio/mpeg'}})},dispose(){}
  }
 }});services.push(s);return {s,root,counters}
}
const chat=(id:string,text:string)=>({id,platform:'bilibili' as const,kind:'chat' as const,user:{id:'u'+id,name:'离线观众'},text,at:Date.now()})
describe('DSH music with an injected offline provider',()=>{
 it('独立直播曲库超过旧500首后仍能增加、保存并恢复轮播列表',async()=>{
   const tracks=Array.from({length:501},(_,i)=>({id:`qq:old${i}`,title:`原有歌曲${i}`,artist:'测试',source:`shop-qqmusic://track/old${i}`}))
   const {s,root}=await setup({saved:{tracks,bgmTrackIds:tracks.map(t=>t.id),maxQueue:250}})
   expect((await s.action('add','陌生的星海')).ok).toBe(true)
   const saved=JSON.parse(await readFile(join(root,'stellaris-music.json'),'utf8'))
   expect(saved.tracks).toHaveLength(502);expect(saved.bgmTrackIds).toHaveLength(502);expect(saved.maxQueue).toBe(250)
   const restored=await setup({saved});expect((await restored.s.view()).bgmTrackIds).toHaveLength(502)
 })
 it('直播队列默认100、可调到500并持久保存，无需为修改队列初始化账号',async()=>{
   const {s,root,counters}=await setup();expect((await s.view()).maxQueue).toBe(100)
   expect((await s.action('queueLimit',500)).ok).toBe(true);expect(counters.provider).toBe(0)
   for(const bad of [0,501,3.5,NaN,'200'])expect((await s.action('queueLimit',bad)).ok).toBe(false)
   const saved=JSON.parse(await readFile(join(root,'stellaris-music.json'),'utf8'))
   expect(saved.maxQueue).toBe(500);const restored=await setup({saved});expect((await restored.s.view()).maxQueue).toBe(500)
 })
 it('曲库达到5000首时明确提示已满，不伪报加入成功',async()=>{
   const tracks=Array.from({length:5000},(_,i)=>({id:`qq:old${i}`,title:`原有歌曲${i}`,artist:'测试',source:`shop-qqmusic://track/old${i}`}))
   const {s}=await setup({saved:{tracks,bgmTrackIds:tracks.map(t=>t.id)}})
   const result=await s.action('add','陌生的星海');expect(result.ok).toBe(false);expect(result.message).toContain('5000');expect(result.view.state.tracks).toHaveLength(5000)
 })
 it('区分无匹配、无完整播放权限和网络问题，同时过滤原始凭据错误',async()=>{
   for(const message of ['没有找到可确认的歌名和歌手，请发「点歌 歌名 歌手」。','这首歌暂时无法取得完整播放地址，请在QQ音乐核对账号权限或换一首。','QQ音乐连接失败，请稍后重试。']){
     const {s}=await setup({failure:message});expect((await s.action('add','歌曲')).message).toBe(message)
   }
   const {s}=await setup({failure:'Cookie=SECRET https://secret.test/?vkey=SECRET'})
   expect((await s.action('add','歌曲')).message).not.toContain('SECRET')
 })
 it('背景曲全部失败后每分钟恢复一次，用户停止后不恢复',async()=>{
   vi.useFakeTimers();const {s}=await setup();await s.action('start')
   for(let n=0;n<4;n++){const v=await s.view();expect(v.state.current?.isBgm).toBe(true);s.feedback(v.state.current!.generationId,'error')}
   expect((await s.view()).state.current).toBeUndefined()
   await vi.advanceTimersByTimeAsync(59999);expect((await s.view()).state.current).toBeUndefined()
   await vi.advanceTimersByTimeAsync(2);expect((await s.view()).state.current?.isBgm).toBe(true)
   await s.action('stop');await vi.advanceTimersByTimeAsync(180000);expect((await s.view()).state.current).toBeUndefined()
 })
 it('背景曲完成自动轮播，观众点播完成后回到背景曲',async()=>{
   const {s}=await setup();await s.action('start');const first=(await s.view()).state.current!
   s.feedback(first.generationId,'started');s.feedback(first.generationId,'ended');expect((await s.view()).state.current?.trackId).not.toBe(first.trackId)
   s.event(chat('after-bgm','点歌 陌生的星海'));await s.flush();const requested=(await s.view()).state.current!
   expect(requested.isBgm).not.toBe(true);s.feedback(requested.generationId,'started');s.feedback(requested.generationId,'ended')
   expect((await s.view()).state.current?.isBgm).toBe(true)
 })
 it('does not initialize accounts or start sound on launch, and isolated mode blocks every real operation',async()=>{
  const {s,counters}=await setup({disabled:true});expect((await s.view()).enabled).toBe(false);expect(counters.provider).toBe(0)
  expect((await s.action('start')).ok).toBe(false);expect(counters.provider).toBe(0)
 })
 it('searches an unfamiliar request, deduplicates it and requires actual playback acknowledgement',async()=>{
  const {s,counters}=await setup();await s.action('start')
  const event=chat('1','点歌 陌生的星海');s.event(event);s.event(event);await s.flush()
  const v=await s.view();expect(counters.resolve).toBe(1);expect(v.state.current?.trackId).toBe('qq:cleanMID');expect(v.state.current?.startedAt).toBeUndefined()
  const generation=v.state.current!.generationId;s.feedback(generation,'started');expect((await s.view()).state.current?.startedAt).toBeTypeOf('number')
  await s.action('stop');s.feedback(generation,'ended');expect((await s.view()).state.current).toBeUndefined()
 })
 it('checks actual QQ metadata rather than the requested alias, and never streams a blocked anthem',async()=>{
  const {s,counters}=await setup({title:'义勇军进行曲'});await s.action('start');s.event(chat('1','点歌 普通歌曲'));await s.flush()
  expect((await s.view()).state.tracks.some(x=>x.id==='qq:cleanMID')).toBe(false);expect(counters.stream).toBe(0)
  expect((await s.action('add','普通歌曲')).ok).toBe(false)
 })
 it('screens lyrics for unfamiliar music before queueing, and blocks political lyrics and high profanity density',async()=>{
  const {s,counters}=await setup({lyrics:'[00:01]fuck this\n[00:02]fucking shit\n[00:03]bitch'});await s.action('start');s.event(chat('1','点歌 陌生歌曲'));await s.flush()
  expect((await s.view()).state.tracks.some(x=>x.id==='qq:cleanMID')).toBe(false);expect(counters.stream).toBe(0)
  expect(assessMusic({title:'普通曲名',artist:'测试'},'[00:01]这是一首政治宣传歌曲').allowed).toBe(false)
 })
 it('checks before audio bytes, caches the verdict without storing lyrics, and stops immediately on blacklist updates',async()=>{
  const {s,root,counters}=await setup();await s.action('start');const v=await s.view(),track=v.state.tracks.find(x=>x.id===v.state.current?.trackId)!
  expect((await s.stream(new Request(track.source))).ok).toBe(true);expect((await s.stream(new Request(track.source))).ok).toBe(true)
  expect(counters.lyrics).toBe(1);expect(counters.stream).toBe(2)
  const saved=await readFile(join(root,'stellaris-music.json'),'utf8');expect(saved).not.toContain('Fly among');expect(saved).not.toContain('Session')
  await s.action('blacklist',track.title);expect((await s.view()).enabled).toBe(false);expect((await s.stream(new Request(track.source))).status).toBe(403)
 })
 it('normalizes spaced and full-width blacklisted names while allowing ordinary lyrics and a single mild swear',()=>{
  expect(musicDenied({title:'国　歌：义 勇 军 进 行 曲',artist:'测试'})).toBe(true)
  expect(musicDenied({title:'Ｔｈｅ Ｓｔａｒ－Ｓｐａｎｇｌｅｄ Ｂａｎｎｅｒ',artist:'测试'})).toBe(true)
  expect(assessMusic({title:'夜航',artist:'测试'},'one shit\nmore stars\nquiet sea\nsoft lights\nfar away\nbright day\nwe fly').allowed).toBe(true)
 })
})
