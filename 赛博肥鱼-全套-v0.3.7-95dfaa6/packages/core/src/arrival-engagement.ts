import type { ShopTimePhase } from '../../shared/src/shop-time'

const REENTRY_MS = 10 * 60 * 1000
const salutations: Record<ShopTimePhase, string> = { morning: '早上好', day: '你好呀', dusk: '傍晚好', night: '晚上好' }

export const arrivalSalutation = (phase: ShopTimePhase) => salutations[phase]

/** One small opening per arrival batch; no model calls, reminders, or assumed viewer answers. */
export function createArrivalEngagement(now: () => number) {
  const invitedAt = new Map<string, number>()
  const spokenInvitations = new Map<string, { question: string; at: number }>()
  let variant = 0
  return {
    invite(input: { userIds: string[]; phase: ShopTimePhase; busy: boolean; existing?: string }): string | undefined {
      if (input.busy || !input.userIds.length) return
      const at = now()
      for (const [id, previous] of invitedAt) if (at - previous >= REENTRY_MS) invitedAt.delete(id)
      const ids = [...new Set(input.userIds)]
      if (input.existing) {
        for (const id of ids) if (!invitedAt.has(id)) invitedAt.set(id, at)
        while (invitedAt.size > 3000) invitedAt.delete(invitedAt.keys().next().value!)
        return input.existing
      }
      if (!ids.some(id => !invitedAt.has(id))) return
      const questions = [
        input.phase === 'night' ? '这会儿想听歌，还是聊两句？' : '今天先听歌，还是聊两句？',
        '现在的心情，能用一个字说说吗？',
        '你喜欢轻快的歌，还是安静的歌？',
        '刚忙完，还是路过逛逛？',
        input.phase === 'morning' ? '今天有件期待的小事吗？' : '今天过得顺利吗？',
        '你来选，先看本店长摆个鬼脸，还是听个冷笑话？',
      ]
      const question = questions[variant++ % questions.length]!
      for (const id of ids) invitedAt.set(id, at)
      while (invitedAt.size > 3000) invitedAt.delete(invitedAt.keys().next().value!)
      return question
    },
    spoken(userIds: string[], question: string) {
      for (const userId of userIds) spokenInvitations.set(userId, { question, at: now() })
      while (spokenInvitations.size > 3000) spokenInvitations.delete(spokenInvitations.keys().next().value!)
    },
    takeSpoken(userId: string): string | undefined {
      const item = spokenInvitations.get(userId)
      spokenInvitations.delete(userId)
      return item && now() - item.at < REENTRY_MS ? item.question : undefined
    },
  }
}
