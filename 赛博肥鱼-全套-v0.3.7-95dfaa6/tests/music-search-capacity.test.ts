import { describe, expect, it } from 'vitest'
import { validateTracks, restoreMusic, musicLibraryFull, createJukebox } from '../packages/core/src/jukebox'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import { validateConfig } from '../packages/core/src/runtime'
import { DEFAULT_BGM_TRACKS } from '../packages/core/src/music-defaults'
import { MUSIC_LIBRARY_LIMIT, MUSIC_QUEUE_LIMIT } from '../packages/shared/src/music-limits'
import { musicMatchScore, musicSearchQueries } from '../packages/core/src/music-match'

describe('expanded music library and search regressions',()=>{
  const tracks=Array.from({length:MUSIC_LIBRARY_LIMIT},(_,i)=>({id:`qq:Track${i}`,title:`歌曲${i}`,artist:'测试歌手',source:`shop-qqmusic://track/Track${i}`}))
  it('5000首自选和默认背景曲可保存、重启恢复，超出时明确拒绝',()=>{
    const restored=restoreMusic({tracks},createDefaultState().music)
    expect(restored.tracks).toHaveLength(MUSIC_LIBRARY_LIMIT+DEFAULT_BGM_TRACKS.length)
    expect(validateTracks(restored.tracks)).toEqual(restored.tracks)
    expect(musicLibraryFull(restored.tracks)).toBe(true)
    expect(musicLibraryFull([...tracks.slice(1),...DEFAULT_BGM_TRACKS])).toBe(false)
    expect(()=>validateTracks([...restored.tracks,{...tracks[0]!,id:'qq:Extra',source:'shop-qqmusic://track/Extra'}])).toThrow('5000')
  })
  it('轮播配置不再截断到50首，默认100首待播、最多500首',()=>{
    expect(validateConfig({music:{bgmTrackIds:tracks.map(t=>t.id)}}).music.bgmTrackIds).toHaveLength(5000)
    expect(defaultConfig.music.maxQueue).toBe(100)
    expect(validateConfig({music:{maxQueue:999}}).music.maxQueue).toBe(MUSIC_QUEUE_LIMIT)
    expect(validateConfig({music:{maxQueue:20}}).music.maxQueue).toBe(20)
  })
  it.each(['晴天 周杰伦','周杰伦：《晴天》','《晴天》—周杰伦','晴天／周杰伦'])('统一标点和歌手顺序：%s',query=>{
    expect(musicMatchScore({title:'晴天',artist:'周杰伦'},query)).toBe(200)
  })
  it('逗号和顿号也可作为歌名、歌手分隔符',()=>{
    expect(musicSearchQueries('《晴天》，周杰伦')[0]).toBe('晴天 周杰伦')
    expect(musicSearchQueries('周杰伦、晴天')[0]).toBe('周杰伦 晴天')
  })
  it.each(['Love Story Taylor Swift','Taylor Swift Love Story'])('保留英文多词歌名：%s',query=>{
    expect(musicSearchQueries(query)).toContain('Love Story')
    expect(musicMatchScore({title:'Love Story',artist:'Taylor Swift'},query)).toBe(200)
  })
  it('合唱多名歌手都可核对，错误歌手和未点名版本不混入',()=>{
    expect(musicMatchScore({title:'合唱曲',artist:'甲 / 乙'},'甲 乙 合唱曲')).toBe(200)
    expect(musicMatchScore({title:'合唱曲',artist:'甲 / 乙'},'乙 甲 合唱曲')).toBe(200)
    expect(musicMatchScore({title:'晴天 (Live)',artist:'周杰伦'},'晴天 现场版 周杰伦')).toBe(200)
    expect(musicMatchScore({title:'晴天',artist:'其他人'},'晴天 周杰伦')).toBe(-1)
    expect(musicMatchScore({title:'晴天 (Live)',artist:'周杰伦'},'晴天 周杰伦')).toBe(-1)
    expect(musicMatchScore({title:'晴天 (Live)',artist:'周杰伦'},'晴天 Remix 周杰伦')).toBe(-1)
  })
  it('本地曲库同样支持标点、歌手在前，命中后不再重新上网搜歌',()=>{
    const state=createDefaultState().music,config=structuredClone(defaultConfig.music)
    const j=createJukebox({state,config:()=>config,now:Date.now,id:()=> 'request',canStart:()=>true})
    j.setTracks([{id:'qq:Song',title:'晴天',artist:'周杰伦',source:'shop-qqmusic://track/Song'}])
    expect(j.request({id:'u',name:'观众',visits:3,blocked:false},'周杰伦：《晴天》').ok).toBe(true)
    expect(state.current?.trackId).toBe('qq:Song');expect(state.searches).toEqual([])
    j.dispose()
  })
})
