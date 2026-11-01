import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess, spawn } from 'node:child_process'
import { createStellarisController } from '../apps/desktop/electron/stellaris-controller'

const directories: string[] = []
const managers: ReturnType<typeof createStellarisController>[] = []
afterEach(async () => { for (const manager of managers.splice(0)) await manager.dispose(); for (const directory of directories.splice(0)) { const path = await realpath(directory); if (dirname(path) !== await realpath(tmpdir()) || !basename(path).startsWith('cyberfish-dsh-')) throw new Error('Unexpected fixture directory'); await rm(path, { recursive: true, force: true }) } })
async function fixture(now?:()=>number,onStopSleep?:(root:string)=>Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'cyberfish-dsh-')); directories.push(directory)
  const root = join(directory, 'stellaris-player'), data = join(directory, 'desktop')
  const enginePackagePath = join(directory, 'offline-dsh/package.json')
  await mkdir(join(directory, 'offline-dsh/lib'), { recursive: true })
  await writeFile(enginePackagePath, JSON.stringify({ name: '@deepseek-ai/dsh', version: 'offline-fixture' }))
  await writeFile(join(directory, 'offline-dsh/lib/bin.js'), '// fixture metadata only; never run')
  await mkdir(join(root, 'scripts'), { recursive: true }); await mkdir(join(root, '.local/native-bridge/dsh'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'deepseek-stellaris-player' }))
  for (const name of ['autoplay-native.mjs', 'desktop-preflight.mjs']) await writeFile(join(root, 'scripts', name), '// offline fixture only')
  const living = new Set<number>(), preflight = vi.fn(async () => ({ ok: true })), children: EventEmitter[] = []
  const launch = vi.fn(() => { const child = Object.assign(new EventEmitter(), { pid: 1234 }); children.push(child); living.add(1234); queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess }) as unknown as typeof spawn
  const manager = createStellarisController({ dataDirectory: data, candidates: [root], enginePackagePath, platform: 'win32', nodePath: process.execPath, isAlive: pid => living.has(pid), preflight, launch,
    sleep: async () => { await onStopSleep?.(root); living.clear(); children[0]?.emit('exit', 0) },now })
  managers.push(manager)
  return { root, data, manager, living, preflight, launch, children, enginePackagePath }
}
describe('manual desktop DSH lifecycle, entirely offline', () => {
  it('shows a current startup schema failure without exposing raw model errors or stale failures',async()=>{
    const f=await fixture();
    await writeFile(join(f.root,'.local/desktop-controller.json'),JSON.stringify({pid:1234,started:1000,source:'cyberfish-desktop',stoppedAt:1100}));
    const path=join(f.root,'.local/native-bridge/startup-error.json');
    await writeFile(path,JSON.stringify({started:1000,message:'private raw model error'}));
    const status=await f.manager.getStatus();expect(status.phase).toBe('error');expect(status.message).toContain('参数定义');expect(status.message).not.toContain('private');
    await writeFile(path,JSON.stringify({started:999,message:'old error'}));
    expect((await f.manager.getStatus()).phase).toBe('stopped');
  });
  it('publishes only survey counts and stops presenting dead actors as working', async () => {
    const f=await fixture(()=>1000);f.living.add(1234)
    await writeFile(join(f.root,'.local/native-bridge/controller.lock'),JSON.stringify({pid:1234}))
    const cp={sessionId:'s',stopped:false,runtimeStatus:{sessionId:'s',observedAt:900,date:'2200.02.01',paused:false},state:{date:'2200.01.01',paused:true,surveyControl:{records:{0:{fleetId:0,sessionId:'s',owner:'native',observedAt:900,secret:'private',observation:{orders:[{automation:false}]}}}}}}
    await writeFile(join(f.root,'.local/native-bridge/latest-session.json'),JSON.stringify(cp))
    const status=await f.manager.getStatus()
    expect(status.snapshot?.survey).toEqual({assigned:1,working:1,uncertain:0})
    expect(status.snapshot?.date).toBe('2200.02.01')
    expect(JSON.stringify(status)).not.toContain('private');expect(JSON.stringify(status)).not.toContain('fleetId')
    f.living.clear()
    expect((await f.manager.getStatus()).snapshot?.survey).toEqual({assigned:0,working:0,uncertain:1})
  })
  it('opening and repeated status checks never start, probe or rewrite STOP', async () => {
    const f = await fixture(); const marker = join(f.root, '.local/STOP'); await writeFile(marker, 'user_stop: keep stopped')
    for (let n = 0; n < 4; n++) expect((await f.manager.getStatus()).phase).toBe('stopped')
    await f.manager.dispose()
    expect(f.preflight).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled(); expect(await readFile(marker, 'utf8')).toBe('user_stop: keep stopped')
  })
  it('a missing manually opened game never spawns autoplay', async () => {
    const f = await fixture(); f.preflight.mockResolvedValue({ ok: false, message: '请先手动打开群星。' })
    expect((await f.manager.start()).ok).toBe(false); expect(f.launch).not.toHaveBeenCalled(); expect((await f.manager.getStatus()).phase).toBe('stopped')
  })
  it('explicit start is single-instance, uses a fixed script, and cannot launch/restart a game', async () => {
    const f = await fixture(); const first = f.manager.start(), second = f.manager.start()
    await first; await second
    expect(f.launch).toHaveBeenCalledTimes(1)
    const [node, args, options] = vi.mocked(f.launch).mock.calls[0]
    expect(node).toBe(process.execPath); expect(args).toEqual([join(f.root, 'scripts/autoplay-native.mjs')])
    expect(options?.cwd).toBe(f.root); expect(options?.shell).toBeUndefined(); expect(options?.windowsHide).toBe(true)
    expect(options?.env?.CYBERFISH_REQUIRE_RUNNING_GAME).toBe('1'); expect(options?.env?.CYBERFISH_STOP_BASELINE).toMatch(/^\d+$/); expect(options?.env?.DEEPSEEK_API_KEY).toBeUndefined()
    expect(options?.env?.CYBERFISH_MONTHLY_LIFECYCLE_PILOT).toBe('1')
    expect(options?.env?.CYBERFISH_COLONY_UPGRADE_PILOT).toBe('1'); expect(options?.env?.CYBERFISH_LOCAL_WAIT_PILOT).toBe('1')
    expect((await f.manager.getStatus()).phase).toBe('starting')
    expect((await f.manager.getStatus()).engine?.name).toBe('@deepseek-ai/dsh')
  })
  it('stop writes a fresh user stop and waits for actors to exit without claiming a fake pause', async () => {
    const f = await fixture(); await f.manager.start(); const stopped = await f.manager.stop()
    expect(stopped.ok).toBe(true); expect(stopped.status.phase).toBe('stopped'); expect(stopped.status.canStart).toBe(true)
    expect(await readFile(join(f.root, '.local/STOP'), 'utf8')).toMatch(/^user_stop: desktop /); expect(stopped.message).not.toContain('游戏已暂停')
    expect(f.launch).toHaveBeenCalledTimes(1)
  })
  it('external actor is observed and blocks another start; stale stopped PIDs do not count', async () => {
    const f = await fixture(); f.living.add(1234)
    await writeFile(join(f.root, '.local/native-bridge/controller.lock'), JSON.stringify({ pid: 1234 }))
    await writeFile(join(f.root, '.local/native-bridge/latest-session.json'), JSON.stringify({ stopped: false }))
    expect((await f.manager.getStatus()).phase).toBe('running'); expect((await f.manager.start()).ok).toBe(false); expect(f.launch).not.toHaveBeenCalled()
    await writeFile(join(f.root, '.local/native-bridge/latest-session.json'), JSON.stringify({ stopped: true }))
    await writeFile(join(f.root, '.local/native-bridge/dsh/current.json'), JSON.stringify({ pid: 1234 }))
    expect((await f.manager.getStatus()).phase).toBe('stopped')
  })
  it('only fresh live preflight means waiting, and public snapshots exclude private data', async () => {
    const f = await fixture(); f.living.add(1234)
    await writeFile(join(f.root, '.local/native-bridge/preflight.json'), JSON.stringify({ pid: 1234, at: Date.now(), stage: 'waiting_for_picture' }))
    await writeFile(join(f.root, '.local/native-bridge/latest-session.json'), JSON.stringify({ stopped: true, metrics: { orders: 8, verified: 5 }, state: { date: '2300.01.01', capacities: { colonies: 2 }, military: { fleets: [{ total_ships: 10 }] }, resources: { alloys: { net: 12 } }, operatorMessages: ['private-data-do-not-expose'] } }))
    const state = await f.manager.getStatus(); expect(state.phase).toBe('waiting'); expect(state.snapshot?.ships).toBe(10); expect(JSON.stringify(state)).not.toContain('private-data')
    await writeFile(join(f.root, '.local/native-bridge/preflight.json'), JSON.stringify({ pid: 1234, at: 1, stage: 'waiting_for_picture' }))
    expect((await f.manager.getStatus()).phase).toBe('stopped')
  })
  it('status only reads same-session fresh OBS metrics and allowlisted asynchronous progress',async()=>{
    const now=1000000,f=await fixture(()=>now),base=join(f.root,'.local/native-bridge')
    await writeFile(join(base,'latest-session.json'),JSON.stringify({sessionId:'session-a',stopped:true,state:{date:'2324.05.01',orderTracking:{counts:{submitted:2,queued:1,completed:3,failed:-1,private:'secret-value'},recent:[{id:'order-1',command:'build_building',status:'queued',updatedAt:now,reason:'已看到队列，尚未完工',arguments:{secret:'private-order-args'},proof:{private:'private-proof'}},{id:'order-2',command:'shell',status:'completed',reason:'private-command'}]}}}))
    await writeFile(join(base,'quality-latest.json'),JSON.stringify({version:1,sessionId:'session-a',at:now-1000,obs:{status:'observed',source:'local_obs',stats:{activeFps:59.9,renderSkippedFrames:0,renderTotalFrames:100,outputSkippedFrames:1,outputTotalFrames:100,secret:'private-stats'},stream:{active:true,reconnecting:false,outputBytes:5000,url:'private-url',password:'private-password'},record:{active:false},audioIsolation:'passed',viewerLatency:0,streamKey:'private-key'}}))
    const status=await f.manager.getStatus()
    expect(status.snapshot?.orderTracking).toMatchObject({counts:{submitted:2,queued:1,completed:3,executing:0},recent:[{id:'order-1',command:'build_building',status:'queued',reason:'已看到队列，尚未完工'}]})
    expect(status.snapshot?.orderTracking?.counts.failed).toBeUndefined()
    expect(status.snapshot?.quality).toMatchObject({status:'observed',source:'local_obs',stats:{activeFps:59.9,renderSkippedFrames:0},stream:{active:true},record:{active:false},audioIsolation:'not_measured',viewerLatency:'not_measured'})
    expect(JSON.stringify(status)).not.toContain('private-');expect(status.phase).toBe('stopped')
    expect(f.preflight).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled()
  })
  it('cross-session, old and malformed quality samples stay unknown rather than zero loss',async()=>{
    const now=1000000,f=await fixture(()=>now),base=join(f.root,'.local/native-bridge')
    await writeFile(join(base,'latest-session.json'),JSON.stringify({sessionId:'session-a',stopped:true,state:{date:'2324.05.01'}}))
    const obs={status:'observed',source:'local_obs',stats:{activeFps:60,renderSkippedFrames:0},stream:{active:true},record:{active:false}}
    for(const [value,reason] of [[{version:1,sessionId:'old-session',at:now,obs},'cross_session'],[{version:1,sessionId:'session-a',at:now-30001,obs},'stale'],[{version:1,sessionId:'session-a',at:now+5001,obs},'stale'],[{version:1,sessionId:'session-a',at:now,obs:{...obs,stream:undefined}},'invalid_response']] as const){
      await writeFile(join(base,'quality-latest.json'),JSON.stringify(value));const q=(await f.manager.getStatus()).snapshot?.quality
      expect(q).toMatchObject({status:'unknown',reason,audioIsolation:'not_measured',viewerLatency:'not_measured'});expect(q?.stats).toBeUndefined()
    }
  })
  it('isolated test mode never touches real candidates or launches even via direct calls', async () => {
    const launch = vi.fn(), preflight = vi.fn()
    const manager = createStellarisController({ dataDirectory: 'unused', candidates: ['do-not-read'], disabled: true, launch, preflight })
    expect((await manager.getStatus()).localTest).toBe(true); expect((await manager.start()).ok).toBe(false); expect((await manager.stop()).ok).toBe(false); await manager.dispose()
    expect(launch).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled()
  })
  it('quitting during preflight cancels the late callback and never creates an orphan', async () => {
    const f = await fixture(); let finish!: (value: { ok: boolean }) => void
    f.preflight.mockImplementation(() => new Promise(done => { finish = done }))
    const pending = f.manager.start(); await vi.waitFor(() => expect(f.preflight).toHaveBeenCalledOnce())
    await f.manager.dispose(); finish({ ok: true }); expect((await pending).ok).toBe(false); expect(f.launch).not.toHaveBeenCalled()
  })
  it('a real offline child reports progress and stops cooperatively without launching a game', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'scripts/autoplay-native.mjs'), `
      import {readFile,writeFile} from 'node:fs/promises';
      const baseline=Number(process.env.CYBERFISH_STOP_BASELINE);let step=0;
      const tick=async()=>{let stopped=false;try{stopped=(await readFile('.local/STOP','utf8')).startsWith('user_stop: desktop');}catch{}
        await writeFile('.local/native-bridge/latest-session.json',JSON.stringify({started:baseline,stopped,metrics:{orders:++step,verified:step},state:{date:'2200.01.02',capacities:{colonies:1},military:{fleets:[]}}}));
        if(stopped){clearInterval(timer);process.exit(0);}};
      const timer=setInterval(()=>void tick(),100);await tick();
    `)
    const manager = createStellarisController({ dataDirectory: f.data, candidates: [f.root], enginePackagePath: f.enginePackagePath, platform: 'win32', nodePath: process.execPath, preflight: async () => ({ ok: true }) })
    managers.push(manager)
    expect((await manager.start()).ok).toBe(true)
    await vi.waitFor(async () => expect((await manager.getStatus()).snapshot?.date).toBe('2200.01.02'))
    expect((await manager.stop()).status.phase).toBe('stopped')
    expect(JSON.parse(await readFile(join(f.root, '.local/native-bridge/latest-session.json'), 'utf8')).stopped).toBe(true)
  }, 15000)
})

