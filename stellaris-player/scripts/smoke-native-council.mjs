// Deterministic maintenance check, not an autonomous-DSH acceptance run.
// Uses the normal agenda command and normal running time. No save edits or cheats.
import {NativeGame} from '../src/native-game.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const active=JSON.parse(await readFile('.local/active-world.json','utf8'));
if(active.directory!=='2_333029590')throw new Error('Only the user-selected new world is authorized for this check');
const game=new NativeGame({minutes:2});let report;
try {
  await game.start();
  const government=await game.inspect({topic:'government'});
  const key=government.agenda.key||government.available_agendas.find(x=>x.key==='agenda_give_and_take')?.key||government.available_agendas[0]?.key;
  if(!key)throw new Error('No supported legal agenda');
  const before=game.lastState.date;
  const result=await game.apply({requestId:'council-visible-monthly',snapshotId:game.snapshotId,
    explanation:'先选一项符合帝国思潮的议程，选好就继续经营。',orders:[{command:'set_council_agenda',arguments:{agenda_key:key}}]});
  const deadline=Date.now()+30000;
  while(game.lastState.date.slice(0,7)===before.slice(0,7)&&Date.now()<deadline){await game.watch(5);if(game.lastState.pendingEvents?.length)break;}
  const after=game.lastState;
  const frame=await game.rpc('capture_game_frame');
  report={before,after:after.date,agenda:key,currentAgenda:after.council?.active_agenda,
    crossedMonth:after.date.slice(0,7)!==before.slice(0,7),selection:result.orders,presentationPanel:game.presentationPanel,
    frame,passed:after.date.slice(0,7)!==before.slice(0,7)&&after.council?.active_agenda===key&&game.presentationPanel==='game'};
  console.log(JSON.stringify(report));
}finally{await game.stop();if(report)await writeFile('.local/native-bridge/council-smoke.json',JSON.stringify(report,null,2));}
if(!report?.passed)process.exitCode=1;
