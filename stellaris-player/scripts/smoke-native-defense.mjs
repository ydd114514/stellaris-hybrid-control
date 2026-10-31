import {NativeGame} from '../src/native-game.mjs';
import {writeFile} from 'node:fs/promises';

const game = new NativeGame({minutes: 4});
const report = {at: new Date().toISOString(), kind: 'deterministic native integration probe; not a DeepSeek endurance test'};
try {
  report.before = await game.start();
  report.fleets = await game.inspect({topic: 'military'});
  report.contacts = await game.inspect({topic: 'contacts'});
  const fleet = report.fleets.fleets?.find(x => x.designs?.length);
  if (fleet) {
    report.quota = await game.apply({requestId: 'quota-smoke',snapshotId: game.snapshotId, explanation: '验证正常舰队扩编', orders:[{command:'increase_fleet_quota',arguments:{fleet_id:fleet.fleet_id,design_id:fleet.designs[0].design_id,target_quota:fleet.designs[0].target_quota+3}}]});
    report.fleetsAfterQuota = await game.inspect({topic:'military',fleet_id:fleet.fleet_id});
    report.reinforce = await game.apply({requestId:'reinforce-smoke',snapshotId:game.snapshotId,explanation:'验证船坞正常补员',orders:[{command:'reinforce_fleet',arguments:{fleet_id:fleet.fleet_id}}]});
    report.shipyard = await game.inspect({topic:'ships'});
  }
  report.diplomacy=[];
  for(const contact of report.contacts.empires.filter(x=>x.country_type==='default').slice(0,3)) {
    report.diplomacy.push({contact, ...await game.inspect({topic:'diplomacy',id:contact.country_id})});
  }
  await writeFile('.local/native-bridge/defense-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({military:report.fleetsAfterQuota,quota:report.quota?.orders,reinforce:report.reinforce?.orders,shipyard:report.shipyard,diplomacy:report.diplomacy},null,2));
} finally {await game.stop();}
