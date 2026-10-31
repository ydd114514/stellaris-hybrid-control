/** Caption state follows acknowledged audio playback, never plans or generated replies. */
export const DEFAULT_SPEECH_ORIGIN='http://127.0.0.1:17661';
export function resolvePlaybackOrigin(value) {
  try{const url=new URL(value);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&/^\d+$/.test(url.port)&&Number(url.port)>0&&Number(url.port)<=65535)return url.origin;}catch{}
  return DEFAULT_SPEECH_ORIGIN;
}
export function createPlaybackCaptionState({now=Date.now,staleMs=6000}={}) {
  let state={sessionId:'',sequence:-1,status:'idle',enabled:false,id:'',text:'',kind:'',at:0,connected:false,lastUpdateAt:0};
  let canonical;
  const retired=new Set();
  const view=()=>({...state});
  function clear(connected=false){state={...state,status:'idle',id:'',text:'',kind:'',connected};return view();}
  function receive(packet,{authoritative=false}={}) {
    if(!packet||packet.version!==1||typeof packet.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(packet.sessionId)||!Number.isSafeInteger(packet.sequence)||packet.sequence<0||!['idle','playing','paused'].includes(packet.status)||typeof packet.enabled!=='boolean')return false;
    if(retired.has(packet.sessionId))return false;
    if(packet.sessionId!==state.sessionId){
      // Only the service's read-only stream can establish a new session. An old
      // iframe's queued message must never reclaim the caption after a restart.
      if(!authoritative)return false;
      if(state.sessionId)retired.add(state.sessionId);
      state={...state,sessionId:packet.sessionId,sequence:-1,status:'idle',id:'',text:'',kind:''};canonical=undefined;
    }
    if(packet.sequence<state.sequence)return false;
    const id=typeof packet.id==='string'?packet.id.slice(0,200):'';
    if(packet.sequence>state.sequence&&packet.status!=='playing'&&id&&state.id&&id!==state.id)return false;
    const text=typeof packet.text==='string'?packet.text.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,140):'';
    const playing=packet.enabled&&packet.status==='playing'&&id&&text;
    const next={sessionId:state.sessionId,sequence:packet.sequence,status:playing?'playing':packet.enabled&&packet.status==='paused'?'paused':'idle',enabled:packet.enabled,id:playing?id:'',text:playing?text:'',kind:playing&&['game','host'].includes(packet.kind)?packet.kind:'',at:Number.isFinite(packet.at)?packet.at:0};
    if(packet.sequence===state.sequence){
      // A full matching heartbeat may restore a disconnected caption; conflicting
      // equal-sequence iframe messages cannot replace it or extend its liveness.
      const equal=canonical&&['sessionId','sequence','status','enabled','id','text','kind'].every(key=>canonical[key]===next[key]);
      if(!equal||!authoritative&&!state.connected)return false;
    }
    canonical=next;state={...next,connected:true,lastUpdateAt:now()};
    return true;
  }
  function expire(){if(state.connected&&now()-state.lastUpdateAt>=staleMs){clear();return true;}return false;}
  return {receive,view,disconnect:()=>clear(),expire};
}

/** Browser wiring has no player lease and cannot start synthesis or audio. */
export function createPlaybackCaptionController({caption,label,body,origin=DEFAULT_SPEECH_ORIGIN,now=Date.now,EventSourceClass=globalThis.EventSource,staleMs=6000}={}) {
  if(!caption||!label||!body)throw Error('缺少播报字幕元素。');
  origin=resolvePlaybackOrigin(origin);
  const state=createPlaybackCaptionState({now,staleMs});
  function render(){
    const value=state.view();
    caption.textContent=value.text;
    caption.dataset.playbackId=value.id;
    caption.dataset.playbackStatus=value.status;
    caption.dataset.playbackSequence=String(value.sequence);
    caption.dataset.playbackSession=value.sessionId;
    label.textContent=value.status==='playing'?'肥鱼碎碎念 · 正在说':!value.connected?'肥鱼碎碎念 · 等待语音连接':value.status==='paused'?'肥鱼碎碎念 · 语音暂缓':'肥鱼碎碎念 · 等待开口';
    body.classList.toggle('speaking',value.status==='playing');
  }
  const stream=new EventSourceClass(origin+'/playback/events');
  stream.onmessage=event=>{try{if(state.receive(JSON.parse(event.data),{authoritative:true}))render();}catch{/* A malformed event never changes the caption. */}};
  stream.onerror=()=>{state.disconnect();render();};
  const timer=setInterval(()=>{if(state.expire())render();},250);
  function acceptMessage(packet){if(state.receive(packet)){render();return true;}return false;}
  render();
  return {acceptMessage,view:state.view,dispose(){clearInterval(timer);stream.close();state.disconnect();render();}};
}
