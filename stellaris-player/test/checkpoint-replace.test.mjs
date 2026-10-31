import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {replaceCheckpoint} from '../src/checkpoint-replace.mjs';
test('sharing failures retain the old complete checkpoint until replacement succeeds',async t=>{
 const d=await mkdtemp(join(tmpdir(),'checkpoint-replace-'));t.after(()=>rm(d,{recursive:true,force:true}));
 const old=join(d,'state.json'),next=join(d,'state.tmp');await writeFile(old,'{"version":1}');await writeFile(next,'{"version":2}');
 let attempts=0;const waits=[];
 await replaceCheckpoint(next,old,{renameFile:async(a,b)=>{
  assert.deepEqual(JSON.parse(await readFile(old,'utf8')),{version:1});
  if(attempts++<3)throw Object.assign(new Error('sharing conflict'),{code:['EPERM','EACCES','EBUSY'][attempts-1]});
  await rename(a,b);
 },wait:async ms=>waits.push(ms)});
 assert.deepEqual(JSON.parse(await readFile(old,'utf8')),{version:2});assert.equal(attempts,4);assert.deepEqual(waits,[25,50,100]);
});
test('persistent sharing failure is bounded and remains an error',async()=>{
 let attempts=0,totalDelay=0;const failure=Object.assign(new Error('locked'),{code:'EPERM'});
 await assert.rejects(replaceCheckpoint('next','current',{renameFile:async()=>{attempts++;throw failure;},wait:async ms=>{totalDelay+=ms;}}),e=>e===failure);
 assert.equal(attempts,6);assert.equal(totalDelay,775);
});
test('missing temporary file or unexpected filesystem failures are never retried',async()=>{
 for(const code of ['ENOENT','ENOSPC','EIO']){
  let attempts=0;await assert.rejects(replaceCheckpoint('next','current',{renameFile:async()=>{attempts++;throw Object.assign(new Error(code),{code});},wait:async()=>assert.fail('unexpected retry')}),{code});assert.equal(attempts,1);
 }
});
