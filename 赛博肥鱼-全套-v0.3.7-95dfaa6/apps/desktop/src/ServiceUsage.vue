<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { voiceBillingUnit } from '../../../packages/core/src/usage'
import type { AppState } from '../../../packages/shared/src'

const props = defineProps<{ state: AppState }>()
const emit = defineEmits<{ 'open-budget': [] }>()
const count = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value).toLocaleString('zh-CN') : '—'
const money = (value: number) => Number.isFinite(value) ? value.toFixed(value > 0 && value < .1 ? 4 : 2) : '—'
const legacy = computed(() => !!props.state.costs.legacyUsageIncomplete)
const apiCountsIncomplete = computed(() => !!props.state.costs.apiCountsIncomplete)
const brainMissing = computed(() => Math.max(0, props.state.costs.brainUsageMissing || 0))
const voiceMissing = computed(() => Math.max(0, props.state.costs.voiceUsageMissing || 0))
const token = (value: number | undefined, missing = 0) => typeof value === 'number' ? `${missing || legacy.value ? '至少 ' : ''}${count(value)}` : '未记录'
const brainLabel = computed(() => props.state.config.brain.provider === 'deepseek' ? 'DeepSeek 对话' : props.state.config.brain.provider === 'qwen' ? '千问对话' : '对话服务')
const voiceTokens = computed(() => voiceBillingUnit(props.state.config.voice.model) === 'tokens')
const pricesMissing = computed(() => {
  const labels: string[] = []
  if (!(props.state.config.brain.inputPrice > 0) || !(props.state.config.brain.outputPrice > 0)) labels.push(brainLabel.value)
  if (voiceTokens.value ? !(Number(props.state.config.voice.inputPrice) > 0) || !(Number(props.state.config.voice.outputPrice) > 0) : !(props.state.config.voice.pricePer10kChars > 0)) labels.push('千问配音')
  return labels
})
const costUnknown = computed(() => props.state.costs.unpricedRequests > 0 || legacy.value)
const pending = (total: number | undefined, success: number | undefined, failed: number | undefined, cancelled: number | undefined) => Math.max(0, (total || 0) - (success || 0) - (failed || 0) - (cancelled || 0))
</script>

