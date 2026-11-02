import {createServer,type Server,type ServerResponse} from 'node:http'
import {readFile,writeFile,mkdir,rename,stat,open} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {StringDecoder} from 'node:string_decoder'
import {CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT,CAPTAIN_VOICE_PRESETS} from '../../../packages/core/src/stellaris-voice-presets'
import {createCaptainSpeechQueue,type SpeechLine} from '../../../packages/core/src/captain-speech-queue'
import {synthesizeQwen,type QwenOptions,type VoiceResult} from '../../../packages/core/src/voice'
import type {CaptainPlayerRole,CaptainSpeechAction,CaptainSpeechConfig,CaptainSpeechView} from '../../../packages/shared/src/stellaris-speech'
import type {SecretCodec} from './stellaris-ai'
import {captainPlayerPage,captainAuditionsPage} from './captain-pages'
import {queryCaptainVoice} from '../../../packages/core/src/captain-voice-check'
import {inspectCaptainWav,tuneCaptainWav} from '../../../packages/core/src/captain-audio'
import {CAPTAIN_TUNED_VOICE,CAPTAIN_TUNED_SAMPLE_SHA256,captainSpeechInstruction} from '../../../packages/core/src/captain-tuned'
import type {CaptainVoiceCheck} from '../../../packages/shared/src/stellaris-speech'
import type {CaptainPlayback} from '../../../packages/shared/src/captain-playback'
import {createCaptainGameNarration} from '../../../packages/core/src/captain-game-narration'

const supportsTuned=CAPTAIN_VOICE.model.startsWith('qwen-audio-')
export const CAPTAIN_DEFAULTS:CaptainSpeechConfig={...CAPTAIN_VOICE,baseUrl:'https://trial.cn-beijing.maas.aliyuncs.com',workspaceId:'',presetId:'',...(supportsTuned?{model:CAPTAIN_TUNED_VOICE.model,voice:CAPTAIN_TUNED_VOICE.voice,rate:CAPTAIN_TUNED_VOICE.rate,instruction:CAPTAIN_TUNED_VOICE.instruction,baseUrl:CAPTAIN_TUNED_VOICE.baseUrl,presetId:CAPTAIN_TUNED_VOICE.id}:{}),narrateGame:true,replyAudience:true,gameCommentSeconds:30,maxRequestsPerHour:240,volume:.8}
interface Options{directory:string;getProject():Promise<string|undefined>;secrets:SecretCodec;disabled?:boolean;port?:number;samplesDirectory?:string;tunedSamplesDirectory?:string;playbackOrigins?:string[];now?:()=>number;onStop?():void;diagnostics?():unknown;synthesize?:(o:QwenOptions)=>Promise<VoiceResult>;queryVoice?:typeof queryCaptainVoice}
function normalize(x:any):CaptainSpeechConfig{
  const text=(v:unknown,n:number)=>typeof v==='string'?v.trim().slice(0,n):''
  const number=(v:any,min:number,max:number,f:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):f
  const preset=CAPTAIN_VOICE_PRESETS.find(p=>p.id===x?.presetId)
  const tuned=x?.presetId===CAPTAIN_TUNED_VOICE.id&&supportsTuned
  return {...CAPTAIN_DEFAULTS,baseUrl:text(x?.baseUrl,500)||CAPTAIN_DEFAULTS.baseUrl,workspaceId:text(x?.workspaceId,100),presetId:tuned?CAPTAIN_TUNED_VOICE.id:preset?.id||'',model:tuned?CAPTAIN_TUNED_VOICE.model:CAPTAIN_VOICE.model,voice:tuned?CAPTAIN_TUNED_VOICE.voice:CAPTAIN_VOICE.voice,rate:tuned?CAPTAIN_TUNED_VOICE.rate:CAPTAIN_VOICE.rate,instruction:tuned?CAPTAIN_TUNED_VOICE.instruction:preset?.instruction||CAPTAIN_VOICE.instruction,
    narrateGame:x?.narrateGame!==false,replyAudience:x?.replyAudience!==false,gameCommentSeconds:Math.round(number(x?.gameCommentSeconds,15,180,30)),maxRequestsPerHour:Math.round(number(x?.maxRequestsPerHour,10,600,240)),volume:number(x?.volume,0,1,.8)}
}
export function pcmWav(data:string,rate:number){const pcm=Buffer.from(data,'base64'),h=Buffer.alloc(44);if(!pcm.length||pcm.length%2||![16000,22050,24000,44100,48000].includes(rate))throw Error('配音音频格式无效');h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm])}
class LiveTail{
  path='';offset=0;pending='';decoder=new StringDecoder('utf8')
  async read(path:string,receive:(row:any)=>void){
    const info=await stat(path)
    if(this.path!==path||info.size<this.offset){this.path=path;this.offset=info.size;this.pending='';this.decoder=new StringDecoder('utf8');return}
    if(info.size===this.offset)return
    const f=await open(path),buf=Buffer.alloc(Math.min(info.size-this.offset,262144));let bytesRead=0
    try{({bytesRead}=await f.read(buf,0,buf.length,this.offset))}finally{await f.close()}
    this.offset+=bytesRead;this.pending+=this.decoder.write(buf.subarray(0,bytesRead));const lines=this.pending.split('\n');this.pending=lines.pop()||''
    if(this.pending.length>262144)this.pending=''
    for(const line of lines)try{receive(JSON.parse(line))}catch{/* Not a complete valid row. */}
  }
}

