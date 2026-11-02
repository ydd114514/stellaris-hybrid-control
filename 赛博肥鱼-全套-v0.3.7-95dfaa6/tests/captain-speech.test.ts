import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,mkdir,readFile,writeFile,rm,appendFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,basename,resolve} from 'node:path'
import {createCaptainSpeechQueue} from '../packages/core/src/captain-speech-queue'
import {captainContext,captainMessages,spokenText} from '../packages/core/src/stellaris-captain'
import {CAPTAIN_VOICE_PRESETS,CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT} from '../packages/core/src/stellaris-voice-presets'
import {createStellarisSpeech,pcmWav} from '../apps/desktop/electron/stellaris-speech'
import {inspectCaptainWav} from '../packages/core/src/captain-audio'
import {CAPTAIN_TUNED_VOICE,CAPTAIN_TUNED_SAMPLE_SHA256} from '../packages/core/src/captain-tuned'
const testData=resolve('.local/test-data')
const roots:string[]=[],services:ReturnType<typeof createStellarisSpeech>[]=[]
const secrets={available:()=>true,encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()}
afterEach(async()=>{for(const s of services.splice(0))await s.dispose();for(const root of roots.splice(0)){if(dirname(root)!==testData||!basename(root).startsWith('fish-speech-'))throw Error('Unsafe test path');await rm(root,{recursive:true,force:true})}})
async function setup(synthesize?:Parameters<typeof createStellarisSpeech>[0]['synthesize'],now?:()=>number){
 await mkdir(testData,{recursive:true});const root=await mkdtemp(join(testData,'fish-speech-'));roots.push(root);const project=join(root,'project'),directory=join(root,'data'),samplesDirectory=join(root,'samples');await mkdir(join(project,'.local/native-bridge'),{recursive:true});await mkdir(samplesDirectory)
 const service=createStellarisSpeech({directory,getProject:async()=>project,secrets,port:0,samplesDirectory,synthesize,now});services.push(service)
 return {service,project,directory,samplesDirectory}
}
const response=(o:any)=>Promise.resolve({kind:'pcm' as const,data:Buffer.alloc(4800,1).toString('base64'),sampleRate:24000,characters:4,words:[],usage:{inputTokens:3,outputTokens:4}})
async function fixtureSample(directory:string){const wav=pcmWav(Buffer.alloc(4800,1).toString('base64'),24000);await writeFile(join(directory,'20.wav'),wav);await writeFile(join(directory,'manifest.json'),JSON.stringify({voice:CAPTAIN_VOICE.voice,model:CAPTAIN_VOICE.model,rate:1,text:CAPTAIN_SAMPLE_TEXT,samples:[{id:'20',status:'ready',instruction:CAPTAIN_VOICE_PRESETS[19]!.instruction,sha256:inspectCaptainWav(wav).sha256}]}))}
async function start(service:ReturnType<typeof createStellarisSpeech>){await service.action({type:'save-key',key:'offline-secret'});await service.action({type:'save-config',config:{presetId:'20'}});await service.action({type:'auditions'});const root=roots.at(-1)!;await fixtureSample(join(root,'samples'));const r=await service.action({type:'start'});expect(r.ok).toBe(true);return r.view.playerUrl!.replace('/player','')}
const client='12345678-1234-1234-1234-123456789012'
function post(origin:string,path:string,data:any){return fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({client,...data})})}
describe('captain speech and chat',()=>{
 it('20 independent expression directions preserve exact voice, model and speed',()=>{expect(CAPTAIN_VOICE_PRESETS).toHaveLength(20);expect(new Set(CAPTAIN_VOICE_PRESETS.map(x=>x.instruction)).size).toBe(20);expect(CAPTAIN_VOICE.model).toBe('qwen-audio-3.1-tts-flash');expect(CAPTAIN_VOICE.rate).toBe(1)})
 it('busy chat cannot starve the latest game commentary forever',()=>{const at=Date.now(),q=createCaptainSpeechQueue(()=>at);q.push({id:'g',kind:'game',text:'先稳住后勤。',at});for(let i=0;i<4;i++)q.push({id:'h'+i,kind:'host',text:'小明，说得有道理。',at});expect(q.take()?.kind).toBe('host');expect(q.take()?.kind).toBe('host');expect(q.take()?.id).toBe('g');expect(q.take()?.kind).toBe('host')})
 it('audience replies take priority, old plans coalesce, duplicate and private reasoning never enter speech',()=>{let now=100000;const q=createCaptainSpeechQueue(()=>now);q.push({id:'p1',kind:'game',text:'我先补科研。',at:now});q.push({id:'p2',kind:'game',text:'我先把后勤稳住。',at:now});q.push({id:'h1',kind:'host',text:'小明，你说得有道理。',at:now});expect(q.take()?.id).toBe('h1');expect(q.take()?.id).toBe('p2');expect(q.push({id:'h1',kind:'host',text:'重复',at:now})).toBe(false);expect(spokenText('reasoning_content: 内部推理')).toBe('');q.push({id:'p3',kind:'game',text:'过期计划',at:now});now+=31000;expect(q.take()).toBeUndefined()})
 it('fresh and old game context are distinguished without growing history or changing original safety prefix',()=>{const cp={state:{date:'2287.08.25',player:{name:'地球联合国'},capacities:{colonies:13},resources:{alloys:{net:68.3}},wars:[]},observedAt:100000};expect(captainContext(cp,100001)).toContain('控制器最近仍在更新');expect(captainContext(cp,200000)).toContain('历史快照');const msgs=captainMessages([{role:'system',content:'safety'},{role:'user',content:'hello'}],cp,100001);expect(msgs[0]?.content).toContain('safety');expect(msgs[0]?.content).toContain('大肥鱼舰长');expect(msgs[1]?.content).not.toContain('大肥鱼舰长');expect(msgs.at(-1)?.content).toContain('2287.08.25');expect(JSON.stringify(msgs).length).toBeLessThan(3000)})
 it('no listener means no charged request; one player lease owns playback and audio is valid WAV',async()=>{let calls=0;const {service,directory}=await setup(async o=>{calls++;o.onRequest?.();return response(o)});const origin=await start(service);service.say({id:'h1',kind:'host',text:'各位舰员晚上好。',at:Date.now()});await service.poll();expect(calls).toBe(0);expect((await post(origin,'/player/poll',{})).status).toBe(200);expect((await post(origin,'/player/poll',{client:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'})).status).toBe(409);await service.poll();await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready');const s=await (await post(origin,'/player/poll',{})).json();const bytes=Buffer.from(await (await fetch(origin+s.current.audio)).arrayBuffer());expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.readUInt32LE(24)).toBe(24000);expect(calls).toBe(1);await post(origin,'/player/feedback',{id:'h1',kind:'started'});expect((await service.view()).current?.phase).toBe('playing');await post(origin,'/player/feedback',{id:'h1',kind:'ended'});expect((await service.view()).current).toBeUndefined();expect(await readFile(join(directory,'captain-speech-key.enc.json'),'utf8')).not.toContain('offline-secret');expect(JSON.stringify(await service.view())).not.toContain('offline-secret')})
 it('直播网页源优先接管本机试听，复用音频并唤醒旧播放器，迟到反馈不能打断直播',async()=>{
  let calls=0
  const {service}=await setup(async o=>{calls++;o.onRequest?.();return response(o)}),origin=await start(service),broadcast='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  await post(origin,'/player/poll',{role:'monitor'})
  expect((await service.view()).playback?.playerRole).toBe('monitor')
  service.say({id:'handoff',kind:'host',text:'这句话要送进直播。',at:Date.now()})
  await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  await post(origin,'/player/feedback',{id:'handoff',kind:'started',mediaSequence:10})
  const previous=await(await post(origin,'/player/poll',{role:'monitor'})).json()
  const waiting=post(origin,'/player/poll',{role:'monitor',afterRevision:previous.revision})
  await new Promise(done=>setTimeout(done,25))
  const takeover=await post(origin,'/player/poll',{client:broadcast,role:'broadcast'})
  expect(takeover.status).toBe(200);expect((await waiting).status).toBe(409)
  const next=await takeover.json()
  expect(next.current).toMatchObject({id:'handoff',audio:previous.current.audio})
  expect(next.playback.status).toBe('idle');expect((await service.view()).current?.phase).toBe('ready')
  expect((await service.view()).playback?.playerRole).toBe('broadcast')
  expect((await(await fetch(origin+'/diagnostics')).json()).speech.playerRole).toBe('broadcast')
  expect((await post(origin,'/player/poll',{role:'monitor'})).status).toBe(409)
  expect((await post(origin,'/player/poll',{client:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',role:'broadcast'})).status).toBe(409)
  expect((await post(origin,'/player/feedback',{id:'handoff',kind:'ended',mediaSequence:11})).status).toBe(404)
  expect((await post(origin,'/player/release',{})).status).toBe(404)
  expect((await post(origin,'/player/feedback',{client:broadcast,id:'handoff',kind:'started',mediaSequence:1})).status).toBe(200)
  expect(service.readPlayback()).toMatchObject({id:'handoff',status:'playing'});expect(calls).toBe(1)
 })
 it('直播接管在途配音不取消或重复合成',async()=>{
  let finish!:(value:Awaited<ReturnType<typeof response>>)=>void,signal:AbortSignal|undefined,calls=0
  const {service}=await setup(o=>{calls++;o.onRequest?.();signal=o.signal;return new Promise(done=>finish=done)}),origin=await start(service),broadcast='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  await post(origin,'/player/poll',{role:'monitor'})
  service.say({id:'pending-handoff',kind:'host',text:'合成中的声音也要继续送出。',at:Date.now()})
  await expect.poll(async()=>(await service.view()).current?.phase).toBe('generating')
  expect((await post(origin,'/player/poll',{client:broadcast,role:'broadcast'})).status).toBe(200)
  expect(signal?.aborted).toBe(false)
  finish(await response({}));await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  const state=await(await post(origin,'/player/poll',{client:broadcast,role:'broadcast'})).json()
  expect(state.current).toMatchObject({id:'pending-handoff',audio:'/audio/pending-handoff'});expect(calls).toBe(1)
 })
 it('过期租约换播放器后重置反馈序号，现有音频可继续播放',async()=>{
  let now=100000
  const {service}=await setup(response,()=>now),origin=await start(service),nextClient='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  await post(origin,'/player/poll',{})
  service.say({id:'expired-handoff',kind:'host',text:'重连后继续播放。',at:now})
  await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  await post(origin,'/player/feedback',{id:'expired-handoff',kind:'started',mediaSequence:20})
  now+=6100
  expect((await post(origin,'/player/poll',{client:nextClient})).status).toBe(200)
  expect((await service.view()).current?.phase).toBe('ready')
  expect((await post(origin,'/player/feedback',{client:nextClient,id:'expired-handoff',kind:'started',mediaSequence:1})).status).toBe(200)
  expect(service.readPlayback()).toMatchObject({id:'expired-handoff',status:'playing'})
 })
 it('stop aborts synthesis and a late response cannot restore playback',async()=>{let done!:(v:any)=>void,signal:AbortSignal|undefined;const {service}=await setup(o=>{signal=o.signal;o.onRequest?.();return new Promise(r=>done=r)});const origin=await start(service);await post(origin,'/player/poll',{});service.say({id:'h2',kind:'host',text:'本舰长准备出发。',at:Date.now()});await service.poll();expect(signal?.aborted).toBe(false);await service.action({type:'stop'});expect(signal?.aborted).toBe(true);done(await response({}));await Promise.resolve();await Promise.resolve();expect((await service.view()).current).toBeUndefined();expect((await service.view()).enabled).toBe(false)})
 it('取消场控保留排队游戏解说，并中止合成及阻止迟到播放',async()=>{
  let done!:(v:any)=>void,signal:AbortSignal|undefined,calls=0
  const {service}=await setup(o=>{calls++;o.onRequest?.();if(calls===1){signal=o.signal;return new Promise(r=>done=r)}return response(o)})
  const origin=await start(service);await post(origin,'/player/poll',{})
  const at=Date.now();service.say({id:'active-host',kind:'host',text:'正在回复。',at});await service.poll()
  service.say({id:'queued-host',kind:'host',text:'排队回复。',at});service.say({id:'game-kept',kind:'game',text:'继续发展科研。',at})
  service.cancel('host');expect(signal?.aborted).toBe(true);expect((await service.view()).queued+((await service.view()).current?.kind==='game'?1:0)).toBe(1)
  await service.poll();await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  done(await response({}));await new Promise(r=>setImmediate(r))
  expect((await service.view()).current).toMatchObject({id:'game-kept',kind:'game',phase:'ready'});expect(calls).toBe(2)
  service.cancel('host');expect((await service.view()).current?.id).toBe('game-kept')
 })
 it('仅取消排队场控时，两条回复移除而游戏解说保留',()=>{
  const q=createCaptainSpeechQueue(()=>1000000)
  for(const id of ['h1','h2'])q.push({id,kind:'host',text:'收到。',at:1000000})
  q.push({id:'g',kind:'game',text:'继续建设。',at:1000000});q.cancel('host')
  expect(q.size()).toBe(1);expect(q.take()?.id).toBe('g')
 })
 it('three failures open the circuit, retaining reported billed tokens',async()=>{let calls=0;const {service}=await setup(async o=>{calls++;o.onRequest?.();throw Object.assign(Error('provider failed'),{usage:{inputTokens:7,outputTokens:9}})});const origin=await start(service);for(let i=0;i<3;i++){await post(origin,'/player/poll',{});service.say({id:'f'+i,kind:'host',text:'小明，我记下你的建议了。',at:Date.now()});await service.poll();await expect.poll(async()=>(await service.view()).usage.failed).toBe(i+1)}expect((await service.view()).enabled).toBe(false);expect((await service.view()).usage).toMatchObject({requests:3,inputTokens:21,outputTokens:27,missing:0});service.say({id:'no',kind:'host',text:'不得继续扣费。',at:Date.now()});await service.poll();expect(calls).toBe(3)})
 it('the hourly synthesis budget is enforced separately from text-model requests',async()=>{let calls=0;const {service}=await setup(async o=>{calls++;o.onRequest?.();return response(o)});await service.action({type:'save-config',config:{maxRequestsPerHour:10}});const origin=await start(service);for(let i=0;i<10;i++){await post(origin,'/player/poll',{});service.say({id:'b'+i,kind:'host',text:'各位舰员，科研正在安排。',at:Date.now()});await service.poll();await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready');await post(origin,'/player/feedback',{id:'b'+i,kind:'ended'})}service.say({id:'over',kind:'host',text:'这条已经超预算。',at:Date.now()});await service.poll();expect(calls).toBe(10);expect((await service.view()).message).toContain('已达上限')})
 it('only newly appended public intents are narrated, never old journal or internal model text',async()=>{let calls=0;const {service,project}=await setup(async o=>{calls++;o.onRequest?.();return response(o)});const journal=join(project,'.local/native-bridge/session-game-1.jsonl');await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-1'}));await writeFile(journal,JSON.stringify({type:'intent',requestId:'old',explanation:'旧记录不能重播。',at:new Date().toISOString()})+'\n');const origin=await start(service);await post(origin,'/player/poll',{});await service.poll();expect(calls).toBe(0);await appendFile(journal,JSON.stringify({type:'thinking',text:'私有推理'})+'\n'+JSON.stringify({type:'intent',requestId:'new',explanation:'先稳住科研和后勤。',at:new Date().toISOString()})+'\n');await service.poll();await expect.poll(async()=>(await service.view()).current?.text).toBe('先稳住科研和后勤。');expect(calls).toBe(1)})
 it('原生模式没有逐条命令日志时，当前方针及方向变化仍进入真实游戏语音队列',async()=>{
  let calls=0
  const {service,project}=await setup(async o=>{calls++;o.onRequest?.();return response(o)})
  const path=join(project,'.local/native-bridge/latest-session.json'),checkpoint={sessionId:'game-1',stopped:false,state:{countryAIControl:{enabled:true,owner:'native'},strategyContract:{economyFocus:'unity_traditions',expansionStance:'aggressive',militaryStance:'peaceful',steeringConfirmed:true}}}
  // Deliberately no session journal: strategic narration must not require old orders.
  await writeFile(path,JSON.stringify(checkpoint))
  const origin=await start(service);await service.poll();expect(calls).toBe(0)
  await post(origin,'/player/poll',{});await service.poll()
  await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  const first=(await service.view()).current!
  expect(first.kind).toBe('game');expect(first.text).toContain('凝聚力和传统')
  await post(origin,'/player/feedback',{id:first.id,kind:'started'})
  expect(service.readPlayback()).toMatchObject({kind:'game',text:first.text,status:'playing'})
  await post(origin,'/player/feedback',{id:first.id,kind:'ended'})
  await service.poll();await service.poll();expect(calls).toBe(1)
  checkpoint.state.strategyContract.economyFocus='research';await writeFile(path,JSON.stringify(checkpoint));await service.poll()
  await expect.poll(async()=>(await service.view()).current?.text).toContain('科研')
  expect(calls).toBe(2)
  await service.action({type:'stop'});await service.poll();expect(calls).toBe(2)
 })
 it('关闭游戏朗读时，确认的原生方针不触发配音',async()=>{
  let calls=0;const {service,project}=await setup(async o=>{calls++;return response(o)})
  await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-1',state:{strategyContract:{economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',steeringConfirmed:true}}}))
  await service.action({type:'save-config',config:{narrateGame:false}})
  const origin=await start(service);await post(origin,'/player/poll',{});await service.poll();expect(calls).toBe(0)
 })
 it('audition choice requires generated audio and same-origin intent, persists only selection, never activates speech',async()=>{
  const {service,samplesDirectory}=await setup();const r=await service.action({type:'auditions'}),origin=r.view.auditionsUrl!.replace('/auditions','')
  expect((await post(origin,'/auditions/select',{id:'20'})).status).toBe(400)
  await fixtureSample(samplesDirectory)
  expect((await fetch(origin+'/auditions/select',{method:'POST',body:JSON.stringify({id:'20'})})).status).toBe(403);expect((await post(origin,'/auditions/select',{id:'20'})).status).toBe(200)
  expect((await service.view()).config.presetId).toBe('20');expect((await service.view()).enabled).toBe(false);const data=await (await fetch(origin+'/auditions/data')).json();expect(data.samples).toHaveLength(20);expect(data.samples.filter((x:any)=>x.ready)).toHaveLength(1)
 })
 it('a preset id alone cannot start speech, and corrupted audition bytes cannot be selected',async()=>{const {service,samplesDirectory}=await setup();await service.action({type:'save-key',key:'offline-secret'});await service.action({type:'save-config',config:{presetId:'20'}});expect((await service.action({type:'start'})).ok).toBe(false);await fixtureSample(samplesDirectory);await appendFile(join(samplesDirectory,'20.wav'),'corrupt');const r=await service.action({type:'auditions'}),origin=r.view.auditionsUrl!.replace('/auditions','');expect((await post(origin,'/auditions/select',{id:'20'})).status).toBe(400);expect((await service.action({type:'start'})).ok).toBe(false)})
 it('restart anchors to the current journal tail instead of replaying lines appended while stopped',async()=>{let calls=0;const {service,project}=await setup(async o=>{calls++;o.onRequest?.();return response(o)});const journal=join(project,'.local/native-bridge/session-game-1.jsonl');await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-1'}));await writeFile(journal,'');const origin=await start(service);await service.action({type:'stop'});await appendFile(journal,JSON.stringify({type:'intent',requestId:'during-stop',explanation:'停止时的旧打算。',at:new Date().toISOString()})+'\n');await service.action({type:'start'});await post(origin,'/player/poll',{});await service.poll();expect(calls).toBe(0);await appendFile(journal,JSON.stringify({type:'intent',requestId:'new-after-restart',explanation:'重新开始的新打算。',at:new Date().toISOString()})+'\n');await service.poll();await expect.poll(()=>calls).toBe(1)})
 it('metadata query is separate from synthesis, cannot auto-start, and late results cannot revive cancelled state',async()=>{const {directory,project}=await setup();let finish!:(x:any)=>void,signal:AbortSignal|undefined;const s=createStellarisSpeech({directory,getProject:async()=>project,secrets,port:0,queryVoice:async o=>{signal=o.signal;return new Promise(resolve=>finish=resolve)}});services.push(s);await s.action({type:'save-key',key:'offline-secret'});await s.action({type:'save-config',config:{presetId:''}});const pending=s.action({type:'query-voice'});await expect.poll(async()=>(await s.view()).voiceCheck?.state).toBe('checking');await s.action({type:'stop'});expect(signal?.aborted).toBe(true);finish({state:'ready',message:'ready'});expect((await pending).ok).toBe(false);expect(await s.view()).toMatchObject({enabled:false,usage:{requests:0},voiceCheck:{state:'unchecked'}})})
 it('adopts the verified natural voice and its model, never auto-starts, and rejects stale or changed samples',async()=>{
  const received:any[]=[]
  const {service,project,directory:dataDirectory}=await setup(async o=>{received.push({voice:o.config.voice,model:o.config.model,instruction:o.config.instruction});o.onRequest?.();return response(o)}),directory=join(project,'.local/commentary/captain-tuned')
  await mkdir(directory,{recursive:true})
  const bytes=await readFile(new URL('../assets/captain-tuned/20.wav',import.meta.url)),manifest={...CAPTAIN_TUNED_VOICE,presetId:CAPTAIN_TUNED_VOICE.id,text:CAPTAIN_TUNED_VOICE.sampleText,sha256:inspectCaptainWav(bytes).sha256}
  await writeFile(join(directory,'20.wav'),bytes);await writeFile(join(directory,'manifest.json'),JSON.stringify({...manifest,revision:CAPTAIN_TUNED_VOICE.revision-1}))
  expect((await service.view()).tunedVoice?.ready).toBe(false)
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));expect((await service.view()).tunedVoice?.ready).toBe(true)
  await service.action({type:'save-key',key:'offline-secret'});const adopted=await service.action({type:'use-tuned-voice'})
  expect(adopted.view).toMatchObject({enabled:false,config:{model:CAPTAIN_TUNED_VOICE.model,voice:CAPTAIN_TUNED_VOICE.voice,presetId:CAPTAIN_TUNED_VOICE.id,baseUrl:CAPTAIN_TUNED_VOICE.baseUrl,workspaceId:''}})
  const reloaded=createStellarisSpeech({directory:dataDirectory,getProject:async()=>project,secrets,port:0});services.push(reloaded)
  expect((await reloaded.view()).config).toMatchObject({model:CAPTAIN_TUNED_VOICE.model,voice:CAPTAIN_TUNED_VOICE.voice})
  expect((await service.action({type:'query-voice'})).ok).toBe(true)
  const origin=adopted.view.playerUrl!.replace('/player','');expect((await fetch(origin+'/tuned.wav')).status).toBe(200)
  expect((await service.action({type:'start'})).ok).toBe(true);await post(origin,'/player/poll',{})
  service.say({id:'tuned',text:'各位舰员晚上好。',kind:'host',at:Date.now()});await service.poll()
  await expect.poll(async()=>(await service.view()).current?.phase).toBe('ready')
  expect(received).toEqual([{voice:CAPTAIN_TUNED_VOICE.voice,model:CAPTAIN_TUNED_VOICE.model,instruction:CAPTAIN_TUNED_VOICE.instruction}])
  await service.action({type:'stop'});await appendFile(join(directory,'20.wav'),'changed')
  expect((await service.view()).tunedVoice?.ready).toBe(false);expect((await service.action({type:'start'})).ok).toBe(false)
 })
 it('弹幕、游戏和实际台词试读使用原试听的同一指导，试读遵守播放器、忙碌与停止限制',async()=>{
  const {directory,project}=await setup(),received:{text:string;config:any}[]=[]
  const s=createStellarisSpeech({directory,getProject:async()=>project,tunedSamplesDirectory:resolve('assets/captain-tuned'),secrets,port:0,synthesize:async o=>{received.push({text:o.text,config:{...o.config}});o.onRequest?.();return response(o)}});services.push(s)
  expect((await s.action({type:'read-live-text',text:'先看一眼资源。'})).ok).toBe(false)
  await s.action({type:'save-key',key:'offline-secret'});expect((await s.action({type:'start'})).ok).toBe(true)
  const origin=(await s.view()).playerUrl!.replace('/player','')
  expect((await s.action({type:'read-live-text',text:'先看一眼资源。'})).ok).toBe(false);expect(received).toHaveLength(0)
  await post(origin,'/player/poll',{role:'monitor'})
  expect((await s.action({type:'read-live-text',text:' '})).ok).toBe(false)
  expect((await s.action({type:'read-live-text',text:'啊'.repeat(101)})).ok).toBe(false)
  for(const kind of ['host','game'] as const){
   const id='natural-'+kind;s.say({id,text:kind==='host'?'这个办法可以试试。':'科研这边先慢慢来。',kind,at:Date.now()})
   await expect.poll(async()=>(await s.view()).current?.phase).toBe('ready')
   expect((await s.action({type:'read-live-text',text:'不能打断这句话。'})).ok).toBe(false)
   await post(origin,'/player/feedback',{id,kind:'ended'})
  }
  expect((await s.action({type:'read-live-text',text:'嗯，这边先不急着扩张。'})).ok).toBe(true)
  await expect.poll(async()=>(await s.view()).current?.phase).toBe('ready')
  expect((await s.view()).current?.text).toBe('嗯，这边先不急着扩张。')
  expect(received.map(x=>x.text)).toEqual(['这个办法可以试试。','科研这边先慢慢来。','嗯，这边先不急着扩张。'])
  for(const row of received)expect(row.config).toMatchObject({model:CAPTAIN_TUNED_VOICE.model,voice:CAPTAIN_TUNED_VOICE.voice,rate:CAPTAIN_TUNED_VOICE.rate,instruction:CAPTAIN_TUNED_VOICE.instruction})
  await s.action({type:'stop'});expect((await s.view()).current).toBeUndefined()
  expect((await s.action({type:'read-live-text',text:'停止后不再试读。'})).ok).toBe(false);expect(received).toHaveLength(3)
 })
 it('fresh full installs ship the selected voice without a controller directory; existing choices keep their original voice',async()=>{
  const {directory,project}=await setup();const bundled=resolve('assets/captain-tuned')
  const s=createStellarisSpeech({directory,getProject:async()=>{throw Error('controller is not installed')},tunedSamplesDirectory:bundled,secrets,port:0});services.push(s)
  expect(await s.view()).toMatchObject({enabled:false,config:{presetId:CAPTAIN_TUNED_VOICE.id,voice:CAPTAIN_TUNED_VOICE.voice,baseUrl:CAPTAIN_TUNED_VOICE.baseUrl},tunedVoice:{ready:true,duration:11.36}})
  const opened=await s.action({type:'open-player'});expect(opened.ok).toBe(true);expect(opened.view).toMatchObject({enabled:false,usage:{requests:0}})
  const bytes=Buffer.from(await (await fetch(opened.view.playerUrl!.replace('/player','/tuned.wav'))).arrayBuffer());expect(inspectCaptainWav(bytes).sha256).toBe(CAPTAIN_TUNED_SAMPLE_SHA256)
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'captain-speech.json'),JSON.stringify({presetId:'20',baseUrl:'https://trial.cn-beijing.maas.aliyuncs.com',volume:.4}))
  const legacy=createStellarisSpeech({directory,getProject:async()=>project,tunedSamplesDirectory:bundled,secrets,port:0});services.push(legacy)
  expect((await legacy.view()).config).toMatchObject({presetId:'20',model:CAPTAIN_VOICE.model,voice:CAPTAIN_VOICE.voice,baseUrl:'https://trial.cn-beijing.maas.aliyuncs.com',volume:.4})
 })
 it('an altered bundled recommendation cannot be substituted by changing both the audio and manifest hash',async()=>{
  const {directory,project}=await setup(),bundled=join(project,'bundle');await mkdir(bundled)
  const bytes=pcmWav(Buffer.alloc(4800,1).toString('base64'),24000)
  await writeFile(join(bundled,'20.wav'),bytes);await writeFile(join(bundled,'manifest.json'),JSON.stringify({...CAPTAIN_TUNED_VOICE,presetId:CAPTAIN_TUNED_VOICE.id,text:CAPTAIN_TUNED_VOICE.sampleText,sha256:inspectCaptainWav(bytes).sha256}))
  const s=createStellarisSpeech({directory,getProject:async()=>project,tunedSamplesDirectory:bundled,secrets,port:0});services.push(s)
  expect((await s.view()).tunedVoice?.ready).toBe(false);expect((await s.action({type:'use-tuned-voice'})).ok).toBe(false)
 })
 it('stop during asynchronous startup cannot enable speech after the sample arrives',async()=>{
  const {directory,project}=await setup(),sampleDirectory=join(project,'.local/commentary/captain-tuned');await mkdir(sampleDirectory,{recursive:true})
  await writeFile(join(sampleDirectory,'20.wav'),await readFile(new URL('../assets/captain-tuned/20.wav',import.meta.url)));await writeFile(join(sampleDirectory,'manifest.json'),await readFile(new URL('../assets/captain-tuned/manifest.json',import.meta.url)))
  let defer=false,release!:(v:string)=>void,waiting=false
  const s=createStellarisSpeech({directory,getProject:async()=>{if(defer){defer=false;waiting=true;return new Promise<string>(done=>release=done)}return project},secrets,port:0});services.push(s)
  await s.action({type:'save-key',key:'offline-secret'});defer=true;const startup=s.action({type:'start'});await expect.poll(()=>waiting).toBe(true)
  await s.action({type:'stop'});release(project);expect((await startup).ok).toBe(false);expect(await s.view()).toMatchObject({enabled:false,usage:{requests:0}})
 })
 it('offline mode does not read profiles, save keys, start servers or call the API',async()=>{const {directory,project}=await setup();const s=createStellarisSpeech({directory,disabled:true,getProject:async()=>project,secrets,synthesize:()=>{throw Error('must not call')}});services.push(s);for(const action of [{type:'save-key',key:'secret'},{type:'start'},{type:'auditions'},{type:'query-voice'}] as const)expect((await s.action(action)).ok).toBe(false);expect((await s.view()).hasKey).toBe(false)})
})
