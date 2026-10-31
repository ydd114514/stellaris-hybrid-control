import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { SKINS, OUTFITS, type AppConfig, type AppState, type CommandResult, type LiveEvent } from '../packages/shared/src/index'

export interface ControlEvent { kind: LiveEvent['kind']; userId: string; name: string; id: string; text?: string; giftId?: string; giftName?: string; count?: number; comboKey?: string }
type ControlChannel = 'root' | 'cat' | 'worker' | 'music'
export interface ControlAck { channel: ControlChannel; batchId?: string; at: number; accepted: boolean; results: { id: string; ok: boolean; message?: string }[]; error?: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const token = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9:_-]+$/.test(value) ? value : undefined
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
const kinds = new Set<LiveEvent['kind']>(['chat', 'gift', 'enter', 'follow', 'like'])
const MAX_BYTES = 64 * 1024

/** Owner preview changes only the costume; paid services, budgets and routing remain fixed. */
export function rehearsalLookConfig(current: AppConfig, incoming: unknown): AppConfig {
  const look = object(object(incoming).look)
  if (!SKINS.some(skin => skin.id === look.scheme) || !OUTFITS.some(outfit => outfit.id === look.outfit) || !['auto', 'morning', 'day', 'dusk', 'night'].includes(String(look.timeOfDay))) throw new Error('请从现有AI形象、服装与布景中选择。')
  return { ...current, look: { scheme: String(look.scheme), outfit: String(look.outfit), timeOfDay: look.timeOfDay as AppConfig['look']['timeOfDay'] } }
}

function parseEvent(value: unknown, batchId: string, index: number, channel: ControlChannel): ControlEvent {
  const raw = object(value), kind = raw.kind as LiveEvent['kind'], userId = token(typeof raw.userId === 'string' ? raw.userId.replace(/^rehearsal-/, '') : raw.userId, 64)
  if (!kinds.has(kind) || !userId) throw new Error('事件类型或模拟观众编号无效；控制文件只接收模拟互动。')
  if (raw.text !== undefined && (typeof raw.text !== 'string' || raw.text.length > 600)) throw new Error('模拟弹幕最多 600 字。')
  const name = clean(raw.name, 54)
  if (!name) throw new Error('模拟观众名称不能为空。')
  const providedId = raw.id === undefined ? undefined : token(raw.id, 120)
  if (raw.id !== undefined && !providedId) throw new Error('模拟事件编号无效。')
  const namespace = channel === 'root' ? '' : `${channel}:`
  const result: ControlEvent = { kind, userId, name: name.startsWith('模拟') ? name : `模拟·${name}`, id: `control:${namespace}${providedId || `${batchId}:${index + 1}`}` }
  if (kind === 'chat') { result.text = clean(raw.text, 600); if (!result.text) throw new Error('模拟弹幕不能为空。') }
  if (kind === 'gift') {
    result.giftId = clean(raw.giftId, 100); result.giftName = clean(raw.giftName, 60)
    if (!result.giftId && !result.giftName) throw new Error('模拟礼物需要名称或编号。')
    const count = raw.count === undefined ? 1 : raw.count
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('模拟礼物数量需要是 1–100000 的整数。')
    result.count = count
    if (raw.comboKey !== undefined) { const key = token(raw.comboKey, 160); if (!key) throw new Error('模拟连击编号无效。'); result.comboKey = `control:${namespace}${key}` }
  }
  return result // Explicit fields only: origin/user/commands/URLs are never merged.
}

