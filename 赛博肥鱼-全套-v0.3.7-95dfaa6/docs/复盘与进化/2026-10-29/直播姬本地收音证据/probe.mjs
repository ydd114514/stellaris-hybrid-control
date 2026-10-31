import {chromium} from '@playwright/test';import fs from 'node:fs/promises';import path from 'node:path';
const dir=path.resolve('.local/livehime-audio-20261029');await fs.mkdir(dir,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:19223'),context=browser.contexts()[0],main=context.pages().find(p=>p.url().includes('stellaris.html'));
if(!main)throw Error('Actual installed controller page unavailable');
const report={at:Date.now(),mode:process.argv.includes('--play')?'play':'prepare',desktopControl:false,newModelRequests:0,newTtsRequests:0,phases:[]};
async function action(op){return main.evaluate(op)}
try{
 const before=await action(async()=>({controller:await window.stellaris.getStatus(),speech:await window.stellaris.speech.view(),ai:await window.stellaris.ai.view(),music:await window.stellaris.music.view()}));
 if(before.speech.enabled||before.ai.status.running||!['stopped','unavailable'].includes(before.controller.phase))throw Error('Active producers; refusing to interfere');
 report.installedVersion='0.3.14';report.defaultStopped=true;
 await action(()=>window.stellaris.speech.action({type:'open-player'}));
 const baseline=async()=>{let files=[];for(const root of ['C:/Users/YDD/Videos'])for(const item of await fs.readdir(root,{withFileTypes:true})){if(item.isFile()&&/\.(mp4|mkv|flv|mov)$/i.test(item.name)){const location=path.join(root,item.name),stat=await fs.stat(location);files.push({path:location,size:stat.size,mtime:stat.mtimeMs})}}return files};
 if(!process.argv.includes('--play')){
  await action(()=>window.stellaris.music.action('start'));await new Promise(r=>setTimeout(r,2000));await action(()=>window.stellaris.music.action('stop'));
  report.recordingsBefore=await baseline();report.ready=true;
 }else{
  const voice=context.pages().find(p=>p.url().includes('17661/player'));if(!voice)throw Error('Actual app player unavailable');
  const wav=await fs.readFile('.local/live-api-20261029/run-1793246256483-9e1d7bb6/new-reply-played.wav');
  const phase=async(name,run)=>{const row={name,start:Date.now()};report.phases.push(row);await fs.writeFile(path.join(dir,'progress.json'),JSON.stringify(report,null,2));row.media=await run();row.end=Date.now()};
  await action(()=>window.stellaris.music.action('stop'));
  await phase('silence-before',()=>new Promise(r=>setTimeout(r,4000)));
  await phase('real-selected-voice',()=>voice.evaluate(async data=>{const ctx=new AudioContext(),buffer=await ctx.decodeAudioData(Uint8Array.from(atob(data),x=>x.charCodeAt(0)).buffer),source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;gain.gain.value=.8;source.connect(gain).connect(ctx.destination);await ctx.resume();const startedAt=Date.now();await new Promise((resolve,reject)=>{source.onended=resolve;source.start();setTimeout(()=>reject(Error('Audio timeout')),20000)});const endedAt=Date.now();await ctx.close();return {startedAt,endedAt,duration:buffer.duration,actualDecodedWav:true}},wav.toString('base64')));
  await phase('silence-gap',()=>new Promise(r=>setTimeout(r,3000)));
  if(!process.argv.includes('--voice-only'))await phase('actual-QQ-music',async()=>{const start=await action(()=>window.stellaris.music.action('start'));if(!start.ok)throw Error(start.message);await new Promise(r=>setTimeout(r,8000));const view=await action(()=>window.stellaris.music.view());await action(()=>window.stellaris.music.action('stop'));if(view.state.status!=='playing')throw Error('QQ music not actually playing');return {status:view.state.status,title:view.state.tracks.find(t=>t.id===view.state.current?.trackId)?.title}});
  await phase('silence-after',()=>new Promise(r=>setTimeout(r,5000)));report.playbackCompleted=true;report.recordingValidated=false;
 }
}catch(e){report.error=e.message;process.exitCode=1}
finally{await action(()=>window.stellaris.music.action('stop')).catch(()=>{});await fs.writeFile(path.join(dir,report.mode==='prepare'?'prepared.json':process.argv.includes('--voice-only')?'voice-only.json':'playback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(process.exitCode||0)}
