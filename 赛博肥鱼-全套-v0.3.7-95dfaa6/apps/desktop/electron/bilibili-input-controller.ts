import type { Command, CommandResult } from '../../../packages/shared/src'
import type { BilibiliCredentials } from './bilibili-receiver'
type StoredCredentials = Omit<BilibiliCredentials, 'appId'> & { appId: string }

interface CredentialStore { get(provider: string): string | undefined; set(provider: string, value: string): void }
interface Receiver { info(): { state: string; message: string; received: number; reconnects: number }; start(): Promise<unknown>; stop(): unknown }
type InputCommand = Extract<Command, { type: 'bilibili-input-info' | 'bilibili-input-start' | 'bilibili-input-stop' | 'bilibili-input-clear' | 'bilibili-input-save' }>
const fields = ['accessKeyId', 'accessKeySecret', 'appId', 'identityCode'] as const

/** Account material stays in the main process's encrypted credential store. */
export function createBilibiliInputController(options: { store: CredentialStore; receiver: Receiver; disabled?: boolean }) {
  let operation = 0, connecting = false
  function credentials(): StoredCredentials | undefined {
    if (options.disabled) return
    try {
      const value = JSON.parse(options.store.get('bilibili') || 'null') as StoredCredentials | null
      if (!value || !fields.every(field => typeof value[field] === 'string' && value[field].trim())) return
      return { accessKeyId: value.accessKeyId, accessKeySecret: value.accessKeySecret, appId: value.appId, identityCode: value.identityCode }
    } catch { return }
  }
  const info = () => ({ ...options.receiver.info(), configured: !!credentials(), ...(options.disabled ? { message: '独立测试不连接真实 B 站直播间，也不读取已保存的接入信息。' } : {}) })
  async function command(command: InputCommand): Promise<CommandResult> {
    if (command.type === 'bilibili-input-info') return { ok: true, data: info() }
    if (options.disabled) return { ok: false, message: '独立测试不保存账号信息或连接真实 B 站直播间，请在直播工作台配置。' }
    if (command.type === 'bilibili-input-save') {
      const old = credentials(), next = {} as StoredCredentials
      for (const field of fields) {
        if (typeof command[field] !== 'string') return { ok: false, message: 'B 站接入信息格式不正确，请重新填写。' }
        const value = command[field].trim() || old?.[field] || ''
        if (!value || value.length > 256 || /[\s\u0000-\u001f\u007f]/u.test(value)) return { ok: false, message: '首次配置请完整填写四项接入信息；每项最多 256 字，不能含空格或控制字符。' }
        next[field] = value
      }
      if (!/^[1-9]\d{0,14}$/.test(next.appId) || !Number.isSafeInteger(Number(next.appId))) return { ok: false, message: '项目 App ID 需要是 B 站开放平台分配的正整数。' }
      // Write first: an encryption failure must leave the live connection untouched.
      try { options.store.set('bilibili', JSON.stringify(next)) }
      catch { return { ok: false, message: 'B 站接入信息未能加密保存，请检查系统安全存储后重试。' } }
      operation++; connecting = false; void options.receiver.stop()
      return { ok: true, data: info(), message: 'B 站接入信息已加密保存。点击连接后开始接收互动。' }
    }
    if (command.type === 'bilibili-input-clear') {
      try { options.store.set('bilibili', '') }
      catch { return { ok: false, message: 'B 站接入信息未能清除，请重试。' } }
      operation++; connecting = false; void options.receiver.stop()
      return { ok: true, data: info(), message: 'B 站连接已停止，保存的接入信息已清除。' }
    }
    if (command.type === 'bilibili-input-stop') {
      operation++; connecting = false; void options.receiver.stop()
      return { ok: true, data: info(), message: 'B 站互动接收已停止，抖音和直播音画继续。' }
    }
    if (!credentials()) return { ok: false, message: '请先保存 B 站开放平台 Access Key ID、Secret、项目 App ID 和主播身份码。' }
    if (connecting || ['connecting', 'connected', 'reconnecting'].includes(options.receiver.info().state)) return { ok: true, data: info(), message: 'B 站互动连接已在运行。' }
    const run = ++operation; connecting = true
    try {
      await options.receiver.start()
      if (run !== operation) return { ok: false, message: '本次 B 站连接已取消。' }
      const status = info()
      return { ok: !['error', 'ended', 'stopped'].includes(status.state), data: status, message: status.message }
    } catch { return { ok: false, message: 'B 站连接未完成，请核对接入信息、项目权限与网络。' } }
    finally { if (run === operation) connecting = false }
  }
  return { credentials, info, command }
}
