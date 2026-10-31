// Reviewed integration test in the existing test world. Normal empty-zone and
// favorite-job commands only; no resource editing or new world.
import {NativeGame} from '../src/native-game.mjs';
import {writeFile} from 'node:fs/promises';
const game=new NativeGame({minutes:5}),report={at:new Date().toISOString(),kind:'deterministic development probe, not a DeepSeek endurance run'};
try {
  report.before=await game.start();await game.rpc('set_paused',{paused:true});await game.observe();
  report.route=await game.inspect({topic:'route',fleet_id:1012,system_id:141});
  report.blockedMove=await game.apply({requestId:'probe-route',snapshotId:game.snapshotId,orders:[{command:'move_fleet',arguments:{fleet_id:1012,system_id:141}}]});
  report.zones=await game.inspect({topic:'zones',id:1560,district_type:'district_city'});
  const district=report.zones.districts?.find(x=>x.slots?.some(s=>s.zone===null&&s.buildable_zones?.some(z=>z.zone==='zone_foundry')));
  const slot=district?.slots.find(s=>s.zone===null&&s.buildable_zones?.some(z=>z.zone==='zone_foundry'));
  if(slot)report.foundry=await game.apply({requestId:'probe-foundry',snapshotId:game.snapshotId,explanation:'先补上重工业，军舰才有稳定的合金后勤。',orders:[{command:'set_district_zone',arguments:{planet_id:1560,district_id:district.district_id,zone_slot:slot.slot,zone_key:'zone_foundry'}}]});
  report.jobs=await game.inspect({topic:'jobs',id:3});
  const job=report.jobs.strata?.flatMap(x=>x.jobs||[]).find(x=>x.job_name==='冶金师'&&x.can_prioritize);
  if(job)report.priority=await game.apply({requestId:'probe-priority',snapshotId:game.snapshotId,explanation:'先保证冶金岗位有人，稳住舰队的后勤。',orders:[{command:'set_job_priority',arguments:{planet_id:3,job_key:job.job_key,prioritized:true}}]});
  report.government=await game.inspect({topic:'government'});
  if(report.government.available_agendas?.some(x=>x.key==='agenda_display_of_power')) {
    report.agenda=await game.apply({requestId:'probe-agenda',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_display_of_power'}}]});
    report.afterAgenda=await game.inspect({topic:'government'});
    report.frame=await game.rpc('capture_game_frame');
  }
  report.final=await game.observe();
  await writeFile('.local/native-bridge/industry-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({route:report.route,blockedMove:report.blockedMove?.orders,foundry:report.foundry?.orders,priority:report.priority?.orders,agenda:report.agenda?.orders,council:report.final.council,frame:report.frame}));
}finally{await game.stop();}
