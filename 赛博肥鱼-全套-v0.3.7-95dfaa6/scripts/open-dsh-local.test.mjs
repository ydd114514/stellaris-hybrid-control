import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';import {localLaunchPlan,runLocalLauncher} from './open-dsh-local.mjs';
test('source launch names exact electron/main/controller paths and rollback never silently replaces it',()=>{
 const plan=localLaunchPlan({root:'fixture with spaces',exists:()=>true,speech:true});assert.equal(plan.mode,'local-source');assert.equal(plan.environment.CYBERFISH_LOCAL_SOURCE,'1');assert.equal(plan.args.length,2);assert.equal(plan.args[1],'--speech');assert.ok(plan.controller.endsWith('stellaris-player'));
 const old=localLaunchPlan({root:'fixture',localAppData:resolve('old profile'),exists:()=>true,rollback:true});assert.equal(old.mode,'rollback-0.3.16');assert.deepEqual(old.args,[]);assert.deepEqual(old.environment,{});assert.equal(old.controller,null);
 assert.equal(localLaunchPlan({root:'missing',exists:()=>false}).ok,false);
});
test('check mode never spawns or prints inherited secrets and ambiguous flags fail before launch',async()=>{
 let spawns=0;const output=[];const root=resolve(import.meta.dirname,'..');const options={root,spawnProcess:()=>{spawns++;throw Error('must not launch');},output:s=>output.push(s),env:{LOCALAPPDATA:'fixture',DEEPSEEK_API_KEY:'private-test-key'}};
 await runLocalLauncher(['--check'],options);assert.equal(spawns,0);assert.equal(output.length,1);assert.equal(output.join('').includes('private-test-key'),false);assert.equal(JSON.parse(output[0]).launched,false);
 await assert.rejects(runLocalLauncher(['--check','--launch'],options));await assert.rejects(runLocalLauncher(['--arbitrary'],options));assert.equal(spawns,0);
});
test('first user launch allows the GUI to show, removes electron node mode and retains test isolation',async()=>{
 let called;const fake=Object.assign(new EventEmitter(),{unref(){}});
 await runLocalLauncher(['--launch','--speech'],{root:resolve(import.meta.dirname,'..'),env:{ELECTRON_RUN_AS_NODE:'1',VITE_DEV_SERVER_URL:'http://invalid',CYBER_FISH_TEST_DATA_DIR:'isolated'},spawnProcess:(exe,args,options)=>{called={exe,args,options};queueMicrotask(()=>fake.emit('spawn'));return fake;}});
 assert.equal(called.options.shell,undefined);assert.equal(called.options.windowsHide,false);assert.equal(called.options.detached,true);assert.equal(called.options.stdio,'ignore');assert.equal(called.options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(called.options.env.VITE_DEV_SERVER_URL,undefined);assert.equal(called.options.env.CYBER_FISH_TEST_DATA_DIR,'isolated');assert.equal(called.options.env.CYBERFISH_LOCAL_SOURCE,'1');assert.equal(called.args.at(-1),'--speech');
});
