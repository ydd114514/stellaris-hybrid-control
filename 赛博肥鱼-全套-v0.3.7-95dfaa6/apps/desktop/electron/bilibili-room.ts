// Web protocol adapted from xfgryujk/blivedm (MIT); see licenses/blivedm.txt.
// Fixed Bilibili read endpoints only. No sending chat, stream keys or external server.
import { createHash } from 'node:crypto'
import { inflateSync, brotliDecompressSync } from 'node:zlib'
import WebSocket from 'ws'
import type { LiveEvent } from '../../../packages/shared/src/index'

export interface BilibiliRoomState {
  status:'stopped'|'connecting'|'connected'|'retrying'|'error';roomId?:number;loggedIn:boolean;
  message:string;received:number;lastEventAt?:number;lastHeartbeatAt?:number
}
const MIXIN=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13]
export function biliSign(params:Record<string,string|number>,img:string,sub:string,now=Date.now()) {
  const raw=img+sub,key=MIXIN.map(i=>raw[i]||'').join(''),fields={...params,wts:Math.floor(now/1000)}
  const query=Object.keys(fields).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(String(fields[k as keyof typeof fields]).replace(/[!'()*]/g,''))}`).join('&')
  return query+'&w_rid='+createHash('md5').update(query+key).digest('hex')
}
export function biliPacket(op:number,body:string|object='') {
  const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),header=Buffer.alloc(16)
  header.writeUInt32BE(16+bytes.length);header.writeUInt16BE(16,4);header.writeUInt16BE(1,6);header.writeUInt32BE(op,8);header.writeUInt32BE(1,12)
  return Buffer.concat([header,bytes])
}
export function biliPackets(bytes:Buffer,depth=0):{op:number;body:Buffer}[] {
  if(depth>3||bytes.length>8*1024*1024)throw Error('弹幕数据超出限制')
  const rows:{op:number;body:Buffer}[]=[]
  for(let p=0;p<bytes.length;){
    if(bytes.length-p<16)throw Error('弹幕包头不完整')
    const length=bytes.readUInt32BE(p),header=bytes.readUInt16BE(p+4),version=bytes.readUInt16BE(p+6),op=bytes.readUInt32BE(p+8)
    if(header<16||length<header||p+length>bytes.length)throw Error('弹幕数据包无效')
    const body=bytes.subarray(p+header,p+length)
    if(version===2||version===3){const unpacked=version===2?inflateSync(body,{maxOutputLength:8*1024*1024}):brotliDecompressSync(body,{maxOutputLength:8*1024*1024});rows.push(...biliPackets(unpacked,depth+1))}
    else rows.push({op,body})
    if(rows.length>2048)throw Error('弹幕数量超出限制')
    p+=length
  }
  return rows
}
// Bounded wire reader for the community dmv2 schema: content=6, user=20.
// Unknown fields are skipped; user IDs remain decimal strings (no int32 truncation).
function protobuf(bytes:Buffer) {
  const fields=new Map<number,Buffer|bigint>();let p=0,count=0
  function integer(){let value=0n;for(let n=0;n<10&&p<bytes.length;n++){const b=bytes[p++]!;value|=BigInt(b&127)<<BigInt(n*7);if(!(b&128))return value}throw Error('protobuf无效')}
  while(p<bytes.length){if(++count>512)throw Error('protobuf过大');const tag=Number(integer()),wire=tag&7,key=tag>>>3;if(!key)throw Error('protobuf字段无效')
    if(wire===0)fields.set(key,integer())
    else if(wire===2){const size=Number(integer());if(size<0||p+size>bytes.length)throw Error('protobuf长度无效');fields.set(key,bytes.subarray(p,p+size));p+=size}
    else if(wire===1)p+=8;else if(wire===5)p+=4;else throw Error('protobuf编码无效')
    if(p>bytes.length)throw Error('protobuf数据不完整')
  }return fields
}
const clean=(x:unknown,n:number)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n):''
export function biliChat(raw:any,roomId:number,now=Date.now()):LiveEvent|undefined {
  if(typeof raw?.cmd!=='string'||raw.cmd.split(':')[0]!=='DANMU_MSG')return
  let text='',name='',uid='',stamp:unknown
  if(Array.isArray(raw.info)) {text=clean(raw.info[1],600);name=clean(raw.info[2]?.[1],80);uid=String(raw.info[2]?.[0]??'');stamp=raw.info[0]?.[4]}
  else if(typeof raw.dm_v2==='string'&&raw.dm_v2.length<256000){
    const dm=protobuf(Buffer.from(raw.dm_v2,'base64')),user=dm.get(20)
    text=clean(dm.get(6)?.toString(),600)
    if(Buffer.isBuffer(user)){const u=protobuf(user);name=clean(u.get(2)?.toString(),80);uid=u.get(1)?.toString()||''}
    stamp=dm.get(7)?.toString()
  }
  if(!text)return
  const known=/^[1-9]\d{0,19}$/.test(uid),identity=known?uid:'anonymous-'+createHash('sha256').update(name||'匿名观众').digest('hex').slice(0,16)
  const timestamp=Number(stamp),at=timestamp>1e12?timestamp:timestamp>1e9?timestamp*1000:now
  const id=createHash('sha256').update(JSON.stringify([roomId,uid,name,text,stamp??now,raw.info?.[0]?.[5]??raw.dm_v2??''])).digest('hex')
  return {id:'bilibili:room:'+roomId+':'+id,platform:'bilibili',kind:'chat',user:{id:'bilibili:'+identity,name:name||'匿名观众'},text,at}
}
export function createBilibiliRoom(options:{fetch?:typeof fetch;socket?:(url:string,config:WebSocket.ClientOptions)=>WebSocket;cookies?:()=>Promise<string>;onEvent(event:LiveEvent):Promise<unknown>|unknown;disabled?:boolean}) {
  let state:BilibiliRoomState={status:'stopped',loggedIn:false,message:'尚未连接真实 B 站直播间。',received:0}
  let epoch=0,ws:WebSocket|undefined,controller:AbortController|undefined,retry:ReturnType<typeof setTimeout>|undefined,beat:ReturnType<typeof setInterval>|undefined,authTimer:ReturnType<typeof setTimeout>|undefined,attempts=0,disposed=false
  let delivery=Promise.resolve(),anonymousBuvid=''
  const seen=new Set<string>(),http=options.fetch||fetch
  const view=():BilibiliRoomState=>({...state})
  function clear(){clearTimeout(retry);clearInterval(beat);clearTimeout(authTimer);controller?.abort();ws?.removeAllListeners();ws?.on('error',()=>{});ws?.terminate();ws=undefined}
  function stop(){epoch++;clear();state={...state,status:'stopped',message:'真实直播间连接已停止。'}}
  async function connect(at:number,room:number):Promise<void>{
    if(disposed||at!==epoch)return
    clear();controller=new AbortController();const signal=controller.signal
    const ensure=()=>{if(disposed||at!==epoch||signal.aborted)throw Error('已停止')}
    let cookie=''
    async function get(url:string){ensure();const r=await http(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:`https://live.bilibili.com/${room}`,...(cookie?{Cookie:cookie}:{})},signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error'});ensure();if(!r.ok)throw Error('平台请求失败');const text=await r.text();if(text.length>2*1024*1024)throw Error('平台数据过大');return JSON.parse(text)}
    function reconnect(){if(disposed||at!==epoch)return;clear();attempts++;state.status='retrying';state.message='直播间连接中断，正在自动重连；尚未收到弹幕不代表已接通。';retry=setTimeout(()=>void connect(at,room).catch(reconnect),Math.min(60000,3000*2**Math.min(attempts,4)));retry.unref?.()}
    try{
      cookie=await options.cookies?.()||'';ensure();state.loggedIn=/(?:^|;\s*)SESSDATA=/.test(cookie);state.lastHeartbeatAt=undefined
      const init=await get(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${room}`)
      if(init.code!==0||!Number.isSafeInteger(init.data?.room_id))throw Error('直播间无效')
      const real=init.data.room_id;state.roomId=real
      if(!/(?:^|;\s*)buvid3=/.test(cookie)){
        if(!anonymousBuvid){const spi=await get('https://api.bilibili.com/x/frontend/finger/spi');if(spi.code!==0||!/^[-A-Za-z0-9_]{10,128}$/.test(spi.data?.b_3))throw Error('设备标识获取失败');anonymousBuvid=spi.data.b_3}
        cookie+=(cookie?'; ':'')+'buvid3='+anonymousBuvid
      }
      const nav=await get('https://api.bilibili.com/x/web-interface/nav'),img=nav.data?.wbi_img
      state.loggedIn=nav.data?.isLogin===true
      const key=(s:unknown)=>{if(typeof s!=='string')throw Error('签名信息缺失');const k=new URL(s).pathname.split('/').pop()!.split('.')[0]!;if(!/^[a-zA-Z0-9]{32}$/.test(k))throw Error('签名信息无效');return k}
      const query=biliSign({id:real,type:0},key(img?.img_url),key(img?.sub_url))
      const conf=await get('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?'+query)
      if(conf.code!==0||typeof conf.data?.token!=='string')throw Error('直播间认证信息获取失败')
      const host=conf.data.host_list?.find((x:any)=>typeof x.host==='string'&&/^[a-zA-Z0-9-]+\.chat\.bilibili\.com$/.test(x.host)&&Number.isInteger(x.wss_port)&&x.wss_port>0&&x.wss_port<65536)
      if(!host)throw Error('直播间服务器无效');ensure()
      const socket=ws=(options.socket||((url,config)=>new WebSocket(url,config)))(`wss://${host.host}:${host.wss_port}/sub`,{headers:{Origin:'https://live.bilibili.com','User-Agent':'Mozilla/5.0'},handshakeTimeout:12000,maxPayload:8*1024*1024})
      const current=()=>!disposed&&at===epoch&&ws===socket
      socket.on('open',()=>{if(!current())return;socket.send(biliPacket(7,{uid:nav.data?.isLogin?nav.data.mid:0,roomid:real,protover:3,platform:'web',type:2,buvid:/(?:^|;\s*)buvid3=([^;]+)/.exec(cookie)?.[1],key:conf.data.token}));authTimer=setTimeout(()=>{if(current())reconnect()},15000)})
      socket.on('message',bytes=>{if(!current())return;try{for(const packet of biliPackets(Buffer.from(bytes as Buffer))){
        if(packet.op===8){const auth=JSON.parse(packet.body.toString());if(auth.code!==0){reconnect();return}if(state.status==='connected')continue;clearTimeout(authTimer);attempts=0;state.status='connected';const connectedAt=Date.now();state.message=state.loggedIn?'已连接真实直播间，弹幕将显示并用于点歌。':'已连接真实直播间（未登录，平台可能隐藏昵称；建议扫码登录）。';socket.send(biliPacket(2,'[object Object]'));beat=setInterval(()=>{if(!current())return;if(Date.now()-(state.lastHeartbeatAt||connectedAt)>75000){reconnect();return}socket.send(biliPacket(2,'[object Object]'))},30000);beat.unref?.()}
        if(packet.op===3)state.lastHeartbeatAt=Date.now()
        if(packet.op===5){const raw=JSON.parse(packet.body.toString()),event=biliChat(raw,real);if(!event||seen.has(event.id))continue;seen.add(event.id);if(seen.size>10000)seen.delete(seen.values().next().value!);state.received++;state.lastEventAt=Date.now();delivery=delivery.then(async()=>{if(current())await options.onEvent(event)}).catch(()=>{if(current())state.message='弹幕已收到，但本地转交失败，请检查项目目录。'})}
      }}catch{state.message='收到无法解析的弹幕包；保留连接等待下一条。'}})
      socket.on('error',()=>{if(current())reconnect()});socket.on('close',()=>{if(current())reconnect()})
    }catch{if(at!==epoch||disposed||signal.aborted)return;reconnect()}
  }
  return {view,stop,async start(value:unknown){
    if(options.disabled||disposed)return {ok:false,message:'离线模式不连接真实直播间。'}
    const match=typeof value==='string'?/^(?:https:\/\/live\.bilibili\.com\/)?([1-9]\d{0,11})\/?$/.exec(value.trim()):null
    if(!match)return {ok:false,message:'请输入 B 站直播间号或 live.bilibili.com 的房间链接。'}
    stop();seen.clear();attempts=0;state={status:'connecting',roomId:Number(match[1]),loggedIn:false,message:'正在连接真实 B 站直播间…',received:0};const at=epoch
    await connect(at,Number(match[1]));return {ok:state.status!=='stopped',message:state.message}
  },async dispose(){disposed=true;stop();await delivery}}
}
