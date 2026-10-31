/** Interface-only, isolated virtual-output probe. Never shows a window or controls input. */
import {BrowserWindow,session} from 'electron'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export interface InterfaceAudioMediaEvent {
  kind:string;at:number;time:number;duration:number|null;paused:boolean;volume:number;muted:boolean;outputExact:boolean
}
export interface InterfaceAudioMetrics {
  outputLabel:string;inputLabel:string;physicalMicrophoneCaptured:false;systemDefaultChanged:false;visibleWindow:false
  baselineRms:number;playRmsPeak:number;playSamples:number;stoppedRms:number|null;samples:number
  media:InterfaceAudioMediaEvent[];feedback:{id:string;kind:string;at:number}[];activeAudioCount:number;finished:boolean
  isVisible:boolean;isFocused:boolean;neverShown:boolean;neverFocused:boolean
  recording?:{file:string;bytes:number;mime:string}
}
export interface InterfaceAudioOptions {playerUrl:string;outputDirectory:string;record?:boolean}

const setup=String.raw`(async()=>{
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 if(window.__captainInterfaceAudio)throw Error('接口音频探针已经初始化。');
 const devices=Array.from(await navigator.mediaDevices.enumerateDevices());
 const exact=kind=>devices.filter(d=>d.kind===kind&&!['default','communications',''].includes(d.deviceId));
 const outputs=exact('audiooutput').filter(d=>/^CABLE Input\b/i.test(d.label)||/(?:扬声器|Speakers).*VB-Audio Virtual Cable/i.test(d.label));
 const inputs=exact('audioinput').filter(d=>/^CABLE Output\b/i.test(d.label));
 if(outputs.length!==1||inputs.length!==1)throw Error('未找到唯一明确的VB-CABLE输入/输出；拒绝回落到系统默认设备或实体麦克风。');
 const output=outputs[0],input=inputs[0];
 if(typeof HTMLMediaElement.prototype.setSinkId!=='function')throw Error('当前音频进程不支持指定输出设备。');
 let stream,context,source,analyser,recorder,timer,finished=false,finishPromise;
 const audios=[],events=[],feedback=[],chunks=[];
 const state={outputLabel:output.label,inputLabel:input.label,physicalMicrophoneCaptured:false,systemDefaultChanged:false,visibleWindow:false,baselineRms:0,playRmsPeak:0,playSamples:0,stoppedRms:null,samples:0};
 const OriginalAudio=window.Audio,originalFetch=window.fetch;
 const readRms=()=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length)};
 const snapshot=()=>({...state,media:events.slice(),feedback:feedback.slice(),activeAudioCount:audios.filter(a=>!a.paused&&!a.ended).length,finished});
 try{
  stream=await navigator.mediaDevices.getUserMedia({video:false,audio:{deviceId:{exact:input.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const track=stream.getAudioTracks()[0];
  if(!track||track.getSettings().deviceId!==input.deviceId||!/^CABLE Output\b/i.test(track.label))throw Error('录音端点不是指定虚拟回环，已拒绝采集。');
  context=new AudioContext();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);await context.resume();
  let baseline=0;for(let n=0;n<12;n++){baseline+=readRms();await wait(50)}state.baselineRms=baseline/12;
  if(state.baselineRms>.0002)throw Error('虚拟输出已有其他声音，已停止本轮测试，尚未请求模型或配音。');
  // Observe only the production page's natural requests; never manufacture feedback.
  window.fetch=function(input,init){
   try{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin&&url.pathname==='/player/feedback'&&typeof init?.body==='string'){
    const data=JSON.parse(init.body);if(typeof data.id==='string'&&['started','ended','error'].includes(data.kind)){feedback.push({id:data.id.slice(0,200),kind:data.kind,at:Date.now()});if(feedback.length>64)feedback.shift()}
   }}catch{}
   return originalFetch.call(window,input,init);
  };
  function InterfaceAudio(...args){
   const audio=new OriginalAudio(...args);audios.push(audio);
   const routed=audio.setSinkId(output.deviceId).then(()=>{if(audio.sinkId!==output.deviceId)throw Error('无法确认精确虚拟输出。')});
   // Do not let the page's immediate play() race the asynchronous sink change.
   routed.catch(()=>{});const originalPlay=audio.play.bind(audio);
   audio.play=async()=>{await routed;if(finished)throw Error('接口音频探针已停止。');return originalPlay()};
   for(const kind of ['loadedmetadata','playing','pause','ended','error'])audio.addEventListener(kind,()=>{
    events.push({kind,at:Date.now(),time:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:null,paused:audio.paused,volume:audio.volume,muted:audio.muted,outputExact:audio.sinkId===output.deviceId});
    if(events.length>128)events.shift();
   });
   return audio;
  }
  InterfaceAudio.prototype=OriginalAudio.prototype;Object.setPrototypeOf(InterfaceAudio,OriginalAudio);window.Audio=InterfaceAudio;
  timer=setInterval(()=>{const rms=readRms();state.samples++;if(audios.some(a=>!a.paused&&!a.ended)){state.playSamples++;state.playRmsPeak=Math.max(state.playRmsPeak,rms)}},50);
  if(__RECORD__){
   const mime=['audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
   if(!mime)throw Error('虚拟回环录音格式不可用。');
   recorder=new MediaRecorder(stream,{mimeType:mime});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start(250);
  }
  async function finish(){
   if(finishPromise)return finishPromise;
   finishPromise=(async()=>{
    finished=true;
    for(const audio of audios){audio.pause();audio.removeAttribute('src');audio.load()}
    clearInterval(timer);
    let quiet=0;for(let n=0;n<12;n++){quiet+=readRms();await wait(50)}state.stoppedRms=quiet/12;
    let recording;
    if(recorder&&recorder.state!=='inactive'){
     await new Promise((resolve,reject)=>{recorder.addEventListener('stop',resolve,{once:true});recorder.addEventListener('error',reject,{once:true});recorder.stop()});
     const bytes=new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());let binary='';for(let p=0;p<bytes.length;p+=16384)binary+=String.fromCharCode(...bytes.subarray(p,p+16384));recording={data:btoa(binary),mime:recorder.mimeType};
    }
    source.disconnect();analyser.disconnect();stream.getTracks().forEach(t=>t.stop());await context.close();window.Audio=OriginalAudio;window.fetch=originalFetch;
    return {...snapshot(),...(recording?{recording}:{})};
   })();return finishPromise;
  }
  window.__captainInterfaceAudio={metrics:snapshot,finish};
  return snapshot();
 }catch(error){
  clearInterval(timer);if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(t=>t.stop());source?.disconnect();analyser?.disconnect();await context?.close().catch(()=>{});window.Audio=OriginalAudio;window.fetch=originalFetch;throw error;
 }
})()`

