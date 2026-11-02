import {app,safeStorage} from 'electron'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {createStellarisSpeech,pcmWav} from '../apps/desktop/electron/stellaris-speech'
import {CAPTAIN_TUNED_VOICE,captainSpeechInstruction} from '../packages/core/src/captain-tuned'
import {synthesizeQwen,designQwenVoice} from '../packages/core/src/voice'
import {inspectCaptainWav,tuneCaptainWav} from '../packages/core/src/captain-audio'
import {resolveStellarisProfile} from '../apps/desktop/electron/stellaris-profile'
import {connect} from 'node:net'
import type {Readable} from 'node:stream'

const arg=(name:string)=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1)
const output=arg('--output'),project=arg('--project')
const calm=process.argv.includes('--calm')
const naturalCompare=process.argv.includes('--natural-compare')
const relaxedDesign=process.argv.includes('--relaxed-design')
const baselineCompare=process.argv.includes('--baseline-compare')
const ordinaryCheck=process.argv.includes('--ordinary-key-check')
if([calm,naturalCompare,relaxedDesign,baselineCompare].filter(Boolean).length>1)throw Error('试听方向不能同时选择。')
const relaxedPrompt='原创成年女性普通话声线，约二十五岁，中低音区，音色柔和、略偏干，声音有自然的人声质感。像熟人在旁边看着游戏随口聊天，字与字顺着意思连成词，一句话自然说顺。平常反应不大，但有自己的想法；吐槽时带一点漫不经心的机灵，情绪随内容自然流露。整体松弛、亲近，有生活感。'
const relaxedInstruction='用普通话，像边看游戏边跟身边的熟人顺口说话。'
// A new listening candidate. Keep the user's saved production settings unchanged until selected.
const calmInstruction='请用普通话，以冷静、淡然、收敛的日常口吻说话。情绪中性，不带笑意，音调起伏小，重音轻，句尾自然落下。句子按意思自然连贯，吐槽也平静地讲完，不刻意强调包袱，不热情招呼，不用播报腔。'
if(!process.argv.includes('--generate')||!output||!project)throw Error('需要显式生成参数。')
const inside=relative(resolve(project,'..','语音小样'),resolve(output))
if(!inside||inside.startsWith('..')||/^[a-z]:/i.test(inside))throw Error('试听输出目录无效。')
const profile=join(output,'isolated-profile'),session=join(profile,'session')
mkdirSync(session,{recursive:true})
const source=resolveStellarisProfile({sourceRoot:project,documents:'C:/Users/YDD/Documents',appData:'C:/Users/YDD/AppData/Roaming',basic:false})
app.setName('群星控制器大肥鱼')
app.setPath('userData',profile)
app.setPath('sessionData',session)
app.commandLine.appendSwitch('disable-background-networking')
try{
  const state=JSON.parse(readFileSync(join(source,'Local State'),'utf8'))
  if(state.os_crypt)writeFileSync(join(session,'Local State'),JSON.stringify({os_crypt:state.os_crypt}))
}catch{/* DPAPI may work without a Chromium key on this platform. */}

const lines=[
  {id:'01',kind:'弹幕',label:'普通接话',text:'这个办法可以试试，先把眼前这点资源缺口补上。'},
  {id:'02',kind:'弹幕',label:'接梗吐槽',text:'你这舰队名字也太长了，敌人还没打过来，我先念缺氧了。'},
  {id:'03',kind:'弹幕',label:'稍有惊喜',text:'这个名字还挺合适的！先留着，下次有新舰队就用它。'},
  {id:'04',kind:'解说',label:'战略方向',text:'我先顾科研，基础资源也得够用。先巩固现有领土。先和平发展。'},
  {id:'05',kind:'解说',label:'资源状况',text:'能源每个月要亏5，手上还有1000。'},
  {id:'06',kind:'解说',label:'科研进展',text:'物理这边还在研究《蓝激光发射器》。'},
]
const candidateLines=ordinaryCheck
  ? [lines[1]].map(line=>({...line,candidate:'松弛日常表达参考（系统底音）',voice:'xieshurou_v3.1',group:line.kind}))
  : baselineCompare
  ? [{id:'A',name:'原试听指导',instruction:CAPTAIN_TUNED_VOICE.instruction},{id:'B',name:'无语气指导',instruction:''}].flatMap(candidate=>lines.filter(line=>['02','06'].includes(line.id)).map(line=>({...line,id:candidate.id+'-'+line.id,candidate:candidate.name,instruction:candidate.instruction,voice:CAPTAIN_TUNED_VOICE.voice,group:candidate.id+'-'+candidate.name})))
  : naturalCompare
  ? [{id:'A',name:'叶知晴',voice:CAPTAIN_TUNED_VOICE.voice},{id:'B',name:'龙颜',voice:'longyan_v3.1'}].flatMap(candidate=>lines.filter(line=>['02','03','06'].includes(line.id)).map(line=>({...line,id:candidate.id+'-'+line.id,candidate:candidate.name,voice:candidate.voice,group:candidate.id+'-'+candidate.name})))
  : lines.map(line=>({...line,candidate:CAPTAIN_TUNED_VOICE.name,voice:CAPTAIN_TUNED_VOICE.voice,group:line.kind}))
