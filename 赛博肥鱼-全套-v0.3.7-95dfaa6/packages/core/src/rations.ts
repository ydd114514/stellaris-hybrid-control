import type { InputOrigin, RationsState } from '../../shared/src/index'
import { inputOrigin } from './input-statistics'
import { usageNumber } from './usage'

const MAX = Number.MAX_SAFE_INTEGER
const bounded = (value: number) => Math.max(-MAX, Math.min(MAX, value))
const count = (value: unknown, fallback = 0) => usageNumber(value) ?? fallback
const label = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) : ''
export const createRations = (): RationsState => ({ balance: 100000, earned: 0, spent: 0, unknownRequests: 0 })

/** No migration from costs: old requests did not have a ration ledger. */
export function restoreRations(value: unknown): RationsState {
  const result = createRations()
  if (!value || typeof value !== 'object') return result
  const data = value as Record<string, any>
  if (typeof data.balance === 'number' && Number.isFinite(data.balance) && Math.abs(data.balance) <= MAX) result.balance = data.balance
  for (const key of ['earned', 'spent', 'unknownRequests'] as const) result[key] = count(data[key])
  if (data.lastTopUp && typeof data.lastTopUp === 'object' && count(data.lastTopUp.tokens) > 0) {
    result.lastTopUp = { name: label(data.lastTopUp.name) || '补给', tokens: count(data.lastTopUp.tokens), at: count(data.lastTopUp.at), origin: inputOrigin(data.lastTopUp.origin) }
  }
  if (data.lastSpend && typeof data.lastSpend === 'object' && count(data.lastSpend.tokens) > 0 && ['deepseek', 'qwen', 'custom'].includes(data.lastSpend.provider)) {
    result.lastSpend = { tokens: count(data.lastSpend.tokens), provider: data.lastSpend.provider, at: count(data.lastSpend.at) }
  }
  return result
}

export function topUpRations(state: RationsState, tokens: number, name: string, origin: InputOrigin, at: number) {
  if (usageNumber(tokens) === undefined || tokens <= 0) return
  state.balance = bounded(state.balance + tokens)
  state.earned = Math.min(MAX, state.earned + tokens)
  state.lastTopUp = { name: label(name) || '补给', tokens, origin: inputOrigin(origin), at }
}

/** Call from the request's once-only billing closure, including late/cancelled results. */
export function spendRations(state: RationsState, provider: NonNullable<RationsState['lastSpend']>['provider'], input: unknown, output: unknown, at: number) {
  const inputTokens = usageNumber(input), outputTokens = usageNumber(output)
  if (inputTokens === undefined || outputTokens === undefined) state.unknownRequests = Math.min(MAX, state.unknownRequests + 1)
  const tokens = Math.min(MAX, (inputTokens ?? 0) + (outputTokens ?? 0))
  if (tokens <= 0) return
  state.balance = bounded(state.balance - tokens)
  state.spent = Math.min(MAX, state.spent + tokens)
  state.lastSpend = { tokens, provider, at }
}
