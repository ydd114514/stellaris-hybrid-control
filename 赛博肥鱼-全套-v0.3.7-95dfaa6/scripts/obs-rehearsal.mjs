// Explicit local rehearsal only. Reuses an already enabled, authenticated OBS API.
// Never starts streaming, never logs the WebSocket password or reads stream keys.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import WebSocket from 'ws';
const dir=join(process.env.APPDATA,'obs-studio'), artifacts=resolve('.local/artifacts/live-rehearsal');
await mkdir(artifacts,{recursive:true});
const action=process.argv[2];
if(action==='prepare'||action==='prepare-full'){
  const bundle=join(artifacts,'broadcast.cjs');
  await build({entryPoints:['apps/desktop/electron/stellaris-broadcast.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {stellarisObsCollection}=createRequire(import.meta.url)(bundle);
  const collection=stellarisObsCollection(); collection.name='Cyberfish Rehearsal';
  if(action==='prepare-full'){
    const rehearsal=JSON.parse(await readFile(resolve('.local/artifacts/full-broadcast/current.json'),'utf8'));
    if(rehearsal.stage!=='ready'||!/^http:\/\/127\.0\.0\.1:\d+\/overlay$/.test(rehearsal.overlayUrl))throw new Error('全链路演练尚未就绪');
    const overlay=collection.sources.find(x=>x.id==='browser_source'),music=collection.sources.find(x=>x.id==='wasapi_process_output_capture');
    overlay.settings.url=rehearsal.overlayUrl;
    overlay.settings.css+=' body::before { content: "本地演练 · 模拟弹幕 · 未开播"; position:fixed; top:23px; left:600px; z-index:999; font:14px Microsoft YaHei; color:#3288ba; }';
    music.settings={window:rehearsal.musicWindowTitle+':Chrome_WidgetWin_1:electron.exe',priority:0};
  }
  await writeFile(join(dir,'basic/scenes/CyberfishRehearsal.json'),JSON.stringify(collection,null,2));
  const profile=join(dir,'basic/profiles/CyberfishRehearsal');await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'basic.ini'),`[General]\nName=Cyberfish Rehearsal\n\n[Output]\nMode=Simple\nFilenameFormatting=Cyberfish-%CCYY-%MM-%DD-%hh-%mm-%ss\n\n[SimpleOutput]\nFilePath=${artifacts.replaceAll('\\','/')}\nRecFormat2=mkv\nRecQuality=Small\nRecEncoder=x264\nVBitrate=6000\nABitrate=192\nRecTracks=1\n\n[Video]\nBaseCX=1920\nBaseCY=1080\nOutputCX=1920\nOutputCY=1080\nFPSType=0\nFPSCommon=30\n\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n`);
  const p=spawn('C:/Program Files (x86)/Steam/steamapps/common/OBS Studio/bin/64bit/obs64.exe',['--profile','Cyberfish Rehearsal','--collection','Cyberfish Rehearsal','--disable-updater','--disable-missing-files-check'],{cwd:'C:/Program Files (x86)/Steam/steamapps/common/OBS Studio/bin/64bit',windowsHide:false,detached:true,stdio:'ignore'});p.unref();
  console.log(JSON.stringify({prepared:true,pid:p.pid,streamingRequested:false}));
  process.exit(0);
}
const cfg=JSON.parse(await readFile(join(dir,'plugin_config/obs-websocket/config.json'),'utf8'));
if(!cfg.server_enabled||!cfg.auth_required||!cfg.server_password)throw new Error('OBS现有认证接口未就绪，不自动开放新接口');
const ws=new WebSocket(`ws://127.0.0.1:${cfg.server_port||4455}`);
const pending=new Map(); let identifyResolve,identifyReject;
let meterFrames=0,meterNonzero=0,meterPeak=0;
const allMeters={};
const ready=new Promise((a,b)=>{identifyResolve=a;identifyReject=b});
const hash=s=>createHash('sha256').update(s).digest('base64');
ws.on('error',identifyReject);
ws.on('message',bytes=>{const {op,d}=JSON.parse(String(bytes));
  if(op===0){const authentication=hash(hash(cfg.server_password+d.authentication.salt)+d.authentication.challenge);ws.send(JSON.stringify({op:1,d:{rpcVersion:1,authentication,eventSubscriptions:action==='meters'?65536:0}}));}
  if(op===2)identifyResolve();
  if(op===5&&d.eventType==='InputVolumeMeters'){
    for(const input of d.eventData.inputs||[]){if(!['大肥鱼 · QQ音乐','群星 · 实时游戏与声音'].includes(input.inputName))continue;const m=allMeters[input.inputName]??={frames:0,nonzeroFrames:0,peak:0};const peak=Math.max(0,...input.inputLevelsMul.flat());m.frames++;if(peak>0.00001)m.nonzeroFrames++;m.peak=Math.max(m.peak,peak);}
    const row=d.eventData.inputs?.find(x=>x.inputName==='大肥鱼 · QQ音乐');if(row){meterFrames++;const peak=Math.max(0,...row.inputLevelsMul.flat());meterPeak=Math.max(meterPeak,peak);if(peak>0.00001)meterNonzero++;}
  }
  if(op===7){const p=pending.get(d.requestId);if(p){pending.delete(d.requestId);d.requestStatus.result?p.resolve(d.responseData||{}):p.reject(new Error(d.requestType+': '+d.requestStatus.comment));}}
});
const timeout=setTimeout(()=>{const e=new Error('OBS连接超时');identifyReject(e);for(const p of pending.values())p.reject(e);pending.clear();ws.close();},['meters','silence-check','isolation-tone','isolation-record'].includes(action)?30000:12000);
function call(requestType,requestData={}){return new Promise((resolve,reject)=>{const requestId=randomUUID();pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));});}
try{
  await ready;
  const streaming=await call('GetStreamStatus');
  if(streaming.outputActive)throw new Error('OBS正在实际推流，拒绝修改');
  if((await call('GetProfileList')).currentProfileName!=='Cyberfish Rehearsal')throw new Error('不是独立演练配置');
  let result;
  if(action==='isolation-record'){
    if((await call('GetRecordStatus')).outputActive)throw new Error('请先结束已有录制');
    const live=await(await fetch('https://api.live.bilibili.com/room/v1/Room/room_init?id=7322535',{signal:AbortSignal.timeout(5000)})).json();
    if(live.code!==0||live.data?.live_status!==0)throw new Error('仅在确认未开播时播放隔离测试音');
    const names=['大肥鱼 · QQ音乐','群星 · 实时游戏与声音'],old=await Promise.all(names.map(inputName=>call('GetInputMute',{inputName})));let started=false;
    try{
      for(const inputName of names)await call('SetInputMute',{inputName,inputMuted:true});
      const muted=await Promise.all(names.map(inputName=>call('GetInputMute',{inputName})));
      if(muted.some(x=>!x.inputMuted))throw new Error('静音未生效');
      await new Promise(done=>setTimeout(done,3000));await call('StartRecord');started=true;
      const psFile=join(artifacts,'play-outside-tone.ps1');
      const tone=new Promise(resolve=>{const p=spawn('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',psFile],{windowsHide:true,stdio:'ignore'});p.on('error',()=>resolve(false));p.on('exit',code=>resolve(code===0))});
      await new Promise(done=>setTimeout(done,5500));const stopped=await call('StopRecord');
      for(let n=0;n<20;n++){if(!(await call('GetRecordStatus')).outputActive){started=false;break}await new Promise(done=>setTimeout(done,250))}
      if(started)throw new Error('隔离录制尚未停止');
      result={outputPath:stopped.outputPath,mutedSources:names,mutedBeforeRecord:true,confirmedMuted:muted.every(x=>x.inputMuted),outsideTonePlayed:await tone,special:await call('GetSpecialInputs')};
      await writeFile(join(artifacts,'whole-clip-isolation.json'),JSON.stringify(result,null,2));
    }finally{
      if(started)await call('StopRecord').catch(()=>{});
      for(let i=0;i<names.length;i++)await call('SetInputMute',{inputName:names[i],inputMuted:old[i].inputMuted})
    }
  }else if(action==='attach-full'){
    const rehearsal=JSON.parse(await readFile(resolve('.local/artifacts/full-broadcast/current.json'),'utf8'));
    if(rehearsal.stage!=='ready'||!/^http:\/\/127\.0\.0\.1:\d+\/overlay$/.test(rehearsal.overlayUrl))throw new Error('演练未就绪');
    if((await call('GetRecordStatus')).outputActive)throw new Error('请先停止当前录制');
    await call('SetInputSettings',{inputName:'大肥鱼 · 蓝白框面与字幕',inputSettings:{url:rehearsal.overlayUrl}});
    // Rebind the process source after an isolated test player has exited.
    await call('RemoveInput',{inputName:'大肥鱼 · QQ音乐'});
    result=await call('CreateInput',{sceneName:'大肥鱼 · 群星',inputName:'大肥鱼 · QQ音乐',inputKind:'wasapi_process_output_capture',inputSettings:{window:rehearsal.musicWindowTitle+':Chrome_WidgetWin_1:electron.exe',priority:0},sceneItemEnabled:true});
  }else if(action==='start')result=await call('StartRecord');
  else if(action==='stop')result=await call('StopRecord');
  else if(action==='screenshot'){
    result=await call('SaveSourceScreenshot',{sourceName:'大肥鱼 · 群星',imageFormat:'png',imageFilePath:join(artifacts,process.argv[3]||'obs-program.png'),imageWidth:1920,imageHeight:1080});
  }else if(action==='status'){
    result={record:await call('GetRecordStatus'),inputs:await call('GetInputList'),special:await call('GetSpecialInputs'),scene:await call('GetCurrentProgramScene')};
  }else if(action==='stats'){result=await call('GetStats');
  }else if(action==='levels'){
    result={};for(const name of ['群星 · 实时游戏与声音','大肥鱼 · 蓝白框面与字幕'])result[name]={mute:await call('GetInputMute',{inputName:name}),volume:await call('GetInputVolume',{inputName:name})};
  }else if(action==='meters'){
    await new Promise(done=>setTimeout(done,12000));result={frames:meterFrames,nonzeroFrames:meterNonzero,peak:meterPeak,source:'大肥鱼 · QQ音乐',sources:allMeters};
    await writeFile(join(artifacts,'qq-music-meter.json'),JSON.stringify(result,null,2));
  }else if(action==='silence-all'||action==='isolation-tone'){
    const names=['大肥鱼 · QQ音乐','群星 · 实时游戏与声音'],old=await Promise.all(names.map(inputName=>call('GetInputMute',{inputName})));
    if(!(await call('GetRecordStatus')).outputActive)throw new Error('请先启动本地录音');
    try{
      for(const inputName of names)await call('SetInputMute',{inputName,inputMuted:true});
      const before=await call('GetRecordStatus');let tone;
      if(action==='isolation-tone'){
        const sr=48000,samples=sr*4,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
        for(let n=0;n<samples;n++){const t=n/sr,phase=t%1,envelope=phase<.3?Math.min(1,phase/.02,(.3-phase)/.02):0;wav.writeInt16LE(Math.round(Math.sin(t*2*Math.PI*880)*1800*envelope),44+n*2)}
        const toneFile=join(artifacts,'outside-capture-test-tone.wav');await writeFile(toneFile,wav);
        const psFile=join(artifacts,'play-outside-tone.ps1');await writeFile(psFile,"$tonePlayer = [System.Media.SoundPlayer]::new('"+toneFile.replaceAll("'","''")+"'); $tonePlayer.Load(); $tonePlayer.PlaySync(); $tonePlayer.Dispose();");
        tone=new Promise(resolve=>{const p=spawn('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',psFile],{windowsHide:true,stdio:'ignore'});p.on('error',()=>resolve(false));p.on('exit',code=>resolve(code===0))});
      }
      await new Promise(done=>setTimeout(done,5500));const after=await call('GetRecordStatus');
      result={mutedSources:names,fromSeconds:before.outputDuration/1000+.5,toSeconds:after.outputDuration/1000-.5,special:await call('GetSpecialInputs'),...(tone?{outsideTonePlayed:await tone,outsideToneProcess:'pwsh.exe'}:{})};
      await writeFile(join(artifacts,action==='isolation-tone'?'outside-tone-isolation-window.json':'full-isolation-window.json'),JSON.stringify(result,null,2));
    }finally{for(let i=0;i<names.length;i++)await call('SetInputMute',{inputName:names[i],inputMuted:old[i].inputMuted})}
  }else if(action==='silence-check'){
    const inputName='大肥鱼 · QQ音乐',old=await call('GetInputMute',{inputName}),record=await call('GetRecordStatus');
    if(!record.outputActive)throw new Error('请先启动本地录音');
    try{
      await call('SetInputMute',{inputName,inputMuted:true});const before=await call('GetRecordStatus');
      await new Promise(done=>setTimeout(done,5500));const after=await call('GetRecordStatus');
      result={mutedOnlyMusicSource:true,restoredMute:old.inputMuted,fromSeconds:before.outputDuration/1000+.5,toSeconds:after.outputDuration/1000-.5,special:await call('GetSpecialInputs')};
      await writeFile(join(artifacts,'qq-music-isolation-window.json'),JSON.stringify(result,null,2));
    }finally{await call('SetInputMute',{inputName,inputMuted:old.inputMuted})}
  }else if(action==='audit-audio'){
    result={};for(const inputName of ['群星 · 实时游戏与声音','大肥鱼 · QQ音乐','大肥鱼 · 蓝白框面与字幕']){
      result[inputName]={settings:await call('GetInputSettings',{inputName}),mute:await call('GetInputMute',{inputName}),tracks:await call('GetInputAudioTracks',{inputName})};
    }
  }else if(action==='mute-game'){
    result=await call('SetInputMute',{inputName:'群星 · 实时游戏与声音',inputMuted:process.argv[3]!=='off'});
  }else throw new Error('仅支持prepare/start/stop/status/screenshot/levels/meters');
  if(['stop','stats','audit-audio','status'].includes(action))await writeFile(join(artifacts,'obs-last-'+action+'.json'),JSON.stringify({at:Date.now(),action,streaming:false,result},null,2));
  console.log(JSON.stringify({action,streaming:false,result}));
}finally{clearTimeout(timeout);ws.close();}
