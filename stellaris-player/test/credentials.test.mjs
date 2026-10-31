import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { saveDeepSeekKey, loadDeepSeekKey, credentialStatus } from '../src/credentials.mjs'

test('DPAPI round trip uses isolated test data; ciphertext never contains the key', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(),'fish-key-test-')), path = join(directory,'key.dpapi')
  t.after(async()=>{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true})})
  const key='sk-offline_test_only_01234567890123456789'
  assert.deepEqual(credentialStatus({environment:{},path}),{stored:false,environment:false})
  await saveDeepSeekKey(key,{path})
  assert.equal((await readFile(path)).includes(Buffer.from(key)),false)
  assert.equal(await loadDeepSeekKey({environment:{},path}),key)
  assert.deepEqual(credentialStatus({environment:{},path}),{stored:true,environment:false})
  assert.equal(await loadDeepSeekKey({environment:{DEEPSEEK_API_KEY:'temporary-test-value'},path}),'temporary-test-value')
  await writeFile(path,'broken encrypted store')
  await assert.rejects(loadDeepSeekKey({environment:{},path}),/无法加密或解密/u)
})
test('invalid keys are rejected before accessing the credential store', async () => {
  await assert.rejects(saveDeepSeekKey('not-a-key',{path:'does-not-get-written'}),/格式不正确/u)
})
