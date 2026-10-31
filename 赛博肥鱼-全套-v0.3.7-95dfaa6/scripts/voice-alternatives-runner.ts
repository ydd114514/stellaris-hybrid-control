import {app,safeStorage} from 'electron';import fs from 'node:fs/promises';import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {synthesizeQwen} from '../packages/core/src/voice';import {pcmWav} from '../apps/desktop/electron/stellaris-speech';
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(!output||!process.argv.includes('--generate'))throw Error('Explicit generation entry required');
const profile=path.join(output,'isolated-profile'),source=path.join(app.getPath('documents'),'大肥鱼 DSH/.local/dsh-desktop');mkdirSync(path.join(profile,'session'),{recursive:true});
app.setName('群星控制器大肥鱼');app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));app.commandLine.appendSwitch('disable-background-networking');
try{const local=JSON.parse(readFileSync(path.join(source,'Local State'),'utf8'));if(local.os_crypt)writeFileSync(path.join(profile,'session/Local State'),JSON.stringify({os_crypt:local.os_crypt}))}catch{}
const natural=process.argv.includes('--natural');
const text=natural?'嗯？你说刚才那个啊。等一下，我看一眼……哦，还真是。那先不弄这个了，咱们换个办法试试。你别急，我这边慢慢来。':'哎，你来啦。我刚才光顾着看资源，差点忘了还有舰队。先别急，这次咱们换个思路，去看看外面的星系。';
const instruction=natural?'像坐在旁边和熟人随口说话，放松、朴素，不面向听众表演。句子自然连起来，只在意思转折时短暂停一下，重音轻，句尾平实收住。不要字字清晰用力，不要节目主持或广告介绍的语气，不刻意卖萌。':'用自然的日常聊天口吻，正常语速，停顿跟着语意，不用播音腔，不刻意夹嗓或拖长尾音。';
const samples=natural?[{id:'E',name:'小乔',voice:'xuxiaoqiao_v3.1'},{id:'F',name:'叶知晴',voice:'yezhiqing_v3.1'},{id:'G',name:'龙颜',voice:'longyan_v3.1'},{id:'H',name:'林小灵',voice:'linxiaoling_v3.1'}]:[{id:'A',name:'龙铃',voice:'longling_v3.1'},{id:'B',name:'龙安欢',voice:'longanhuan_v3.1'},{id:'C',name:'龙安灵心',voice:'longanlingxin_v3.1'},{id:'D',name:'龙安风悦',voice:'longanfengyue_v3.1'}];
const report:any={date:'2026-10-31',text,model:'qwen-audio-3.1-tts-flash',rate:1,maxRequests:4,requests:0,automaticRetries:0,formalVoiceChanged:false,desktopControl:false,windowsCreated:0,autoPlayback:false,samples:[]};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),save=()=>fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(report,null,2));
async function run(){await app.whenReady();let key='';
try{
 const configBytes=await fs.readFile(path.join(source,'captain-speech.json')),keyBytes=await fs.readFile(path.join(source,'captain-speech-key.enc.json')),config=JSON.parse(configBytes.toString());
 if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用');key=safeStorage.decryptString(Buffer.from(JSON.parse(keyBytes.toString()).key,'base64'));if(!key.trim())throw Error('未取得本项目保存的配音密钥');
 report.formalVoiceBefore={model:config.model,voice:config.voice,preset:config.presetId};await save();
 for(const sample of samples){const row:any={...sample,status:'started'};report.samples.push(row);await save();try{
  const result=await synthesizeQwen({text,apiKey:key,config:{...config,model:report.model,voice:sample.voice,rate:1,instruction},signal:AbortSignal.timeout(50000),onRequest(){if(report.requests>=4)throw Error('试听请求已达上限');report.requests++}});
  if(result.kind!=='pcm'||!result.data)throw Error('本轮未返回可核验的PCM音频，不自动补发');const audio=pcmWav(result.data,result.sampleRate);const duration=(audio.length-44)/(result.sampleRate*2);if(duration<1||duration>40)throw Error('音频时长不符合短样范围');const filename=`${sample.id}-${sample.name}.wav`;await fs.writeFile(path.join(output,filename),audio);Object.assign(row,{status:'ok',file:filename,duration,sha256:sha(audio),usage:result.usage,characters:result.characters,charactersReported:result.charactersReported});console.log(`${sample.id} ${sample.name}：已生成 ${duration.toFixed(2)} 秒`);
 }catch(e){row.status='failed';row.error=e instanceof Error?e.message.slice(0,160):'合成失败';await save();break}await save()}
 report.sourceFilesUnchanged=sha(await fs.readFile(path.join(source,'captain-speech.json')))===sha(configBytes)&&sha(await fs.readFile(path.join(source,'captain-speech-key.enc.json')))===sha(keyBytes);if(!report.sourceFilesUnchanged)throw Error('原配置文件变化，请核对；本工具没有写入原配置');
}catch(e){report.error=e instanceof Error?e.message.slice(0,160):'试听未完成';process.exitCode=1}finally{key='';await save();app.exit(process.exitCode||0)}}
void run();
