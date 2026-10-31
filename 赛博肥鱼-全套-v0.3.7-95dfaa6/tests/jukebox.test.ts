import { describe, it, expect } from 'vitest'
import { createJukebox, restoreMusic, validateTracks } from '../packages/core/src/jukebox'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import { DEFAULT_BGM_TRACKS } from '../packages/core/src/music-defaults'
import type { MusicTrack } from '../packages/shared/src'

const tracks: MusicTrack[] = [
  { id: 'rain', title: '雨夜', artist: '小店', source: 'shop-media://track/uuid-rain' },
  { id: 'stars', title: '星星', artist: '小店', source: 'https://example.test/stars.wav' },
  { id: 'tea', title: '晚安茶', artist: '小店', source: 'https://example.test/tea.wav' },
  { id: 'moon', title: '月亮', artist: '小店', source: 'https://example.test/moon.wav' },
]
const viewer = (id = 'one', visits = 1) => ({ id, name: id, visits, blocked: false })
function setup() {
  let now = 100000, n = 0
  const state = createDefaultState(now).music, config = structuredClone(defaultConfig.music)
  const j = createJukebox({ state, config: () => config, now: () => now, id: () => `id-${++n}`, canStart: () => true })
  j.setTracks(tracks)
  return { state, config, j, advance(ms: number) { now += ms } }
}

