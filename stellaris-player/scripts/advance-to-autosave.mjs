// Maintenance only: preserve the current test world via its normal January/July
// autosave before loading a rebuilt bridge. Never edits the save contents.
import {NativePipe} from '../src/native-pipe.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const metadata='C:/Users/YDD/Documents/Paradox Interactive/Stellaris/continue_game.json';
const pipe=new NativePipe();
try {
  const before=await pipe.request('get_status');
  const old=JSON.parse(await readFile(metadata,'utf8'));
  if(!old.title?.startsWith('save games/_929703252/')) throw new Error('Continue world changed');
  if((await pipe.request('get_active_events')).length) throw new Error('Resolve the central event first');
  if(![6,12].includes(before.date.month) || before.date.day<20) throw new Error('Not within 11 days of the test-world autosave');
  const nextMonth=before.date.month===12?1:7,nextYear=before.date.year+(nextMonth===1?1:0);
  await pipe.request('set_speed',{speed:1});
  await pipe.request('set_paused',{paused:false});
  let after;
  const deadline=Date.now()+30000;
  do {
    await delay(200);after=await pipe.request('get_status');
    if(after.date.year===nextYear && after.date.month===nextMonth) break;
    if((await pipe.request('get_active_events')).length) throw new Error('New central event; stopped before autosave');
  } while(Date.now()<deadline);
  await pipe.request('set_paused',{paused:true});
  let saved;
  for(let i=0;i<20;++i) {
    saved=JSON.parse(await readFile(metadata,'utf8'));
    if(saved.title!==old.title && saved.date?.startsWith(`${nextYear}.${String(nextMonth).padStart(2,'0')}.`)) break;
    await delay(250);
  }
  if(saved.title===old.title) throw new Error('No new normal autosave was observed');
  const report={before:before.date.formatted,after:after.date.formatted,save:saved,verified:true};
  await writeFile('.local/native-bridge/pre-upgrade-autosave.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  try{await pipe.request('set_paused',{paused:true});}finally{pipe.close();}
}
