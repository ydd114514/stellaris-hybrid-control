import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWindowsDriver } from '../src/driver.mjs'

const snapshot = { ok: true, id: 'frame-1', width: 1920, height: 1080, imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png', windowId: '101:44:77', window: { hwnd: '101', pid: 44, windowId: '101:44:77' } }
test('coordinates only use a fresh bound observation and cannot be reused', async () => {
  let at = 1000; const calls = []
  const driver = createWindowsDriver({ now: () => at, invoke: async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  const image = await driver.observe()
  await driver.execute({ type: 'click', x: 100, y: 200 }, { observationId: image.id })
  assert.deepEqual(calls[1].expectedWindow, snapshot.window)
  assert.equal(calls[1].expectedWidth, 1920)
  await assert.rejects(driver.execute({ type: 'click' }, { observationId: image.id }), /过期/u)
  const newer = await driver.observe(); at += 45001
  await assert.rejects(driver.execute({ type: 'click' }, { observationId: newer.id }), /过期/u)
  assert.equal(calls.filter(call => call.command === 'execute').length, 1)
})
test('raw pause key and unknown initial pause state cannot advance', async () => {
  const calls = [], driver = createWindowsDriver({ invoke: async command => { calls.push(command); return snapshot } })
  const image = await driver.observe()
  await assert.rejects(driver.execute({ type: 'key', key: 'space' }, { observationId: image.id }), /advance/u)
  await assert.rejects(driver.execute({ type: 'advance', seconds: 1 }, { observationId: image.id }), /手动暂停/u)
  assert.equal(calls.filter(call => call.command === 'execute').length, 0)
})
test('cancellation immediately after resume still sends the bounded pause cleanup', async () => {
  const cancellation = new AbortController(), calls = []
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    calls.push(command)
    if (command.command === 'observe') return snapshot
    if (calls.filter(call => call.command === 'execute').length === 1) cancellation.abort()
    return { ok: true }
  } })
  const image = await driver.observe()
  await assert.rejects(driver.execute({ type: 'advance', seconds: 1 }, { observationId: image.id, signal: cancellation.signal }), { name: 'AbortError' })
  assert.equal(calls.filter(call => call.command === 'execute').length, 2)
  assert.equal(driver.info().paused, true)
})
test('failed resume has unknown outcome; never blindly toggles pause again', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: true, invoke: async command => { calls.push(command); if (command.command === 'observe') return snapshot; throw new Error('timeout') } })
  const image = await driver.observe()
  await assert.rejects(driver.execute({ type: 'advance', seconds: 1 }, { observationId: image.id }), /未能确认继续/u)
  assert.equal(calls.filter(call => call.command === 'execute').length, 1)
  assert.equal(driver.info().paused, 'unknown'); assert.equal(driver.info().stopped, true)
})
test('stop during observation blocks a late image and releases inputs', async () => {
  let finish; const calls = []
  const driver = createWindowsDriver({ invoke: async command => { calls.push(command.command); if (command.command === 'observe') return new Promise(resolve => { finish = resolve }); return { ok: true } } })
  const pending = driver.observe(); await driver.stop(); finish(snapshot)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.deepEqual(calls, ['observe', 'release'])
})
test('identical pixels from separate captures retain distinct observation identities', async () => {
  const driver = createWindowsDriver({ assumePaused: true, invoke: async () => snapshot })
  const first = await driver.observe(), second = await driver.observe()
  assert.notEqual(first.id, second.id); assert.equal(first.imageHash, second.imageHash)
  assert.equal(second.paused, true)
})
test('cancellation never hides failure to restore pause after losing focus', async () => {
  const cancellation = new AbortController(); let spaces = 0
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    if (++spaces === 1) { cancellation.abort(); return { ok: true } }
    throw new Error('focus lost')
  } })
  const image = await driver.observe()
  await assert.rejects(driver.execute({ type: 'advance', seconds: 1 }, { observationId: image.id, signal: cancellation.signal }), /手动暂停/u)
  await driver.stop()
  assert.equal(driver.info().paused, 'unknown'); assert.equal(driver.info().stopped, true)
})
test('stop cancels its own advance delay and waits for the pause cleanup', async () => {
  let spaces = 0, resumeReady, finishPause
  const resumed = new Promise(resolve => { resumeReady = resolve })
  const pause = new Promise(resolve => { finishPause = resolve })
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    spaces++
    if (spaces === 1) resumeReady()
    else await pause
    return { ok: true }
  } })
  const image = await driver.observe()
  const action = driver.execute({ type: 'advance', seconds: 15 }, { observationId: image.id })
  await resumed
  let stopped = false
  const stopping = driver.stop().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  finishPause(); await assert.rejects(action, { name: 'AbortError' }); await stopping
  assert.equal(driver.info().paused, true); assert.equal(spaces, 2)
})
test('clearing a consumed observation never rebinds the session to another game window', async () => {
  let captures = 0; const calls = []
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    calls.push(command)
    if (command.command !== 'observe') return { ok: true }
    return ++captures === 1 ? snapshot : { ...snapshot, windowId: '202:55:88', window: { ...snapshot.window, windowId: '202:55:88' } }
  } })
  const image = await driver.observe()
  await driver.execute({ type: 'wait', seconds: 0.2 }, { observationId: image.id })
  await assert.rejects(driver.observe(), /另一局/u)
  assert.equal(calls.at(-1).windowId, snapshot.windowId)
})
test('explicit startup focus happens once and immediately binds the verified game identity', async () => {
  const calls=[],driver=createWindowsDriver({gamePath:'D:/Stellaris/stellaris.exe',focusOnStart:true,invoke:async command=>{calls.push(command);return snapshot}})
  await driver.observe();await driver.observe()
  assert.deepEqual(calls.map(row=>row.command),['focus','observe','observe'])
  assert.equal(calls[1].windowId,snapshot.windowId)
  assert.equal(calls[0].gamePath,'D:/Stellaris/stellaris.exe')
})
test('stop rechecks observed HUD pause so an event pause is never blindly toggled to running',async()=>{
  const calls=[];let pausedRead=true
  const driver=createWindowsDriver({assumePaused:true,readHud:async()=>({paused:pausedRead}),invoke:async command=>{calls.push(command);return command.command==='observe'?snapshot:{ok:true}}})
  const image=await driver.observe();await driver.setRunning(true,{observationId:image.id})
  // A game event auto-pauses while the external model is considering a turn.
  pausedRead=true;const result=await driver.stop()
  assert.equal(result.paused,true);assert.equal(result.pauseSent,false)
  assert.equal(calls.filter(command=>command.command==='execute').length,1)
  assert.equal(calls.filter(command=>command.command==='observe').length,2)
})

