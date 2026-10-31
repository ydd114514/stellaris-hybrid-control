// Maintenance only: ask the game's ordinary save command to persist this test
// world before upgrading the bridge. Never exposed as a model gameplay tool.
import {NativePipe} from '../src/native-pipe.mjs';
import {readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
const directory='C:/Users/YDD/Documents/Paradox Interactive/Stellaris';
const world=join(directory,'save games/_929703252');
const metadata=JSON.parse(await readFile(join(directory,'continue_game.json'),'utf8'));
if(!metadata.title?.startsWith('save games/_929703252/')) throw new Error('Independent test world required');
const bridge=new NativePipe(); const started=Date.now();
try {
  const before=await bridge.request('get_status');
  if(!before.in_game || before.outliner?.sectors_summary?.capital_system!=='太阳') throw new Error('Unexpected world');
  await bridge.request('set_paused',{paused:true});
  const name=`cyberfish-war-recovery-${before.date.formatted.replaceAll('.','')}`;
  const result=await bridge.request('run_console',{command:`save ${name}`});
  let saved;
  for(let i=0;i<20 && !saved;i++) {
    await delay(500);
    for(const file of await readdir(world)) {
      if(!file.endsWith('.sav')) continue;
      const info=await stat(join(world,file));
      if(info.mtimeMs>=started-1000 && info.size>100000) {saved=file;break;}
    }
  }
  const report={before:before.date,result,saved,verified:!!saved};
  await writeFile('.local/native-bridge/war-checkpoint.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!saved) throw new Error('No new save file observed; do not restart the game');
  await writeFile(join(directory,'continue_game.json'),JSON.stringify({...metadata,title:`save games/_929703252/${saved.slice(0,-4)}`,date:before.date.formatted}));
} finally {bridge.close();}
