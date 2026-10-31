import {spawnSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';import {inspectNativeProcess} from '../src/native-process.mjs';
const planetId=Number(process.argv[2]);if(!Number.isSafeInteger(planetId)||planetId<0||planetId>=0xffffffff)throw Error('需要完整己方planet_id');
const identity=await inspectNativeProcess({op:'identity'}),pipe=new NativePipe();
const report={at:Date.now(),identity,planetId,readOnly:true,commandsIssued:0,candidateRuntimeValidated:false,worldLineageVerified:false};
try{
 const status=await pipe.request('get_status'),world=await pipe.request('get_galaxy_overview'),planet=await pipe.request('get_planet_details',{planet_id:planetId});
 if(status.is_paused!==true||!Number.isSafeInteger(world.player?.country_id)||planet.planet_id!==planetId||!Number.isSafeInteger(planet.colony_id))throw Error('需要已暂停的当前玩家殖民地');
 const r=spawnSync('C:/Program Files/Python315/python.exe',['scripts/probe-colony-automation-readonly.py','--pid',String(identity.pid),'--colony-id',String(planet.colony_id),'--planet-id',String(planetId),'--country-id',String(world.player.country_id),...(process.argv.includes('--settings')?['--settings']:[])],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});
 if(r.status!==0)throw Error('只读归属核对失败；未读取为已关闭状态');report.relative=JSON.parse(r.stdout);
 const after=await pipe.request('get_status'),current=await pipe.request('get_galaxy_overview'),again=await pipe.request('get_planet_details',{planet_id:planetId});
 if(after.is_paused!==true||after.date?.formatted!==status.date?.formatted||current.player.country_id!==world.player.country_id||current.player.capital_system_id!==world.player.capital_system_id||again.colony_id!==planet.colony_id)throw Error('只读核对期间会话或对象发生变化');
 report.date=after.date?.formatted;report.paused=true;report.localPlayerRelationshipVerified=report.relative.relationship?.ownershipRelationshipVerified===true;report.enabledByte=report.relative.observedEnabledByte;report.categoryMembership=report.relative.categoryMembership;
 report.limitations='Bounded external memory reads corroborated with before/after native player queries; not an atomic game-thread snapshot, budget proof, candidate DLL runtime test or enable/disable acceptance.';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{pipe.close();const file=resolve(`.local/hybrid-control/colony-layout-inventory/owned-colony-${report.at}.json`);await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,date:report.date,paused:report.paused,localPlayerRelationshipVerified:report.localPlayerRelationshipVerified,enabledByte:report.enabledByte,categoryMembership:report.categoryMembership,error:report.error,candidateRuntimeValidated:false}));}