it('explicit local source wins over a valid saved older controller without rewriting user configuration',async()=>{
 const f=await fixture(),preferred=join(dirname(f.root),'local-current')
 await mkdir(join(preferred,'scripts'),{recursive:true});await mkdir(f.data,{recursive:true})
 await writeFile(join(preferred,'package.json'),JSON.stringify({name:'deepseek-stellaris-player'}))
 for(const name of ['autoplay-native.mjs','desktop-preflight.mjs'])await writeFile(join(preferred,'scripts',name),'// fixture')
 const config=JSON.stringify({projectDirectory:f.root});await writeFile(join(f.data,'stellaris-controller.json'),config)
 const manager=createStellarisController({dataDirectory:f.data,preferredProject:preferred,candidates:[f.root],enginePackagePath:f.enginePackagePath,platform:'win32',nodePath:process.execPath})
 managers.push(manager)
 expect((await manager.getStatus()).projectDirectory).toBe(preferred)
 expect(await readFile(join(f.data,'stellaris-controller.json'),'utf8')).toBe(config)
})

describe('P0 hybrid survey configuration and handoff',()=>{
 it('saves mode without launching and explicitly delivers it to the existing launcher',async()=>{
  const f=await fixture();expect((await f.manager.getStatus()).hybrid?.surveyEnabled).toBe(false);
  const enabled=await f.manager.setHybridSurvey(true);expect(enabled.ok).toBe(true);expect(enabled.status.hybrid?.surveyEnabled).toBe(true);expect(f.launch).not.toHaveBeenCalled();expect(f.preflight).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(join(f.root,'.local/hybrid-control/settings.json'),'utf8'))).toEqual({version:1,survey:true});
  expect((await f.manager.start()).ok).toBe(true);expect(vi.mocked(f.launch).mock.calls[0][2]?.env?.CYBERFISH_HYBRID_SURVEY).toBe('1');
  expect((await f.manager.setHybridSurvey(false)).ok).toBe(false);
  await f.manager.stop();expect((await f.manager.setHybridSurvey(false)).ok).toBe(true);
 });
 it('damaged configuration blocks starting and can be repaired without touching the game',async()=>{
  const f=await fixture();await mkdir(join(f.root,'.local/hybrid-control'),{recursive:true});await writeFile(join(f.root,'.local/hybrid-control/settings.json'),'broken');
  expect((await f.manager.getStatus()).canStart).toBe(false);expect((await f.manager.setHybridSurvey('1' as any)).ok).toBe(false);
  expect((await f.manager.setHybridSurvey(false)).ok).toBe(true);expect((await f.manager.getStatus()).canStart).toBe(true);expect(f.launch).not.toHaveBeenCalled();
 });
 it('only a stopped checkpoint from the active session confirms pause and survey handoff',async()=>{
  const cp={sessionId:'current',started:Date.now(),stopped:false,cleanup:{bindingConfirmed:true,pauseConfirmed:true,survey:[],monthlyTrade:{confirmed:true,recovered:{confirmed:true}}}};
  const f=await fixture(undefined,async root=>{await writeFile(join(root,'.local/native-bridge/latest-session.json'),JSON.stringify({...cp,stopped:true}));});
  await f.manager.start();await writeFile(join(f.root,'.local/native-bridge/latest-session.json'),JSON.stringify(cp));
  const r=await f.manager.stop();expect(r.message).toContain('已确认暂停并收回调查');
 });
});
it('unknown final binding or pause state cannot be masked by older positive cleanup flags',async()=>{
 for(const unknown of [{bindingConfirmed:false},{pauseStateUnknown:true}]){
  const cp={sessionId:'current',started:Date.now(),stopped:false,cleanup:{pauseConfirmed:true,paused:true,survey:[],...unknown}};
  const f=await fixture(undefined,async root=>{await writeFile(join(root,'.local/native-bridge/latest-session.json'),JSON.stringify({...cp,stopped:true}));});
  await f.manager.start();await writeFile(join(f.root,'.local/native-bridge/latest-session.json'),JSON.stringify(cp));
  const r=await f.manager.stop();expect(r.message).toContain('尚未确认');expect(r.message).not.toContain('已确认暂停并收回调查');
 }
});

