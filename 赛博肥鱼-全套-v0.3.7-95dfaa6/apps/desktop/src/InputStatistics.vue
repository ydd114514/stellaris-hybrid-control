<script setup lang="ts">
import { computed } from 'vue'
import type { InputOrigin, InputStatistics } from '../../../packages/shared/src'
const props = defineProps<{ statistics: InputStatistics }>()
const labels: Record<InputOrigin, string> = { simulator: '模拟排练', bridge: '本机接入 · 未核验', screen: '屏幕识别 · 未核验', unknown: '来源未标明' }
const kinds = { chat: '评论', gift: '礼物', enter: '进场', follow: '关注', like: '点赞' }
const rows = computed(() => (['simulator', 'bridge', 'screen', 'unknown'] as const).map(origin => ({ origin, label: labels[origin], ...(props.statistics.counts[origin] || { comments: 0, giftEvents: 0, giftCount: 0, reportedDiamonds: 0, refDiamonds: 0, unknownValueGiftCount: 0 }) })))
const last = computed(() => props.statistics.lastEvent)
const time = (at: number) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
</script>
<template>
  <section class="card input-statistics" data-testid="input-statistics">
    <div class="card-head"><h2>本场消息与礼物来源</h2><span class="tag">独立事件 · 连击计净增</span></div>
    <p class="small" role="status" data-testid="input-last-event">{{ last ? `最后有效消息：${labels[last.origin]} · ${kinds[last.kind]} · ${time(last.at)}` : '本场尚无有效消息；未接入来源时不会自动读取直播伴侣的评论或礼物栏。' }}</p>
    <div class="table-wrap"><table><thead><tr><th>消息来源</th><th>评论 / 条</th><th>礼物消息 / 条</th><th>礼物净增 / 件</th><th>事件上报 / 抖币</th><th>参考面值 / 抖币</th><th>价值未知 / 件</th></tr></thead><tbody><tr v-for="row in rows" :key="row.origin" :data-testid="`input-origin-${row.origin}`"><td>{{row.label}}</td><td>{{row.comments}}</td><td>{{row.giftEvents}}</td><td>{{row.giftCount}}</td><td>{{(row.reportedDiamonds||0).toLocaleString('zh-CN')}}</td><td>{{(row.refDiamonds||0).toLocaleString('zh-CN')}}</td><td>{{row.unknownValueGiftCount||0}}</td></tr></tbody></table></div>
    <p class="muted small">事件面值与参考面值分列，不合并为实际金额。参考来自公开资料，未代表平台核验或到账；单价未知的礼物只计件数。</p>
    <p class="muted small">屏幕识别只表示看到了窗口文字，不核验账号身份、礼物金额或关注资格；同名有歧义时不会猜认。</p>
    <p class="muted small">从 {{time(statistics.startedAt)}} 起统计被小店接纳的独立事件；重复事件 ID 和相同连击累计值不重复增加。本机接入只代表收到转发消息，不代表已核验抖音礼物或到账收入。</p>
    <p v-if="statistics.legacyUnclassified" class="notice" data-testid="input-legacy">旧版累计没有记录消息来源，未猜测分配到上表。小店历史暖心值和玩法钱包可能包含模拟赠礼。</p>
    <p v-if="statistics.legacyValueUnclassified" class="notice" data-testid="input-legacy-value">旧记录未记价格，历史面值待核对；上表金额只包含升级后已记录部分，不把旧礼物补猜为零。</p>
    <details><summary>最近礼物 · 最多20条</summary><div v-if="statistics.recentGifts.length" class="table-wrap"><table><thead><tr><th>收到时间</th><th>观众</th><th>礼物</th><th>本次净增</th><th>来源</th><th>单价 / 抖币</th><th>净增面值 / 抖币</th><th>价格依据</th></tr></thead><tbody><tr v-for="gift in statistics.recentGifts" :key="gift.eventId"><td class="small">{{time(gift.at)}}</td><td>{{gift.userName}}</td><td>{{gift.giftName}}</td><td>{{gift.count}} 件</td><td class="small">{{labels[gift.origin]}}</td><td>{{gift.unitDiamonds===undefined?'待核对':gift.unitDiamonds}}</td><td>{{gift.diamonds===undefined?'待核对':gift.diamonds}}</td><td>{{gift.valueSource==='event'?'事件上报':gift.valueSource==='reference'?'公开参考':'价值未知'}}</td></tr></tbody></table></div><p v-else class="muted small">本场尚无礼物事件。模拟赠礼与本机接入会分开标注。</p></details>
  </section>
</template>
<style scoped>
.input-statistics table{width:100%}.input-statistics th,.input-statistics td{padding:10px 12px;text-align:left;white-space:nowrap}.input-statistics th{font-size:12px;color:var(--muted,#a7b9ad)}.input-statistics details{margin-top:14px}.input-statistics summary{cursor:pointer}.input-statistics p{line-height:1.7}
</style>
