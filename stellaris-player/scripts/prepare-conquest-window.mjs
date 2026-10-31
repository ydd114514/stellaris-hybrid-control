// Operator-only fixture under the user's explicit current-save parameter-setup authorization.
// No loading, launching, desktop input, resource/fleet edits or war/result commands.
import assert from 'node:assert/strict';
import {mkdir,readdir,stat,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {NativePipe} from '../src/native-pipe.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
const expectedDate=process.argv[2];assert.match(expectedDate||'',/^\d{4}\.\d{2}\.\d{2}$/,'需要显式当前日期');
const started=Date.now(),directory=resolve('.local','conquest-window-'+started),world='C:/Users/YDD/Documents/Paradox Interactive/Stellaris/save games/4_-1439839595';
await mkdir(directory,{recursive:true});const p=new NativePipe({timeoutMs:20000});
const report={startedAt:new Date().toISOString(),authorization:'user explicitly permits controller preparation of necessary current-save test conditions',fixture:true,modelCalls:0,automaticLoads:0,automaticRestarts:0,steps:[]};
const call=async(method,params={})=>{const result=await p.request(method,params);report.steps.push({method,params,result});return result;};
let binding;
async function scope(){const actual=await inspectNativeProcess({op:'bound_identity',pid:binding.pid,creationTime:binding.creationTime});assert.equal(actual.pid,binding.pid);assert.equal(actual.creationTime,binding.creationTime);const status=await call('get_status'),overview=await call('get_galaxy_overview');assert.equal(status.is_paused,true);assert.equal(status.date.formatted,expectedDate);assert.equal(overview.player.country_id,0);assert.equal(overview.player.capital_system_id,1);return status;}
async function consoleLine(command){await scope();const result=await call('run_console',{command});assert.equal(result.ok,true,result.error||'console refused');}
try{
 binding=await inspectNativeProcess({op:'identity'});report.binding=binding;const before=await scope();
 const wars=await call('get_wars');assert.deepEqual(wars.wars,[]);
 const contacts=await call('get_contacts',{mode:'empires'}),foreign=contacts.empires.filter(c=>c.country_type==='default'&&c.has_communications===true&&c.country_id!==0);assert.equal(foreign.length,1);assert.equal(foreign[0].country_id,1);
 report.beforeOptions=await call('get_attack_options',{country_id:1});assert.ok(report.beforeOptions.options.some(x=>x.goal_key==='wg_conquest'&&x.legal===false&&x.reason.includes('停战')),'只处理已经明确确认的停战阻点');
 let backup;
 if(process.argv.includes('--use-existing-autosave-backup')){
  const source=join(world,'autosave_2217.07.01.sav');const info=await stat(source);assert.ok(info.isFile()&&info.size>10000);
  backup=join(directory,'before-truce-autosave_2217.07.01.sav');await copyFile(source,backup);report.backupSource=source;report.backupIsCurrentDate=false;
 }else{
  const name='cyberfish_conquest_pre_truce_'+expectedDate.replaceAll('.','_')+'_'+started;
  await consoleLine('save '+name);
  for(let attempt=0;attempt<20&&!backup;attempt++){
   await delay(500);
   for(const file of await readdir(world)){if(!file.startsWith(name)||!file.endsWith('.sav'))continue;const path=join(world,file),info=await stat(path);if(info.isFile()&&info.size>10000&&info.mtimeMs>=started-1000){backup=path;break;}}
  }
  assert.ok(backup,'未确认新备份，不修改停战');report.backupIsCurrentDate=true;
 }
 const verify=spawnSync('C:/Program Files/Python315/python.exe',['-c',`import sys,json,hashlib;from zipfile import ZipFile;from pathlib import Path;p=Path(sys.argv[1]);z=ZipFile(p);m=z.read('meta').decode('utf-8-sig');d=next(x for x in m.splitlines() if x.startswith('date=')).split(chr(34))[1];print(json.dumps({'date':d,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))`,backup],{windowsHide:true,encoding:'utf8'});
 assert.equal(verify.status,0,verify.stderr);report.backup={path:backup,...JSON.parse(verify.stdout)};assert.equal(report.backup.date,report.backupIsCurrentDate?expectedDate:'2217.07.01');
 // Only one foreign default empire has communications, verified above. This is
 // the game's own end_truce effect used by agenda_second_strike; no war is sent.
 await consoleLine('effect every_country = { limit = { is_country_type = default has_communications = root NOT = { is_same_value = root } } end_truce = root }');
 report.afterOptions=await call('get_attack_options',{country_id:1});assert.equal(report.afterOptions.options.find(x=>x.goal_key==='wg_conquest')?.legal,true,'引擎未确认解除阻点；不要重放或宣战');
 const after=await scope();for(const key of ['energy','minerals','alloys','influence','food','consumer_goods','trade'])assert.equal(after.resources[key].stockpile,before.resources[key].stockpile,'准备过程不应改变库存 '+key);
 assert.deepEqual((await call('get_wars')).wars,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{p.close();report.finishedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:join(directory,'report.json'),passed:report.passed===true,backup:report.backup?.path,error:report.error}));}
