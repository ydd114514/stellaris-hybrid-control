import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,basename,resolve} from 'node:path'
import {createStellarisMusic} from '../apps/desktop/electron/stellaris-music'
import {assessMusic,musicDenied} from '../packages/core/src/music-policy'
const roots:string[]=[],services:ReturnType<typeof createStellarisMusic>[]=[]
afterEach(async()=>{for(const service of services.splice(0))await service.dispose();for(const root of roots.splice(0)){if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('cyberfish-music-'))throw new Error('Unexpected test directory');await rm(root,{recursive:true,force:true})}vi.useRealTimers()})
async function setup(options:{disabled?:boolean;title?:string;lyrics?:string;lyricsFailure?:boolean;loggedIn?:boolean;searchGate?:Promise<void>;saved?:unknown;failure?:string;streamStatus?:number;streamBody?:string;resolveGate?:Promise<void>;likedGate?:Promise<void>}={}){
 const root=await mkdtemp(join(tmpdir(),'cyberfish-music-'));roots.push(root)
 if(options.saved)await writeFile(join(root,'stellaris-music.json'),JSON.stringify(options.saved))
 const counters={provider:0,lyrics:0,stream:0,resolve:0,search:0};const repairSignals:AbortSignal[]=[]
 const s=createStellarisMusic({directory:root,disabled:options.disabled,provider:async()=>{
  counters.provider++;return {
   status:async()=>({loggedIn:options.loggedIn!==false,loginPending:false,message:'离线假账号'}),
   likedSongs:async()=>{if(options.likedGate)await options.likedGate;return {tracks:[{id:'qq:liked1',title:'喜欢的歌',artist:'歌手',source:'shop-qqmusic://track/liked1'}],total:1,skipped:0,truncated:false}},
   search:async(query,signal,page)=>{counters.search++;if(options.searchGate)await options.searchGate;return {tracks:[{id:`qq:result${page}`,title:options.title||query,artist:'原唱歌手',source:`shop-qqmusic://track/result${page}`}],more:page===1}},
   loginStart:async()=>({qrDataUrl:'data:image/png;base64,AA==',expiresAt:Date.now()+120000,message:'离线假二维码'}),
   loginPoll:async()=>({loggedIn:true,loginPending:false,message:'离线假账号'}),
   resolve:async(_query,signal)=>{counters.resolve++;repairSignals.push(signal);if(options.resolveGate)await Promise.race([options.resolveGate,new Promise((_,fail)=>signal?.addEventListener('abort',()=>fail(new Error('已取消')),{once:true}))]);if(options.failure)throw new Error(options.failure);return {id:'qq:cleanMID',title:options.title||'陌生的星海',artist:'测试歌手',source:'shop-qqmusic://track/cleanMID'}},
   lyrics:async()=>{counters.lyrics++;if(options.lyricsFailure)throw Error('upstream failure SECRET');return options.lyrics??'[00:01]Fly among the stars\n[00:02]A quiet ocean shines'},
   stream:async()=>{counters.stream++;if(options.streamStatus)return new Response(options.streamBody||'离线模拟音频地址失效',{status:options.streamStatus});return new Response('offline fake audio',{headers:{'content-type':'audio/mpeg'}})},dispose(){}
  }
 }});services.push(s);return {s,root,counters,repairSignals}
}
const chat=(id:string,text:string)=>({id,platform:'bilibili' as const,kind:'chat' as const,user:{id:'u'+id,name:'离线观众'},text,at:Date.now()})
describe('DSH music with an injected offline provider',()=>{
 it('导入我喜欢合并现有轮播且不启动音频，重复导入不重复添加',async()=>{
   const {s,counters}=await setup(),before=await s.view()
   const result=await s.action('import-liked')
   expect(result.ok).toBe(true);expect(result.view.bgmTrackIds).toEqual([...before.bgmTrackIds,'qq:liked1'])
   expect(result.message).toContain('新增轮播 1 首');expect(result.view.enabled).toBe(false)
   expect(counters.resolve).toBe(0);expect(counters.lyrics).toBe(0);expect(counters.stream).toBe(0)
   expect((await s.action('import-liked')).message).toContain('新增轮播 0 首')
 })
 it('停止取消喜欢导入后，迟到列表不能写入歌单',async()=>{
   let release!:()=>void;const likedGate=new Promise<void>(done=>release=done),{s,root}=await setup({likedGate})
   const before=await s.view(),pending=s.action('import-liked');await new Promise(done=>setImmediate(done))
   await s.action('stop');release();expect((await pending).ok).toBe(false)
   expect((await s.view()).state.tracks).toEqual(before.state.tracks)
   await expect(readFile(join(root,'stellaris-music.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'})
 })
 it.each(['one last kiss','雨爱','老男孩'])('手动搜索%s可选版本收藏，未登录也不取播放地址或启动声音',async title=>{
   const {s,counters,root}=await setup({title,loggedIn:false,failure:'不应自动解析'})
   const found=await s.action('search',title)
   expect(found.ok).toBe(true);expect(found.view.catalog?.tracks[0]?.title).toBe(title)
   const added=await s.action('add-result','qq:result1')
   expect(added.ok).toBe(true);expect(added.view.bgmTrackIds).toContain('qq:result1')
   expect(counters.resolve).toBe(0);expect(counters.stream).toBe(0);expect(added.view.enabled).toBe(false)
   expect(JSON.parse(await readFile(join(root,'stellaris-music.json'),'utf8')).bgmTrackIds).toContain('qq:result1')
 })
 it('搜索可翻页；只允许加入当前页实际返回的QQ结果，不能由界面注入音源',async()=>{
   const {s}=await setup();await s.action('search','雨爱')
   expect((await s.action('searchPage',2)).view.catalog).toMatchObject({query:'雨爱',page:2,more:false})
   expect((await s.action('add-result','qq:result1')).ok).toBe(false)
   expect((await s.action('add-result','https://evil.test/a.mp3')).ok).toBe(false)
   expect((await s.action('add-result','qq:result2')).ok).toBe(true)
 })
 it('歌词接口失败可先收藏但未伪造检查通过；播放仍重查歌词',async()=>{
   const {s,counters}=await setup({lyricsFailure:true});await s.action('search','雨爱')
   const r=await s.action('add-result','qq:result1');expect(r.ok).toBe(true);expect(r.message).toContain('播放前会重试')
   await s.action('start');const v=await s.view(),t=v.state.tracks.find(t=>t.id===v.state.current?.trackId)!
   expect((await s.stream(new Request(t.source))).status).toBe(503);expect(counters.stream).toBe(0);expect(counters.lyrics).toBe(2)
 })
 it('已选搜索结果的明确黑名单与歌词拦截仍生效，理由明确显示',async()=>{
   const {s}=await setup({title:'义勇军进行曲'});await s.action('search','曲目')
   const r=await s.action('add-result','qq:result1');expect(r.ok).toBe(false);expect(r.message).toContain('禁止加入')
   const explicit=await setup({lyrics:'fuck\nfucking shit\nbitch'});await explicit.s.action('search','曲目')
   expect((await explicit.s.action('add-result','qq:result1')).message).toContain('脏话密度')
 })
 it('音乐未开启时停止也取消手动搜索，迟到结果不能替换目录',async()=>{
   let release!:()=>void;const gate=new Promise<void>(done=>release=done),{s}=await setup({searchGate:gate})
   const pending=s.action('search','老男孩');await new Promise(done=>setImmediate(done));await s.action('stop');release()
   expect((await pending).ok).toBe(false);expect((await s.view()).catalog).toBeUndefined()
 })
 it('普通隐喻和零星粗口不再等同违规类别，明确政治宣传仍拒绝',()=>{
   expect(assessMusic({title:'恋爱革命',artist:'测试歌手'},'这是爱的革命\n在心中成为领袖').allowed).toBe(true)
   expect(assessMusic({title:'普通歌',artist:'测试歌手'},Array.from({length:50},(_,i)=>i<4?'fuck':'we sing under the stars').join('\n')).allowed).toBe(true)
   expect(assessMusic({title:'普通歌',artist:'测试歌手'},'这是一首政治宣传歌曲').allowed).toBe(false)
 })
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
 it('失效背景来源重新查找并检查一次，保留歌单ID和其他曲目',async()=>{
  const {s,counters}=await setup({streamStatus:502});await s.action('start')
  const before=await s.view(),track=before.state.tracks.find(t=>t.id===before.state.current?.trackId)!
  expect((await s.stream(new Request(track.source))).status).toBe(502)
  await expect.poll(async()=>(await s.view()).state.tracks.find(t=>t.id===track.id)?.source).toBe('shop-qqmusic://track/cleanMID')
  expect(counters.resolve).toBe(1)
  expect((await s.view()).state.tracks.filter(t=>t.id!==track.id)).toEqual(before.state.tracks.filter(t=>t.id!==track.id))
 })
 it('权限拒绝不重新搜歌，停止取消在途来源修复且不写回迟到结果',async()=>{
  const denied=await setup({streamStatus:403});await denied.s.action('start');const v=await denied.s.view(),t=v.state.tracks.find(t=>t.id===v.state.current?.trackId)!
  await denied.s.stream(new Request(t.source));expect(denied.counters.resolve).toBe(0)
  let release!:()=>void;const gate=new Promise<void>(done=>release=done)
  const x=await setup({streamStatus:502,resolveGate:gate});await x.s.action('start');const before=await x.s.view(),track=before.state.tracks.find(t=>t.id===before.state.current?.trackId)!
  await x.s.stream(new Request(track.source));await expect.poll(()=>x.repairSignals.length).toBe(1)
  await x.s.action('stop');expect(x.repairSignals[0]?.aborted).toBe(true);release();await new Promise(r=>setImmediate(r))
  expect((await x.s.view()).state.tracks).toEqual(before.state.tracks)
 })
 it('停止可取消主界面手动搜索，取消后可立即重新扫码',async()=>{
  const gate=new Promise<void>(()=>{});const x=await setup({resolveGate:gate});await x.s.action('start')
  const pending=x.s.action('add','测试歌曲');await expect.poll(()=>x.repairSignals.length).toBe(1)
  await x.s.action('stop');expect(x.repairSignals[0]?.aborted).toBe(true)
  expect((await pending).ok).toBe(false);expect((await x.s.action('login','qq')).ok).toBe(true)
 })
 it('音频接口报告登录过期时撤销缓存登录假象，不再当成地址失效重搜',async()=>{
  const x=await setup({streamStatus:502,streamBody:'QQ音乐尚未登录或登录已失效，请重新扫码。'});await x.s.action('start')
  const v=await x.s.view(),track=v.state.tracks.find(t=>t.id===v.state.current?.trackId)!
  await x.s.stream(new Request(track.source));expect((await x.s.view()).account.loggedIn).toBe(false)
  expect(x.counters.resolve).toBe(0);expect(x.s.diagnostics().lastStreamFailure?.message).toContain('重新扫码')
 })
 it('normalizes spaced and full-width blacklisted names while allowing ordinary lyrics and a single mild swear',()=>{
  expect(musicDenied({title:'国　歌：义 勇 军 进 行 曲',artist:'测试'})).toBe(true)
  expect(musicDenied({title:'Ｔｈｅ Ｓｔａｒ－Ｓｐａｎｇｌｅｄ Ｂａｎｎｅｒ',artist:'测试'})).toBe(true)
  expect(assessMusic({title:'夜航',artist:'测试'},'one shit\nmore stars\nquiet sea\nsoft lights\nfar away\nbright day\nwe fly').allowed).toBe(true)
 })
})
