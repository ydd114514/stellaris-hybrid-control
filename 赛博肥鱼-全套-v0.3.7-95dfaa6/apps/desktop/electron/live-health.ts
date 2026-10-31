import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../../../packages/shared/src'

const safe = (value: string) => value.replace(/https?:\/\/\S+/gi, '[地址]').replace(/\bsk-[\w.-]{8,}/gi, '[已隐藏]').slice(0, 220)
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function numbers(value: unknown, keys: readonly string[]) { const source = record(value), result: Record<string, number> = {}; for (const key of keys) { const item = source[key]; if (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0) result[key] = item }; return result }
function inputDiagnostics(value: unknown) {
  const source = record(value), primary = record(source.primary), result: { primary?: { methods: Record<string, number>; giftRejections: Record<string, number> }; screen?: Record<string, number>; failover?: Record<string, number> } = {}
  const methods = numbers(primary.methods, ['chat', 'enter', 'follow', 'like', 'gift', 'control', 'other']), giftRejections = numbers(primary.giftRejections, ['identity', 'details', 'count', 'ambiguousCombo', 'nonComboFinal', 'malformed'])
  if (Object.keys(methods).length || Object.keys(giftRejections).length) result.primary = { methods, giftRejections }
  const screen = numbers(source.screen, ['frames', 'candidates', 'errorCount', 'lastFrameAt']), failover = numbers(source.failover, ['deliveredBridge', 'deliveredScreen', 'ignored', 'duplicates', 'pendingScreenGifts'])
  if (Object.keys(screen).length) result.screen = screen
  if (Object.keys(failover).length) result.failover = failover
  return result
}
/** Minimal, local, read-only monitoring data. No message text, credentials, audio, cookies or source URLs. */
export function liveHealthSnapshot(state: AppState, at = Date.now(), closed = false, diagnostics?: unknown) {
  return { at, pid: process.pid, version: state.version, closed, running: !closed && state.running, generating: !closed && state.generating,
    stage: { speaking: !closed && state.stage.speaking, muted: state.stage.muted, action: state.stage.action, face: state.stage.face, hasReply: !!state.stage.replyId },
    audio: { mode: state.config.audio.mode, dedicatedDeviceSelected: !!state.config.audio.streamDeviceId, monitorEnabled: state.config.audio.monitorEnabled, connection: safe(state.connection.voice) },
    music: { status: closed ? 'stopped' : state.music.status, bgm: !!state.music.current?.isBgm, queued: state.music.queue.length, searching: state.music.searches.length },
    input: { connection: safe(state.connection.input), lastEventAt: state.inputStatistics.lastEvent?.at, lastOrigin: state.inputStatistics.lastEvent?.origin, counts: state.inputStatistics.counts, ...(diagnostics === undefined ? {} : { diagnostics: inputDiagnostics(diagnostics) }) },
    mood: state.roomMood.kind, queueLength: state.queue.length, draftCount: state.drafts.length,
    usage: { deepseekRequests: state.costs.brainApiRequests, deepseekFailed: state.costs.brainApiFailed, qwenRequests: state.costs.voiceApiRequests, qwenFailed: state.costs.voiceApiFailed, inputTokens: state.costs.inputTokens, outputTokens: state.costs.outputTokens, voiceInputTokens: state.costs.voiceInputTokens, voiceOutputTokens: state.costs.voiceOutputTokens, incomplete: state.costs.unpricedRequests, knownEstimatedCNY: state.costs.session },
    warnings: state.logs.filter(row => row.level === 'warn' || row.level === 'error').slice(0, 8).map(row => ({ at: row.at, category: safe(row.category), message: safe(row.message) })),
  }
}

export function createLiveHealthReporter(folder: string, getState: () => AppState, intervalMs = 10000, getInputDiagnostics?: () => unknown) {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const path = join(folder, 'live-health.json'), temp = path + '.tmp'
  let stopped = false
  function write(closed = false) { try { let diagnostics: unknown; if (getInputDiagnostics) { try { diagnostics = getInputDiagnostics() ?? {} } catch { diagnostics = {} } }; writeFileSync(temp, JSON.stringify(liveHealthSnapshot(getState(), Date.now(), closed, diagnostics)), { mode: 0o600 }); renameSync(temp, path) } catch { /* Observation cannot interrupt the show. */ } }
  write()
  const timer = setInterval(() => { if (!stopped) write() }, Math.max(5000, intervalMs)); timer.unref()
  return { path, stop() { if (stopped) return; stopped = true; clearInterval(timer); write(true) } }
}