test('setRunning privately resumes and pauses while observations, clicks and ordinary keys remain available', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: true, invoke: async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  let image = await driver.observe()
  const running = await driver.setRunning(true, { observationId: image.id })
  assert.equal(running.changed, true); assert.equal(running.running, true); assert.equal(driver.info().paused, false)
  assert.equal(driver.info().hasObservation, false)
  image = await driver.observe(); assert.equal(image.paused, false)
  await driver.execute({ type: 'click', x: 100, y: 200 }, { observationId: image.id })
  image = await driver.observe()
  await driver.execute({ type: 'key', key: 'F4' }, { observationId: image.id })
  image = await driver.observe()
  const paused = await driver.setRunning(false, { observationId: image.id })
  assert.equal(paused.pauseSent, true); assert.equal(driver.info().paused, true)
  const actions = calls.filter(command => command.command === 'execute')
  assert.deepEqual(actions.map(command => command.action), [{ type: 'key', key: 'SPACE' }, { type: 'click', x: 100, y: 200 }, { type: 'key', key: 'F4' }, { type: 'key', key: 'SPACE' }])
})

test('every native SPACE alias is denied by ordinary execute', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: true, invoke: async command => { calls.push(command); return snapshot } })
  const image = await driver.observe()
  for (const key of ['SPACE', 'SPACEBAR', ' space ', ' SpaceBar ', '空格']) await assert.rejects(driver.execute({ type: 'key', key }, { observationId: image.id }), /setRunning/u)
  assert.equal(calls.filter(command => command.command === 'execute').length, 0)
})

test('setRunning refuses unknown pause state, invalid targets and stale observations without toggling', async () => {
  let at = 1000; const calls = []
  const invoke = async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } }
  const unknown = createWindowsDriver({ invoke })
  let image = await unknown.observe()
  await assert.rejects(unknown.setRunning(true, { observationId: image.id }), /手动暂停/u)
  const driver = createWindowsDriver({ assumePaused: true, now: () => at, invoke })
  image = await driver.observe()
  await assert.rejects(driver.setRunning('yes', { observationId: image.id }), /布尔/u)
  await assert.rejects(driver.setRunning(true, { observationId: 'another-image' }), /过期/u)
  at += 45001
  await assert.rejects(driver.setRunning(true, { observationId: image.id }), /过期/u)
  assert.equal(calls.filter(command => command.command === 'execute').length, 0)
})

