import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPlaybackCaptionState,createPlaybackCaptionController,resolvePlaybackOrigin} from '../public/playback-caption.js';

const packet=(sequence,extra={})=>({version:1,sessionId:'session-a',sequence,enabled:true,status:'idle',at:100,...extra});
test('only acknowledged playing text appears; ready, idle, pause and disable remain empty',()=>{
  const s=createPlaybackCaptionState();
  assert.equal(s.receive(packet(0,{text:'不要提前出现'}),{authoritative:true}),true);assert.equal(s.view().text,'');
  assert.equal(s.receive(packet(1,{status:'ready',text:'尚未开口'}),{authoritative:true}),false);
  s.receive(packet(1,{status:'playing',id:'reply-1',kind:'host',text:'现在真的开口。'}),{authoritative:true});assert.equal(s.view().text,'现在真的开口。');
  s.receive(packet(2,{status:'paused',id:'reply-1',text:'暂停文字也不显示'}),{authoritative:true});assert.equal(s.view().text,'');
  s.receive(packet(3,{status:'playing',id:'reply-1',text:'恢复开口。'}),{authoritative:true});assert.equal(s.view().text,'恢复开口。');
  s.receive(packet(4,{enabled:false,status:'playing',id:'reply-1',text:'停止时不能显示'}),{authoritative:true});assert.equal(s.view().text,'');
});
test('stale sequence, late prior reply end and old session cannot replace current speech',()=>{
  const s=createPlaybackCaptionState();
  assert.equal(s.receive(packet(1,{status:'playing',id:'a',text:'旧语音'})),false);
  s.receive(packet(1,{status:'playing',id:'a',text:'旧语音'}),{authoritative:true});
  s.receive(packet(3,{status:'playing',id:'b',text:'新语音'}),{authoritative:true});
  assert.equal(s.receive(packet(2,{status:'idle',id:'a'}),{authoritative:true}),false);
  assert.equal(s.receive(packet(4,{status:'idle',id:'a'}),{authoritative:true}),false);assert.equal(s.view().text,'新语音');
  assert.equal(s.receive(packet(3,{status:'playing',id:'a',text:'同序号冲突'})),false);assert.equal(s.view().text,'新语音');
  assert.equal(s.receive(packet(0,{sessionId:'session-b',status:'playing',id:'c',text:'重启后语音'})),false);
  s.receive(packet(0,{sessionId:'session-b',status:'playing',id:'c',text:'重启后语音'}),{authoritative:true});
  assert.equal(s.receive(packet(20,{status:'playing',id:'a',text:'过期进程'}),{authoritative:true}),false);assert.equal(s.view().text,'重启后语音');
});
test('stream failure and stale heartbeat clear captions without any text fallback',()=>{
  let clock=100;const s=createPlaybackCaptionState({now:()=>clock,staleMs:1000});
  s.receive(packet(1,{status:'playing',id:'a',text:'正在说'}),{authoritative:true});
  clock=900;s.receive(packet(1,{status:'playing',id:'a',text:'正在说'}),{authoritative:true});clock=1500;assert.equal(s.expire(),false);
  clock=1900;assert.equal(s.expire(),true);assert.equal(s.view().text,'');assert.equal(s.view().connected,false);
  s.receive(packet(2,{status:'playing',id:'b',text:'恢复'}),{authoritative:true});s.disconnect();assert.equal(s.view().text,'');
  s.receive(packet(2,{status:'playing',id:'b',text:'恢复'}),{authoritative:true});assert.equal(s.view().text,'恢复');
});
test('test speech mapping accepts only a fully bounded loopback HTTP origin',()=>{
  assert.equal(resolvePlaybackOrigin('http://127.0.0.1:34567'),'http://127.0.0.1:34567');
  for(const value of [null,'https://example.com','http://127.0.0.1:34567/path','http://localhost:34567','http://127.0.0.1:34567/?x=1','http://user@127.0.0.1:34567','http://127.0.0.1:65536'])assert.equal(resolvePlaybackOrigin(value),'http://127.0.0.1:17661');
});
test('browser subscriber is read-only and updates caption only for playback events',()=>{
  let connection;class Events{constructor(url){this.url=url;connection=this;}close(){this.closed=true;}}
  const caption={textContent:'旧计划',dataset:{}},label={textContent:''},classes=new Set(),body={classList:{toggle:(s,on)=>on?classes.add(s):classes.delete(s)}};
  const controller=createPlaybackCaptionController({caption,label,body,EventSourceClass:Events});
  try{
    assert.equal(connection.url,'http://127.0.0.1:17661/playback/events');assert.equal(caption.textContent,'');
    connection.onmessage({data:JSON.stringify(packet(0))});assert.equal(caption.textContent,'');
    connection.onmessage({data:JSON.stringify(packet(1,{status:'playing',id:'now',text:'开口才显示'}))});assert.equal(caption.textContent,'开口才显示');assert.equal(caption.dataset.playbackId,'now');assert.equal(classes.has('speaking'),true);
    connection.onerror();assert.equal(caption.textContent,'');assert.equal(classes.has('speaking'),false);
  }finally{controller.dispose();}
  assert.equal(connection.closed,true);
});
test('overlay separates plan history from actual speech and serves the read-only reducer module',async()=>{
  const html=await readFile(new URL('../public/commentary.html',import.meta.url),'utf8');
  const server=await readFile(new URL('../scripts/commentary-server.mjs',import.meta.url),'utf8');
  assert.match(html,/createPlaybackCaptionController/);assert.doesNotMatch(html,/\$\('caption'\)\.textContent\s*=\s*s\.caption/);
  assert.doesNotMatch(html,/x\.text!==s\.caption/);assert.match(server,/\/playback-caption\.js/);
});
