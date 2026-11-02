import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createStellarisBroadcast, stellarisObsCollection, OVERLAY_URL } from '../apps/desktop/electron/stellaris-broadcast'

const roots: string[] = [], services: ReturnType<typeof createStellarisBroadcast>[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(s => s.dispose()))
  for (const root of roots.splice(0)) { if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('cyberfish-broadcast-')) throw new Error('Unexpected temporary directory'); await rm(root, { recursive: true, force: true }) }
})
async function setup(disabled = false) {
  const root = await mkdtemp(join(tmpdir(), 'cyberfish-broadcast-')); roots.push(root)
  let prepares = 0
  const service = createStellarisBroadcast({ disabled, port: 0, getProject: async () => root, prepare: async () => { prepares++ }, healthy: async () => true }); services.push(service)
  return { root, service, prepares: () => prepares }
}
describe('Stellaris local broadcast', () => {
  it('两个入口并发收到同一弹幕时只交付一次，重启本地桥不清除真实房间去重',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    const events:unknown[]=[]
    const service=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,onAudienceEvent:async e=>{await new Promise(done=>setTimeout(done,10));events.push(e)}});services.push(service)
    await service.operation('start');const config=JSON.parse(service.connectionConfig()!)
    const event={id:'bilibili:concurrent',platform:'bilibili' as const,kind:'chat' as const,user:{id:'bilibili:u',name:'观众'},text:'舰长晚上好',at:Date.now()}
    await Promise.all([service.receivePlatform(event),service.receivePlatform(event),fetch(config.endpoint,{method:'POST',headers:config.headers,body:JSON.stringify(event)})])
    await service.operation('stop');await service.operation('start');await service.receivePlatform(event)
    expect(events).toHaveLength(1)
    expect((await readFile(join(root,'.local/commentary/audience.jsonl'),'utf8')).trim().split('\n')).toHaveLength(1)
  })
  it('已规范化的B站礼物与关注交给场控，统计事件不伪装成文字弹幕',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    const events:unknown[]=[]
    const service=createStellarisBroadcast({getProject:async()=>root,healthy:async()=>true,onAudienceEvent:e=>events.push(e)});services.push(service)
    const base={platform:'bilibili' as const,user:{id:'bilibili:u',name:'观众'},at:Date.now()}
    await service.receivePlatform({...base,id:'gift-1',kind:'gift',giftId:'gift-1',giftName:'小花花',count:1})
    await service.receivePlatform({...base,id:'follow-1',kind:'follow'})
    expect(events).toHaveLength(2)
    await expect(readFile(join(root,'.local/commentary/audience.jsonl'),'utf8')).rejects.toMatchObject({code:'ENOENT'})
  })
  it('退出发生在房间目录读取中时，迟到消息不写入也不转交',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    let release!:(root:string)=>void
    const events:unknown[]=[]
    const service=createStellarisBroadcast({getProject:()=>new Promise(done=>{release=done}),onAudienceEvent:e=>events.push(e)});services.push(service)
    const pending=service.receivePlatform({id:'late',platform:'bilibili',kind:'chat',user:{id:'u',name:'观众'},text:'迟到消息',at:Date.now()})
    await Promise.resolve();await Promise.resolve()
    const disposing=service.dispose();release(root);await Promise.all([pending,disposing])
    expect(events).toEqual([])
    await expect(readFile(join(root,'.local/commentary/audience.jsonl'),'utf8')).rejects.toMatchObject({code:'ENOENT'})
  })
  it('真实房间消息不依赖本地HTTP监听，同时写入框面并转交点歌一次',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    const events:unknown[]=[]
    const service=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,onAudienceEvent:e=>events.push(e)});services.push(service)
    const event={id:'bilibili:room:1:message',platform:'bilibili' as const,kind:'chat' as const,user:{id:'bilibili:123',name:'离线测试观众'},text:'点歌 晴天 周杰伦',at:Date.now()}
    await service.receivePlatform(event);await service.receivePlatform(event)
    expect(events).toHaveLength(1);expect((await service.info()).input.status).toBe('stopped')
    const rows=(await readFile(join(root,'.local/commentary/audience.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x))
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({origin:'bilibili-web',text:event.text})
  })
  it('forwards authenticated audience requests once to the music handler',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    const events:unknown[]=[]
    const service=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,onAudienceEvent:e=>events.push(e)});services.push(service)
    await service.operation('start');const c=JSON.parse(service.connectionConfig()!)
    const event={id:'song-request-once',platform:'bilibili',kind:'chat',user:{id:'u',name:'离线观众'},text:'点歌 陌生歌曲',at:Date.now()}
    for(let n=0;n<2;n++)expect((await fetch(c.endpoint,{method:'POST',headers:c.headers,body:JSON.stringify(event)})).status).toBe(202)
    expect(events).toHaveLength(1);expect(events[0]).toMatchObject({text:'点歌 陌生歌曲'})
  })
  it('isolated mode never reads or starts real services', async () => {
    const { service, prepares } = await setup(true)
    expect(await service.info()).toMatchObject({ localTest: true, ready: false, input: { status: 'stopped' } })
    expect((await service.operation('prepare')).ok).toBe(false)
    expect((await service.operation('start')).ok).toBe(false)
    expect(service.connectionConfig()).toBeUndefined(); expect(prepares()).toBe(0)
  })
  it('startup, room and preview share pending frame preparation without blocking audience controls',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    let prepares=0,release!:()=>void
    const service=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,prepare:async()=>{prepares++;await new Promise<void>(done=>{release=done})}});services.push(service)
    const startup=service.operation('prepare'),room=service.operation('prepare'),preview=service.operation('prepare')
    await expect.poll(()=>prepares).toBe(1)
    expect((await service.operation('start')).ok).toBe(true)
    expect((await service.operation('stop')).ok).toBe(true)
    release()
    expect((await Promise.all([startup,room,preview])).every(result=>result.ok)).toBe(true)
    expect(prepares).toBe(1)
  })
  it('a failed shared frame preparation can be retried',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cyberfish-broadcast-'));roots.push(root)
    let prepares=0
    const service=createStellarisBroadcast({getProject:async()=>root,healthy:async()=>false,prepare:async()=>{if(++prepares===1)throw Error('offline fixture')}});services.push(service)
    const failed=await Promise.all([service.operation('prepare'),service.operation('prepare')])
    expect(failed.every(result=>!result.ok)).toBe(true);expect(prepares).toBe(1)
    expect((await service.operation('prepare')).ok).toBe(true);expect(prepares).toBe(2)
  })
  it('authenticates local HTTP, refuses other platforms, deduplicates and keeps test events out of the live feed', async () => {
    const { service, root, prepares } = await setup()
    expect(prepares()).toBe(0); expect((await service.operation('prepare')).ok).toBe(true); expect(prepares()).toBe(1)
    await service.operation('start')
    const config = JSON.parse(service.connectionConfig()!), event = { id: 'message-1', platform: 'bilibili', kind: 'chat', user: { id: 'u1', name: '离线测试观众' }, text: '这是一条隔离测试消息', at: Date.now() }
    const post = (headers: Record<string, string>, body = event) => fetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
    expect((await post({ 'Content-Type': 'application/json' })).status).toBe(401)
    expect((await post(config.headers, { ...event, platform: 'douyin' })).status).toBe(422)
    expect((await service.operation('test')).ok).toBe(true)
    await expect(readFile(join(root, '.local/commentary/audience.jsonl'))).rejects.toHaveProperty('code', 'ENOENT')
    expect((await post(config.headers)).status).toBe(202); expect((await post(config.headers)).status).toBe(202)
    const rows = (await readFile(join(root, '.local/commentary/audience.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x))
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ platform: 'bilibili', type: 'chat', text: event.text, origin: 'bridge' })
    const status = JSON.stringify(await service.info())
    expect(status).not.toContain(config.headers.Authorization.slice(7)); expect(status).not.toContain('websocketEndpoint')
    await service.operation('stop'); expect(service.connectionConfig()).toBeUndefined()
  })
  it('disposing during prerequisite lookup cannot revive the local listener', async () => {
    let release!: (root: string) => void
    const service = createStellarisBroadcast({ getProject: () => new Promise<string>(done => { release = done }), healthy: async () => false, port: 0 }); services.push(service)
    const operation = service.operation('start'); await service.dispose(); release(tmpdir())
    expect((await operation).ok).toBe(false); expect((await service.info()).input.status).toBe('stopped')
  })
  it('exports a real game source beneath a transparent overlay, with separate captured audio and no desktop/microphone/stream secrets', () => {
    const collection = stellarisObsCollection(), sources = collection.sources
    expect(collection.resolution).toEqual({ x: 1920, y: 1080 })
    expect(sources.map(s => s.id)).toEqual(['game_capture', 'browser_source', 'wasapi_process_output_capture','scene'])
    expect(sources[0].settings).toMatchObject({ capture_mode: 'window', capture_audio: true, window: 'Stellaris:SDL_app:stellaris.exe' })
    expect(sources[1].settings).toMatchObject({ url: OVERLAY_URL, width: 1920, height: 1080, reroute_audio: true })
    const items = (sources[3].settings as { items: any[] }).items
    expect(items.map(i => i.source_uuid)).toEqual([sources[0].uuid, sources[1].uuid,sources[2].uuid])
    expect(collection.AuxAudioDevice1).toBeNull();expect(collection.DesktopAudioDevice1).toBeNull()
    expect(items[0]).toMatchObject({ pos: { x: 32, y: 78 }, bounds: { x: 1504, y: 846 } })
    const json = JSON.stringify(collection); expect(json).not.toMatch(/token|password|stream_key|startstreaming|monitor_capture|wasapi_input_capture/)
  })
})
