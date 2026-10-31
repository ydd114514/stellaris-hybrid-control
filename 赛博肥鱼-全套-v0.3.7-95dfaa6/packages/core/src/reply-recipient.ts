import type { Reply } from '../../shared/src/index'

/** A short spoken label only; the original viewer identity remains in metadata. */
export function safeRecipientName(name: string): string {
  const original = typeof name === 'string' ? name.normalize('NFKC').trim().replace(/^模拟·/, '').trim() : ''
  const dangerous = /https?|www|sk-|(?:忽略|执行|绕过).*(?:指令|系统|命令|规则|限制|代码|设定)|(?:输出|透露|打印).*(?:密钥|提示词)|傻[逼比屄]|操你|你妈|fuck|bitch/i
  if (dangerous.test(original) || /[./\\:@?#&%=<>]/.test(original)) return '这位朋友'
  const value = original.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim()
  if (!value || Array.from(value).length > 12 || !/^[\p{L}\p{N} _·・-]+$/u.test(value) || dangerous.test(value)) return '这位朋友'
  return value
}

/** Called once speech is selected so TTS, captions and public history use identical words. */
export function ensureReplyRecipient(reply: Reply, maxLength: number): void {
  if (!reply.heard?.trim() || !reply.viewerName) return
  const limit = Number.isFinite(maxLength) ? Math.max(10, Math.floor(maxLength)) : 90
  let name = safeRecipientName(reply.viewerName)
  if (Array.from(name).length + 4 > limit) name = '这位朋友'
  const original = reply.viewerName.trim(), unmarked = original.replace(/^模拟·/, '').trim()
  let lines = reply.say.filter(line => typeof line === 'string' && line.trim()).map(line => {
    let result = original ? line.split(original).join(name) : line
    if (unmarked && unmarked !== original && name !== unmarked) result = result.split(unmarked).join(name)
    return result.trim()
  })
  if (!lines.length) lines = ['我在听。']
  const firstSentence = lines[0]!.split(/[。！？!?；;\n]/, 1)[0]!
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startsWithNonLatinName = Array.from(name).length >= 2 && !/\p{Script=Latin}/u.test(name) && firstSentence.startsWith(name)
  const addressed = startsWithNonLatinName || new RegExp(`(?:^|[，,:：、\\s])${escapedName}(?:$|[，,:：、\\s]|你好|同学|朋友|早上好|晚上好|呀|啊|哟|～|~)`, 'iu').test(firstSentence)
  if (!addressed) lines[0] = `${name}，${lines[0]}`
  let remaining = limit
  reply.say = lines.flatMap(line => {
    if (!remaining) return []
    const characters = Array.from(line)
    const value = characters.length <= remaining ? line : characters.slice(0, Math.max(0, remaining - 1)).join('') + '…'
    remaining -= Array.from(value).length
    return value ? [value] : []
  })
}