test('an already requested running state does not toggle again', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: false, invoke: async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  const image = await driver.observe()
  const result = await driver.setRunning(true, { observationId: image.id })
  assert.equal(result.changed, false); assert.equal(result.paused, false)
  assert.equal(calls.filter(command => command.command === 'execute').length, 0)
  await driver.stop()
})

test('stop restores pause using bound identity and saved dimensions after the last observation is consumed', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: true, gamePath: 'D:/Games/stellaris.exe', invoke: async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  let image = await driver.observe()
  await driver.setRunning(true, { observationId: image.id })
  image = await driver.observe()
  await driver.execute({ type: 'click', x: 10, y: 20 }, { observationId: image.id })
  assert.equal(driver.info().hasObservation, false)
  const stopping = driver.stop(), duplicate = driver.stop()
  assert.equal(stopping, duplicate)
  const result = await stopping
  assert.equal(result.ok, true); assert.equal(result.paused, true); assert.equal(result.pauseSent, true); assert.equal(result.released, true)
  const pause = calls.at(-2)
  assert.equal(pause.windowId, snapshot.windowId); assert.deepEqual(pause.expectedWindow, snapshot.window)
  assert.equal(pause.expectedWidth, 1920); assert.equal(pause.expectedHeight, 1080)
  assert.deepEqual(pause.action, { type: 'key', key: 'SPACE' }); assert.equal(calls.at(-1).command, 'release')
})

test('stop waits for a late resume receipt and its pause cleanup before releasing inputs', async () => {
  let finishResume, finishPause, resumeReady, pauseReady, spaces = 0
  const resumed = new Promise(resolve => { resumeReady = resolve }), pausing = new Promise(resolve => { pauseReady = resolve })
  const calls = [], driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    calls.push(command)
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    if (++spaces === 1) { resumeReady(); return new Promise(resolve => { finishResume = () => resolve({ ok: true }) }) }
    pauseReady(); return new Promise(resolve => { finishPause = () => resolve({ ok: true }) })
  } })
  const image = await driver.observe(), action = driver.setRunning(true, { observationId: image.id })
  await resumed
  let finished = false
  const stopping = driver.stop().then(result => { finished = true; return result })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false)
  finishResume(); await pausing
  assert.equal(calls.some(command => command.command === 'release'), false)
  assert.equal(finished, false)
  finishPause()
  await assert.rejects(action, { name: 'AbortError' })
  const result = await stopping
  assert.equal(result.ok, true); assert.equal(result.paused, true); assert.equal(result.pauseSent, true); assert.equal(spaces, 2)
  assert.equal(calls.at(-1).command, 'release')
})

test('cancelling a resume after its receipt restores pause even without calling stop', async () => {
  const cancellation = new AbortController(); let spaces = 0
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'execute' && ++spaces === 1) cancellation.abort()
    return { ok: true }
  } })
  const image = await driver.observe()
  await assert.rejects(driver.setRunning(true, { observationId: image.id, signal: cancellation.signal }), { name: 'AbortError' })
  assert.equal(spaces, 2); assert.equal(driver.info().paused, true); assert.equal(driver.info().stopped, false)
})

test('a lost foreground during stop reports unknown pause and never retries the toggle', async () => {
  let spaces = 0, releases = 0
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') { releases++; return { ok: true } }
    if (++spaces === 1) return { ok: true }
    throw new Error('target lost foreground')
  } })
  const image = await driver.observe(); await driver.setRunning(true, { observationId: image.id })
  const result = await driver.stop()
  assert.equal(result.ok, false); assert.equal(result.paused, 'unknown'); assert.equal(result.pauseSent, false); assert.match(result.error, /手动暂停/u)
  assert.equal(driver.info().paused, 'unknown'); assert.equal(releases, 1); assert.equal(spaces, 2)
  await driver.stop(); assert.equal(spaces, 2); assert.equal(releases, 1)
})

test('an indeterminate resume outcome stops without a blind second SPACE', async () => {
  let spaces = 0, releases = 0
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') { releases++; return { ok: true } }
    spaces++; throw new Error('receipt timeout')
  } })
  const image = await driver.observe()
  await assert.rejects(driver.setRunning(true, { observationId: image.id }), /未能确认继续/u)
  const result = await driver.stop()
  assert.equal(result.ok, false); assert.equal(result.paused, 'unknown')
  assert.equal(spaces, 1); assert.equal(releases, 1)
})