describe('有秩序的点歌台', () => {
  it('弹幕点歌只加入队列，不打断当前曲；每人最多一首待播', () => {
    const {j,state,advance} = setup()
    expect(j.chat(viewer('a'), '点歌 雨夜').result?.ok).toBe(true)
    const current = state.current!
    advance(3000)
    expect(j.chat(viewer('b'), '点歌 星星').result?.ok).toBe(true)
    expect(state.current!.generationId).toBe(current.generationId)
    expect(state.queue).toHaveLength(1)
    advance(3000)
    expect(j.request(viewer('b'), '晚安茶').ok).toBe(false)
    expect(state.current!.trackId).toBe('rain')
  })
  it('审核模式先待确认；通过后仍按队列顺序播放', () => {
    const {j,state,config} = setup(); config.requestPolicy = 'approval'
    j.play('rain'); j.request(viewer(), '星星')
    expect(state.queue[0]!.status).toBe('pending')
    expect(state.current!.trackId).toBe('rain')
    expect(j.approve(state.queue[0]!.id).ok).toBe(true)
    expect(state.queue[0]!.status).toBe('queued')
    expect(state.current!.trackId).toBe('rain')
    j.ended(state.current!.generationId)
    expect(state.current!.trackId).toBe('stars')
  })
  it('熟客模式不以礼物换点歌权限，按来访场次数决定', () => {
    const {j,state,config} = setup(); config.requestPolicy = 'regular'
    expect(j.request(viewer('new',2), '雨夜').ok).toBe(false)
    expect(j.request(viewer('regular',3), '雨夜').ok).toBe(true)
    expect(state.current!.userId).toBe('regular')
  })
  it('个人冷却、全局频率和队列上限同时生效', () => {
    const {j,state,config,advance} = setup(); config.autoStart=false;config.maxQueue=2
    expect(j.request(viewer('a'),'雨夜').ok).toBe(true)
    expect(j.request(viewer('b'),'星星').message).toContain('太快')
    advance(3000);expect(j.request(viewer('b'),'星星').ok).toBe(true)
    advance(3000);expect(j.request(viewer('c'),'晚安茶').message).toContain('满')
    j.reject(state.queue.find(r=>r.userId==='a')!.id)
    expect(j.request(viewer('a'),'晚安茶').message).toContain('间隔')
  })
  it('店长可编排多首待播歌曲，观众仍每人一首', () => {
    const {j,state,config}=setup();config.autoStart=false
    expect(j.request(viewer('__owner__'),'雨夜',true).ok).toBe(true)
    expect(j.request(viewer('__owner__'),'星星',true).ok).toBe(true)
    expect(j.request(viewer('a'),'晚安茶').ok).toBe(true)
    expect(j.request(viewer('a'),'月亮').message).toContain('每人最多')
    expect(state.queue.map(r=>r.trackId)).toEqual(['rain','stars','tea'])
  })
  it('重复歌曲和同名歧义不会排队多次，黑名单不能绕过', () => {
    const {j,state,config,advance}=setup()
    j.request(viewer('a'),'雨夜');advance(3000)
    expect(j.request(viewer('b'),'雨夜').ok).toBe(false)
    config.blockedTracks=['星星'];expect(j.request(viewer('b'),'stars').message).toContain('屏蔽')
    j.setTracks([...tracks,{id:'rain-two',title:'雨夜',artist:'另一位',source:'https://example.test/other.wav'}])
    expect(j.request(viewer('c'),'雨夜').message).toContain('同名')
    expect(state.queue).toHaveLength(0)
  })
  it('切歌必须先听满保护时间；重复弹幕只算独立观众一票', () => {
    const {j,state,advance}=setup();j.audience(['a','b','c','d']);j.play('rain');j.started(state.current!.generationId);j.request(viewer('b'),'星星')
    expect(j.chat(viewer('a'),'切歌').result?.message).toContain('听满')
    advance(45000)
    j.chat(viewer('a'),'切歌');j.chat(viewer('a'),'切歌');j.chat(viewer('a'),'切歌')
    expect(state.skipVotes).toHaveLength(1)
    expect(state.current!.trackId).toBe('rain')
    j.chat(viewer('b'),'切歌');expect(state.current!.trackId).toBe('rain')
    j.chat(viewer('c'),'切歌');expect(state.current!.trackId).toBe('stars')
    expect(state.skipVotes).toHaveLength(0)
  })
  it('人数变多时需满足比例，非现场观众不能投票', () => {
    const {j,state,advance}=setup();j.audience(['a','b','c','d','e','f','g','h']);j.play('rain');j.started(state.current!.generationId);advance(45000)
    expect(state.skipRequired).toBe(5)
    expect(j.chat(viewer('absent'),'切歌').result?.ok).toBe(false)
    for(const user of ['a','b','c','d'])j.chat(viewer(user),'切歌')
    expect(state.current!.trackId).toBe('rain')
    j.chat(viewer('e'),'切歌');expect(state.current).toBeUndefined()
  })
  it('暂停时长不能用于绕过最短试听保护', () => {
    const {j,state,advance}=setup();j.audience(['a','b','c']);j.play('rain');j.started(state.current!.generationId);advance(10000);j.pause();advance(180000);j.resume()
    expect(j.chat(viewer('a'),'切歌').result?.message).toContain('听满')
    expect(state.current!.trackId).toBe('rain')
  })
  it('主播可直接切歌，迟到回执不能推进新歌曲', () => {
    const {j,state}=setup();j.play('rain');const old=state.current!.generationId;j.play('stars');const next=state.current!.generationId
    expect(old).not.toBe(next);j.ended(old);expect(state.current!.generationId).toBe(next)
    j.stop();j.ended(next);expect(state.current).toBeUndefined()
  })
  it('暂停后迟到的 ended 不会自动切歌和恢复声音', () => {
    const {j,state}=setup();j.play('rain');j.request(viewer(),'星星');const generation=state.current!.generationId
    j.pause();j.ended(generation)
    expect(state.status).toBe('paused');expect(state.current!.trackId).toBe('rain');expect(state.queue).toHaveLength(1)
    j.resume();j.ended(generation);expect(state.current!.trackId).toBe('stars')
  })
  it('暂停中的歌曲失败时不自动启动下一首', () => {
    const {j,state}=setup();j.play('rain');j.request(viewer(),'星星');const generation=state.current!.generationId
    j.pause();j.ended(generation,'文件不可读')
    expect(state.status).toBe('stopped');expect(state.current).toBeUndefined();expect(state.queue).toHaveLength(1)
    expect(state.lastMessage).toContain('播放失败')
  })
  it('播放队列失败不会停止原来正在播放的歌曲', () => {
    const {j,state}=setup();j.play('rain');const generation=state.current!.generationId
    expect(j.play().ok).toBe(false);expect(state.current!.generationId).toBe(generation);expect(state.status).toBe('playing')
  })
  it('修改正在播放的来源会停止旧音频，不能悄悄替换播放', () => {
    const {j,state}=setup();j.play('rain');j.setTracks(tracks.map(t=>t.id==='rain'?{...t,source:'https://example.test/new.wav'}:t))
    expect(state.current).toBeUndefined();expect(state.status).toBe('stopped')
  })
  it('重启只恢复曲库，不自动恢复声响或观众申请', () => {
    const {j,state}=setup();j.play('rain');j.request(viewer(),'星星')
    const restored=restoreMusic(state,createDefaultState().music)
    expect(restored.tracks).toEqual([...tracks,...DEFAULT_BGM_TRACKS]);expect(restored.current).toBeUndefined();expect(restored.queue).toHaveLength(0);expect(restored.status).toBe('stopped')
  })
  it('屏蔽观众不能点歌，取消只移除自己的待播歌曲', () => {
    const {j,state,advance}=setup();j.play('rain');expect(j.request({...viewer(),blocked:true},'星星').ok).toBe(false)
    j.request(viewer('a'),'星星');advance(3000);j.request(viewer('b'),'晚安茶');j.chat(viewer('a'),'取消点歌')
    expect(state.queue.map(r=>r.userId)).toEqual(['b'])
  })
  it('曲目来源拒绝脚本、任意文件路径、假安全协议和重复编号', () => {
    for(const source of ['javascript:alert(1)','file:///Users/owner/private.wav','data:audio/wav;base64,AAAA','shop-media://track/../../secret','shop-media://other/uuid']) expect(()=>validateTracks([{...tracks[0],source}])).toThrow()
    expect(()=>validateTracks([tracks[0],tracks[0]])).toThrow()
  })
  it('QQ 曲目保存稳定 MID 并可恢复，拒绝附带地址和伪造协议路径', () => {
    const qq={id:'qq:001A2b3C',title:'QQ 歌曲',artist:'歌手',source:'shop-qqmusic://track/001A2b3C'}
    expect(validateTracks([qq])).toEqual([qq])
    expect(restoreMusic({tracks:[qq]},createDefaultState().music).tracks).toEqual([qq,...DEFAULT_BGM_TRACKS])
    for(const source of ['shop-qqmusic://track/','shop-qqmusic://track/'+ 'A'.repeat(65),'shop-qqmusic://track/a-b','shop-qqmusic://track/a_b','shop-qqmusic://track/%41','shop-qqmusic://track/a?url=https://example.test','shop-qqmusic://track/a#b','shop-qqmusic://user:pass@track/a','shop-qqmusic://track:80/a','shop-qqmusic://other/a','shop-qqmusic://track/a/extra','shop-qqmusic://track/../a']) expect(()=>validateTracks([{...qq,source}])).toThrow()
  })
  it('缓冲和解析时间不消耗保护期，真实开始后才计时且重复回执不重置', () => {
    const {j,state,advance}=setup();j.audience(['a','b','c']);j.play('rain')
    advance(120000)
    expect(j.chat(viewer('a'),'切歌').result?.message).toContain('准备播放')
    const generation=state.current!.generationId;j.started(generation)
    advance(44000);j.started(generation)
    expect(j.chat(viewer('a'),'切歌').result?.message).toContain('听满')
    advance(1000);expect(j.chat(viewer('a'),'切歌').result?.ok).toBe(true)
    expect(state.skipVotes).toHaveLength(1)
  })
  it('停止或换曲后的迟到 started 不能恢复歌曲或启动下一首保护计时', () => {
    const {j,state}=setup();j.play('rain');const old=state.current!.generationId
    j.play('stars');const current=state.current!.generationId;j.started(old)
    expect(state.current!.generationId).toBe(current);expect(state.current!.startedAt).toBeUndefined()
    j.stop();j.started(current);expect(state.current).toBeUndefined();expect(state.status).toBe('stopped')
  })
  it('开始前暂停的迟到 started 被忽略，恢复后的首次回执重新开始保护计时', () => {
    const {j,state,advance}=setup();j.audience(['a','b','c']);j.play('rain');const generation=state.current!.generationId
    j.pause();advance(120000);j.started(generation)
    expect(state.current!.startedAt).toBeUndefined();expect(state.status).toBe('paused')
    j.resume();j.started(generation);advance(44000)
    expect(j.chat(viewer('a'),'切歌').result?.message).toContain('听满')
    advance(1000);expect(j.chat(viewer('a'),'切歌').result?.ok).toBe(true)
  })
})