it('missing trade/binding evidence and contradictory cleanup never display a confirmed handoff',async()=>{
 for(const change of [(c:any)=>delete c.bindingConfirmed,(c:any)=>delete c.monthlyTrade,(c:any)=>c.monthlyTrade={},(c:any)=>delete c.monthlyTrade.recovered,(c:any)=>c.monthlyTrade.confirmed=false,(c:any)=>c.monthlyTrade.recovered.confirmed=false,(c:any)=>c.surveyStatus='unknown',(c:any)=>{c.surveyStatus='confirmed';c.survey=[{confirmed:false}]},(c:any)=>c.survey=[null],(c:any)=>c.paused=false,(c:any)=>{c.pauseConfirmed=false;c.paused=true},(c:any)=>c.error='最终核对失败']){
  const cleanup:any={bindingConfirmed:true,pauseConfirmed:true,paused:true,survey:[],monthlyTrade:{confirmed:true,recovered:{confirmed:true}}};change(cleanup);
  const cp={sessionId:'current',started:Date.now(),stopped:false,cleanup};
  const f=await fixture(undefined,async root=>{await writeFile(join(root,'.local/native-bridge/latest-session.json'),JSON.stringify({...cp,stopped:true}));});
  await f.manager.start();await writeFile(join(f.root,'.local/native-bridge/latest-session.json'),JSON.stringify(cp));
  const r=await f.manager.stop();expect(r.message).toContain('尚未确认');expect(r.message).not.toContain('已确认暂停并收回调查');
 }
});

