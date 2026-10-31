import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const directory=resolve(process.argv[2]||''),reason=process.argv[3];
if(!reason||!directory.startsWith(resolve('.local/hybrid-control')+'\\'))throw Error('需要明确本轮目录和停止原因');
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
const checkpoint=JSON.parse(await readFile(join(directory,'native/latest-session.json'),'utf8'));
if(!manifest.execute||checkpoint.stopped||checkpoint.started<manifest.started)throw Error('不是活动试点');
await writeFile(join(directory,'operator-stop.json'),JSON.stringify({at:Date.now(),sessionId:checkpoint.sessionId,reason},null,2));
await writeFile(resolve('.local/STOP'),`hybrid_pilot: ${reason}`);
console.log(JSON.stringify({directory,reason,stopRequested:true}));
