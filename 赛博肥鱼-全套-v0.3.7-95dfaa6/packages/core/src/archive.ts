/*
 * The detailed record: every viewer event and every line she said back, kept for good.
 * Long-term memory (memory.ts) is the gist; when it does not cover something a viewer brings up, she looks it up here.
 * The desktop app keeps it in SQLite (apps/desktop/electron/storage.ts); the browser preview and tests use this
 * in-memory version.
 */

/** hidden: kept in the record (filtered or injection attempts) but never handed to the model. */
export interface ArchiveRow { id: string; userId: string; name: string; kind: 'chat' | 'gift' | 'enter' | 'follow' | 'like' | 'reply'; text: string; at: number; hidden?: boolean }
export interface Archive {
  append(rows: ArchiveRow[]): void
  /** The viewer's rows that share the most search terms with `terms`, older than `before`, best first. */
  search(userId: string, terms: string[], limit: number, before?: number): ArchiveRow[]
  /** The viewer's latest rows, newest first. */
  recent(userId: string, limit: number): ArchiveRow[]
  count(userId?: string): number
}

const STOP = new Set(['店长', '肥鱼', '你还', '还记', '记得', '得吗', '上次', '之前', '以前', '我们', '你们', '什么', '怎么', '这个', '那个', '一下', '是不', '不是', '没有', '就是', '可以', '今天', '晚上'])
/** Search terms for Chinese chat: two-character pieces of each run of letters, minus filler. */
export function terms(text: string) {
  const out = new Set<string>()
  for (const run of text.toLowerCase().match(/[一-龥]+|[a-z0-9]{2,}/g) ?? []) {
    if (/^[a-z0-9]+$/.test(run)) { out.add(run); continue }
    for (let i = 0; i + 1 < run.length; i++) { const bigram = run.slice(i, i + 2); if (!STOP.has(bigram)) out.add(bigram) }
  }
  return [...out].slice(0, 24)
}
export const score = (row: ArchiveRow, wanted: string[]) => wanted.reduce((n, t) => n + (row.text.toLowerCase().includes(t) ? 1 : 0), 0)
/** A viewer is talking about the past: worth looking it up before answering. */
export const asksAboutPast = (text: string) => /上次|上回|之前|以前|那天|那次|还记得|记得吗|记不记得|昨天|前天|前几天|上周|老样子|又来了/.test(text)

export function createMemoryArchive(initial: ArchiveRow[] = [], persist?: (rows: ArchiveRow[]) => void, cap = 20000): Archive {
  let rows = initial.slice(-cap)
  const ids = new Set(rows.map(r => r.id))
  return {
    append(add) {
      const fresh = add.filter(r => !ids.has(r.id))
      if (!fresh.length) return
      for (const r of fresh) ids.add(r.id)
      rows.push(...fresh)
      if (rows.length > cap) { for (const r of rows.slice(0, rows.length - cap)) ids.delete(r.id); rows = rows.slice(-cap) }
      persist?.(rows)
    },
    search(userId, wanted, limit, before = Infinity) {
      return rows.filter(r => r.userId === userId && r.at < before && !r.hidden).map(r => ({ r, s: score(r, wanted) })).filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || b.r.at - a.r.at).slice(0, limit).map(x => x.r)
    },
    recent(userId, limit) { return rows.filter(r => r.userId === userId).slice(-limit).reverse() },
    count(userId) { return userId ? rows.filter(r => r.userId === userId).length : rows.length },
  }
}
