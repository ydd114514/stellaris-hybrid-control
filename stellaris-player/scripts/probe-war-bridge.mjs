import {NativePipe} from '../src/native-pipe.mjs';
import {writeFile} from 'node:fs/promises';
const pipe=new NativePipe(),report={at:new Date().toISOString()};
try {
  await pipe.request('set_paused',{paused:true});
  report.wars=await pipe.request('get_wars');
  report.events=await pipe.request('get_active_events');
  report.contacts=await pipe.request('get_contacts',{mode:'empires'});
  report.government=await pipe.request('get_government');
  report.appointments=await pipe.request('get_council_candidates');
  report.military=await pipe.request('get_fleets');
  report.defense=await pipe.request('get_defense_scan');
  report.goals=[];
  for(const war of report.wars.wars||[]) report.goals.push(await pipe.request('get_war_goal_candidates',{war_id:war.war_id}));
  report.frame=await pipe.request('capture_game_frame');
  await writeFile(`.local/native-bridge/war-bridge-${process.argv[2]||'current'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({wars:report.wars,events:report.events,appointments:report.appointments,seats:report.government.council_seats?.map(s=>({id:s.position_id,index:s.seat_index,position:s.position_key,assigned:s.is_assigned})),military:report.military,defense:report.defense,frame:report.frame},null,2));
}finally{pipe.close();}
