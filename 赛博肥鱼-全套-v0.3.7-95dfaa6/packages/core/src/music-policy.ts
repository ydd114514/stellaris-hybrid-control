import type {MusicTrack} from '../../shared/src/index'
// Conservative metadata deny-list, combined with an owner-reviewed library.
// Keyword matching alone cannot classify the subject of every song's lyrics.
export const MUSIC_DENY_TERMS = [
 '国歌','國歌','党歌','黨歌','军歌','軍歌','政治','政党','政黨','革命','共产','共產','社会主义','社會主義','领袖','領袖',
 '义勇军进行曲','義勇軍進行曲','国际歌','國際歌','东方红','東方紅','没有共产党就没有新中国','歌唱祖国','我和我的祖国','我的祖国','团结就是力量','保卫黄河',
 'national anthem','state anthem','party anthem','The Star-Spangled Banner','God Save the King','God Save the Queen','La Marseillaise','Deutschlandlied','Deutschland über alles','Horst Wessel','君が代','君之代','Гимн','Интернационал',
 '解放军','解放軍','人民军','人民軍','军乐团','軍樂團','中央乐团','政治部','文工团','文工團',
 '毛泽东','毛澤東','习近平','習近平','邓小平','鄧小平','列宁','列寧','斯大林','普京','特朗普','纳粹','納粹','法西斯','苏维埃','蘇維埃','politics','communist','nazi','socialism',
]
export const normalizeMusicTerm=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\p{C}\s]/gu,'')
export function musicDenied(track:Pick<MusicTrack,'title'|'artist'>,extra:string[]=[]):boolean {
 const fields=[normalizeMusicTerm(track.title),normalizeMusicTerm(track.artist)]
 return [...MUSIC_DENY_TERMS,...extra].some(term=>{const value=normalizeMusicTerm(term);return !!value&&fields.some(field=>field.includes(value))})
}
export function parseMusicBlacklist(value:unknown):string[]{
 if(typeof value!=='string'||value.length>6000)throw new Error('黑名单长度无效')
 const terms=[...new Set(value.split(/[\n,，;；]/).map(x=>x.trim()).filter(Boolean))]
 if(terms.length>100||terms.some(x=>x.length>60))throw new Error('黑名单最多100项，每项60个字')
 return terms
}
const swear=/傻[逼屄比]|他妈的|操你|草你[妈馬]|[艹肏]你|妈了个|你妈死|臭婊子|狗娘养|\b(?:fuck(?:ing|er|ed|s)?|motherfuck\w*|shit|bullshit|bitch(?:es)?|cunt|nigg\w*|asshole)\b/giu
export function assessMusic(track:Pick<MusicTrack,'title'|'artist'>,lyrics:string,extra:string[]=[]):{allowed:boolean;reason:string}{
 if(musicDenied(track,extra)||musicDenied({title:lyrics,artist:''},extra))return {allowed:false,reason:'国歌／政治相关或自定义黑名单'}
 const lines=lyrics.replace(/\[[^\]\r\n]*\]/g,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
 const matches=lyrics.match(swear)||[]
 const explicitLines=lines.filter(line=>{swear.lastIndex=0;return swear.test(line)}).length;swear.lastIndex=0
 if(matches.length>=4 || matches.length>=2 && explicitLines/Math.max(1,lines.length)>=.15)
   return {allowed:false,reason:'歌词脏话密度过高'}
 return {allowed:true,reason:'本地歌名、歌手与歌词规则检查通过'}
}