const samples:any[]=[],groups:Record<string,Buffer[]>={}
let requests=0,designRequests=0,designedVoice='',key='',service:ReturnType<typeof createStellarisSpeech>|undefined
async function inputKey(stream:Readable=process.stdin):Promise<string>{
  console.log('等待进程管道输入新密钥；不会回显。')
  return new Promise((done,fail)=>{
    let input=''
    const cleanup=()=>{clearTimeout(timer);stream.off('data',data);stream.off('end',end);stream.off('error',error);stream.pause()}
    const finish=()=>{const value=input.trim();input='';cleanup();if(!/^sk-[A-Za-z0-9._-]{16,4090}$/.test(value))fail(Error('管道未收到有效密钥；未发起网络请求。'));else done(value)}
    const data=(chunk:string)=>{input+=chunk;if(input.length>4096){input='';cleanup();fail(Error('密钥输入超长。'))}else if(input.includes('\n'))finish()}
    const end=()=>finish(),error=()=>{input='';cleanup();fail(Error('密钥输入管道未完成。'))}
    const timer=setTimeout(()=>{input='';cleanup();fail(Error('等待密钥输入超时。'))},60000)
    stream.setEncoding('utf8');stream.on('data',data);stream.once('end',end);stream.once('error',error)
  })
}
async function main(){
  await app.whenReady()
  try{
    if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用。')
    const codec={available:()=>safeStorage.isEncryptionAvailable(),encrypt:(s:string)=>safeStorage.encryptString(s).toString('base64'),decrypt:(s:string)=>safeStorage.decryptString(Buffer.from(s,'base64'))}
    service=createStellarisSpeech({directory:source,getProject:async()=>undefined,tunedSamplesDirectory:join(project,'assets/captain-tuned'),secrets:codec})
    let selected=(await service.view()).config
    const workspaceId=arg('--workspace-id')
    if(workspaceId){
      if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspaceId))throw Error('业务空间ID格式无效。')
      selected={...selected,workspaceId,baseUrl:`https://${workspaceId}.cn-beijing.maas.aliyuncs.com`}
    }
    if(selected.presetId!==CAPTAIN_TUNED_VOICE.id)throw Error('当前正式音色已变化，请核对后再生成。')
    if(process.argv.includes('--key-stdin')||arg('--key-pipe')){
      const pipe=arg('--key-pipe')
      if(pipe){
        if(!/^\\\\\.\\pipe\\cyberfish-voice-key-[a-f0-9-]{36}$/i.test(pipe))throw Error('密钥管道地址无效。')
        const stream=connect(pipe)
        try{key=await inputKey(stream)}finally{stream.destroy()}
      }else key=await inputKey()
      await writeFile(join(output!,'candidate-key.enc.json'),JSON.stringify({key:codec.encrypt(key),createdAt:new Date().toISOString(),baseUrl:selected.baseUrl}),{mode:0o600})
      console.log('新密钥已接收并加密保存在本轮目录，现用配置未更改。')
    }else if(arg('--candidate-key-file')){
      const path=resolve(arg('--candidate-key-file')!),inside=relative(resolve(project!,'..','语音小样'),path)
      if(!inside||inside.startsWith('..')||/^[a-z]:/i.test(inside))throw Error('候选密钥路径无效。')
      const saved=JSON.parse(await readFile(path,'utf8'))
      try{key=codec.decrypt(saved.key)}catch{throw Error('本机无法解密本轮候选密钥。')}
    }else{
      const saved=JSON.parse(await readFile(join(source,'captain-speech-key.enc.json'),'utf8'))
      try{key=codec.decrypt(saved.key)}catch{throw Error('当前执行身份无法解密本项目保存的语音密钥。')}
    }
    if(!key.trim())throw Error('本项目尚未保存可用语音密钥。')
    if(process.argv.includes('--grant-voice-design')){
      if(!selected.workspaceId)throw Error('定向授权必须提供已确认的业务空间。')
      const url=new URL('/api/v1/models/permissions',selected.baseUrl)
      const r=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({models:[{model:'voice-enrollment',inference:true}]}),signal:AbortSignal.timeout(20000)})
      const body=await r.json(),safe=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(value)?value:null
      const result:any={operation:'grant-voice-enrollment-only',httpStatus:r.status,code:safe(body.code),success:body.success===true}
      console.log(JSON.stringify(result))
      if(r.ok&&result.success){
        url.searchParams.set('model','voice-enrollment');url.searchParams.set('authorization_scope','AUTHORIZABLE')
        const check=await fetch(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)})
        const data=await check.json()
        result.confirmation={httpStatus:check.status,code:safe(data.code),permissions:data.output?.permissions??null}
        console.log(JSON.stringify(result.confirmation))
      }else process.exitCode=1
      await writeFile(join(output!,'voice-design-permission.json'),JSON.stringify(result,null,2))
      return
    }
    if(process.argv.includes('--inspect-model-access')){
      const results=[]
      for(const [name,path]of [['permissions','/api/v1/models/permissions'],['limits','/api/v1/models/limits']] as const){
        const url=new URL(path,selected.baseUrl)
        url.searchParams.set('model','voice-enrollment');url.searchParams.set('page_no','1');url.searchParams.set('page_size','20')
        if(name==='permissions')url.searchParams.set('authorization_scope','AUTHORIZABLE')
        const r=await fetch(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)})
        const text=await r.text();if(text.length>131072)throw Error('模型管理响应过大。')
        let body:any;try{body=JSON.parse(text)}catch{body={}}
        const safe=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(value)?value:null
        const result={name,httpStatus:r.status,code:safe(body.code),success:body.success,...(r.ok?{output:body.output??null}:{})}
        results.push(result);console.log(JSON.stringify(result))
      }
      await writeFile(join(output!,'model-access.json'),JSON.stringify({workspaceId:selected.workspaceId,baseUrl:selected.baseUrl,readOnly:true,requests:2,results},null,2))
      return
    }
    if(process.argv.includes('--compare-voice-keys')){
      let original='',candidate=''
      try{
        try{const saved=JSON.parse(await readFile(join(project!,'.local/user-data/credentials.enc.json'),'utf8'));original=codec.decrypt(saved.qwen)}catch{/* Only availability is reported. */}
        try{const saved=JSON.parse(await readFile(join(project!,'.local/captain-credential-candidate.enc.json'),'utf8'));candidate=codec.decrypt(saved.qwen)}catch{/* Only availability is reported. */}
        const comparison={currentKeyAvailable:true,originalKeyAvailable:!!original,candidateKeyAvailable:!!candidate,currentMatchesOriginal:original?key===original:null,currentMatchesCandidate:candidate?key===candidate:null,originalMatchesCandidate:original&&candidate?original===candidate:null,networkRequests:0}
        await writeFile(join(output!,'voice-key-comparison.json'),JSON.stringify(comparison,null,2))
        console.log(JSON.stringify(comparison))
      }finally{original='';candidate=''}
      return
    }
    if(process.argv.includes('--design-access')){
      // One read-only metadata call, to distinguish a creation restriction from broken TTS.
      const url=new URL(selected.baseUrl)
      url.pathname='/api/v1/services/audio/tts/customization'
      const r=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'voice-enrollment',input:{action:'list_voice',prefix:'fatfish',page_index:0,page_size:1}}),signal:AbortSignal.timeout(20000)})
      const raw=await r.json(),code=raw?.code??raw?.error?.code
      const requestId=typeof raw?.request_id==='string'&&/^[a-f0-9-]{32,40}$/i.test(raw.request_id)?raw.request_id:undefined
      const access={httpStatus:r.status,errorCode:typeof code==='string'&&/^[a-z\d_.-]{1,80}$/i.test(code)?code:null,...(requestId?{requestId}:{}),baseUrl:selected.baseUrl,workspaceId:selected.workspaceId,metadataRequests:1,designRequests:0,ttsRequests:0}
      await writeFile(join(output!,'design-access.json'),JSON.stringify(access,null,2))
      console.log(JSON.stringify(access))
      if(!r.ok)process.exitCode=1
      return
    }
    const config={...selected,rate:ordinaryCheck||relaxedDesign||naturalCompare?1:calm?.96:selected.rate,instruction:ordinaryCheck||relaxedDesign?relaxedInstruction:naturalCompare?'请用普通话，像平时和熟人说话一样自然地说。':calm?calmInstruction:captainSpeechInstruction(selected),enabled:true,provider:'qwen' as const,outputDeviceId:'',pricePer10kChars:0}
    if(relaxedDesign){
      designRequests++
      const previewText=[lines[0].text,lines[1].text,lines[5].text].join('')
      const created=await designQwenVoice({description:relaxedPrompt,previewText,config,apiKey:key,signal:AbortSignal.timeout(120000)})
      designedVoice=created.voice
      await writeFile(join(output!,'designed-voice.json'),JSON.stringify({model:config.model,voice:designedVoice,description:relaxedPrompt,instruction:relaxedInstruction,previewText,rate:1,designRequests,automaticRetries:0},null,2))
      if(created.previewUrl?.startsWith('data:audio/wav;base64,')){
        const preview=Buffer.from(created.previewUrl.slice('data:audio/wav;base64,'.length),'base64')
        inspectCaptainWav(preview)
        await writeFile(join(output!,'原创底音预览.wav'),preview)
      }
      console.log('原创松弛女声已设计，开始按相同六句合成。')
    }
    for(const line of candidateLines){
      // Official Qwen-Audio emotion tags are synthesis controls and are not spoken words.
      const ttsText=calm?'[serious]'+line.text:line.text
      const actualVoice=designedVoice||line.voice
      const actualInstruction=baselineCompare&&'instruction' in line?line.instruction as string:config.instruction
      const result=await synthesizeQwen({text:ttsText,config:{...config,voice:actualVoice,instruction:actualInstruction},apiKey:key,signal:AbortSignal.timeout(50000),onRequest(){if(requests>=(ordinaryCheck?1:baselineCompare?4:6))throw Error('已达本轮请求上限。');requests++}})
      if(result.kind!=='pcm'||!result.data||result.sampleRate!==24000)throw Error('服务未返回预期PCM声音；不自动补发请求。')
      const wav=tuneCaptainWav(pcmWav(result.data,result.sampleRate),CAPTAIN_TUNED_VOICE.gainDb,CAPTAIN_TUNED_VOICE.fadeMilliseconds)
      const info=inspectCaptainWav(wav),file=`${line.id}-${line.kind}-${line.label}.wav`
      await writeFile(join(output!,file),wav)
      // pcmWav creates the canonical 44-byte PCM header; merge unchanged samples with silence only.
      const parts=groups[line.group]??(groups[line.group]=[])
      if(parts.length)parts.push(Buffer.alloc(Math.round(24000*2*.8)))
      parts.push(wav.subarray(44))
      samples.push({...line,voice:actualVoice,instruction:actualInstruction,candidate:relaxedDesign?'松弛日常原创女声':line.candidate,ttsText,file,...info,usage:result.usage})
      console.log(`${line.id} ${relaxedDesign?'原创女声':line.candidate} ${line.kind} ${line.label}：已生成 ${info.duration.toFixed(2)} 秒`)
    }
    for(const [kind,parts] of Object.entries(groups)){
      const wav=pcmWav(Buffer.concat(parts).toString('base64'),24000)
      await writeFile(join(output!,kind+(naturalCompare?'自然说话对照.wav':'回复小样.wav')),wav)
    }
    await writeFile(join(output!,'samples.json'),JSON.stringify({version:baselineCompare?'baseline-compare-5':ordinaryCheck?'stock-delivery-reference':relaxedDesign?'relaxed-design-4':naturalCompare?'natural-compare-3':calm?'calm-2':'live-1',model:config.model,voice:ordinaryCheck?'xieshurou_v3.1':designedVoice||(naturalCompare?['yezhiqing_v3.1','longyan_v3.1']:config.voice),rate:config.rate,instruction:baselineCompare?null:config.instruction,emotionTag:calm?'[serious]':null,requests,designRequests,automaticRetries:0,note:'试听示例台词，数字与科技名不代表当前游戏状态。'+(baselineCompare?'最初叶知晴原声线，同样两句台词，仅对照原试听指导与不加指导，逐句instruction见samples；正常语速，无新音色设计。':ordinaryCheck?'新密钥仅1次普通TTS检查；系统底音配松弛日常表达指导，尚非新设计声线。':relaxedDesign?'原创女声设计，只用通用音色描述，无角色或演员名字、无参考音频。松弛日常表达候选，未替换正式配置。':naturalCompare?'自然三调：原音色与龙颜均使用一句日常指导、正常语速、无情绪标签，未替换正式配置。':calm?'冷静二调候选，未替换正式语音配置。':'使用正式直播配音指导。')+'同样的音频处理；未播放、未送往直播。',samples},null,2))
  }catch(e){
    const message=e instanceof Error?e.message:'小样生成未完成。'
    const failure=e as {httpStatus?:number;providerCode?:string;requestId?:string}
    const details={...(typeof failure.httpStatus==='number'?{httpStatus:failure.httpStatus}:{}),...(typeof failure.providerCode==='string'?{providerCode:failure.providerCode}:{}),...(typeof failure.requestId==='string'?{requestId:failure.requestId}:{})}
    // Only local adapter errors are exposed; it never echoes upstream envelopes or credentials.
    console.log('生成未完成：'+message)
    if(Object.keys(details).length)console.log(JSON.stringify(details))
    await writeFile(join(output!,'generation-status.json'),JSON.stringify({requests,designRequests,designedVoice,completed:samples.length,automaticRetries:0,message,...details}))
    process.exitCode=1
  }finally{
    key=''
    await service?.dispose()
    app.exit(process.exitCode||0)
  }
}
void main()
