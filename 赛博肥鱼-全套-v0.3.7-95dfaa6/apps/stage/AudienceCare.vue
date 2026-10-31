<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AppState } from '../../packages/shared/src/index'
import { counterChat } from './counter-chat'

const props = defineProps<{ state: AppState; now: number }>()
const turns = computed(() => counterChat(props.state.history))
const rations = computed(() => props.state.rations)
const balance = ref(rations.value?.balance ?? 100000)
let animation = 0
const integer = (value: number) => Math.round(value).toLocaleString('zh-CN')
const balanceLabel = computed(() => integer(balance.value))
const balanceSize = computed(() => balanceLabel.value.length > 15 ? 18 : balanceLabel.value.length > 11 ? 22 : 28)
watch(() => rations.value?.balance, value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === balance.value) return
  cancelAnimationFrame(animation)
  const from = balance.value, started = performance.now()
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { balance.value = value; return }
  const animate = (now: number) => { const progress = Math.min(1, (now - started) / 450); balance.value = from + (value - from) * (1 - (1 - progress) ** 3); if (progress < 1) animation = requestAnimationFrame(animate) }
  animation = requestAnimationFrame(animate)
})
const change = computed(() => {
  const topUp = rations.value?.lastTopUp, spend = rations.value?.lastSpend
  if (topUp && topUp.tokens > 0 && (!spend || topUp.at >= spend.at) && props.now - topUp.at >= 0 && props.now - topUp.at < 7000) return { id: `plus:${topUp.at}:${topUp.tokens}`, kind: 'plus', origin: topUp.origin, label: `${topUp.origin === 'simulator' ? '演练补充' : topUp.name === '店长' ? '店长补给' : '口粮补充'} +${integer(topUp.tokens)}` }
  if (spend && spend.tokens > 0 && props.now - spend.at >= 0 && props.now - spend.at < 7000) return { id: `minus:${spend.at}:${spend.tokens}`, kind: 'minus', origin: '', label: `${spend.provider === 'qwen' ? '配音' : '对话'} −${integer(spend.tokens)}` }
})
onBeforeUnmount(() => cancelAnimationFrame(animation))
</script>

<template>
 <g transform="translate(0 -360)" class="audience-care" data-testid="audience-care" :data-chat-count="turns.length">
  <rect x="245" y="1420" width="715" height="185" rx="15" fill="#ecdfbf" fill-opacity=".97" stroke="#967149" stroke-width="2" stroke-opacity=".7"/>
  <text x="272" y="1447" fill="#725535" font-size="21" letter-spacing="1">茶馆来信</text>
  <g v-if="change" :key="change.id" :class="['ration-change',change.kind]" :data-origin="change.origin" data-testid="ration-change"><text x="935" y="1447" text-anchor="end" :fill="change.kind==='plus'?'#b7e2b4':'#e6c497'" font-size="20">{{change.label}}</text></g>
  <g data-testid="counter-chat">
   <g v-for="(turn,index) in turns" :key="turn.id" class="chat-turn" data-testid="chat-turn" :data-reply-id="turn.id" :opacity="index===turns.length-1?1:.75">
    <text x="272" :y="turns.length===1?1487:1478+index*52" font-size="24" data-testid="chat-heard"><tspan fill="#8f5d2c">{{turn.name}}：</tspan><tspan fill="#3b4030">{{turn.heard}}</tspan></text>
    <text x="272" :y="turns.length===1?1523:1504+index*52" font-size="24" data-testid="chat-reply"><tspan fill="#4c7151">肥鱼：</tspan><tspan fill="#373c2d">{{turn.reply}}</tspan></text>
   </g>
   <g v-if="!turns.length" data-testid="chat-empty"><text x="272" y="1492" fill="#5e6045" font-size="25">还没有聊天记录</text><text x="272" y="1530" fill="#7a765d" font-size="22">观众来信和肥鱼回复会留在这里</text></g>
  </g>
  <path d="M270 1563H934" stroke="#967149" stroke-opacity=".2"/>
  <text x="272" y="1590" fill="#756441" font-size="24">口粮 <tspan fill="#594c2e" :font-size="balanceSize" font-family="monospace" data-testid="rations-balance" :data-balance="rations?.balance??100000">{{balanceLabel}}</tspan><tspan font-size="18"> token</tspan></text>
  <text v-if="rations?.unknownRequests" x="934" y="1589" text-anchor="end" fill="#e4b48d" :font-size="String(rations.unknownRequests).length > 8 ? 14 : 21" data-testid="rations-unknown">{{integer(rations.unknownRequests)}} 笔待核算</text>
  <text v-else-if="balanceLabel.length < 14" x="934" y="1589" text-anchor="end" fill="#7a765d" font-size="19">消耗按实际返回 token 扣除</text>
 </g>
</template>

<style scoped>
.chat-turn{animation:chat-in .25s ease both}.ration-change{animation:care-change .45s ease both}.audience-care text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}@keyframes chat-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes care-change{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.chat-turn,.ration-change{animation:none}}
</style>
