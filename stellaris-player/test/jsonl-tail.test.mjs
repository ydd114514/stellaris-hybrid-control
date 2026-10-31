import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonlTail} from '../src/jsonl-tail.mjs';
test('the first new audience message is read once, while default journal tails do not replay old speech',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyberfish-tail-'));
  try{
    const file=join(root,'events.jsonl'),audience=new JsonlTail({readInitial:true}),journal=new JsonlTail(),a=[],j=[];
    await assert.rejects(audience.read(file,x=>a.push(x)),{code:'ENOENT'});
    await writeFile(file,JSON.stringify({text:'第一条真实弹幕'})+'\n');
    await audience.read(file,x=>a.push(x));await journal.read(file,x=>j.push(x));
    assert.deepEqual(a,[{text:'第一条真实弹幕'}]);assert.deepEqual(j,[]);
    await audience.read(file,x=>a.push(x));assert.equal(a.length,1);
    const next=Buffer.from(JSON.stringify({text:'继续聊天'})+'\n');
    await appendFile(file,next.subarray(0,next.length-3));await audience.read(file,x=>a.push(x));assert.equal(a.length,1);
    await appendFile(file,next.subarray(next.length-3));await audience.read(file,x=>a.push(x));await journal.read(file,x=>j.push(x));
    assert.equal(a[1].text,'继续聊天');assert.equal(j[0].text,'继续聊天');
  }finally{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('cyberfish-tail-'));await rm(root,{recursive:true,force:true});}
});
