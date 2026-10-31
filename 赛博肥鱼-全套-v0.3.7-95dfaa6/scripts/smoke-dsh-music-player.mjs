// Offline real Electron media pipeline; no accounts, network, game or speakers.
import {build} from 'esbuild';import {_electron as electron,expect} from '@playwright/test';import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'cyberfish-player-audio-')),artifacts=resolve('.local/artifacts');let application;
try{
 await mkdir(artifacts,{recursive:true});await writeFile(join(root,'stellaris-music.json'),JSON.stringify({tracks:[{id:'qq:offlineMID',source:'shop-qqmusic://track/offlineMID',title:'离线测试音（不是QQ实播）',artist:'本机合成测试'}],bgmTrackIds:['qq:offlineMID'],volume:.2}));
 const source=`import{app,BrowserWindow,protocol,ipcMain}from'electron';import{createStellarisMusic}from${JSON.stringify(resolve('apps/desktop/electron/stellaris-music.ts'))};
 app.setPath('userData',${JSON.stringify(root)});protocol.registerSchemesAsPrivileged([{scheme:'shop-qqmusic',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
 app.whenReady().then(async()=>{
 const wav=Buffer.alloc(44+48000*2*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<(wav.length-44)/2;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*4000),44+i*2);
 const music=createStellarisMusic({directory:${JSON.stringify(root)},provider:async()=>({status:async()=>({loggedIn:true,loginPending:false,message:'离线模拟'}),loginStart:async()=>{throw Error()},loginPoll:async()=>{throw Error()},resolve:async()=>{throw Error()},lyrics:async()=>'',stream:async()=>new Response(wav,{headers:{'content-type':'audio/wav','content-length':String(wav.length)}}),dispose(){}})});globalThis.__music=music;
 protocol.handle('shop-qqmusic',r=>music.stream(r));ipcMain.handle('dsh:music-view',()=>music.view());ipcMain.handle('dsh:music-feedback',(_,g,k)=>music.feedback(g,k));
 const w=new BrowserWindow({width:650,height:230,title:'隔离播放器测试',webPreferences:{preload:${JSON.stringify(resolve('dist/dsh/electron/preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}});w.webContents.setAudioMuted(true);await w.loadFile(${JSON.stringify(resolve('dist/dsh/renderer/music-player.html'))});globalThis.__window=w;
 });app.on('window-all-closed',()=>app.quit());`;
 await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'offline-player.ts',loader:'ts'},outfile:join(root,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent'});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 application=await electron.launch({executablePath:electronPath,args:[join(root,'main.cjs')],env,timeout:30000});const page=await application.firstWindow();await page.waitForURL(/music-player\.html/);
 expect((await application.evaluate(async()=>globalThis.__music.view())).enabled).toBe(false);
 await application.evaluate(async()=>globalThis.__music.action('start'));
 await expect.poll(async()=>(await application.evaluate(async()=>globalThis.__music.view())).state.current?.startedAt).toBeTruthy();
 await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(0);
 const firstGeneration=(await application.evaluate(async()=>globalThis.__music.view())).state.current.generationId;
 await expect.poll(async()=>(await application.evaluate(async()=>globalThis.__music.view())).state.current?.generationId,{timeout:10000}).not.toBe(firstGeneration);
 await application.evaluate(async()=>globalThis.__music.event({id:'offline-audience-round',platform:'bilibili',kind:'chat',user:{id:'offline-viewer',name:'离线模拟观众'},text:'点歌 离线测试音（不是QQ实播）',at:Date.now()}));
 await expect.poll(async()=>(await application.evaluate(async()=>globalThis.__music.view())).state.current?.userId).toBe('offline-viewer');
 await expect.poll(async()=>(await application.evaluate(async()=>globalThis.__music.view())).state.current?.startedAt).toBeTruthy();
 await expect.poll(async()=>(await application.evaluate(async()=>globalThis.__music.view())).state.current?.isBgm,{timeout:10000}).toBe(true);
 const generation=(await application.evaluate(async()=>globalThis.__music.view())).state.current.generationId;
 await page.screenshot({path:join(artifacts,'dsh-music-player-offline.png')});
 await application.evaluate(async()=>globalThis.__music.action('stop'));
 await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused&&!a.hasAttribute('src'))).toBe(true);
 await application.evaluate(async(_,id)=>{globalThis.__music.feedback(id,'ended');globalThis.__music.feedback(id,'started')},generation);
 expect((await application.evaluate(async()=>globalThis.__music.view())).state.current).toBeUndefined();
 await application.evaluate(async()=>globalThis.__music.dispose());
 await writeFile(join(artifacts,'dsh-music-player-offline.json'),JSON.stringify({passed:true,isolated:true,realQQ:false,realGame:false,speakerMuted:true,mediaDecoded:true,playingAcknowledged:true,naturalBackgroundLoop:true,audienceThenBackgroundResumed:true,stopClearedAudio:true,lateFeedbackIgnored:true},null,2));
 console.log('离线真实Electron播放器通过：自定义音频协议、解码、playing回执、停止清流、迟到回执不复播；没有QQ账号或游戏请求，扬声器静音。');
}finally{await application?.close().catch(()=>{});const p=await realpath(root);if(dirname(p)!==await realpath(tmpdir())||!basename(p).startsWith('cyberfish-player-audio-'))throw new Error('Unexpected test root');await rm(p,{recursive:true,force:true})}