export function createStellarisSpeech(options:Options){
  const now=options.now||Date.now,queue=createCaptainSpeechQueue(now),file=join(options.directory,'captain-speech.json'),keyFile=join(options.directory,'captain-speech-key.enc.json')
  let config={...CAPTAIN_DEFAULTS},encoded='',enabled=false,disposed=false,message=supportsTuned?'已选用自然聊天声线，保存千问密钥后可启动语音。':'先试听并选定一版声音，再开启直播语音。',epoch=0,polling=false,generating=false
  let server:Server|undefined,origin='',current:(SpeechLine&{phase:'generating'|'ready'|'playing';audio?:Buffer;createdAt:number;lastMediaSequence?:number})|undefined,abort:AbortController|undefined
  let timer:ReturnType<typeof setInterval>|undefined,saves=Promise.resolve(),keySaves=Promise.resolve(),lease:{client:string;at:number;role?:CaptainPlayerRole}={client:'',at:0},consecutiveFailures=0,tail=new LiveTail(),queryAbort:AbortController|undefined
  let voiceCheck:CaptainVoiceCheck={state:'unchecked',message:'尚未查询音色所属服务的状态。'}
  let gameNarration=createCaptainGameNarration(now)
  const sessionId=randomUUID(),captionClients=new Set<ServerResponse>(),playerWaiters=new Set<()=>void>()
  const playbackOrigins=(options.playbackOrigins??['http://127.0.0.1:17655','http://127.0.0.1:17659']).map(value=>{const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('字幕只允许本机来源。');return u.origin})
  let playback:CaptainPlayback={version:1,sessionId,sequence:0,enabled:false,status:'idle',at:now()},revision=0,heartbeat:ReturnType<typeof setInterval>|undefined
  function wakePlayer(){revision++;for(const done of [...playerWaiters])done()}
  function publishPlayback(status:CaptainPlayback['status']='idle'){
    const next:CaptainPlayback={version:1,sessionId,sequence:playback.sequence,enabled,status,at:playback.at,...(current&&status!=='idle'?{id:current.id,kind:current.kind,...(status==='playing'?{text:current.text}:{})}:{})}
    if(JSON.stringify({...next,at:0})===JSON.stringify({...playback,at:0}))return
    playback={...next,sequence:playback.sequence+1,at:now()}
    const packet=`data: ${JSON.stringify(playback)}\n\n`;for(const res of captionClients)res.write(packet)
  }
  function readPlayback():CaptainPlayback{return {...playback}}
  const requests:number[]=[]
  const usage={requests:0,completed:0,failed:0,cancelled:0,inputTokens:0,outputTokens:0,missing:0}
  const loaded=options.disabled?Promise.resolve():Promise.allSettled([readFile(file,'utf8').then(s=>{config=normalize(JSON.parse(s))}),readFile(keyFile,'utf8').then(s=>{const x=JSON.parse(s);if(typeof x.key==='string')encoded=x.key})]).then(()=>{})
  function save(){const text=JSON.stringify(config,null,2);saves=saves.catch(()=>{}).then(async()=>{await mkdir(options.directory,{recursive:true});await writeFile(file+'.tmp',text,{mode:0o600});await rename(file+'.tmp',file)});return saves}
  function key(){try{return encoded&&options.secrets.available()?options.secrets.decrypt(encoded):''}catch{return ''}}
  async function tunedSample(){
    if(options.disabled||!supportsTuned)return
    try{
      let directory=options.tunedSamplesDirectory
      if(directory){try{await stat(join(directory,'manifest.json'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return;directory=undefined}}
      if(!directory){const root=await options.getProject();if(!root)return;directory=join(root,'.local/commentary/captain-tuned')}
      const manifestFile=join(directory,'manifest.json'),audioFile=join(directory,'20.wav');if((await stat(manifestFile)).size>65536||(await stat(audioFile)).size>8388608)return
      const m=JSON.parse(await readFile(manifestFile,'utf8'));if(m.presetId!==CAPTAIN_TUNED_VOICE.id||m.revision!==CAPTAIN_TUNED_VOICE.revision||m.model!==CAPTAIN_TUNED_VOICE.model||m.voice!==CAPTAIN_TUNED_VOICE.voice||m.rate!==CAPTAIN_TUNED_VOICE.rate||m.instruction!==CAPTAIN_TUNED_VOICE.instruction||m.text!==CAPTAIN_TUNED_VOICE.sampleText||m.gainDb!==CAPTAIN_TUNED_VOICE.gainDb||m.fadeMilliseconds!==CAPTAIN_TUNED_VOICE.fadeMilliseconds)return
      const audio=await readFile(audioFile),info=inspectCaptainWav(audio);if(info.sha256!==m.sha256||info.sha256!==CAPTAIN_TUNED_SAMPLE_SHA256)return;return {...info,audio}
    }catch{return}
  }
  async function view():Promise<CaptainSpeechView>{await loaded;const tuned=await tunedSample();return {localTest:!!options.disabled,enabled,hasKey:!!key(),encrypted:options.secrets.available(),message,config:{...config},queued:queue.size(),playback:{playerConnected:!!lease.client&&now()-lease.at<=6000,status:playback.status,...(lease.client&&now()-lease.at<=6000?{playerRole:lease.role}:{})},usage:{...usage},voiceCheck:{...voiceCheck},tunedVoice:{ready:!!tuned,name:CAPTAIN_TUNED_VOICE.name,message:tuned?'已生成并核验，可直接采用这版声音。':'推荐小样尚未就绪。',...(tuned?{duration:tuned.duration}:{})},...(current?{current:{id:current.id,text:current.text,kind:current.kind,phase:current.phase}}:{}),...(origin?{playerUrl:origin+'/player',auditionsUrl:origin+'/auditions'}:{})}}
  function say(line:SpeechLine){if(disposed||!enabled||line.kind==='game'&&!config.narrateGame||line.kind==='host'&&!config.replyAudience)return false;const accepted=queue.push(line);if(accepted)queueMicrotask(()=>void pump());return accepted}
  function stop(){enabled=false;epoch++;abort?.abort();abort=undefined;queryAbort?.abort();queryAbort=undefined;if(voiceCheck.state==='checking')voiceCheck={state:'unchecked',message:'音色查询已取消。'};current=undefined;generating=false;queue.clear();publishPlayback();wakePlayer();message='语音已停止，排队和在途合成已取消。';options.onStop?.()}
  function cancel(kind:'host'){
    queue.cancel(kind)
    if(current?.kind===kind){epoch++;abort?.abort();abort=undefined;generating=false;current=undefined;publishPlayback();wakePlayer();message='场控回复语音已取消，游戏解说继续。'}
  }
  async function audioBytes(result:VoiceResult,signal:AbortSignal){
    if(result.kind==='pcm')return pcmWav(result.data||'',result.sampleRate)
    // Generated audio URLs may contain signed query parameters. Keep them in the main process only.
    const u=new URL(result.url||'');if(u.protocol!=='https:'||!/(?:^|\.)(?:aliyuncs\.com|aliyuncs\.com\.cn)$/.test(u.hostname))throw Error('配音音频来源无效')
    const r=await fetch(u,{signal,redirect:'error'});if(!r.ok)throw Error('配音音频读取失败')
    if(Number(r.headers.get('content-length'))>8388608)throw Error('配音音频过大')
    const reader=r.body?.getReader();if(!reader)throw Error('配音音频为空');const parts:Buffer[]=[];let size=0
    try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>8388608){await reader.cancel();throw Error('配音音频过大')}parts.push(Buffer.from(x.value))}}finally{reader.releaseLock()}
    const b=Buffer.concat(parts);if(b.toString('ascii',0,4)!=='RIFF')throw Error('配音返回的格式不受支持');return b
  }
  async function pump(){
    if(!enabled||disposed||current||generating||now()-lease.at>4000||!lease.client)return
    while(requests.length&&now()-requests[0]!>3600000)requests.shift()
    if(requests.length>=config.maxRequestsPerHour){message='本小时语音请求已达上限，字幕继续显示。';return}
    const line=queue.take();if(!line)return
    const ticket=epoch,controller=new AbortController();generating=true;abort=controller;current={...line,phase:'generating',createdAt:now()};message='正在合成'+(line.kind==='host'?'弹幕回复':'游戏解说');wakePlayer()
    try{
      const result=await (options.synthesize||synthesizeQwen)({text:line.text,apiKey:key(),config:{...config,instruction:captainSpeechInstruction(config),enabled:true,provider:'qwen',outputDeviceId:'',pricePer10kChars:0},signal:controller.signal,onRequest:()=>{requests.push(now());usage.requests++}})
      usage.completed++;usage.inputTokens+=result.usage?.inputTokens??0;usage.outputTokens+=result.usage?.outputTokens??0;if(result.usage?.inputTokens===undefined||result.usage?.outputTokens===undefined)usage.missing++
      if(ticket!==epoch||controller.signal.aborted||!current)return
      const raw=await audioBytes(result,controller.signal),bytes=config.presetId===CAPTAIN_TUNED_VOICE.id?tuneCaptainWav(raw,CAPTAIN_TUNED_VOICE.gainDb,CAPTAIN_TUNED_VOICE.fadeMilliseconds):raw
      if(ticket!==epoch||controller.signal.aborted||!current)return
      if(now()-line.at>30000){current=undefined;wakePlayer();message='已丢弃过时解说。';return}
      consecutiveFailures=0;current={...line,phase:'ready',audio:bytes,createdAt:now()};message='等待播放器确认播放。';wakePlayer()
    }catch(e){
      const reported=(e as {usage?:{inputTokens?:number;outputTokens?:number}})?.usage
      if(reported){usage.inputTokens+=reported.inputTokens??0;usage.outputTokens+=reported.outputTokens??0}
      if(!reported||reported.inputTokens===undefined||reported.outputTokens===undefined)usage.missing++
      if(controller.signal.aborted){usage.cancelled++}else{usage.failed++;consecutiveFailures++;message='千问语音未完成，请核对账户额度、模型和音色。';if(consecutiveFailures>=3){stop();message='千问连续3次失败，已停止语音，请检查账户和音色后手动重启。'}}if(ticket===epoch){current=undefined;publishPlayback();wakePlayer()}
    }
    finally{if(abort===controller){generating=false;abort=undefined}}
  }
  async function poll(){
    if(polling||disposed||!enabled)return;polling=true
    const ticket=epoch,reader=tail
    try{
      const root=await options.getProject();if(ticket!==epoch||!enabled)return
      if(root){const p=join(root,'.local/native-bridge/latest-session.json'),info=await stat(p);if(info.size<4194304){const c=JSON.parse(await readFile(p,'utf8'));if(ticket===epoch&&typeof c.sessionId==='string'&&/^[\da-z-]{1,100}$/i.test(c.sessionId)){
        if(ticket===epoch&&enabled&&config.narrateGame&&lease.client&&now()-lease.at<=4000&&!current&&!generating){const line=gameNarration.observe(c,info.mtimeMs,{intervalSeconds:config.gameCommentSeconds??30});if(line)say(line)}
        await reader.read(join(root,'.local/native-bridge',`session-${c.sessionId}.jsonl`),row=>{if(ticket===epoch&&row.type==='intent')say({id:'game:'+c.sessionId+':'+String(row.requestId).slice(0,80),text:row.explanation,kind:'game',at:typeof row.at==='number'?row.at:Date.parse(row.at)})})
      }}}
    }catch{/* Missing or replacing game state never blocks audience replies. */}
    finally{polling=false}
    if(ticket!==epoch||!enabled)return
    if(current&&(now()-current.createdAt>45000||now()-lease.at>6000)){epoch++;abort?.abort();current=undefined;publishPlayback();wakePlayer();message='播放器已离线或确认超时，旧语音已丢弃。'}
    void pump()
  }
  async function auditions(){
    let manifest:any={};try{const path=join(options.samplesDirectory||options.directory,'manifest.json');if((await stat(path)).size<262144)manifest=JSON.parse(await readFile(path,'utf8'))}catch{}
    const rows=Array.isArray(manifest.samples)?manifest.samples:[]
    const samples=await Promise.all(CAPTAIN_VOICE_PRESETS.map(async p=>{const r=rows.filter((x:any)=>x.id===p.id&&x.status==='ready'&&x.instruction===p.instruction).at(-1);let ready=false,duration:number|undefined;try{const file=join(options.samplesDirectory||options.directory,p.id+'.wav'),s=await stat(file);if(r&&manifest.voice===CAPTAIN_VOICE.voice&&manifest.model===CAPTAIN_VOICE.model&&manifest.rate===1&&manifest.text===CAPTAIN_SAMPLE_TEXT&&s.isFile()&&s.size>44&&s.size<=8388608){const audio=inspectCaptainWav(await readFile(file));ready=r.sha256===audio.sha256;duration=audio.duration}}catch{}return {...p,ready,duration,...(!ready?{message:'尚未生成并核验有效音频'}:{})}}))
    return {text:CAPTAIN_SAMPLE_TEXT,selected:config.presetId,samples}
  }
  async function startServer(){
    if(server)return
    const instance=createServer(async(req,res)=>{
      try{
        const url=new URL(req.url||'/',origin||'http://127.0.0.1'),json=(status:number,x:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(x))}
        if(req.method==='GET'&&['/playback','/playback/events','/diagnostics'].includes(url.pathname)){
          const requested=req.headers.origin;if(requested&&requested!==origin&&!playbackOrigins.includes(requested))return json(403,{})
          if(requested)res.setHeader('Access-Control-Allow-Origin',requested);res.setHeader('Vary','Origin')
          if(url.pathname==='/diagnostics')return json(200,{version:1,speech:{enabled,queued:queue.size(),phase:current?.phase??'idle',playerConnected:!!lease.client&&now()-lease.at<=6000,playerRole:lease.client&&now()-lease.at<=6000?lease.role:null,playerLeaseAgeMs:lease.client?Math.max(0,now()-lease.at):null,narrateGame:config.narrateGame,replyAudience:config.replyAudience,volume:config.volume,message,usage:{...usage},playbackStatus:playback.status},modules:options.diagnostics?.()??{}})
          if(url.pathname==='/playback')return json(200,readPlayback())
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(`data: ${JSON.stringify(readPlayback())}\n\n`);captionClients.add(res);res.on('close',()=>captionClients.delete(res));return
        }
        if(req.method==='GET'&&['/player','/auditions'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; frame-ancestors 'self' ${playbackOrigins.join(' ')}`}).end(url.pathname==='/player'?captainPlayerPage:captainAuditionsPage);return}
        if(req.method==='GET'&&url.pathname==='/auditions/data')return json(200,await auditions())
        if(req.method==='GET'&&url.pathname==='/tuned.wav'){const tuned=await tunedSample();if(!tuned)return json(404,{});res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'}).end(tuned.audio);return}
        if(req.method==='GET'&&/^\/auditions\/audio\/(?:0[1-9]|1\d|20)\.wav$/.test(url.pathname)){
          const id=url.pathname.split('/').at(-1)!.slice(0,2);if(!(await auditions()).samples.some(x=>x.id===id&&x.ready))return json(404,{})
          const path=join(options.samplesDirectory||options.directory,id+'.wav');if((await stat(path)).size>8388608)return json(413,{})
          res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'private,max-age=3600'}).end(await readFile(path));return
        }
        if(req.method==='GET'&&url.pathname==='/audio/'+current?.id&&current?.audio){res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'}).end(current.audio);return}
        if(req.method!=='POST'||req.headers.origin!==origin)return json(403,{})
        const chunks:Buffer[]=[];let size=0;for await(const part of req){size+=part.length;if(size>2048)return json(413,{});chunks.push(part)}const data=JSON.parse(Buffer.concat(chunks).toString())
        if(url.pathname==='/auditions/select'){
          if(!(await auditions()).samples.some(x=>x.id===data.id&&x.ready))return json(400,{})
          stop();config=normalize({...config,presetId:data.id});await save();return json(200,{selected:config.presetId})
        }
        if(typeof data.client!=='string'||!/^[a-z\d-]{36}$/i.test(data.client))return json(400,{})
        if(url.pathname==='/player/poll'){
          if(data.role!==undefined&&data.role!=='monitor'&&data.role!=='broadcast')return json(400,{})
          const role:CaptainPlayerRole=data.role==='monitor'?'monitor':'broadcast',newOwner=lease.client!==data.client
          if(newOwner&&lease.client&&now()-lease.at<5000&&!(role==='broadcast'&&lease.role==='monitor'))return json(409,{})
          lease={client:data.client,at:now(),role}
          if(newOwner){
            // A live browser source takes priority over the local audition window.
            // Reuse generated audio and synthesis in flight; feedback numbers belong
            // to the new media element, not to the player that previously owned it.
            if(current){current.lastMediaSequence=undefined;if(current.audio){current.phase='ready';current.createdAt=now()}}
            publishPlayback();wakePlayer()
          }
          queueMicrotask(()=>void pump())
          if(Number.isInteger(data.afterRevision)&&data.afterRevision===revision)await new Promise<void>(done=>{let timeout:ReturnType<typeof setTimeout>;const finish=()=>{clearTimeout(timeout);playerWaiters.delete(finish);res.off('close',finish);done()};playerWaiters.add(finish);res.once('close',finish);timeout=setTimeout(finish,1500)})
          if(res.destroyed)return
          if(lease.client!==data.client)return json(409,{})
          return json(200,{enabled,volume:config.volume,message,revision,playerRole:lease.role,playback:readPlayback(),current:current?{id:current.id,text:current.text,kind:current.kind,...(current.audio?{audio:'/audio/'+current.id}:{})}:null})
        }
        if(url.pathname==='/player/release'&&data.client===lease.client){lease={client:'',at:0};epoch++;abort?.abort();current=undefined;publishPlayback();wakePlayer();message='播放器已断开，等待直播画面重新接入。';return json(200,{ok:true,playback:readPlayback()})}
        if(url.pathname==='/player/feedback'&&data.client===lease.client&&current&&current.id===data.id){
          if(Number.isInteger(data.mediaSequence)){if(data.mediaSequence<=(current.lastMediaSequence??-1))return json(409,{});current.lastMediaSequence=data.mediaSequence}
          if(data.kind==='started'&&enabled&&current.audio){current.phase='playing';publishPlayback('playing');message='正在朗读：'+current.text}
          else if(data.kind==='paused'&&enabled&&current.audio){current.phase='ready';publishPlayback('paused')}
          else if(data.kind==='ended'||data.kind==='error'){current=undefined;publishPlayback();if(data.kind==='error'){message='播放器未能播放，请确认浏览器允许音频。';lease={client:'',at:0};stop()}else queueMicrotask(()=>void pump())}
          wakePlayer();return json(200,{ok:true,playback:readPlayback()})
        }
        return json(404,{})
      }catch{res.writeHead(400).end()}
    })
    await new Promise<void>((done,fail)=>{instance.once('error',fail);instance.listen(options.port??17661,'127.0.0.1',done)})
    server=instance;const address=instance.address();origin=`http://127.0.0.1:${typeof address==='object'?address?.port:17661}`
    heartbeat=setInterval(()=>{const packet=`data: ${JSON.stringify(readPlayback())}\n\n`;for(const res of captionClients)res.write(packet)},2000);heartbeat.unref?.()
  }
  async function action(input:CaptainSpeechAction){
    await loaded
    if(options.disabled||disposed)return {ok:false,message:'独立测试不读真实语音配置、不联网或保存密钥。',view:await view()}
    try{
      if(!input||typeof input!=='object')throw Error('不支持的语音操作。')
      if(input.type==='stop'){stop();clearInterval(timer);timer=undefined}
      else if(input.type==='set-commentary-interval'){
        if(!Number.isInteger(input.seconds)||input.seconds<15||input.seconds>180)throw Error('游戏解说间隔请填写15到180秒。')
        config={...config,gameCommentSeconds:input.seconds};await save();message=`游戏解说已调整为约每${input.seconds}秒一段，当前播放继续。`
      }
      else if(input.type==='use-tuned-voice'){if(!await tunedSample())throw Error('推荐小样尚未通过核验，请检查控制器目录。');stop();config=normalize({...config,presetId:CAPTAIN_TUNED_VOICE.id,baseUrl:CAPTAIN_TUNED_VOICE.baseUrl,workspaceId:''});await save();voiceCheck={state:'ready',message:'采用已真实合成的公开女声，不依赖fishcute3私有音色权限。',targetModel:config.model};await startServer();message=`已采用${CAPTAIN_TUNED_VOICE.name}和已验证的北京接口，语音仍未开启。`}
      else if(input.type==='save-config'){stop();config=normalize({...config,...input.config});voiceCheck={state:'unchecked',message:'配置已更新，请重新查询音色状态。'};await save();message='语音设置已保存，仍处于停止状态。'}
      else if(input.type==='save-key'){
        if(!options.secrets.available())throw Error('Windows安全存储不可用，不保存明文密钥。')
        if(typeof input.key!=='string'||input.key.length>4096||/\s/.test(input.key))throw Error('密钥格式无效。')
        stop();voiceCheck={state:'unchecked',message:'密钥已更新，请重新查询音色状态。'};encoded=input.key?options.secrets.encrypt(input.key):'';const saved=JSON.stringify({key:encoded});keySaves=keySaves.catch(()=>{}).then(async()=>{await mkdir(options.directory,{recursive:true});await writeFile(keyFile+'.tmp',saved,{mode:0o600});await rename(keyFile+'.tmp',keyFile)});await keySaves;message=encoded?'千问密钥已加密保存。':'千问密钥已清除。'
      }else if(input.type==='query-voice'){
        if(enabled)throw Error('请先停止语音，再查询音色状态。')
        if(config.presetId===CAPTAIN_TUNED_VOICE.id){voiceCheck={state:'ready',message:'当前采用已生成真实小样的公开女声，无需查询fishcute3私有音色资料。',targetModel:config.model};return {ok:true,message:voiceCheck.message,view:await view()}}
        if(queryAbort)throw Error('正在查询音色，请等待本次结果。')
        const ticket=epoch,controller=new AbortController();queryAbort=controller;voiceCheck={state:'checking',message:'正在查询音色资料；没有合成音频。'}
        try{const checked=await (options.queryVoice||queryCaptainVoice)({config:{...config},key:key(),signal:controller.signal});if(ticket!==epoch||controller.signal.aborted)return {ok:false,message:'音色查询已取消。',view:await view()};voiceCheck={...checked,checkedAt:now()};message=checked.message}
        catch(e){if(ticket===epoch&&!controller.signal.aborted){voiceCheck={state:'unknown',message:e instanceof Error?e.message:'音色查询未完成。',checkedAt:now()};message=voiceCheck.message}else return {ok:false,message:'音色查询已取消。',view:await view()}}
        finally{if(queryAbort===controller)queryAbort=undefined}
        return {ok:voiceCheck.state==='ready',message,view:await view()}
      }else if(input.type==='start'){
        if(enabled)return {ok:true,message,view:await view()}
        const ticket=epoch
        if(!config.presetId)throw Error('请先在20版试听中确认使用哪一版。')
        const sampleReady=config.presetId===CAPTAIN_TUNED_VOICE.id?!!(await tunedSample()):(await auditions()).samples.some(x=>x.id===config.presetId&&x.ready)
        if(ticket!==epoch||disposed)return {ok:false,message:'语音启动已取消。',view:await view()}
        if(!sampleReady)throw Error('所选版本尚无通过音频与哈希核验的真实试听，请重新生成并确认。')
        if(!key())throw Error('请先保存这枚音色所属账号的千问API密钥。')
        await startServer();if(ticket!==epoch||disposed)return {ok:false,message:'语音启动已取消。',view:await view()};tail=new LiveTail();gameNarration=createCaptainGameNarration(now);consecutiveFailures=0;enabled=true;publishPlayback();wakePlayer();message='语音已开启，等待直播画面播放器接入。';if(!timer){await poll();if(ticket===epoch&&enabled&&!disposed){timer=setInterval(()=>void poll(),750);timer.unref?.()}}
      }else if(input.type==='read-live-text'){
        if(!enabled)throw Error('请先开启语音，再试读当前直播语气。')
        if(current||generating||queue.size())throw Error('当前还有语音，请等播完后再试读。')
        if(!lease.client||now()-lease.at>4000)throw Error('播放器尚未接入，请先接入本机或直播播放器。')
        const text=typeof input.text==='string'?input.text.trim():''
        if(!text||text.length>100)throw Error('试读文字请填写1到100字。')
        if(requests.filter(at=>now()-at<3600000).length>=config.maxRequestsPerHour)throw Error('本小时语音请求已达上限，请稍后再试读。')
        if(!say({id:'live-read:'+randomUUID(),text,kind:'host',at:now()}))throw Error('请开启弹幕回复朗读后再试读。')
        message='已送入当前语音输出，沿用直播语气和配音额度。'
      }else if(input.type==='play-sample'){
        if(!enabled)throw Error('请先开启语音，再检查直播播放和字幕。')
        if(current||generating)throw Error('当前语音尚未结束，请等播完后再检查。')
        const ticket=epoch,sample=await tunedSample()
        if(ticket!==epoch||disposed||!enabled)return {ok:false,message:'播放检查已取消。',view:await view()}
        if(current||generating)throw Error('当前语音尚未结束，请等播完后再检查。')
        if(!sample)throw Error('本机测试语音尚未就绪，请检查随程序提供的声音小样。')
        if(!lease.client||now()-lease.at>4000)throw Error('直播播放器尚未接入，请检查直播姬网页源。')
        current={id:'sample:'+randomUUID(),text:CAPTAIN_TUNED_VOICE.sampleText,kind:'game',at:now(),phase:'ready',audio:sample.audio,createdAt:now()}
        message='正在检查直播声音和字幕，使用本机小样，不产生配音费用。';wakePlayer()
      }else if(input.type==='open-player'){await startServer();message='本机播放器已准备，可启动语音；尚未发起配音请求。'}
      else if(input.type==='auditions'){await startServer();message='已准备20版试听页，正式语音尚未开启。'}
      else throw Error('不支持的语音操作。')
      return {ok:true,message,view:await view()}
    }catch(e){return {ok:false,message:e instanceof Error?e.message:'语音操作失败。',view:await view()}}
  }
  return {view,action,say,poll,readPlayback,cancel,async dispose(){cancel('host');disposed=true;stop();clearInterval(timer);clearInterval(heartbeat);for(const res of captionClients)res.end();captionClients.clear();await Promise.allSettled([saves,keySaves]);if(server)await new Promise<void>(done=>{server!.close(()=>done());server!.closeAllConnections()});server=undefined}}
}