<template>
 <section class="card service-usage" data-testid="service-usage">
  <div class="card-head"><div><span class="eyebrow">当前小店场次</span><h2>两家服务用量</h2></div><button class="btn ghost small" @click="emit('open-budget')"><Icon name="settings" :size="14"/>费用与单价</button></div>
  <p class="muted small">只累计服务实际返回的用量；独立测试窗口显示它自己的本场数据，测试报告单独保存。</p>
  <div class="usage-services">
   <article class="usage-provider" data-testid="brain-usage">
    <div class="usage-provider-head"><div><h3>{{brainLabel}}</h3><p class="muted small usage-model">{{state.config.brain.model}}</p></div><div class="usage-call-total"><b>{{count(state.costs.brainApiRequests)}}</b><span>{{apiCountsIncomplete?'至少已记录的':'实际'}}请求</span></div></div>
    <div class="usage-outcomes"><span>成功 <b>{{count(state.costs.brainApiSucceeded)}}</b></span><span :class="{warning:state.costs.brainApiFailed>0}">失败 <b>{{count(state.costs.brainApiFailed)}}</b></span><span>已取消 <b>{{count(state.costs.brainApiCancelled)}}</b></span><span v-if="pending(state.costs.brainApiRequests,state.costs.brainApiSucceeded,state.costs.brainApiFailed,state.costs.brainApiCancelled)" class="pending">进行中 {{pending(state.costs.brainApiRequests,state.costs.brainApiSucceeded,state.costs.brainApiFailed,state.costs.brainApiCancelled)}}</span></div>
    <dl class="usage-tokens"><div><dt>输入 token</dt><dd>{{token(state.costs.inputTokens,brainMissing)}}</dd></div><div><dt>输出 token</dt><dd>{{token(state.costs.outputTokens,brainMissing)}}</dd></div></dl>
    <p class="small usage-cache">缓存命中 <b>{{token(state.costs.cacheHitTokens,brainMissing)}}</b> · 未命中 <b>{{token(state.costs.cacheMissTokens,brainMissing)}}</b></p>
    <p v-if="brainMissing" class="small usage-incomplete">{{brainMissing}} 次请求用量未完整返回，缺失部分待核算。</p>
   </article>
   <article class="usage-provider" data-testid="voice-usage">
    <div class="usage-provider-head"><div><h3>千问配音</h3><p class="muted small usage-model">{{state.config.voice.model}}</p></div><div class="usage-call-total"><b>{{count(state.costs.voiceApiRequests)}}</b><span>{{apiCountsIncomplete?'至少已记录的':'实际'}}请求</span></div></div>
    <div class="usage-outcomes"><span>成功 <b>{{count(state.costs.voiceApiSucceeded)}}</b></span><span :class="{warning:state.costs.voiceApiFailed>0}">失败 <b>{{count(state.costs.voiceApiFailed)}}</b></span><span>已取消 <b>{{count(state.costs.voiceApiCancelled)}}</b></span><span v-if="pending(state.costs.voiceApiRequests,state.costs.voiceApiSucceeded,state.costs.voiceApiFailed,state.costs.voiceApiCancelled)" class="pending">进行中 {{pending(state.costs.voiceApiRequests,state.costs.voiceApiSucceeded,state.costs.voiceApiFailed,state.costs.voiceApiCancelled)}}</span></div>
    <dl class="usage-tokens"><div><dt>输入 token</dt><dd>{{token(state.costs.voiceInputTokens,voiceMissing)}}</dd></div><div><dt>输出音频 token</dt><dd>{{token(state.costs.voiceOutputTokens,voiceMissing)}}</dd></div></dl>
    <p class="small usage-cache">计费字符 <b>{{count(Math.max(0,state.costs.voiceCharacters-state.costs.voiceCharactersEstimated))}}</b><span v-if="state.costs.voiceCharactersEstimated"> · 另有 {{count(state.costs.voiceCharactersEstimated)}} 字估算</span>；不换算成 token。</p>
    <p v-if="voiceMissing" class="small usage-incomplete">{{voiceMissing}} 次请求用量未完整返回，缺失部分待核算。</p>
   </article>
  </div>
  <div class="usage-cost"><div><span class="muted small">本场费用估算</span><strong>{{costUnknown?'待核算':'¥ '+money(state.costs.session)}}</strong><span v-if="costUnknown" class="muted small">已知部分 ¥ {{money(state.costs.session)}} · {{state.costs.unpricedRequests||'历史'}} 笔未计全</span></div><p class="muted small">{{brainMissing||voiceMissing||legacy?'“至少”只含已收到用量，失败或取消后仍可能有待核算费用。':'请求次数不包含被本机拦截、尚未发出的请求。'}}</p></div>
  <div v-if="pricesMissing.length" class="notice warning usage-notice"><Icon name="help" :size="15"/><span>{{pricesMissing.join('、')}}单价未完整配置，金额不能当作实际免费。请到「费用与单价」补充。</span></div>
  <p v-if="apiCountsIncomplete" class="small usage-incomplete">旧版没有记录实际调用次数，以上仅列升级后已记录值；新一场会完整记录后续实际请求。</p>
 </section>
</template>

<style scoped>
.service-usage .card-head h2{margin-top:5px}.usage-services{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.usage-provider{padding:17px;border:1px solid var(--border);background:var(--surface-2);border-radius:12px;min-width:0}.usage-provider-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.usage-provider-head h3{font-size:14px;font-weight:600}.usage-model{margin-top:5px;overflow-wrap:anywhere;max-width:240px}.usage-call-total{text-align:right;display:grid;gap:3px;flex:none}.usage-call-total b{font:24px ui-monospace,monospace;color:var(--accent-2)}.usage-call-total span{font-size:10px;color:var(--muted)}.usage-outcomes{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:16px}.usage-outcomes b{font-weight:500;color:var(--text-2)}.usage-outcomes .warning,.usage-incomplete{color:#e8b68e}.usage-outcomes .pending{color:var(--accent)}.usage-tokens{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0 14px}.usage-tokens dt{font-size:11px;color:var(--muted);margin-bottom:7px}.usage-tokens dd{font:18px ui-monospace,monospace;color:var(--text);margin:0;overflow-wrap:anywhere}.usage-cache{color:var(--muted);line-height:1.6}.usage-cache b{font-weight:500;color:var(--text-2)}.usage-incomplete{line-height:1.6;margin-top:8px}.usage-cost{display:flex;gap:16px;justify-content:space-between;align-items:center;padding-top:4px}.usage-cost>div{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.usage-cost strong{font-size:19px;color:var(--accent-2)}.usage-cost>p{max-width:350px;line-height:1.6}.usage-notice{align-items:flex-start}.usage-notice svg{flex:none;margin-top:2px}@media(max-width:1400px){.usage-services{grid-template-columns:1fr}.usage-cost{align-items:flex-start;flex-direction:column;gap:8px}.usage-cost>p{max-width:none}}
</style>
