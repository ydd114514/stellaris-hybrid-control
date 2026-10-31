import type { AppConfig, VoiceBillingData } from '../../shared/src/index'

/** A missing upstream field is unknown, not a reported zero. */
export const usageNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined

/** Official Qwen-Audio HTTP billing: 3.1 Flash uses tokens; Plus/3.0 use characters. */
export const voiceBillingUnit = (model: string) => /^qwen-audio-3\.1-tts-flash(?:-|$)/.test(model) ? 'tokens' as const : 'characters' as const

export function calculateVoiceUsage(data: VoiceBillingData | undefined, config: AppConfig['voice'], fallbackCharacters = 0, interrupted = false) {
  const inputTokens = usageNumber(data?.usage?.inputTokens), outputTokens = usageNumber(data?.usage?.outputTokens)
  const reportedCharacters = usageNumber(data?.chargedCharacters ?? data?.characters)
  const characters = reportedCharacters ?? Math.max(0, fallbackCharacters)
  const characterCountEstimated = data?.charactersReported === false || data?.usageUncertain === true || reportedCharacters === undefined && characters > 0
  const tokensMissing = inputTokens === undefined || outputTokens === undefined || interrupted
  const explicitCost = usageNumber(data?.cost)
  let cost = 0, costUnknown = interrupted
  if (explicitCost !== undefined) cost = explicitCost
  else if (voiceBillingUnit(config.model) === 'tokens') {
    const inputPrice = usageNumber(config.inputPrice) ?? 0, outputPrice = usageNumber(config.outputPrice) ?? 0
    cost = ((inputTokens ?? 0) * inputPrice + (outputTokens ?? 0) * outputPrice) / 1e6
    costUnknown ||= tokensMissing || (inputTokens ?? 0) > 0 && inputPrice <= 0 || (outputTokens ?? 0) > 0 && outputPrice <= 0
  } else {
    const price = usageNumber(config.pricePer10kChars) ?? 0
    cost = characters / 1e4 * price
    costUnknown ||= reportedCharacters === undefined || characterCountEstimated || characters > 0 && price <= 0
  }
  return { inputTokens, outputTokens, characters, characterCountEstimated, tokensMissing, cost, costUnknown }
}
