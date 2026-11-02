import {it,expect} from 'vitest'
import {mergeMusicRotation} from '../packages/core/src/music-import'
const track=(id:string,title=id)=>({id:'qq:'+id,title,artist:'歌手',source:'shop-qqmusic://track/'+id})
it('导入喜欢歌曲合并轮播、去重，同时保留现有歌单和设置',()=>{
 const saved={tracks:[track('old'),track('stored')],bgmTrackIds:['qq:old'],volume:.35,maxQueue:250,screening:[['old-key',{}]],other:{keep:true}}
 const r=mergeMusicRotation(saved,[track('old'),track('stored'),track('new'),track('new')])
 expect(r.data.tracks.map(t=>t.id)).toEqual(['qq:old','qq:stored','qq:new'])
 expect(r.data.bgmTrackIds).toEqual(['qq:old','qq:stored','qq:new'])
 expect(r.data.volume).toBe(.35);expect(r.data.screening).toEqual(saved.screening);expect(r.data.other).toEqual({keep:true})
 expect(saved.tracks).toHaveLength(2);expect(r.counts.addedToLibrary).toBe(1);expect(r.counts.addedToRotation).toBe(2)
 expect(mergeMusicRotation(r.data,[track('new'),track('stored')]).counts.addedToRotation).toBe(0)
})
it('导入不覆盖同源旧ID，明确黑名单和伪造外部音源不能入轮播',()=>{
 const old={...track('same'),id:'existing-id'}
 const r=mergeMusicRotation({tracks:[old],bgmTrackIds:[],blacklist:'自选屏蔽'},[track('same'),track('bad','自选屏蔽'),track('anthem','义勇军进行曲'),{...track('external'),source:'https://example.com/a.mp3'}])
 expect(r.data.bgmTrackIds).toEqual(['existing-id']);expect(r.counts.blocked).toBe(2);expect(r.counts.invalid).toBe(1)
})
it('空喜欢列表保留原轮播；曲库满时仍可启用库内喜欢歌曲',()=>{
 const tracks=Array.from({length:5000},(_,i)=>track('old'+i)),saved={tracks,bgmTrackIds:['qq:old0']}
 expect(mergeMusicRotation(saved,[]).data).toEqual(saved)
 const r=mergeMusicRotation(saved,[track('new'),track('old1')])
 expect(r.counts.capacitySkipped).toBe(1);expect(r.data.bgmTrackIds).toEqual(['qq:old0','qq:old1'])
})