it('native country AI unknown or contradictory shutdown cannot be masked by paused trade and survey cleanup',async()=>{
 for(const countryAI of [undefined,{confirmed:false},{confirmed:true,owner:'native'},
  {confirmed:true,owner:'human',ordinaryOrdersBlocked:false,paused:true,nativePhase:'stopped',actualFlags:{human_ai:true,force_human_ai:false}}]){
  const cp={sessionId:'current',started:Date.now(),stopped:false,state:{countryAIControl:{enabled:true}},
   cleanup:{bindingConfirmed:true,pauseConfirmed:true,paused:true,survey:[],monthlyTrade:{confirmed:true,recovered:{confirmed:true}},countryAI}};
  const f=await fixture(undefined,async root=>{await writeFile(join(root,'.local/native-bridge/latest-session.json'),JSON.stringify({...cp,stopped:true}));});
  await f.manager.start();await writeFile(join(f.root,'.local/native-bridge/latest-session.json'),JSON.stringify(cp));
  const r=await f.manager.stop();expect(r.message).toContain('尚未确认');
 }
});
it('native country mode is saved without starting anything and is explicit in the real launcher environment',async()=>{
 const f=await fixture();const saved=await f.manager.setNativeCountryAI(true);
 expect(saved.ok).toBe(true);expect(saved.status.hybrid?.nativeCountryAIEnabled).toBe(true);expect(f.launch).not.toHaveBeenCalled();
 await f.manager.start();expect(f.launch.mock.calls[0][2]?.env?.CYBERFISH_NATIVE_COUNTRY_AI).toBe('1');
 expect((await f.manager.setNativeCountryAI(false)).ok).toBe(false);
});
