import test from 'node:test';import assert from 'node:assert/strict';
import {nativeEconomicWitnesses} from '../src/native-country-ai-economic-evidence.mjs';
function workforce(){
 const base={tracking_id:1,instance_address:0x10000,domain:'workforce',payload_country_id:0,job_reference:0,colony_reference:0,desired_workforce_limit_raw:'2000000'};
 return [{...base,stage:'native_execute_entered',effect_readback:{known:true,job_reference:0,colony_reference:0,workforce_limit_raw:'500000',max_workforce_raw:'1000000'}},
  {...base,stage:'native_execute_returned',effect_readback:{known:true,job_reference:0,colony_reference:0,workforce_limit_raw:'1000000',max_workforce_raw:'1000000'}},
  {stage:'native_command_resolved',tracking_id:1}];
}
test('native workforce evidence uses exact handles, original clamp semantics and resolved lifetime',()=>{
 const rows=workforce();assert.equal(nativeEconomicWitnesses(rows,0)[0].afterRaw,'1000000');
 rows[1].effect_readback.workforce_limit_raw='999999';assert.equal(nativeEconomicWitnesses(rows,0).length,0);
 const zero=workforce();zero[1].desired_workforce_limit_raw='-9223372036854775808';zero[1].effect_readback.workforce_limit_raw='0';
 assert.equal(nativeEconomicWitnesses(zero,0)[0].afterRaw,'0');
});
test('missing readback, identity mismatch, no-op and unconfirmed copies never count as work',()=>{
 for(const change of [r=>r.pop(),r=>r[1].effect_readback.known=false,r=>r[1].effect_readback.job_reference=1,
  r=>r[1].payload_country_id=1,r=>r[1].effect_readback.colony_reference=1,
  r=>r[1].effect_readback.workforce_limit_raw='500000',r=>delete r[0].tracking_id,r=>r[1].desired_workforce_limit_raw=2000000]){
  const rows=workforce();change(rows);assert.equal(nativeEconomicWitnesses(rows,0).length,0);
 }
});
test('native designation needs the requested actual new key, own country and full colony identity',()=>{
 const base={tracking_id:2,instance_address:0x20000,domain:'colony_designation',payload_country_id:0,colony_reference:0,designation_key:'col_industrial'};
 const rows=[{...base,stage:'native_execute_entered',effect_readback:{known:true,colony_reference:0,designation_key:'col_default'}},
  {...base,stage:'native_execute_returned',effect_readback:{known:true,colony_reference:0,designation_key:'col_industrial'}},
  {stage:'native_command_resolved',tracking_id:2}];
 assert.equal(nativeEconomicWitnesses(rows,0)[0].afterKey,'col_industrial');
 rows[1].effect_readback.designation_key='col_other';assert.equal(nativeEconomicWitnesses(rows,0).length,0);
});
