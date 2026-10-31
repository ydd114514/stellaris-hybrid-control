import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {readAudienceGuidance} from '../src/audience-guidance.mjs';

test('public AI handoff is bounded, fresh, allowlisted and never a game command',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cyberfish-guidance-'));const file=join(dir,'audience-guidance.json');
  try{
    assert.equal((await readAudienceGuidance(dir,10000)).status,'disconnected');
    const state={version:1,source:'cyberfish-ai-hub',updatedAt:10000,status:'ready',summary:'先探索周边',keys:'must-not-be-public',notes:['private'],items:[{id:'s1',name:'观众',text:'补一艘科研船',status:'adopted',reply:'资源足够后考虑',command:'must-not-execute'}]};
    await writeFile(file,JSON.stringify(state));const result=await readAudienceGuidance(dir,12000);assert.equal(result.items[0].status,'adopted');assert.equal(result.items[0].reply,state.items[0].reply);assert.ok(!JSON.stringify(result).includes('must-not'));assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal((await readAudienceGuidance(dir,30000)).status,'disconnected');
    await writeFile(file,JSON.stringify({...state,status:'stopped'}));assert.equal((await readAudienceGuidance(dir,30000)).status,'stopped');
    await writeFile(file,JSON.stringify({...state,source:'unexpected'}));assert.equal((await readAudienceGuidance(dir,12000)).status,'disconnected');
    await writeFile(file,'x'.repeat(65537));assert.equal((await readAudienceGuidance(dir,12000)).status,'disconnected');
  }finally{const resolved=await realpath(dir);if(dirname(resolved)!==await realpath(tmpdir())||!basename(resolved).startsWith('cyberfish-guidance-'))throw new Error('Unexpected fixture directory');await rm(resolved,{recursive:true,force:true});}
});
