import type { AppConfig, SessionTurn } from '../../shared/src'

interface ProactiveLedger { attempts: number[]; lastAt: number; quietStreak: number }
const HOUR = 3600000
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
/** One reservation covers the entire autonomous turn (AI + TTS, or preset + TTS). */
export function createProactiveSpeechBudget(now: () => number, stored?: unknown) {
  const raw = stored && typeof stored === 'object' ? stored as Partial<ProactiveLedger> : {}
  let attempts = Array.isArray(raw.attempts) ? raw.attempts.filter(value => valid(value) && value <= now() && value > now() - HOUR).slice(-24) : []
  let lastAt = valid(raw.lastAt) && raw.lastAt <= now() ? raw.lastAt : now()
  let quietStreak = typeof raw.quietStreak === 'number' && Number.isSafeInteger(raw.quietStreak) ? Math.max(0, Math.min(3, raw.quietStreak)) : 0
  function status(config: AppConfig['idle']) {
    attempts = attempts.filter(at => at > now() - HOUR && at <= now())
    const limit = Math.max(0, Math.min(24, Math.floor(config.hourlySpeechLimit)))
    const quietMinimum = config.entertainment ? 120 : 300
    const interval = quietStreak >= 3 ? Math.max(quietMinimum, Math.min(600, config.quietBackoffSeconds)) : Math.max(120, config.chatterSeconds)
    // Spread show slots across the hour instead of spending every slot then going silent.
    const seconds = config.entertainment && limit ? Math.max(interval, 3600 / limit) : interval
    return { used: attempts.length, limit, quietStreak, nextAllowedAt: lastAt + seconds * 1000 }
  }
  return {
    status,
    reserve(config: AppConfig['idle']) { const value = status(config); if (!value.limit || value.used >= value.limit || now() < value.nextAllowedAt) return false; lastAt = now(); attempts.push(lastAt); quietStreak = Math.min(3, quietStreak + 1); return true },
    spoken() { lastAt = now(); if (attempts.length) attempts[attempts.length - 1] = lastAt },
    audience() { quietStreak = 0 },
    snapshot(): ProactiveLedger { return { attempts: [...attempts], lastAt, quietStreak } },
  }
}

/** Only public, non-sensitive chat provides a continuation; explicit goodbyes close it. */
export function publicTopicContinuation(turns: readonly SessionTurn[], safe: (text: string) => boolean) {
  const latest = turns.at(-1)
  if (!latest || /不想聊|先不聊|别(?:再)?问|让我安静|我想安静|再见|拜拜|下次再说|我去忙|先走了|晚点再聊/.test(latest.heard)) return []
  const ordinary = turns.filter(turn => safe(turn.heard) && safe(turn.said) && !/^[#!！/]?(?:点歌|点一首|切歌|投票切歌|下一首|取消点歌|投\d)|^(?:我(?:已经)?关注|我送|送出|给你送)/.test(turn.heard))
  const acknowledgement = /^(?:嗯|哦|啊|哈|好|对|是|谢谢|收到|明白|可以|行|没错|确实|赞|棒|嘿嘿|你好|早安|晚安|早上好|晚上好|呀|了|啦|呢|喔|哇|[，。！？,.!?\s])+$/u
  let anchor = -1
  for (let index = ordinary.length - 1; index >= 0; index--) {
    const turn = ordinary[index]!
    if (turn.heard.trim().length >= 2 && !acknowledgement.test(turn.heard.trim()) || /^(?:聊|说说|我想聊|换个话题)/.test(turn.heard)) { anchor = index; break }
  }
  if (anchor < 0) return []
  const context = ordinary.slice(Math.max(0, anchor - 2), anchor + 1)
  return context.map(turn => ({ at: turn.at, heard: turn.heard.slice(0, 120), said: turn.said.slice(0, 200) }))
}
