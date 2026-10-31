import { createHash } from 'node:crypto'
import type { CommandResult, LiveEvent } from '../../../packages/shared/src'
import type { LiveScreenCandidate, LiveScreenStatus } from './live-screen-input'

export interface BridgeHealth { state: 'connected' | 'heartbeat' | 'event' | 'disconnected'; heartbeatExpected?: boolean; channel?: string }
export interface InputFailoverInfo {
  selected: 'bridge' | 'screen' | 'none'; bridgeHealth: 'unknown' | 'healthy' | 'unhealthy'; message: string
  lastBridgeSignalAt?: number; screenEnabled: boolean; screen: LiveScreenStatus
  deliveredBridge: number; deliveredScreen: number; duplicates: number; ignored: number; pendingBridge: number
  pendingScreenGifts: number
}
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20)
interface Seen { at: number; source: 'bridge' | 'screen'; key: string; id: string }
interface Combo { key: string; at: number; maximum: number; bridgeCombo?: string; screenRow?: string; source: 'bridge' | 'screen'; name: string; gift: string }

/** Changes only delivery ownership; no runtime/audio/window controls are accepted here. */
export function createInputFailover(options: { deliver(event: LiveEvent): Promise<CommandResult> | CommandResult; onDuplicateGift?(event: LiveEvent): unknown | Promise<unknown>; now?: () => number; onChange?(info: InputFailoverInfo): void; recoveryMs?: number; heartbeatMs?: number }) {
  const now = options.now || Date.now, recoveryMs = options.recoveryMs ?? 5000, heartbeatMs = options.heartbeatMs ?? 20000
  let disposed = false, enabled = false, selected: InputFailoverInfo['selected'] = 'none', health: InputFailoverInfo['bridgeHealth'] = 'unknown'
  let lastSignal = 0, healthySince = 0, sequence = 0, deliveredBridge = 0, deliveredScreen = 0, duplicates = 0, ignored = 0
  let screen: LiveScreenStatus = { state: 'idle', message: '屏幕识别尚未开启。', frames: 0, candidates: 0, errorCount: 0 }
  const seen: Seen[] = [], pending: LiveEvent[] = [], identities = new Map<string, Map<string, number>>(), combos = new Map<string, Combo>()
  const channels = new Map<string, { alive: boolean; at: number; heartbeat: boolean }>()
  const pendingScreenGifts = new Map<string, { event: LiveEvent; due: number; at: number }>()
  let delivery: Promise<unknown> = Promise.resolve()
  const info = (): InputFailoverInfo => {
    const bridge = health === 'healthy' ? '后台连接健康已确认' : health === 'unhealthy' ? '后台暂不可用' : '后台健康尚未确认'
    const backup = !enabled ? '屏幕备用未开启' : screen.state === 'reading' ? '屏幕备用读取中' : `屏幕备用未就绪：${screen.message}`
    return { selected, bridgeHealth: health, message: `${selected === 'bridge' ? enabled && screen.state === 'reading' ? '后台优先 · 画面礼物补缺' : '后台主用' : selected === 'screen' ? '屏幕识别备用' : '等待有效来源'} · ${bridge}；${backup}。`, ...(lastSignal ? { lastBridgeSignalAt: lastSignal } : {}), screenEnabled: enabled, screen: { ...screen }, deliveredBridge, deliveredScreen, duplicates, ignored, pendingBridge: pending.length, pendingScreenGifts: pendingScreenGifts.size }
  }
  const notify = () => { try { options.onChange?.(info()) } catch { /* Observation does not interrupt delivery. */ } }
  function prune() {
    const cutoff = now() - 30000
    while (seen.length && (seen[0]!.at < cutoff || seen.length > 500)) seen.shift()
    for (const [name, users] of identities) { for (const [id, at] of users) if (at < now() - 120000) users.delete(id); if (!users.size) identities.delete(name) }
    while (identities.size > 500) identities.delete(identities.keys().next().value!)
    for (const [key, combo] of combos) if (combo.at < cutoff) combos.delete(key)
    while (combos.size > 500) combos.delete(combos.keys().next().value!)
    while (pending.length && (pending[0]!.at < cutoff || pending.length > 500)) { pending.shift(); ignored++ }
    for(const [key,value] of pendingScreenGifts)if(value.at<cutoff||pendingScreenGifts.size>500){pendingScreenGifts.delete(key);ignored++}
  }
  const enqueue = (work: () => Promise<CommandResult>) => { const result = delivery.then(work, work); delivery = result.catch(() => undefined); return result }
  function choose() {
    if (disposed) return
    prune()
    const alive = [...channels.values()].filter(channel => channel.alive && (!channel.heartbeat || now() - channel.at <= heartbeatMs))
    const wasHealthy = health === 'healthy'
    health = alive.length ? 'healthy' : channels.size ? 'unhealthy' : 'unknown'
    if (!wasHealthy && health === 'healthy') healthySince = now()
    if (alive.length) lastSignal = Math.max(...alive.map(channel => channel.at))
    const next = health === 'healthy' && (selected !== 'screen' || now() - healthySince >= recoveryMs) ? 'bridge' : enabled ? 'screen' : 'none'
    const changed = next !== selected; selected = next
    if (selected === 'bridge' && pending.length) {
      const events = pending.splice(0)
      for (const event of events) void enqueue(() => deliver('bridge', event))
    }
    if (changed) notify()
  }
  function bridgeHealth(signal: BridgeHealth) {
    if (disposed) return
    const key = signal.channel || 'bridge', previous = channels.get(key)
    channels.set(key, { alive: signal.state !== 'disconnected', at: now(), heartbeat: signal.heartbeatExpected ?? previous?.heartbeat ?? false })
    choose(); notify()
  }
  function identity(event: LiveEvent) {
    const name = clean(event.user.name), users = identities.get(name) || new Map<string, number>()
    users.set(event.user.id, now()); identities.set(name, users); prune()
  }
  async function deliver(source: 'bridge' | 'screen', original: LiveEvent, supplement = false): Promise<CommandResult> {
    if (disposed || selected !== source && !(supplement && enabled && source==='screen' && original.kind==='gift' && selected==='bridge')) return { ok: true, message: '此来源正在热备，未重复投递。' }
    prune()
    const event = { ...original, user: { ...original.user }, origin: source } as LiveEvent
    const semantic = [event.kind, clean(event.user.name), clean(event.text || ''), clean(event.giftName || event.giftId || ''), event.kind === 'gift' ? event.count || 1 : ''].join('|')
    const collision = (identities.get(clean(event.user.name))?.size || 0) > 1
    const sourceId = `${source}:${event.id}${event.kind === 'gift' ? `:${event.count || 1}` : ''}`
    const sameId=seen.some(item=>item.id===sourceId), crossSource=!collision&&seen.some(item=>item.source!==source&&item.key===semantic)
    if (sameId || crossSource) {
      if(!sameId&&crossSource&&source==='bridge'&&event.kind==='gift'){try{await options.onDuplicateGift?.(event)}catch{/* Qualification repair cannot repeat the gift. */};seen.push({at:now(),source,key:semantic,id:sourceId})}
      duplicates++; return { ok: true, message: '两路重复消息已合并。' }
    }
    if (event.kind === 'gift') {
      const count = Math.max(1, Math.floor(event.count || 1)), gift = clean(event.giftName || event.giftId || ''), name = clean(event.user.name), logical = `${event.user.id}|${gift}`
      let combo = combos.get(logical)
      if (!combo && source === 'bridge' && !collision && event.comboKey) {
        const candidates = [...new Set(combos.values())].filter(value => value.source === 'screen' && value.name === name && value.gift === gift && !value.bridgeCombo)
        if (candidates.length === 1) combo = candidates[0]
      }
      if (!combo || source === 'bridge' && (!event.comboKey || combo.bridgeCombo && combo.bridgeCombo !== event.comboKey) || source === 'screen' && combo.screenRow && combo.screenRow !== event.comboKey) {
        combo = { key: `input-combo:${hash(`${logical}:${now()}:${++sequence}`)}`, at: now(), maximum: 0, source, name, gift, ...(source === 'bridge' && event.comboKey ? { bridgeCombo: event.comboKey } : {}) }
      }
      if (source === 'bridge' && event.comboKey) combo.bridgeCombo = event.comboKey
      if (source === 'screen') combo.screenRow = event.comboKey
      if (count <= combo.maximum) {
        if(source==='bridge'){try{await options.onDuplicateGift?.(event)}catch{/* Qualification repair cannot repeat the gift. */};seen.push({at:now(),source,key:semantic,id:sourceId})}
        duplicates++; return { ok: true, message: '重复礼物累计值已忽略。' }
      }
      event.count = count - combo.maximum; delete event.comboKey
      event.id = `input:${hash(`${sourceId}|${combo.key}|${count}`)}`
      const result = await options.deliver(event)
      if (!result.ok) return result
      combo.maximum = count; combo.at = now(); combos.set(logical, combo)
    } else {
      const result = await options.deliver(event)
      if (!result.ok) return result
    }
    seen.push({ at: now(), source, key: semantic, id: sourceId }); if (source === 'bridge') deliveredBridge++; else deliveredScreen++
    prune(); return { ok: true }
  }
  function bridgeEvent(event: LiveEvent, channel = 'bridge') {
    if (disposed) return Promise.resolve({ ok: false, message: '互动接收已结束。' })
    identity(event); bridgeHealth({ state: 'event', channel })
    if (selected !== 'bridge') { if (!pending.some(item => item.id === event.id)) pending.push({ ...event, at: now() }); prune(); notify(); return Promise.resolve({ ok: true, message: '后台恢复稳定中，消息已暂存。' }) }
    return enqueue(() => deliver('bridge', event))
  }
  async function screenCandidates(rows: LiveScreenCandidate[]) {
    if (disposed || !enabled) return
    for (const row of rows.slice(0, 200)) {
      if(selected!=='screen'&&row.kind!=='gift')continue
      const frames = row.kind === 'gift' ? 3 : 2, name = clean(row.userName || '')
      if (!name || !row.fingerprint || !Number.isFinite(row.confidence) || row.confidence < .3 || row.confidence > 1 || (row.confirmedFrames ?? 0) < frames || !['chat','gift','follow'].includes(row.kind)) { ignored++; continue }
      prune()
      const users = identities.get(name)
      if (row.kind !== 'chat' && users && users.size > 1) { ignored++; continue }
      const userId = users?.size === 1 ? users.keys().next().value! : `screen:${hash(`${name}|${row.fingerprint}`)}`
      const event: LiveEvent = { id: `screen:${hash(row.fingerprint)}:${row.kind === 'gift' ? row.count || 1 : 'message'}`, kind: row.kind, user: { id: userId, name }, origin: 'screen', at: now() }
      if (row.kind === 'chat') { if (!row.text?.trim()) { ignored++; continue }; event.text = clean(row.text).slice(0, 500) }
      if (row.kind === 'gift') { if (!row.giftName || !Number.isSafeInteger(row.count) || row.count! <= 0 || row.count! > 100000) { ignored++; continue }; event.giftName = clean(row.giftName); event.count = row.count; event.comboKey = `screen-row:${hash(row.fingerprint)}` }
      // No OCR amount, price, credential, or claimed-gift reinterpretation is forwarded.
      if(selected==='bridge'&&event.kind==='gift'){pendingScreenGifts.set(event.id,{event,due:now()+2000,at:now()});prune()}
      else await enqueue(() => deliver('screen', event))
    }
    notify()
  }
  function tick(){choose();for(const [key,value]of pendingScreenGifts){if(selected!=='screen'&&now()<value.due)continue;pendingScreenGifts.delete(key);void enqueue(()=>deliver('screen',value.event,true))}}
  return { bridgeEvent, bridgeHealth, screenCandidates, tick, info, configureScreen(value: boolean) { enabled = value; if(!enabled)pendingScreenGifts.clear();choose(); notify() }, screenStatus(value: LiveScreenStatus) { screen = { ...value }; choose(); notify() }, async flush() { await delivery }, dispose() { disposed = true; pending.length = 0; identities.clear(); combos.clear(); channels.clear();pendingScreenGifts.clear(); seen.length = 0 } }
}
