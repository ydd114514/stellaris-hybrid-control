// Development recovery: copy an existing backup of this same world. No new
// world, save-content edits, empire switch, or resource changes.
import {copyFile,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {NativePipe} from '../src/native-pipe.mjs';
const docs='C:/Users/YDD/Documents/Paradox Interactive/Stellaris';
const source=resolve('.local/native-bridge/backups/bridge-upgrade-1793066974384/autosave_2255.07.01.sav');
const pipe=new NativePipe();
try {
  const status=await pipe.request('get_status'),world=await pipe.request('get_galaxy_overview');
  if(status.stats?.colonies!==0 || world.player?.owned_systems!==0) throw new Error('The local settled empire is not defeated; no recovery performed');
  await pipe.request('set_paused',{paused:true});
  const previous=JSON.parse(await readFile(join(docs,'continue_game.json'),'utf8'));
  if(!previous.title?.startsWith('save games/_929703252/')) throw new Error('Continue-world path changed');
  const backup=resolve('.local/native-bridge/backups',`defeat-2295-${Date.now()}`);
  await mkdir(backup,{recursive:true});
  await copyFile(join(docs,'continue_game.json'),join(backup,'continue_game.json'));
  await copyFile(join(docs,previous.title+'.sav'),join(backup,previous.title.split('/').at(-1)+'.sav'));
  const picture=await pipe.request('capture_game_frame');
  if(picture.success) await copyFile(picture.path,join(backup,'defeat-frame.bmp'));
  const name=`cyberfish_recovery_2255_07_${Date.now()}`;
  const destination=join(docs,'save games/_929703252',name+'.sav');
  await copyFile(source,destination);
  const digest=p=>readFile(p).then(b=>createHash('sha256').update(b).digest('hex'));
  if(await digest(source)!==await digest(destination)) throw new Error('Recovery copy hash mismatch');
  const metadata={title:'save games/_929703252/'+name,desc:'地球联合国',date:'2255.07.01'};
  await writeFile(join(docs,'continue_game.json'),JSON.stringify(metadata,null,2)+'\n');
  const report={failedDate:status.date?.formatted,failedPlayer:world.player,source,destination,sha256:await digest(source),backup,metadata};
  await writeFile(join(backup,'recovery.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{pipe.close();}
