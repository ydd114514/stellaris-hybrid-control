// Explicit maintenance test in the selected world, no model and no blind choice.
import {NativeGame} from '../src/native-game.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const selected=JSON.parse(await readFile('.local/active-world.json','utf8'));
if(selected.directory!=='2_333029590')throw new Error('Unexpected test world');
const game=new NativeGame({minutes:2});let report;
try{
  await game.start();
  const events=await game.inspect({topic:'events'});
  const event=events.find(x=>x.kind==='first_contact_choice');
  const options=event?.options?.filter(x=>x.is_valid);
  if(!event?.description || options?.length!==1 || options[0].text!=='真是有趣。')
    throw new Error('This maintenance check only confirms the observed single informational option');
  const before={date:game.lastState.date,event,alerts:game.lastState.alerts};
  const action=await game.apply({requestId:'first-contact-stage-real-option',snapshotId:game.snapshotId,
    explanation:'先确认这次接触报告，再继续破译巫师的语言。',orders:[{command:'resolve_event',arguments:{window_id:event.window_id,option_index:options[0].index}}]});
  const afterEvents=await game.inspect({topic:'events'}),afterAlerts=await game.inspect({topic:'alerts'});
  const receipt=action.orders[0];
  const frame=await game.rpc('capture_game_frame');
  report={before,action:action.orders,afterEvents,afterAlerts,frame,passed:receipt?.verification?.verified===true&&
    !afterAlerts.some(x=>x.type==='alert_first_contact_stage_done')};
  console.log(JSON.stringify(report));
}finally{await game.stop();if(report)await writeFile('.local/native-bridge/first-contact-smoke.json',JSON.stringify(report,null,2));}
if(!report?.passed)process.exitCode=1;
