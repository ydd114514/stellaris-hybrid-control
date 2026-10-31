import { safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { score, type Archive, type ArchiveRow } from '../../../packages/core/src/archive'

function writePrivate(path: string, value: unknown) {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}
function readObject(path: string): Record<string, any> | undefined {
  try { const value = JSON.parse(readFileSync(path, 'utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) return value } catch { /* First launch or corrupted file: defaults remain usable. */ }
}

/** API keys are encrypted with the OS-backed Electron safeStorage key (Keychain on macOS). */
export function createCredentialStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'credentials.enc.json')
  const isSecure = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  return {
    get encrypted() { return isSecure() },
    get(provider: string): string | undefined {
      if (!isSecure() || !['deepseek', 'qwen', 'bilibili'].includes(provider)) return
      const encoded = readObject(path)?.[provider]
      if (typeof encoded !== 'string') return
      try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')) } catch { return }
    },
    set(provider: string, key: string) {
      if (!['deepseek', 'qwen', 'bilibili'].includes(provider)) throw new Error('未知的密钥类型。')
      const current = readObject(path) || {}
      if (!key.trim()) { delete current[provider]; writePrivate(path, current); return }
      if (!isSecure()) throw new Error('系统安全存储不可用。请确认已登录系统账户（macOS 请解锁登录钥匙串）后重试；应用不会明文保存密钥。')
      if (key.length > 2048) throw new Error('密钥长度不正确，请重新复制。')
      current[provider] = safeStorage.encryptString(key.trim()).toString('base64')
      writePrivate(path, current)
    },
  }
}

/** State in SQLite; human-readable settings in JSON. No external native module required. */
export function createPersistentStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const configPath = join(directory, 'config.json')
  const databasePath = join(directory, 'shop.sqlite')
  const db = new DatabaseSync(databasePath)
  chmodSync(databasePath, 0o600)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS viewers (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS utterances (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS archive (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS archive_user_at ON archive(user_id, at);
  `)
  let configCache = ''
  let lastPayload = ''
  let closed = false
  let pendingState: Record<string, any> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let backgroundError: unknown
  let viewerCache = new Map<string, string>()
  let utteranceCache = new Map<string, string>()
  let logCache = new Map<string, string>()
  const stateSave = db.prepare('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
  const viewerSave = db.prepare('INSERT INTO viewers(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
  const utteranceSave = db.prepare('INSERT INTO utterances(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
  const logSave = db.prepare('INSERT INTO logs(id,at,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,payload=excluded.payload')
  const archiveInsert = db.prepare('INSERT OR IGNORE INTO archive(id,user_id,name,kind,text,at,hidden) VALUES(?,?,?,?,?,?,?)')
  const toRow = (r: any): ArchiveRow => ({ id: r.id, userId: r.user_id, name: r.name, kind: r.kind, text: r.text, at: r.at, hidden: !!r.hidden })
  const rowCache = (rows: { id: string }[] | undefined) => new Map((rows || []).map(row => [row.id, JSON.stringify(row)]))
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
    if (closed || !pendingState) return
    const state = pendingState
    const persisted = { ...state, credentials: undefined, running: false, generating: false, stage: { ...state.stage, speaking: false, text: '', audio: undefined }, queue: [], drafts: [] }
    const payload = JSON.stringify(persisted)
    if (payload === lastPayload) { pendingState = undefined; backgroundError = undefined; return }
    const viewers = rowCache(state.viewers), utterances = rowCache(state.history), logs = rowCache(state.logs)
    db.exec('BEGIN')
    try {
      stateSave.run(payload, Date.now())
      for (const [id, json] of viewers) if (viewerCache.get(id) !== json) viewerSave.run(id, json)
      for (const [id, json] of utterances) if (utteranceCache.get(id) !== json) utteranceSave.run(id, json)
      for (const log of state.logs || []) { const json = logs.get(log.id)!; if (logCache.get(log.id) !== json) logSave.run(log.id, log.at, json) }
      db.exec('COMMIT')
      // Only cache rows after the transaction commits. Each map follows the bounded live snapshot.
      viewerCache = viewers; utteranceCache = utterances; logCache = logs
      lastPayload = payload; pendingState = undefined; backgroundError = undefined
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  function scheduleSave() {
    if (saveTimer || closed) return
    // Coalesce the many snapshots generated by one conversation or incoming burst.
    // The append-only chat archive below still commits immediately and is never coalesced.
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      try { flush() } catch (error) { backgroundError = error }
    }, 200)
    saveTimer.unref?.()
  }
  /** Every viewer event and her answers, never deleted. Search narrows with LIKE, then ranks by shared terms. */
  const archive: Archive = {
    append(rows) {
      if (closed || !rows.length) return
      db.exec('BEGIN')
      try { for (const r of rows) archiveInsert.run(r.id, r.userId, r.name, r.kind, r.text, r.at, r.hidden ? 1 : 0); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    search(userId, terms, limit, before = Number.MAX_SAFE_INTEGER) {
      const wanted = terms.slice(0, 12)
      if (closed || !wanted.length) return []
      const like = wanted.map(() => 'text LIKE ?').join(' OR ')
      const rows = db.prepare(`SELECT * FROM archive WHERE user_id = ? AND at < ? AND hidden = 0 AND (${like}) ORDER BY at DESC LIMIT 400`).all(userId, before, ...wanted.map(t => `%${t.replace(/[%_]/g, '')}%`)).map(toRow)
      return rows.map(r => ({ r, s: score(r, wanted) })).sort((a, b) => b.s - a.s || b.r.at - a.r.at).slice(0, limit).map(x => x.r)
    },
    recent(userId, limit) { return closed ? [] : db.prepare('SELECT * FROM archive WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(userId, limit).map(toRow) },
    count(userId) { return closed ? 0 : Number((userId ? db.prepare('SELECT COUNT(*) AS n FROM archive WHERE user_id = ?').get(userId) : db.prepare('SELECT COUNT(*) AS n FROM archive').get() as any)?.n ?? 0) },
  }
  return {
    archive,
    flush,
    load() {
      flush()
      const row = db.prepare('SELECT payload FROM app_state WHERE id=1').get() as { payload: string } | undefined
      let state: Record<string, any> | undefined
      try { state = row ? JSON.parse(row.payload) : undefined } catch { /* Safe defaults if an old app wrote incompatible data. */ }
      if (state) { lastPayload = row!.payload; viewerCache = rowCache(state.viewers); utteranceCache = rowCache(state.history); logCache = rowCache(state.logs) }
      const config = readObject(configPath)
      if (config) { state = { ...(state || {}), config }; configCache = JSON.stringify(config) }
      // A relaunch never replays speech or resumes unattended paid requests.
      if (state) return { ...state, running: false, generating: false, queue: [], drafts: [], stage: { ...state.stage, speaking: false, audio: undefined, text: '', muted: false }, costs: { ...state.costs, session: 0 } }
    },
    save(state: Record<string, any>) {
      if (closed) return
      const configJson = JSON.stringify(state.config)
      if (configJson !== configCache) { writePrivate(configPath, state.config); configCache = configJson }
      // Live PCM and expiring provider URLs never enter the pending persistence queue.
      pendingState = { ...state, stage: { ...state.stage, audio: undefined } }
      scheduleSave()
      // A timer cannot throw into the runtime. Report its failure through the existing save()
      // error path on the next update, while keeping the latest snapshot queued for retry.
      if (backgroundError) { const error = backgroundError; backgroundError = undefined; throw error }
    },
    close() { if (!closed) { flush(); closed = true; db.close() } },
  }
}
