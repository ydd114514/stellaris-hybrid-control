import{readFile,mkdir,stat,writeFile}from'node:fs/promises'
import{createWriteStream}from'node:fs'
import{Readable,Transform}from'node:stream'
import{pipeline}from'node:stream/promises'

// Public, non-paid playback only. No cookies, login data or private APIs.
const part=Number(process.argv[2]||1),bvid='BV1uGHG6uEDW'
const directory='.local/tutorial';await mkdir(directory,{recursive:true})
const info=JSON.parse(await readFile('.local/bilibili-tutorial-view.json','utf8')).data
const page=info.pages.find(page=>page.page===part)
if(!page||info.rights.pay||info.is_upower_exclusive)throw new Error('不是本次指定的公开教程分集。')
const metadata=await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${page.cid}&qn=16&fnval=0`,{signal:AbortSignal.timeout(15000)}).then(response=>response.json())
if(metadata.code!==0||metadata.data?.durl?.length!==1)throw new Error('公开播放接口未返回可用的单段媒体。')
const video=metadata.data.durl[0],path=`${directory}/part${part}.mp4`
try{if((await stat(path)).size===video.size){console.log(JSON.stringify({part,alreadyPresent:true,path,bytes:video.size}));process.exit(0)}}catch{}
const response=await fetch(video.url,{headers:{Referer:`https://www.bilibili.com/video/${bvid}/`},signal:AbortSignal.timeout(600000)})
if(!response.ok)throw new Error(`公开媒体读取失败HTTP ${response.status}`)
const length=Number(response.headers.get('content-length')||video.size)
if(!length||length>512*1024*1024)throw new Error('媒体大小不符合本次读取范围。')
let received=0,lastReport=0
const progress=new Transform({transform(chunk,encoding,callback){received+=chunk.length;if(received>512*1024*1024)return callback(new Error('媒体超过读取上限'));if(received-lastReport>=10*1024*1024){lastReport=received;console.log(JSON.stringify({part,received,total:length}))}callback(null,chunk)}})
await pipeline(Readable.fromWeb(response.body),progress,createWriteStream(path))
if(received!==length)throw new Error('公开媒体读取不完整。')
await writeFile(`${directory}/source.json`,JSON.stringify({url:`https://www.bilibili.com/video/${bvid}/`,title:info.title,author:info.owner.name,publishedAt:new Date(info.pubdate*1000).toISOString(),parts:info.pages.map(page=>({part:page.page,duration:page.duration,cid:page.cid})),hasPublicSubtitles:false},null,2))
console.log(JSON.stringify({part,path,complete:true,bytes:received}))