/** Call only after Electron app.whenReady(). No production profile or key is read. */
export async function prepareInterfaceAudio(options:InterfaceAudioOptions){
  const url=new URL(options.playerUrl)
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/player')throw Error('接口音频只允许本机生产播放器地址。')
  const origin=url.origin,partition=`captain-interface-audio-${randomUUID()}`,isolated=session.fromPartition(partition,{cache:false})
  const window=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:640,height:160,webPreferences:{partition,contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}})
  let neverShown=true,neverFocused=true
  window.on('show',()=>{neverShown=false});window.on('focus',()=>{neverFocused=false})
  const owner=window.webContents.id
  isolated.setPermissionRequestHandler((contents,permission,done)=>done(contents.id===owner&&['media','speaker-selection'].includes(permission)))
  isolated.setPermissionCheckHandler((contents,permission,requestingOrigin)=>{
    let sameOrigin=false;try{sameOrigin=new URL(requestingOrigin).origin===origin}catch{}
    return contents?.id===owner&&sameOrigin&&['media','speaker-selection'].includes(permission)
  })
  isolated.setDisplayMediaRequestHandler((_request,done)=>done({}))
  isolated.webRequest.onBeforeRequest((details,done)=>{let allowed=false;try{const u=new URL(details.url);allowed=u.origin===origin||['data:','blob:'].includes(u.protocol)}catch{}done({cancel:!allowed})})
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  window.webContents.on('will-navigate',(event,next)=>{if(next!==url.href)event.preventDefault()})
  window.webContents.setAudioMuted(false)
  let disposed=false,completion:Promise<InterfaceAudioMetrics>|undefined
  const metrics=async()=>{
    if(window.isDestroyed())throw Error('接口音频进程已经关闭。')
    const values=await window.webContents.executeJavaScript('window.__captainInterfaceAudio.metrics()')
    return {...values,isVisible:window.isVisible(),isFocused:window.isFocused(),neverShown,neverFocused} as InterfaceAudioMetrics
  }
  const finish=()=>completion??=(async()=>{
    const values=await window.webContents.executeJavaScript('window.__captainInterfaceAudio.finish()')
    const result={...values,isVisible:window.isVisible(),isFocused:window.isFocused(),neverShown,neverFocused} as InterfaceAudioMetrics&{recording?:{data:string;mime:string}}
    const recording=result.recording
    delete result.recording
    if(recording){await mkdir(options.outputDirectory,{recursive:true});const file=join(options.outputDirectory,'virtual-loopback.webm'),bytes=Buffer.from(recording.data,'base64');await writeFile(file,bytes);return {...result,recording:{file,bytes:bytes.length,mime:recording.mime}}}
    return result
  })()
  const dispose=async()=>{
    if(disposed)return;disposed=true
    if(!window.isDestroyed()){await finish().catch(()=>{});window.destroy()}
    isolated.setPermissionRequestHandler(null);isolated.setPermissionCheckHandler(null);isolated.setDisplayMediaRequestHandler(null);isolated.webRequest.onBeforeRequest(null)
  }
  try{
    await window.loadURL(url.href)
    await window.webContents.executeJavaScript(setup.replace('__RECORD__',options.record?'true':'false'))
    if(window.isVisible()||window.isFocused())throw Error('接口音频进程意外显示或聚焦，已终止。')
    return {window,origin,metrics,finish,dispose}
  }catch(error){await dispose();throw error}
}
