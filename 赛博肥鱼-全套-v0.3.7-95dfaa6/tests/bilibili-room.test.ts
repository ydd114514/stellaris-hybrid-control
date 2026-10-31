import {afterEach,describe,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {deflateSync,brotliCompressSync} from 'node:zlib'
import type WebSocket from 'ws'
import {biliSign,biliPacket,biliPackets,biliChat,createBilibiliRoom} from '../apps/desktop/electron/bilibili-room'
const services:ReturnType<typeof createBilibiliRoom>[]=[]
afterEach(async()=>{for(const s of services.splice(0))await s.dispose();vi.useRealTimers()})
const raw={cmd:'DANMU_MSG:4:0:2:2:2:0',info:[[0,1,25,16777215,1793146500,42],'点歌 晴天 周杰伦',[123456789012,'测试观众']]}
function compressed(version:number,bytes:Buffer){const p=biliPacket(5,'');const body=version===2?deflateSync(bytes):brotliCompressSync(bytes);p.writeUInt32BE(16+body.length);p.writeUInt16BE(version,6);return Buffer.concat([p,body])}
class Socket extends EventEmitter {sent:Buffer[]=[];send(b:Buffer){this.sent.push(b)}terminate(){this.emit('close')}}
function setup(extra:Partial<Parameters<typeof createBilibiliRoom>[0]>={}){
 const sockets:Socket[]=[],events:unknown[]=[],calls:string[]=[]
 const http=vi.fn(async(url:any)=>{const u=new URL(String(url));calls.push(u.hostname+u.pathname)
   const data=u.pathname.endsWith('room_init')?{room_id:7322535}:u.pathname.endsWith('spi')?{b_3:'anonymous-buvid-fixture'}:u.pathname.endsWith('/nav')?{isLogin:false,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/'+'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/bfs/wbi/'+'b'.repeat(32)+'.png'}}:{token:'PRIVATE_ROOM_TOKEN',host_list:[{host:'fixture.chat.bilibili.com',wss_port:443}]}
   return Response.json({code:0,data})
 }) as unknown as typeof fetch
 const s=createBilibiliRoom({fetch:http,socket:()=>{const x=new Socket();sockets.push(x);return x as unknown as WebSocket},onEvent:e=>{events.push(e)},...extra});services.push(s)
 return {s,sockets,events,calls,http}
}
describe('B站真实房间协议（全离线夹具）',()=>{
 it('WBI按社区已知向量签名',()=>{
   expect(biliSign({foo:'114',bar:'514',zab:1919810},'7cd084941338484aae1ad9425b84077c','4932caff0ff746eab6f01bf08b70ac45',1702204169000)).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4')
 })
 it.each([2,3])('解压版本%d和粘连数据，不把畸形包当事件',version=>{
   const packets=biliPackets(compressed(version,Buffer.concat([biliPacket(8,{code:0}),biliPacket(5,raw)])))
   expect(packets.map(p=>p.op)).toEqual([8,5]);expect(biliChat(JSON.parse(packets[1]!.body.toString()),1)).toMatchObject({text:'点歌 晴天 周杰伦',user:{id:'bilibili:123456789012'}})
   const broken=Buffer.alloc(16);expect(()=>biliPackets(broken)).toThrow();expect(()=>biliPackets(Buffer.alloc(4))).toThrow()
 })
 it('连接必须等平台认证；弹幕去重后只交付一次，停止后迟到消息不复活',async()=>{
   const {s,sockets,events}=setup();await s.start('https://live.bilibili.com/7322535')
   expect(s.view().status).toBe('connecting');const ws=sockets[0]!;ws.emit('open');expect(ws.sent[0]!.readUInt32BE(8)).toBe(7)
   ws.emit('message',biliPacket(8,{code:0}));expect(s.view().status).toBe('connected')
   ws.emit('message',biliPacket(3,''));expect(s.view().lastHeartbeatAt).toBeTypeOf('number')
   for(let n=0;n<2;n++)ws.emit('message',biliPacket(5,raw));await new Promise(r=>setImmediate(r))
   expect(events).toHaveLength(1);expect(s.view().received).toBe(1);expect(JSON.stringify(s.view())).not.toContain('PRIVATE_ROOM_TOKEN')
   s.stop();ws.emit('message',biliPacket(5,{...raw,info:[[], '旧连接的消息',[3,'旧观众']]}));await new Promise(r=>setImmediate(r));expect(events).toHaveLength(1)
 })
 it('账号读取中停止和离线模式均不能新建连接',async()=>{
   let release!:(s:string)=>void
   const {s,sockets}=setup({cookies:()=>new Promise(r=>{release=r})});const pending=s.start('7322535');s.stop();release('SESSDATA=PRIVATE');await pending;expect(sockets).toHaveLength(0)
   const off=setup({disabled:true});expect((await off.s.start('7322535')).ok).toBe(false);expect(off.calls).toHaveLength(0)
 })
 it('断线重连受退避约束，手动停止取消后续重连',async()=>{
   vi.useFakeTimers();const {s,sockets}=setup();await s.start('7322535');sockets[0]!.emit('open');sockets[0]!.emit('error',Error('private error'))
   expect(s.view().status).toBe('retrying');s.stop();await vi.advanceTimersByTimeAsync(60001);expect(sockets).toHaveLength(1)
 })
 it('拒绝任意网址，无法用服务器列表访问本地网络',async()=>{
   const {s,http,sockets}=setup();expect((await s.start('http://127.0.0.1/')).ok).toBe(false);expect(http).not.toHaveBeenCalled()
   expect(biliChat({cmd:'SEND_GIFT',data:{}},1)).toBeUndefined();expect(sockets).toHaveLength(0)
 })
 it('读取dm_v2内容并保留64位uid',()=>{
   function field(n:number,b:Buffer){return Buffer.concat([Buffer.from([(n<<3)|2,b.length]),b])}
   const user=Buffer.concat([Buffer.from([8,0x80,0x80,0x80,0x80,0x10]),field(2,Buffer.from('新观众'))])
   const dm=Buffer.concat([field(6,Buffer.from('点歌 新歌')),Buffer.from([0xa2,1,user.length]),user])
   expect(biliChat({cmd:'DANMU_MSG',dm_v2:dm.toString('base64')},1)).toMatchObject({text:'点歌 新歌',user:{id:'bilibili:4294967296',name:'新观众'}})
 })
})
