import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetCapacity} from '../src/fleet-capacity.mjs';
test('legacy ships absent from the current template still consume command capacity',()=>{
  const result=fleetCapacity({designs:[{actual_count:6,target_quota:8,naval_size:20},{actual_count:1,target_quota:1,naval_size:10}]},{actual_naval_size:165,command_limit:170});
  assert.equal(result.untemplated_naval_size,35);assert.equal(result.projected_naval_size,205);assert.equal(result.fits_reinforcements,false);
  assert.equal(fleetCapacity({designs:[{actual_count:1,target_quota:5,naval_size:20}]},{actual_naval_size:20,command_limit:170}).fits_reinforcements,true);
  assert.equal(fleetCapacity({},undefined).known,false);
});
