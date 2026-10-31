import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Separate from model credentials: neither QQ sessions nor the sealing secret enter AppState. */
export function createQQVault(directory: string) {
  const file = join(directory, 'qq-music-session.enc.json')
  let cached: { secret: string; session?: string } | undefined
  function secure() {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('系统安全存储不可用，请解锁钥匙串后再连接QQ音乐。')
  }
  function load() {
    secure()
    if (cached) return cached
    if (existsSync(file)) {
      try {
        const envelope = JSON.parse(readFileSync(file, 'utf8'))
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')))
        if (typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret) || value.session !== undefined && (typeof value.session !== 'string' || value.session.length > 65536)) throw new Error()
        cached = value
      } catch { throw new Error('QQ音乐登录信息无法解密，请检查登录钥匙串；不会覆盖原登录信息。') }
    } else cached = { secret: randomBytes(32).toString('hex') }
    return cached!
  }
  function save() {
    secure()
    const temporary = `${file}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ encrypted: safeStorage.encryptString(JSON.stringify(load())).toString('base64') }), { mode: 0o600 })
      renameSync(temporary, file); chmodSync(file, 0o600)
    } catch { throw new Error('QQ音乐登录信息保存失败，请检查项目目录权限和磁盘空间。') }
  }
  return {
    get secret() { return load().secret },
    get() { return load().session },
    set(value: string | undefined) { load().session = value; save() },
  }
}
