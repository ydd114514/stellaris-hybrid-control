import type { Reply } from '../../packages/shared/src'

export interface CounterChatTurn { id: string; name: string; heard: string; reply: string }
const clean = (value: string) => value.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/g, '[已隐藏]').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
const width = (value: string) => Array.from(value).reduce((sum, char) => sum + (/[^\u0000-\u007f]/.test(char) ? 1 : .56), 0)
function clip(value: string, limit: number) {
  if (width(value) <= limit) return value
  let result = ''
  for (const char of Array.from(value)) { if (width(result + char) > limit - 1) break; result += char }
  return result + '…'
}

/** Only already public speech, never drafts, review text, settings, or provider metadata. */
export function counterChat(history: readonly Reply[]): CounterChatTurn[] {
  const seen = new Set<string>()
  return [...history].sort((a, b) => b.createdAt - a.createdAt).filter(turn => {
    // Names are not identities: distinct events from same-name viewers stay distinct.
    const key = turn.eventId?.trim() ? `event:${turn.eventId}` : `reply:${turn.id}`
    if (seen.has(key) || !['speaking', 'done'].includes(turn.status) || !turn.heard?.trim() || !turn.say.some(line => line.trim())) return false
    seen.add(key); return true
  }).slice(0, 2).reverse().map(turn => {
    const name = clip(clean(turn.viewerName || '路过的客人'), 6)
    return { id: turn.id, name, heard: clip(clean(turn.heard!), 26 - width(name) - 1.2), reply: clip(clean(turn.say.join('')), 23.5) }
  })
}