test('stop waits for an ordinary in-flight click while running before restoring pause', async () => {
  let finishClick, clickReady
  const clicking = new Promise(resolve => { clickReady = resolve }), calls = []
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    calls.push(command)
    if (command.command === 'observe') return snapshot
    if (command.action?.type === 'click') { clickReady(); return new Promise(resolve => { finishClick = () => resolve({ ok: true }) }) }
    return { ok: true }
  } })
  let image = await driver.observe(); await driver.setRunning(true, { observationId: image.id })
  image = await driver.observe()
  const action = driver.execute({ type: 'click', x: 20, y: 30 }, { observationId: image.id })
  await clicking
  let finished = false; const stopping = driver.stop().then(result => { finished = true; return result })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false)
  finishClick(); await assert.rejects(action, { name: 'AbortError' })
  const result = await stopping
  assert.equal(result.ok, true)
  assert.deepEqual(calls.filter(command => command.command === 'execute').map(command => command.action.type), ['key', 'click', 'key'])
  assert.equal(calls.at(-1).command, 'release')
})

test('a synchronous stop from a native callback cannot outrun the registered control operation', async () => {
  let driver, stopping, finishPause, pauseReady, spaces = 0
  const pausing = new Promise(resolve => { pauseReady = resolve })
  const calls = []
  driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    calls.push(command)
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    if (++spaces === 1) { stopping = driver.stop(); return { ok: true } }
    pauseReady(); return new Promise(resolve => { finishPause = () => resolve({ ok: true }) })
  } })
  const image = await driver.observe(), action = driver.setRunning(true, { observationId: image.id })
  await pausing
  let finished = false; stopping.then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false)
  assert.equal(calls.some(command => command.command === 'release'), false)
  finishPause(); await assert.rejects(action, { name: 'AbortError' }); await stopping
  assert.equal(driver.info().paused, true); assert.equal(spaces, 2)
})

test('queued controls share the action lock and an immediate stop sends no resume', async () => {
  const calls = [], driver = createWindowsDriver({ assumePaused: true, invoke: async command => { calls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  const image = await driver.observe(), action = driver.setRunning(true, { observationId: image.id })
  await assert.rejects(driver.execute({ type: 'click', x: 1, y: 1 }, { observationId: image.id }), /尚未结束/u)
  // The await above allows the queued resume to complete; obtain a new driver
  // for the strictly synchronous enqueue/stop race.
  await action; await driver.stop()
  const secondCalls = [], second = createWindowsDriver({ assumePaused: true, invoke: async command => { secondCalls.push(command); return command.command === 'observe' ? snapshot : { ok: true } } })
  const fresh = await second.observe(), pending = second.setRunning(true, { observationId: fresh.id }), stopping = second.stop()
  await assert.rejects(pending, { name: 'AbortError' }); await stopping
  assert.equal(secondCalls.some(command => command.command === 'execute'), false)
  assert.equal(secondCalls.at(-1).command, 'release')
})

test('a failed cancellation pause takes priority over AbortError and is not retried by stop', async () => {
  const cancellation = new AbortController(); let spaces = 0
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    if (++spaces === 1) { cancellation.abort(); return { ok: true } }
    throw new Error('foreground lost during cleanup')
  } })
  const image = await driver.observe()
  await assert.rejects(driver.setRunning(true, { observationId: image.id, signal: cancellation.signal }), /手动暂停/u)
  const result = await driver.stop()
  assert.equal(result.ok, false); assert.equal(result.paused, 'unknown'); assert.equal(spaces, 2)
})

test('an indeterminate explicit pause and an unbound running session never get blind stop toggles', async () => {
  let spaces = 0
  const driver = createWindowsDriver({ assumePaused: false, invoke: async command => {
    if (command.command === 'observe') return snapshot
    if (command.command === 'release') return { ok: true }
    spaces++; throw new Error('pause receipt timeout')
  } })
  const image = await driver.observe()
  await assert.rejects(driver.setRunning(false, { observationId: image.id }), /手动暂停/u)
  const result = await driver.stop()
  assert.equal(result.paused, 'unknown'); assert.equal(spaces, 1)
  const calls = [], unbound = createWindowsDriver({ assumePaused: false, invoke: async command => { calls.push(command); return { ok: true } } })
  const unboundResult = await unbound.stop()
  assert.equal(unboundResult.ok, false); assert.equal(unboundResult.paused, 'unknown')
  assert.deepEqual(calls.map(command => command.command), ['release'])
})
