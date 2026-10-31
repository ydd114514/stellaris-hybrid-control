// Real local HTTP -> file -> commentary -> browser. Fully isolated, never a Bilibili session.
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root=await mkdtemp(join(tmpdir(),'cyberfish-bilibili-local-')),artifacts=resolve('.local/artifacts');
let child,browser,service;
try {
  await mkdir(artifacts,{recursive:true});await mkdir(join(root,'.local/native-bridge/dsh'),{recursive:true});
  const events=join(root,'.local/native-bridge/dsh/offline.jsonl');await writeFile(events,'');
  await writeFile(join(root,'.local/native-bridge/session-offline.jsonl'),'');
  await writeFile(join(root,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'offline',stopped:true,metrics:{},state:{date:'2200.01.01',player:{owned_systems:1},military:{fleets:[]},colonies:[],resources:{},capacities:{colonies:1}}}));
  await writeFile(join(root,'.local/native-bridge/dsh/current.json'),JSON.stringify({events}));
  const bundle=join(root,'broadcast.cjs');await build({entryPoints:['apps/desktop/electron/stellaris-broadcast.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {createStellarisBroadcast,stellarisObsCollection}=createRequire(import.meta.url)(bundle);
  child=spawn(process.execPath,[resolve('../stellaris-player/scripts/commentary-server.mjs')],{env:{...process.env,CYBERFISH_COMMENTARY_TEST_ROOT:root,CYBERFISH_COMMENTARY_PORT:'0',DEEPSEEK_API_KEY:''},windowsHide:true,stdio:'ignore'});
  let server;
  for(let i=0;i<40&&!server;i++){try{server=JSON.parse(await readFile(join(root,'.local/commentary/server.json'),'utf8'));}catch{await delay(100);}}
  if(!server)throw new Error('Isolated commentary did not start');
  const url=server.url;
  service=createStellarisBroadcast({getProject:async()=>root,port:0,healthy:async()=>true});await service.operation('start');
  const config=JSON.parse(service.connectionConfig());
  expect((await service.operation('test')).ok).toBe(true);
  expect((await (await fetch(url+'/api/state')).json()).audience.messages).toHaveLength(0);
  const message={id:'isolated-message-1',platform:'bilibili',kind:'chat',user:{id:'offline-u1',name:'离线测试观众'},text:'仅隔离测试：第一条弹幕已送达。',at:Date.now()};
  for(let i=0;i<2;i++)expect((await fetch(config.endpoint,{method:'POST',headers:config.headers,body:JSON.stringify(message)})).status).toBe(202);
  await expect.poll(async()=>(await(await fetch(url+'/api/state')).json()).audience.messages.length).toBe(1);
  browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto(url+'/overlay?voice=1');await expect(page.locator('#chat-list')).toContainText(message.text);
  expect(await page.locator('#chat-list .chat-row').count()).toBe(1);
  expect(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const bounds=await page.locator('.game-window').boundingBox();expect(bounds).toMatchObject({x:32,y:78,width:1504,height:846});
  expect(await page.locator('audio').count()).toBe(0);
  expect((await (await fetch(url+'/api/state')).json()).voiceEnabled).toBe(false);
  const enable=await fetch(url+'/api/voice',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({enabled:true})});
  expect((await enable.json()).enabled).toBe(false);
  await expect(page.locator('#api-balance-value')).toHaveText('—');
  expect((await (await fetch(url+'/api/state')).json()).apiBalance.status).toBe('disabled');
  await page.screenshot({path:join(artifacts,'bilibili-local-pipeline-offline.png'),omitBackground:true});
  await writeFile(join(artifacts,'bilibili-local-verification.json'),JSON.stringify({passed:true,isolated:true,platformConnected:false,streaming:false,firstMessageDelivered:true,duplicateSuppressed:true,testDidNotInject:true,gameRectangle:bounds,transparentOverlay:true},null,2));
  const exports=resolve('../直播素材');await mkdir(exports,{recursive:true});await writeFile(join(exports,'大肥鱼群星-OBS.json'),JSON.stringify(stellarisObsCollection(),null,2));
  console.log('B站本地链路通过：本机鉴权、第一条消息显示、去重、透明框面与尺寸；未连接B站、未开播、未调用模型或游戏。');
}finally{
  await browser?.close();await service?.dispose();
  if(child&&child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}
  const path=await realpath(root);if(dirname(path)!==await realpath(tmpdir())||!basename(path).startsWith('cyberfish-bilibili-local-'))throw new Error('Unexpected test root');await rm(path,{recursive:true,force:true});
}
