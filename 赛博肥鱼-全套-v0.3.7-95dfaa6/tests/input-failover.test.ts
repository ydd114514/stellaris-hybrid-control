import { describe, expect, it } from 'vitest'
import type { LiveEvent } from '../packages/shared/src'
import { createInputFailover } from '../apps/desktop/electron/input-failover'
import type { LiveScreenCandidate } from '../apps/desktop/electron/live-screen-input'
const chat = (id: string, text = '今天有一件好玩的事', userId = 'stable-one'): LiveEvent => ({ id, kind: 'chat', user: { id: userId, name: '听雨' }, text, at: 1000000 })
const gift = (id: string, count: number, userId = 'stable-one'): LiveEvent => ({ id, kind: 'gift', user: { id: userId, name: '听雨' }, giftName: '小心心', giftId: 'heart', count, comboKey: 'backend-combo', at: 1000000 })
const row = (patch: Partial<LiveScreenCandidate> = {}): LiveScreenCandidate => ({ kind: 'chat', userName: '听雨', text: '今天有一件好玩的事', fingerprint: 'visible-one', confidence: .5, confirmedFrames: 2, ...patch })
function setup(onDuplicateGift?: (event: LiveEvent) => void) { let time = 1000000; const events: LiveEvent[] = []; const control = createInputFailover({ now: () => time, onDuplicateGift, deliver(event) { events.push(structuredClone(event)); return { ok: true } } }); return { control, events, advance(ms: number) { time += ms; control.tick() } } }
describe('后台/屏幕主备只切接收与跨源去重', () => {
  it('没有健康证据时用屏幕，后台恢复连续5秒再回主；安静本身不是故障', () => {
    const { control, advance } = setup(); control.configureScreen(true)
    expect(control.info()).toMatchObject({ selected: 'screen', bridgeHealth: 'unknown' })
    control.bridgeHealth({ state: 'connected', heartbeatExpected: true })
    advance(4999); expect(control.info().selected).toBe('screen')
    advance(1); expect(control.info().selected).toBe('bridge')
    for (let i=0;i<20;i++) { advance(5000); control.bridgeHealth({state:'heartbeat',heartbeatExpected:true}) }
    expect(control.info().selected).toBe('bridge')
    control.bridgeHealth({state:'disconnected'}); expect(control.info().selected).toBe('screen')
  })
  it('有明确心跳契约才超时，只有有效HTTP事件的静默不被当故障', async () => {
    const { control, advance } = setup(); await control.bridgeEvent(chat('first')); control.configureScreen(true)
    advance(600000); expect(control.info().selected).toBe('bridge')
    control.bridgeHealth({state:'heartbeat',heartbeatExpected:true}); advance(20001)
    expect(control.info()).toMatchObject({selected:'screen',bridgeHealth:'unhealthy'})
  })
  it('恢复时缓存后台消息并合并已由屏幕投递的同一评论，不重复播放', async () => {
    const { control, events, advance } = setup(); await control.bridgeEvent(chat('old','之前的话题')); control.configureScreen(true); control.bridgeHealth({state:'disconnected'})
    await control.screenCandidates([row()]); expect(events.at(-1)?.user.id).toBe('stable-one')
    await control.bridgeEvent(chat('same-comment')); expect(control.info().pendingBridge).toBe(1)
    advance(5000); await control.flush()
    expect(events).toHaveLength(2); expect(control.info().duplicates).toBe(1)
  })
  it('A累计2→B累计5→A累计5只投递总计5，无comboKey避免runtime再减', async () => {
    const { control, events, advance } = setup(); await control.bridgeEvent(gift('a2',2)); control.configureScreen(true); control.bridgeHealth({state:'disconnected'})
    await control.screenCandidates([row({kind:'gift',giftName:'小心心',text:undefined,count:5,confirmedFrames:3,confidence:.3})])
    await control.bridgeEvent(gift('a5',5)); advance(5000); await control.flush()
    expect(events.map(event=>event.count)).toEqual([2,3]); expect(events.reduce((n,event)=>n+(event.count||0),0)).toBe(5)
    expect(events.every(event=>event.comboKey===undefined)).toBe(true); expect(new Set(events.map(event=>event.id)).size).toBe(2)
    expect(events[1]?.origin).toBe('screen'); expect(events[1]?.unitDiamonds).toBeUndefined()
  })
  it('屏幕隔离身份后来唯一匹配到后台ID时，累计5仍只追加3', async () => {
    const { control, events, advance } = setup(); control.configureScreen(true)
    await control.screenCandidates([row({kind:'gift',giftName:'小心心',text:undefined,count:2,confirmedFrames:3,confidence:.3})])
    expect(events[0]!.user.id).toMatch(/^screen:/)
    await control.bridgeEvent(gift('backend-five',5)); advance(5000); await control.flush()
    expect(events.map(event=>event.count)).toEqual([2,3]); expect(events[1]!.user.id).toBe('stable-one')
    expect(events.every(event=>event.comboKey===undefined)).toBe(true)
  })
  it('A在线但漏礼物时B延迟2秒补5，A迟来5只回填可信证据不重复加数', async () => {
    const proof:LiveEvent[]=[],{control,events,advance}=setup(event=>{proof.push(event)})
    control.bridgeHealth({state:'connected',heartbeatExpected:true});control.configureScreen(true)
    control.screenStatus({state:'reading',message:'画面热备',frames:3,candidates:1,errorCount:0})
    await control.screenCandidates([row(),row({kind:'gift',giftName:'小心心',text:undefined,count:5,confirmedFrames:3,confidence:.3})])
    expect(events).toHaveLength(0);expect(control.info().pendingScreenGifts).toBe(1)
    advance(1999);await control.flush();expect(events).toHaveLength(0)
    advance(1);await control.flush();expect(events.map(event=>event.count)).toEqual([5]);expect(events[0]!.origin).toBe('screen')
    await control.bridgeEvent({...gift('late-a5',5),unitDiamonds:1});await control.bridgeEvent({...gift('late-a5',5),unitDiamonds:1})
    expect(events.reduce((sum,event)=>sum+(event.count||0),0)).toBe(5);expect(proof).toHaveLength(1)
    expect(proof[0]).toMatchObject({origin:'bridge',user:{id:'stable-one'},count:5,unitDiamonds:1})
    expect(control.info().message).toContain('画面礼物补缺')
  })
  it('同名多个后台ID不猜礼物/关注，评论分别隔离，不把送token文字当gift', async () => {
    const { control, events } = setup(); await control.bridgeEvent(chat('one','第一句','person-1')); await control.bridgeEvent(chat('two','第二句','person-2')); control.configureScreen(true); control.bridgeHealth({state:'disconnected'})
    await control.screenCandidates([row({kind:'gift',giftName:'小心心',count:5,confirmedFrames:3}),row({kind:'follow',confirmedFrames:2,fingerprint:'follow'}),row({text:'送出了token10000',fingerprint:'comment-1'}),row({text:'同名另一句',fingerprint:'comment-2'})])
    expect(events).toHaveLength(4); expect(events.slice(-2).every(event=>event.kind==='chat'&&event.user.id.startsWith('screen:'))).toBe(true)
    expect(events.at(-1)!.user.id).not.toBe(events.at(-2)!.user.id); expect(control.info().ignored).toBe(2)
  })
  it('未多帧确认或低raw置信候选不猜认；同一屏幕行5后倒退2不再计礼物', async () => {
    const { control, events } = setup(); control.configureScreen(true)
    await control.screenCandidates([row({confirmedFrames:1}),row({confidence:.29}),row({kind:'gift',giftName:'小心心',count:2,confirmedFrames:2})])
    expect(events).toHaveLength(0)
    await control.screenCandidates([row({kind:'gift',giftName:'小心心',count:5,confirmedFrames:3}),row({kind:'gift',giftName:'小心心',count:2,confirmedFrames:3})])
    expect(events.map(event=>event.count)).toEqual([5])
  })
  it('一条后台通道断开不会盖掉另一条健康通道，缓冲只保留30秒且最多500', async () => {
    const { control, advance } = setup(); control.bridgeHealth({state:'connected',channel:'direct',heartbeatExpected:true}); control.bridgeHealth({state:'connected',channel:'local',heartbeatExpected:false}); control.configureScreen(true)
    control.bridgeHealth({state:'disconnected',channel:'direct'}); advance(25000); expect(control.info().selected).toBe('bridge')
    control.bridgeHealth({state:'disconnected',channel:'local'}); await control.bridgeEvent(chat('buffered'),'direct'); expect(control.info().pendingBridge).toBe(1)
    for(let index=0;index<510;index++) await control.bridgeEvent(chat(`buffer-${index}`),'direct')
    expect(control.info().pendingBridge).toBe(500)
    control.bridgeHealth({state:'disconnected',channel:'direct'}); advance(30001); expect(control.info().pendingBridge).toBe(0)
  })
})
