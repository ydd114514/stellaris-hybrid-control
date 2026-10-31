// Deterministic guard verification in the same world; does not build a ship.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {NativeGame} from '../src/native-game.mjs';
const game=new NativeGame({minutes:3}),report={at:new Date().toISOString(),kind:'developer guard probe, not DeepSeek endurance'};
try {
  await game.start();await game.rpc('set_paused',{paused:true});
  report.before=await game.observe();assert.equal(report.before.wars.length,0);
  const naval=report.before.capacities.naval_capacity;assert.ok(naval.used>=naval.capacity,'Budget probe only runs when already over capacity');
  const ships=await game.inspect({topic:'ships',system_id:0});report.policy=ships.military_expansion_policy;report.queueBefore=ships.queue;
  const design=ships.buildable.find(x=>['corvette','destroyer','cruiser'].includes(x.ship_size));assert.ok(design,'Need a genuinely buildable military design');
  report.rejected=await game.apply({requestId:'smoke-positive-overcapacity',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{system_id:0,design_id:design.design_id,count:1}}]});
  assert.equal(report.rejected.orders[0].status,'rejected');assert.match(report.rejected.orders[0].error,/海军已占用/);
  report.queueAfter=(await game.inspect({topic:'ships',system_id:0})).queue;
  assert.deepEqual(report.queueAfter,report.queueBefore,'Rejected order must not add to the real queue');
  report.frame=await game.rpc('capture_game_frame');assert.equal(report.frame.success,true);
  await writeFile('.local/native-bridge/budget-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({naval,alloys:report.before.resources.alloys,rejected:report.rejected.orders,queueUnchanged:true,frame:report.frame}));
}finally{await game.stop();}