/** Fixed inbox within this run only. No network server, arbitrary path, owner command or credential access. */
export function createRehearsalControl(options: { runDirectory: string; canInject(): boolean; inject(event: ControlEvent): Promise<CommandResult | undefined>; sanitize?: (value: unknown) => string; now?: () => number }) {
  const root = resolve(options.runDirectory), directory = join(root, 'control'), inbox = join(directory, 'inbox.json'), ackFile = join(directory, 'ack.json')
  const channels: ControlChannel[] = ['root', 'cat', 'worker', 'music']
  const inboxes: Record<ControlChannel, string> = { root: inbox, cat: join(directory, 'inbox-cat.json'), worker: join(directory, 'inbox-worker.json'), music: join(directory, 'inbox-music.json') }
  const ackFiles: Record<ControlChannel, string> = { root: ackFile, cat: join(directory, 'ack-cat.json'), worker: join(directory, 'ack-worker.json'), music: join(directory, 'ack-music.json') }
  const lastAckFile = join(directory, 'last-ack.json')
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('测试控制目录必须位于本轮真实目录中。')
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const directoryStat = lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || realpathSync(directory) !== directory) throw new Error('测试控制目录不能是链接或其他文件。')
  const now = options.now || Date.now, sanitize = options.sanitize || ((value: unknown) => clean(value, 500))
  const seen = new Set<string>(), stats = { acceptedBatches: 0, rejectedBatches: 0, injectedEvents: 0 }
  let stopped = false, polling = false
  function assertDirectory() {
    const current = lstatSync(directory)
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directoryStat.dev || current.ino !== directoryStat.ino || realpathSync(directory) !== directory || realpathSync(root) !== root) throw new Error('测试控制目录已变化，拒绝读取。')
  }
  function writeAck(ack: ControlAck) {
    for (const destination of [ackFiles[ack.channel], lastAckFile]) {
      assertDirectory()
      const temporary = join(directory, `.ack-${randomUUID()}.tmp`), fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { writeFileSync(fd, JSON.stringify(ack, null, 2)) } finally { closeSync(fd) }
      assertDirectory(); renameSync(temporary, destination)
    }
  }
  function readInbox(channel: ControlChannel): unknown {
    assertDirectory()
    const inbox = inboxes[channel]
    const before = lstatSync(inbox)
    if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_BYTES) throw new Error('控制文件必须是本目录内不超过 64 KiB 的普通 JSON 文件，不能使用链接。')
    const fd = openSync(inbox, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_BYTES) throw new Error('控制文件在读取前已变化。')
      const buffer = Buffer.alloc(MAX_BYTES + 1); let size = 0, read = 0
      while (size < buffer.length && (read = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += read
      const after = fstatSync(fd); assertDirectory()
      if (size > MAX_BYTES || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('控制文件读取时发生变化，请用临时文件原子替换。')
      try { return JSON.parse(buffer.subarray(0, size).toString('utf8')) } catch { throw new Error('控制文件不是完整 JSON，请用临时文件原子替换。') }
    } finally { closeSync(fd) }
  }
  async function consumeChannel(channel: ControlChannel): Promise<ControlAck | undefined> {
      let batchId: string | undefined
      try {
        let value: unknown
        try { value = readInbox(channel) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
        const raw = object(value); batchId = token(raw.batchId, 100)
        if (!batchId) throw new Error('控制批次需要合法 batchId。')
        if (seen.has(`${channel}:${batchId}`)) return
        if (!Array.isArray(raw.events) || raw.events.length < 1 || raw.events.length > 20) throw new Error('每批需要 1–20 条模拟互动。')
        const events = raw.events.map((event, index) => parseEvent(event, batchId!, index, channel))
        seen.add(`${channel}:${batchId}`); while (seen.size > 10000) seen.delete(seen.values().next().value!)
        const ack: ControlAck = { channel, batchId, at: now(), accepted: options.canInject() && !stopped, results: [] }
        for (const event of events) {
          if (stopped || !options.canInject()) { ack.results.push({ id: event.id, ok: false, message: '本轮未开始、已进入最后30秒收尾，或已经停止；未注入。' }); continue }
          const result = await options.inject(event); stats.injectedEvents++
          ack.results.push({ id: event.id, ok: result?.ok === true, ...(result?.message ? { message: sanitize(result.message).slice(0, 500) } : {}) })
        }
        if (ack.accepted) stats.acceptedBatches++; else stats.rejectedBatches++
        writeAck(ack); return ack
      } catch (error) {
        stats.rejectedBatches++
        if (batchId) { seen.add(`${channel}:${batchId}`); while (seen.size > 10000) seen.delete(seen.values().next().value!) }
        const ack: ControlAck = { channel, ...(batchId ? { batchId } : {}), at: now(), accepted: false, results: [], error: sanitize(error instanceof Error ? error.message : '控制批次读取失败。').slice(0, 500) }
        try { writeAck(ack) } catch { /* An unsafe or removed directory must never become a different write destination. */ }
        return ack
      }
  }
  return {
    inbox, ackFile, inboxes, ackFiles, lastAckFile,
    metadata: () => ({ ...stats, stopped, seenBatches: seen.size }),
    stop() { stopped = true },
    async poll(): Promise<ControlAck | undefined> {
      if (stopped || polling) return
      polling = true; let lastAck: ControlAck | undefined
      try {
        for (const channel of channels) { if (stopped) break; const ack = await consumeChannel(channel); if (ack) lastAck = ack }
        return lastAck
      } finally { polling = false }
    },
  }
}

/** Allowlisted live observation only: no configuration, keys, audio payloads, cookies or source URLs. */
export function rehearsalLiveState(state: AppState, context: { startedAt: number; stopped: boolean; interactive: boolean; acceptingEvents: boolean }, sanitize: (value: unknown) => string) {
  const text = (value: unknown, max = 600) => sanitize(typeof value === 'string' ? value : '').replace(/(?:https?|file|shop-media|shop-qqmusic):\/\/[^\s<>]+/gi, '[地址已省略]').replace(/data:(?:audio|image)\/[^\s]+/gi, '[媒体已省略]').slice(0, max)
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const numericFields = (value: unknown, fields: string[]) => Object.fromEntries(fields.map(key => [key, number(object(value)[key])]))
  const reply = (row: AppState['history'][number]) => ({ id: text(row.id, 120), eventId: text(row.eventId, 160), viewerName: text(row.viewerName, 60), heard: text(row.heard), say: row.say.map(line => text(line)), face: row.face, action: row.action, voiceStyle: text(row.voiceStyle, 100), status: row.status, source: row.source, createdAt: row.createdAt, latencyMs: row.latencyMs })
  const request = (row: AppState['music']['queue'][number]) => ({ id: text(row.id, 120), trackId: text(row.trackId, 100), userId: text(row.userId, 100), userName: text(row.userName, 60), status: row.status, at: row.at, heartCount: row.heartCount, consumedHearts: row.consumedHearts })
  return {
    at: Date.now(), ...context, running: state.running, generating: state.generating,
    look: { scheme: state.config.look.scheme, outfit: state.config.look.outfit, timeOfDay: state.config.look.timeOfDay },
    roomMood: { kind: state.roomMood.kind, label: text(state.roomMood.label, 50), description: text(state.roomMood.description), face: state.roomMood.face, allowedActions: state.roomMood.allowedActions, since: state.roomMood.since, heat: state.roomMood.heat, activeChatters: state.roomMood.activeChatters, activeParticipants: state.roomMood.activeParticipants },
    recentViewers: state.viewers.slice(0, 30).map(viewer => ({ id: text(viewer.id, 100), name: text(viewer.name, 60), followedAt: number(viewer.followedAt), gifts: number(viewer.gifts) })),
    stage: { speaking: state.stage.speaking, text: text(state.stage.text), replyId: text(state.stage.replyId, 120), action: state.stage.action, face: state.stage.face },
    history: state.history.slice(0, 25).map(reply), drafts: state.drafts.slice(0, 25).map(reply),
    queueTotal: state.queue.length, queue: state.queue.slice(0, 200).map(event => ({ id: text(event.id, 160), kind: event.kind, origin: 'simulator', userId: text(event.user.id, 100), name: text(event.user.name, 60), text: text(event.text), giftId: text(event.giftId, 100), giftName: text(event.giftName, 60), count: event.count, at: event.at })),
    music: { status: state.music.status, bgmError: text(state.music.bgmError), lastMessage: text(state.music.lastMessage), current: state.music.current ? { ...request(state.music.current), generationId: text(state.music.current.generationId, 120), isBgm: state.music.current.isBgm === true, startedAt: state.music.current.startedAt } : null, queue: state.music.queue.slice(0, 100).map(request), searches: state.music.searches.map(row => ({ id: text(row.id, 120), query: text(row.query, 100), userId: text(row.userId, 100), userName: text(row.userName, 60), heartCount: row.heartCount, status: row.status })), tracks: state.music.tracks.map(track => ({ id: text(track.id, 100), title: text(track.title, 100), artist: text(track.artist, 100), duration: track.duration })) },
    costs: { ...numericFields(state.costs, ['session', 'today', 'inputTokens', 'outputTokens', 'cacheHitTokens', 'cacheMissTokens', 'requests', 'brainUsageMissing', 'brainApiRequests', 'brainApiSucceeded', 'brainApiFailed', 'brainApiCancelled', 'voiceInputTokens', 'voiceOutputTokens', 'voiceRequests', 'voiceUsageMissing', 'voiceApiRequests', 'voiceApiSucceeded', 'voiceApiFailed', 'voiceApiCancelled', 'voiceCharacters', 'voiceCharactersEstimated', 'unpricedRequests', 'todayUnpricedRequests']), legacyUsageIncomplete: state.costs.legacyUsageIncomplete === true },
    rations: { ...numericFields(state.rations, ['balance', 'earned', 'spent', 'unknownRequests']), lastTopUp: state.rations.lastTopUp ? { name: text(state.rations.lastTopUp.name, 60), tokens: state.rations.lastTopUp.tokens, at: state.rations.lastTopUp.at, origin: state.rations.lastTopUp.origin } : null, lastSpend: state.rations.lastSpend ? { tokens: state.rations.lastSpend.tokens, provider: state.rations.lastSpend.provider, at: state.rations.lastSpend.at } : null },
    logs: state.logs.slice(0, 20).map(row => ({ at: row.at, level: row.level, category: text(row.category, 40), message: text(row.message) })),
  }
}
