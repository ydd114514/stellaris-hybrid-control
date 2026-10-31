import {describe,it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,resolve,basename} from 'node:path'
import {createStellarisAi} from '../apps/desktop/electron/stellaris-ai'
import {createStellarisSpeech,pcmWav} from '../apps/desktop/electron/stellaris-speech'
import {createStellarisBroadcast} from '../apps/desktop/electron/stellaris-broadcast'
import {CAPTAIN_VOICE,CAPTAIN_VOICE_PRESETS,CAPTAIN_SAMPLE_TEXT} from '../packages/core/src/stellaris-voice-presets'
import {inspectCaptainWav} from '../packages/core/src/captain-audio'
const secrets={available:()=>true,encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()}
describe('captain reply to speech integration',()=>{
 it('authenticated audience input becomes one public reply and one playable utterance, without real API requests',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fish-captain-chain-')),project=join(root,'project'),data=join(root,'data'),samples=join(root,'samples');await mkdir(join(project,'.local/native-bridge'),{recursive:true});await mkdir(samples)
  await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-1',observedAt:Date.now(),state:{date:'2201.01.01',paused:true,capacities:{colonies:1},wars:[]}}))
  const wav=pcmWav(Buffer.alloc(4800,1).toString('base64'),24000);await writeFile(join(samples,'20.wav'),wav);await writeFile(join(samples,'manifest.json'),JSON.stringify({voice:CAPTAIN_VOICE.voice,model:CAPTAIN_VOICE.model,rate:1,text:CAPTAIN_SAMPLE_TEXT,samples:[{id:'20',instruction:CAPTAIN_VOICE_PRESETS[19]!.instruction,status:'ready',sha256:inspectCaptainWav(wav).sha256}]}))
  let textCalls=0,voiceCalls=0;const spoken:string[]=[]
  const speech=createStellarisSpeech({directory:data,getProject:async()=>project,secrets,samplesDirectory:samples,port:0,synthesize:async o=>{voiceCalls++;o.onRequest?.();spoken.push(o.text);return {kind:'pcm',data:Buffer.alloc(4800,1).toString('base64'),sampleRate:24000,characters:o.text.length,words:[],usage:{inputTokens:8,outputTokens:12}}}})
  const ai=createStellarisAi({dataDirectory:data,getProject:async()=>project,secrets,basic:true,overlayPort:0,tickMs:10,onSpoken:lines=>{for(const line of lines)speech.say({...line,kind:'host'})},fetch:async(url,init)=>{textCalls++;expect(url).toBe('https://api.deepseek.com/chat/completions');expect(init.body).toContain('2201.01.01');return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({replies:[{to:'',text:'晚上好，舰员！这局先把科研和后勤稳住。'}],toStrategist:[]})}}],usage:{prompt_tokens:500,completion_tokens:30}})}}})
  const broadcast=createStellarisBroadcast({port:0,getProject:async()=>project,healthy:async()=>true,onAudienceEvent:event=>ai.feed(event)})
  try{
   await speech.action({type:'save-key',key:'offline-speech-key'});await speech.action({type:'save-config',config:{presetId:'20'}});const started=await speech.action({type:'start'});expect(started.ok).toBe(true);const origin=started.view.playerUrl!.replace('/player',''),client='12345678-1234-1234-1234-123456789012';const post=(p:string,body:any)=>fetch(origin+p,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({client,...body})});await post('/player/poll',{})
   await ai.action({type:'save-key',id:'deepseek',key:'offline-model-key'});await ai.action({type:'save-director',director:{...ai.view().director,idleCommentSeconds:0}});expect((await ai.action({type:'start-chat'})).ok).toBe(true)
   await broadcast.operation('start');const input=JSON.parse(broadcast.connectionConfig()!),event={id:'audience-once',kind:'chat',platform:'bilibili',user:{id:'offline-u',name:'离线观众'},text:'舰长晚上好，这局有什么打算？',at:Date.now()}
   for(let n=0;n<2;n++)expect((await fetch(input.endpoint,{method:'POST',headers:input.headers,body:JSON.stringify(event)})).status).toBe(202)
   await expect.poll(()=>textCalls).toBe(1);await expect.poll(async()=>(await speech.view()).current?.phase).toBe('ready');expect(voiceCalls).toBe(1);expect(spoken).toEqual(['晚上好，舰员！这局先把科研和后勤稳住。'])
   const state=await (await post('/player/poll',{})).json(),audio=Buffer.from(await (await fetch(origin+state.current.audio)).arrayBuffer());expect(inspectCaptainWav(audio).duration).toBe(.1);await post('/player/feedback',{id:state.current.id,kind:'started'});expect((await speech.view()).current?.phase).toBe('playing')
   expect(await readFile(join(project,'.local/commentary/host-replies.jsonl'),'utf8')).toContain('晚上好，舰员');await speech.action({type:'stop'});expect((await speech.view()).current).toBeUndefined();expect(ai.view().status.running).toBe(true)
  }finally{await Promise.allSettled([broadcast.dispose(),ai.dispose(),speech.dispose()]);if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('fish-captain-chain-'))throw Error('Unsafe path');await rm(root,{recursive:true,force:true})}
 })
 it('room question waits for its read-only facts, then publishes and voices exactly one final answer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fish-captain-chain-')),project=join(root,'project'),data=join(root,'data'),samples=join(root,'samples');await mkdir(join(project,'.local/native-bridge'),{recursive:true});await mkdir(samples)
  let clock=Date.now(),textCalls=0,voiceCalls=0
  await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-query',state:{date:'2201.01.01',paused:true,wars:[]}}))
  const wav=pcmWav(Buffer.alloc(4800,1).toString('base64'),24000);await writeFile(join(samples,'20.wav'),wav);await writeFile(join(samples,'manifest.json'),JSON.stringify({voice:CAPTAIN_VOICE.voice,model:CAPTAIN_VOICE.model,rate:1,text:CAPTAIN_SAMPLE_TEXT,samples:[{id:'20',instruction:CAPTAIN_VOICE_PRESETS[19]!.instruction,status:'ready',sha256:inspectCaptainWav(wav).sha256}]}))
  const speech=createStellarisSpeech({directory:data,getProject:async()=>project,secrets,samplesDirectory:samples,port:0,now:()=>clock,synthesize:async o=>{voiceCalls++;o.onRequest?.();expect(o.text).toBe('舰员甲，物理学正在研究能源技术，还没研究完成。');return {kind:'pcm',data:Buffer.alloc(4800,1).toString('base64'),sampleRate:24000,characters:o.text.length,words:[],usage:{inputTokens:8,outputTokens:12}}}})
  const ai=createStellarisAi({dataDirectory:data,getProject:async()=>project,secrets,basic:true,overlayPort:0,tickMs:10,now:()=>clock,onSpoken:lines=>{for(const line of lines)speech.say({...line,text:line.to+'，'+line.text,kind:'host'})},fetch:async(_url,init)=>{
    textCalls++;const prompt=JSON.parse(init.body!).messages.map((m:any)=>m.content).join('\n'),taskId=/"taskId":"(q-[a-z0-9-]+)"/.exec(prompt)?.[1]
    const out=taskId?{replies:[{taskId,text:'物理学正在研究能源技术，还没研究完成。'}]}:{replies:[],queries:[{eventId:'question-room',topic:'research'}]}
    if(taskId)expect(prompt).toContain('物理学：能源技术，研究中')
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(out)}}],usage:{prompt_tokens:500,completion_tokens:30}})}
  }})
  const broadcast=createStellarisBroadcast({getProject:async()=>project,healthy:async()=>true,onAudienceEvent:event=>ai.feed(event)})
  try{
   await speech.action({type:'save-key',key:'offline-speech-key'});await speech.action({type:'save-config',config:{presetId:'20'}});const started=await speech.action({type:'start'});const origin=started.view.playerUrl!.replace('/player',''),client='12345678-1234-1234-1234-123456789012',post=(p:string,body:any)=>fetch(origin+p,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({client,...body})});await post('/player/poll',{})
   await ai.action({type:'save-key',id:'deepseek',key:'offline-model-key'});await ai.action({type:'save-director',director:{...ai.view().director,idleCommentSeconds:0}});expect((await ai.action({type:'start-chat'})).ok).toBe(true)
   const event={id:'question-room',platform:'bilibili' as const,kind:'chat' as const,user:{id:'bilibili:u',name:'舰员甲'},text:'现在物理学在研究什么？',at:clock}
   await Promise.all([broadcast.receivePlatform(event),broadcast.receivePlatform(event)])
   const queryPath=join(project,'.local/commentary/audience-queries.json')
   await expect.poll(async()=>{try{return JSON.parse(await readFile(queryPath,'utf8')).requests.length}catch{return 0}}).toBe(1)
   expect(voiceCalls).toBe(0);expect((await speech.view()).queued).toBe(0)
   const bus=JSON.parse(await readFile(queryPath,'utf8')),q=bus.requests[0];clock+=8000
   await writeFile(join(project,'.local/commentary/audience-query-results.json'),JSON.stringify({version:1,source:'cyberfish-audience-query-results',runId:bus.runId,gameSessionId:bus.gameSessionId,updatedAt:clock,results:[{id:q.id,taskId:q.taskId,status:'ok',facts:'物理学：能源技术，研究中',observedAt:clock}]}))
   await expect.poll(()=>ai.view().blackboard.audience.tasks![0]!.status).toBe('answered')
   await post('/player/poll',{});await speech.poll();await expect.poll(async()=>(await speech.view()).current?.phase).toBe('ready')
   expect(textCalls).toBe(2);expect(voiceCalls).toBe(1)
   const feed=await(await fetch(ai.view().overlayUrl!.replace('/host','/host/feed'))).json();expect(feed.lines).toEqual([{to:'舰员甲',text:'物理学正在研究能源技术，还没研究完成。'}])
   expect(JSON.parse(await readFile(join(data,'audience-answer-delivery.json'),'utf8')).lines).toHaveLength(1)
   await broadcast.receivePlatform(event);expect(textCalls).toBe(2);expect(voiceCalls).toBe(1)
   await ai.action({type:'stop'});await speech.action({type:'stop'});expect((await speech.view()).current).toBeUndefined()
  }finally{await Promise.allSettled([broadcast.dispose(),ai.dispose(),speech.dispose()]);if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('fish-captain-chain-'))throw Error('Unsafe path');await rm(root,{recursive:true,force:true})}
 })
})
