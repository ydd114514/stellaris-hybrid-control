<script setup lang="ts">
import { SMALL_GIFT_REFERENCES } from '../../../packages/core/src/gift-values'
</script>
<template>
 <section class="card" data-testid="gift-price-reference">
  <div class="card-head"><h2>小额礼物参考价</h2><span class="tag">抖币 · 仅供参考</span></div>
  <p class="muted small">公开资料中的小范围参考，可能与当前礼物池不同。真实事件上报的单价优先；未上报时单列参考面值，不换算人民币或到账收入，也不改变下方口粮规则。</p>
  <details><summary>查看 {{SMALL_GIFT_REFERENCES.length}} 项参考与来源</summary><div class="table-wrap"><table><thead><tr><th>礼物</th><th>单价 / 抖币</th><th>资料来源</th><th>查价日期</th></tr></thead><tbody><tr v-for="gift in SMALL_GIFT_REFERENCES" :key="gift.name"><td>{{gift.name}}</td><td>{{gift.unitDiamonds}}</td><td><a :href="gift.sourceURL" target="_blank" rel="noopener noreferrer">{{gift.confidence==='official-doc'?'官方公开文档 · 历史参考':'网络参考 · 待核对'}}</a></td><td>{{gift.checkedAt}}</td></tr></tbody></table></div></details>
 </section>
</template>
<style scoped>
p{line-height:1.7}details{margin-top:14px}summary{cursor:pointer}td,th{white-space:nowrap}a{color:var(--accent)}
</style>
