<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { AppState, StageEvent, Station, Command } from '../../packages/shared/src/index'
import { getShopDisplayTitle, getShopTime } from '../../packages/shared/src/shop-time'
import { ACTIONS } from '../../packages/core/src/defaults'
import { tally } from '../../packages/core/src/vote'
import { StageAudio } from './audio'
import { MusicAudio } from './music-audio'
import ShopScene from './ShopScene.vue'
import CounterLayer from './CounterLayer.vue'
import AudienceCare from './AudienceCare.vue'
import ActionProps from './ActionProps.vue'
import TeaCorner from './TeaCorner.vue'
import whaleModel from '../../assets/figure/whale/model.json'
// Vendored JavaScript keeps its upstream distribution format.
// @ts-ignore -- upstream JavaScript module
import { createPet } from '../../vendor/coopanion-kit/kit/body.js'
// @ts-ignore -- upstream JavaScript module
import { createWhaleFigure } from '../../vendor/coopanion-kit/whale/figure.js'

const props = withDefaults(defineProps<{ state: AppState; preview?: boolean }>(), { preview: false })
const emit = defineEmits<{ 'stage-event': [event: StageEvent]; 'music-event': [event: Extract<Command, {type:'music-started'|'music-ended'|'music-error'}>] }>()
const petElement = ref<SVGGElement>()
const shadowElement = ref<SVGEllipseElement>()
const effectsElement = ref<SVGGElement>()
const loaded = ref(false)
const renderedSkin = ref('')
const loadError = ref('')
const progress = ref(0)
const clock = ref(new Date())
// Positions the overlay follows each frame, in stage pixels.
const pose = reactive({ bubbleX: 540, bubbleY: 780, hand: { x: 600, y: 1150 }, head: { x: 550, y: 900 }, facing: 1, k: 0 })
const localAction = ref('stand')
const station = ref<Station>('counter')
const giftBurst = ref<{ id: number; amount: number } | undefined>()
const wallet = computed(() => props.state.wallet ?? { balance: 0, earned: 0, spent: 0, bankrupt: false })
const usedTokens = computed(() => props.state.costs.inputTokens + props.state.costs.outputTokens + props.state.costs.voiceInputTokens + props.state.costs.voiceOutputTokens)
const tokensText = computed(() => Math.max(0, Math.floor(usedTokens.value)).toLocaleString('en-US'))
const usageIncomplete = computed(() => props.state.costs.brainUsageMissing > 0 || props.state.costs.voiceUsageMissing > 0 || !!props.state.costs.legacyUsageIncomplete)
const player = new StageAudio()
const musicPlayer = new MusicAudio(event => { if (!props.preview && !disposed) emit('music-event', event) })
const currentSong = computed(() => props.state.music?.tracks.find(track=>track.id===props.state.music.current?.trackId))
const qqBgm = computed(() => !!props.state.music.current?.isBgm)
const musicPending = computed(() => !props.state.music.current && (props.state.music.searches.length > 0 || props.state.music.queue.length > 0))
const pendingMusicMeta = computed(() => props.state.music.searches.length > 0 ? `正在查找 ${props.state.music.searches.length} 首可播歌曲，背景音乐先休息` : `待播 ${props.state.music.queue.length} 首，正在准备点播歌曲`)
const bgmUnselected = computed(() => !musicPending.value && props.state.running && props.state.config.music.bgmEnabled && props.state.config.music.bgmTrackIds.length === 0 && !props.state.music.current)
const bgmError = computed(() => !musicPending.value && props.state.running && props.state.config.music.bgmEnabled && props.state.config.music.bgmTrackIds.length > 0 && !props.state.music.current ? props.state.music.bgmError : undefined)
const musicShown = computed(() => (!!currentSong.value && props.state.music.status !== 'stopped') || musicPending.value || bgmUnselected.value || !!bgmError.value)
const ellipsis = (value: string, limit: number) => { const characters = Array.from(value); return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : value }
const songMeta = computed(() => qqBgm.value ? `${ellipsis(currentSong.value?.artist || '未知歌手', 10)}${props.state.music.status === 'paused' ? ' · 唱片暂停' : !props.state.music.current?.startedAt ? ' · 正在准备' : ''}` : `${ellipsis(currentSong.value?.artist || '未知歌手', 6)} · @${ellipsis(props.state.music.current?.userName || '店长', 6)}`)
const rationsText = computed(() => Math.round(props.state.rations?.balance ?? 100000).toLocaleString('zh-CN'))
const consumedHearts = computed(() => Math.max(0, Math.floor(props.state.music.current?.consumedHearts || 0)))
const musicFeedbackShown = computed(() => !!props.state.music.lastMessage && clock.value.getTime() - props.state.music.messageAt >= 0 && clock.value.getTime() - props.state.music.messageAt < 8000)
function updateAudio() { if (!props.preview) { void player.configure(props.state.config.audio); void musicPlayer.configure(props.state.music, props.state.config.audio, props.state.stage.speaking, props.state.stage.muted) } }
const textureUrls = import.meta.glob('../../assets/figure/whale/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
let ctl: any
let figure: any
let animationFrame = 0
let clockTimer = 0
let actionTimer = 0
let burstTimer = 0
let commandVersion = 0
let currentCommand = ''
let reportedCommand = ''
let pendingAction: (() => void) | undefined
let speechVolume = 0
let playingSpeechKey = ''
let disposed = false
let actionStarted = 0
let actionDuration = 1
const positions: Record<Station, number> = { counter: 550, window: 330, shelf: 735, door: 800 }
// The counter's top face in stage pixels (CounterLayer): every station is behind the counter, so she never steps
// through it, and props stand on or stay above this line.
const COUNTER_TOP = 1020
const shopFaces: Record<string, string> = {
  serve: 'happy', lean: 'sleepy', listen: 'neutral', count: 'thinking', watch_rain: 'neutral', toggle_sign: 'happy', yawn: 'sleepy', giggle: 'smug', akimbo: 'smug', heart: 'love', toast: 'happy',
  noodles: 'happy', tea: 'neutral', cocoa: 'happy', read_chat: 'thinking', fortune: 'excited', pet_cat: 'love', photo: 'wink', cheer: 'excited', vote_call: 'determined', gift_open: 'surprised',
  lantern: 'neutral', blanket: 'shy', stargaze: 'happy', umbrella: 'worried', music: 'happy', goodnight: 'sleepy', sneeze: 'flustered', fan: 'sleepy',
}
const kitMotions = new Set(['stand', 'idle', 'wave', 'bow', 'dance', 'walk', 'run', 'jump', 'hop', 'sit', 'sleep', 'look', 'nod', 'shake', 'spin', 'shiver', 'flap', 'dizzy', 'turn'])
const shopActions = Object.fromEntries(ACTIONS.filter(a => !kitMotions.has(a.id)).map(a => [a.id, { seconds: a.seconds, face: shopFaces[a.id] }]))
const actionNames: Record<string, string> = { stand: '看茶候客', idle: '看茶候客', walk: '店里溜达', ...Object.fromEntries(ACTIONS.filter(a => a.id !== 'stand').map(a => [a.id, a.name])) }
const text = computed(() => props.state.stage.commandId === 'welcome' && !props.state.stage.speaking ? getShopTime(clock.value).greeting : props.state.stage.text)
const visibleText = computed(() => !props.state.stage.speaking || props.preview ? text.value : text.value.slice(0, progress.value))
const bubbleText = computed(() => visibleText.value.length > 42 ? '…' + visibleText.value.slice(-42) : visibleText.value)
const bubbleShown = computed(() => !!text.value && (!!visibleText.value || props.state.stage.speaking))
const goalPercent = computed(() => Math.min(100, Math.round(props.state.shop.points / Math.max(1, props.state.shop.goal) * 100)))
const shopTime = computed(() => getShopTime(clock.value, undefined, props.state.config.look?.timeOfDay || 'auto'))
const shopTitle = computed(() => {
  const title=getShopDisplayTitle(props.state.shop.name,shopTime.value)
  return /^肥鱼(?:晨光|日间|黄昏|深夜)?小店$/.test(title)?'肥鱼茶话铺':title
})
const timeText = computed(() => shopTime.value.timeLabel)
const actionLabel = computed(() => props.state.generating ? '在想怎么接话…' : actionNames[localAction.value] || '守着小店')
const round = computed(() => props.state.vote?.round)
const rows = computed(() => tally(round.value, props.state.config.vote))
const votersTotal = computed(() => round.value?.ballots.length ?? 0)
const remaining = computed(() => { const r = round.value; if (!r || r.status !== 'open') return ''; const s = Math.max(0, Math.round((r.closesAt - clock.value.getTime()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })
const closeRace = computed(() => { const sorted = [...rows.value].sort((a, b) => b.score - a.score); return sorted.length > 1 && votersTotal.value >= 4 && sorted[0]!.score - sorted[1]!.score < .08 })
// Results stay up for a minute and a half after the vote closes, then tonight's plan banner returns.
const voteShown = computed(() => props.state.config.vote.enabled && round.value && (round.value.status === 'open' || clock.value.getTime() - round.value.closesAt < 90000))
const winnerTitle = computed(() => round.value?.options.find(o => o.id === round.value?.winnerId)?.title)
const tonight = computed(() => props.state.config.vote.enabled ? props.state.vote?.plans.find(p => p.applied) : undefined)
const feed = computed(() => (props.state.vote?.feed ?? []).filter(f => f.kind !== 'result').slice(0, 2))
const asset = (path: string) => {
  const value = textureUrls[`../../assets/figure/whale/${path}`]
  if (!value) throw new Error(`角色贴图缺失：${path}`)
  return value
}
const report = (event: StageEvent) => { if (!props.preview && !disposed) emit('stage-event', event) }
function actionEnded() {
  if (!currentCommand || reportedCommand === currentCommand) return
  reportedCommand = currentCommand
  report({ type: 'action-ended', commandId: currentCommand })
}
function perform(action: string) {
  if (!ctl || disposed) return
  localAction.value = action === 'idle' ? 'stand' : action
  actionStarted = performance.now()
  actionDuration = shopActions[action]?.seconds ?? ACTIONS.find(a => a.id === action)?.seconds ?? 3.2
  if (['sleep', 'sit'].includes(ctl.pet.mode) && !['sleep', 'sit', 'stand'].includes(localAction.value)) ctl.act('stand')
  // The shop cat sleeps on the counter to her right: turn toward it so the hand reaches the cat, not the air.
  if (action === 'pet_cat') ctl.pet.facing = 1
  ctl.doWord(localAction.value)
  // The director's selected emotion is authoritative, including on repeated
  // actions where Vue's separate face watcher does not run again.
  ctl.setExpr(props.state.stage.face || shopActions[action]?.face || 'neutral', props.state.stage.speaking ? 90 : actionDuration)
  window.clearTimeout(actionTimer)
  actionTimer = window.setTimeout(() => { actionEnded(); if (shopActions[action]) localAction.value = 'stand' }, actionDuration * 1000 + 500)
}
function applyCommand() {
  if (!ctl) return
  const state = props.state.stage
  const version = ++commandVersion
  currentCommand = state.commandId
  window.clearTimeout(actionTimer)
  const target = state.station || 'counter'
  const movingToStation = target !== station.value || Math.abs(ctl.pet.x - positions[target]) > 30
  const go = () => { if (version === commandVersion) { if (movingToStation && state.action === 'walk') { perform('stand'); actionEnded() } else perform(state.action); playSpeech() } }
  if (movingToStation) {
    station.value = target
    pendingAction = go
    localAction.value = 'walk'
    actionTimer = window.setTimeout(() => { if (version === commandVersion && pendingAction) { pendingAction = undefined; go() } }, 12000)
    ctl.walkTo(positions[target], Math.abs(ctl.pet.x - positions[target]) > 320, version)
  } else go()
}
function playSpeech() {
  const state = props.state.stage
  if (props.preview) return
  if (!state.speaking || state.muted) { player.stop(); speechVolume = 0; playingSpeechKey = ''; return }
  const speechKey = state.replyId || `${state.commandId}:${state.text}`
  if (playingSpeechKey === speechKey) return
  progress.value = 0
  player.stop(); speechVolume = 0
  // A station-specific action first walks to its station; the prepared audio waits for arrival.
  if (!ctl || pendingAction) return
  playingSpeechKey = speechKey
  void player.play(state, {
    progress: value => { progress.value = value },
    amplitude: value => { speechVolume = value },
    ended: () => { if (state.replyId) report({ type: 'speech-ended', replyId: state.replyId }) },
    status: message => report({ type: 'audio-status', message }),
    error: message => report({ type: 'error', message }),
  })
}
const skinKey = () => `${props.state.config.look?.scheme || 'deepseek'}-${props.state.config.look?.outfit || 'maid'}`
watch([() => props.state.stage.commandId, () => props.state.stage.action, () => props.state.stage.station], applyCommand)
watch(() => props.state.stage.face, face => ctl?.setExpr(face, props.state.stage.speaking ? 90 : 4))
watch(() => props.state.stage.speaking, speaking => ctl?.setExpr(props.state.stage.face, speaking ? 90 : 2))
watch(() => props.state.generating, value => ctl?.setThinking(value))
watch([() => props.state.stage.replyId, () => props.state.stage.speaking, () => props.state.stage.muted], playSpeech)
watch([()=>props.state.config.audio,()=>props.state.music,()=>props.state.stage.speaking,()=>props.state.stage.muted,()=>props.state.running,()=>props.state.config.music.bgmEnabled,()=>props.state.config.music.bgmTrackIds],updateAudio,{deep:true})
watch(skinKey, async key => {
  if (!figure) return
  try {
    await figure.setScheme?.(key, { fade: .6 })
    if (!disposed && skinKey() === key) { renderedSkin.value = key; ctl?.act('spin') }
  } catch (error) { report({ type: 'error', message: error instanceof Error ? error.message : '服装加载失败' }) }
})
// A gift lands: a burst of warmth over the goal bar and hearts around her.
watch(() => props.state.shop.points, (now, before) => {
  if (!(now > before)) return
  giftBurst.value = { id: Date.now(), amount: now - before }
  window.clearTimeout(burstTimer); burstTimer = window.setTimeout(() => { giftBurst.value = undefined }, 2600)
  for (let i = 0; i < 4; i++) ctl?.emitHeart()
})

onMounted(async () => {
  clockTimer = window.setInterval(() => { clock.value = new Date() }, 1000)
  try {
    const requestedSkin = skinKey()
    figure = await createWhaleFigure(undefined, { model: whaleModel, asset, scheme: requestedSkin })
    if (disposed) { figure.dispose?.(); return }
    // The console may receive its saved state while the initial textures are still loading.
    // Apply the latest chosen outfit before showing the character instead of retaining the startup default.
    if (skinKey() !== requestedSkin) await figure.setScheme?.(skinKey(), { fade: 0 })
    renderedSkin.value = skinKey()
    if (disposed) { figure.dispose?.(); return }
    ctl = createPet({ petG: petElement.value, shadowEl: shadowElement.value, fxG: effectsElement.value }, {
      figure, roam: 'off', sfx: {}, startX: positions.counter,
      bounds: () => ({ W: 1080, H: 1920, floorY: 1110, S: 2.5 }),
      words: Object.fromEntries(Object.entries(shopActions).map(([id, info]) => [id, { motion: { seconds: info.seconds, face: info.face } }])),
      onEvent: (kind: string, detail: any) => {
        if (kind === 'arrived' && pendingAction) { const run = pendingAction; pendingAction = undefined; run() }
        if (kind === 'done' && detail.word === localAction.value) actionEnded()
      },
    })
    loaded.value = true
    updateAudio()
    applyCommand()
    playSpeech()
    let last = performance.now()
    const frame = (now: number) => {
      if (disposed) return
      // The dedicated capture keeps a stable 30 fps. Console previews yield CPU/GPU to normal work.
      const fps = props.preview ? (document.hidden ? 2 : 15) : 30
      if (now-last < 1000/fps-1) { animationFrame=requestAnimationFrame(frame); return }
      const dt = Math.min(.1, (now - last) / 1000); last = now
      ctl.step(dt)
      ctl.talk(props.preview && props.state.stage.speaking ? .35 + .45 * Math.abs(Math.sin(now / 80)) : speechVolume)
      ctl.render()
      const anchor = ctl.anchor()
      pose.bubbleX = Math.max(310, Math.min(770, anchor.x))
      pose.bubbleY = Math.max(600, anchor.y - 80)
      pose.facing = ctl.pet.facing >= 0 ? 1 : -1
      const hand = ctl.toStage(162, 202), head = ctl.toStage(128, 64)
      pose.hand.x = hand.x; pose.hand.y = hand.y; pose.head.x = head.x; pose.head.y = head.y
      pose.k = Math.min(1, (now - actionStarted) / Math.max(1, actionDuration * 1000))
      animationFrame = requestAnimationFrame(frame)
    }
    animationFrame = requestAnimationFrame(frame)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '角色加载失败'
    report({ type: 'error', message: loadError.value })
  }
})
onBeforeUnmount(() => {
  disposed = true; commandVersion++
  cancelAnimationFrame(animationFrame)
  window.clearInterval(clockTimer)
  window.clearTimeout(actionTimer)
  window.clearTimeout(burstTimer)
  musicPlayer.dispose()
  player.dispose()
  figure?.dispose?.()
})
</script>

<template>
  <div class="fish-stage stage-root" :class="['time-'+shopTime.phase, { 'stage-preview': preview }]" data-testid="stage" :data-loaded="loaded" :data-rendered-skin="renderedSkin" :data-action="localAction" :data-station="station" :data-scene="state.shop.scene" :data-time-phase="shopTime.phase" :data-actual-time-phase="shopTime.actualPhase">
    <ShopScene :show-menu-text="false" :invite-to-chat="!voteShown" :scene="state.shop.scene || 'rain'" :running="state.running" :decorations="state.shop.decorations" :action="localAction" :time="shopTime"/>

    <svg class="character-layer" viewBox="0 0 1080 1920" aria-hidden="true">
      <ellipse ref="shadowElement" class="character-shadow"/>
      <g ref="petElement" data-testid="stage-character"/>
      <g ref="effectsElement"/>
      <ActionProps layer="body" :surface="COUNTER_TOP" :action="localAction" :k="pose.k" :hand="pose.hand" :head="pose.head" :facing="pose.facing"/>
    </svg>

    <!-- The counter is always in front of her and hides her lower body; what stands on it is drawn over it. -->
    <CounterLayer :petting="localAction === 'pet_cat'" :decorations="state.shop.decorations" :phase="shopTime.phase" :show-guide="true"/>
    <svg class="counter-props" viewBox="0 0 1080 1920" aria-hidden="true">
      <ActionProps layer="counter" :surface="COUNTER_TOP" :action="localAction" :k="pose.k" :hand="pose.hand" :head="pose.head" :facing="pose.facing"/>
    </svg>

    <svg class="stage-overlay" viewBox="0 0 1080 1920" aria-hidden="true">
      <defs><linearGradient id="barFill" x1="0" x2="1"><stop stop-color="#9fd0a6"/><stop offset="1" stop-color="#e8cf8f"/></linearGradient></defs>
      <g data-testid="ai-disclosure"><rect x="690" y="216" width="300" height="32" rx="16" fill="#344c38"/><text x="840" y="239" text-anchor="middle" fill="#eadbb7" font-size="20">AI 形象 · 实时互动</text></g>
      <rect x="74" y="68" width="932" height="140" rx="9" fill="#493525" stroke="#af8951" stroke-width="7" data-testid="shop-header"/>
      <rect x="88" y="81" width="904" height="114" rx="4" fill="none" stroke="#ba995d" stroke-opacity=".4" stroke-width="2"/>
      <text x="540" y="150" text-anchor="middle" fill="#f0dfb6" font-size="58" font-family="KaiTi, STKaiti, serif" letter-spacing="12" data-testid="shop-title">{{ shopTitle }}</text>
      <circle cx="112" cy="179" r="6" :fill="state.running ? '#a3be87' : '#b7a27c'" class="status-dot"/>
      <text x="130" y="186" fill="#cabb91" font-size="20">{{shopTime.label}}茶席 · {{state.running?'茶已沏好':'小憩片刻'}}</text>
      <text x="966" y="114" text-anchor="end" fill="#ddcba1" font-size="28" font-family="monospace">{{timeText}}</text>
      <text x="966" y="185" text-anchor="end" fill="#cabb91" font-size="18" data-testid="header-rations" :data-balance="state.rations?.balance??100000">口粮 {{rationsText}}</text>
      <g v-if="wallet.bankrupt" class="bankrupt" transform="translate(838 1020) rotate(-8)"><rect x="-120" y="-38" width="240" height="70" rx="10" fill="none" stroke="#e46f5f" stroke-width="5"/><text x="0" y="12" text-anchor="middle" fill="#e46f5f" font-size="38" font-weight="800" letter-spacing="8">破产中</text></g>

      <g v-if="musicShown" class="music-board" data-testid="music-board" :data-bgm-kind="musicPending ? 'pending' : bgmError ? 'qq-error' : qqBgm ? 'qq' : bgmUnselected ? 'unselected' : undefined" transform="translate(650 1336)">
        <rect width="320" height="157" rx="12" fill="#3e4d37" stroke="#b7985d" stroke-width="3"/>
        <text x="18" y="31" fill="#f1e6c8" font-size="24" data-testid="music-title">♫ {{musicPending?'点歌处理中':bgmError?'QQ 背景音乐暂不可播':bgmUnselected?'尚未选择 QQ 背景音乐':ellipsis(currentSong?.title||'',11)}}</text>
        <text x="18" y="60" fill="#d9c48b" font-size="18" data-testid="music-status">{{musicPending?(state.config.music.bgmEnabled?'BGM已暂停':'正在准备'):bgmError?'播放失败':qqBgm?'小店BGM · QQ音乐':bgmUnselected?'等待选曲':state.music.status==='paused'?'唱片暂停':'小店点播'}}</text>
        <text x="18" y="88" fill="#bcc8a5" font-size="17" data-testid="music-meta">{{musicPending?ellipsis(pendingMusicMeta,17):bgmError?'请检查 QQ 登录或播放权限':bgmUnselected?'观众可弹幕点歌':songMeta}}</text>
        <text v-if="!musicPending && !bgmUnselected && !qqBgm && !bgmError" x="18" y="119" fill="#e0d4b0" font-size="16" data-testid="music-votes"><tspan v-if="consumedHearts>0">已用♡{{consumedHearts.toLocaleString('zh-CN')}} · </tspan>切歌 {{state.music.skipVotes.length}}/{{state.music.skipRequired}}</text>
      </g>

      <g transform="translate(615 244) scale(.58)" data-testid="activity-board-position">
      <!-- Tonight's plan, chosen by last night's vote. -->
      <g v-if="tonight && !voteShown" class="slide-in" data-testid="plan-board"><rect x="59" y="236" width="560" height="62" rx="31" fill="#e9d9b0" fill-opacity=".92"/><text x="92" y="276" fill="#4a3a28" font-size="25">{{shopTime.phase==='night'?'🌙':'☀'}} 本场 · 大家选的：<tspan font-weight="700">{{ tonight.option.title }}</tspan></text></g>

      <!-- The vote board: one viewer one ballot, gifts only boost. -->
      <g v-if="voteShown && round" class="vote-board slide-in" data-testid="vote-board">
        <rect x="59" y="236" width="600" :height="112 + round.options.length * 62 + (feed.length && round.status === 'open' ? 36 : 0)" rx="26" fill="#14232a" fill-opacity=".88" stroke="#e8cf8f" stroke-opacity=".35" stroke-width="2"/>
        <text x="90" y="280" fill="#f1e6c8" font-size="30" font-weight="700">{{ round.status === 'open' ? round.title : '投票结果' }}</text>
        <text x="630" y="280" text-anchor="end" :fill="closeRace ? '#f2a46a' : '#a8bfae'" font-size="24" font-family="monospace">{{ round.status === 'open' ? (closeRace ? '胶着！' : '') + remaining : votersTotal + ' 人' }}</text>
        <g v-for="(option, i) in round.options" :key="option.id" :transform="`translate(90 ${300 + i * 62})`">
          <rect width="540" height="50" rx="13" fill="#ffffff" fill-opacity=".07"/>
          <rect class="vote-bar" :width="Math.max(14, 540 * (rows[i]?.score ?? 0))" height="50" rx="13" :fill="round.winnerId === option.id ? '#e8cf8f' : 'url(#barFill)'" :fill-opacity="round.winnerId && round.winnerId !== option.id ? .25 : .55"/>
          <text x="18" y="34" fill="#fffaf0" font-size="25" font-weight="700">{{ i + 1 }}号</text>
          <text x="80" y="34" fill="#fffaf0" font-size="24">{{ option.title }}</text>
          <text x="522" y="34" text-anchor="end" fill="#fdf3dc" font-size="22">{{ rows[i]?.heads ?? 0 }}人<tspan v-if="rows[i]?.boost" fill="#f3c98b"> ✦{{ rows[i]?.boost }}</tspan></text>
        </g>
        <text x="90" :y="330 + round.options.length * 62" fill="#a8bfae" font-size="20">{{ round.status === 'open' ? '发「投1」「投2」参与 · 每人一票 · 礼物只助推' : winnerTitle ? `明天就「${winnerTitle}」啦！` : '没有人投票，明天老样子' }}</text>
        <g v-if="feed[0] && round.status === 'open'" :key="feed[0].id" :transform="`translate(90 ${364 + round.options.length * 62})`"><text class="feed-line" fill="#f3d9a6" font-size="20">{{ feed[0].text }}</text></g>
      </g>
      </g>

      <g v-if="bubbleShown" transform="translate(365 546)" data-testid="stage-speech">
        <foreignObject x="-255" y="-200" width="510" height="180"><div xmlns="http://www.w3.org/1999/xhtml" class="speech-bubble" :key="state.stage.replyId || state.stage.commandId"><span data-testid="stage-subtitle">{{ bubbleText || '…' }}</span></div></foreignObject>
      </g>
      <AudienceCare :state="state" :now="clock.getTime()"/>
      <TeaCorner :now="clock.getTime()" :action="localAction" :command-id="state.stage.commandId" :show-stove="!musicShown && !musicFeedbackShown"/>
      <g v-if="musicFeedbackShown" data-testid="music-feedback" transform="translate(650 1510)"><rect width="320" height="50" rx="18" fill="#14232a" fill-opacity=".92" stroke="#e8cf8f" stroke-opacity=".2"/><text x="160" y="31" text-anchor="middle" fill="#e8cf8f" font-size="16">♫ {{ellipsis(state.music.lastMessage,17)}}</text></g>
      <g v-if="state.config.stage.showLedger" data-testid="stage-ledger">
        <rect x="63" y="252" width="954" height="88" rx="12" fill="#334b39" fill-opacity=".91" stroke="#b29a64" stroke-opacity=".55"/>
        <text x="92" y="280" fill="#d9cb9f" font-size="21" letter-spacing="3">茶馆小愿望</text><text x="981" y="280" text-anchor="end" fill="#f1dfb0" font-size="22">{{state.shop.points}} / {{state.shop.goal}}</text>
        <rect x="94" y="293" width="890" height="7" rx="3.5" fill="#24392b"/><rect class="goal-bar" x="94" y="293" :width="890*goalPercent/100" height="7" rx="3.5" fill="#d5b879"/>
        <text x="94" y="324" fill="#b6b89a" font-size="18" data-testid="stage-token-usage">本场已报消耗 <tspan fill="#ead8aa" font-family="monospace">{{tokensText}}</tspan> token</text>
        <text x="981" y="324" text-anchor="end" font-size="18" :fill="usageIncomplete?'#f2c27a':'#b6b89a'" data-testid="stage-usage-completeness">{{usageIncomplete?'部分用量待核算':'对话 + 千问配音'}}</text>
        <g v-if="giftBurst" :key="giftBurst.id" class="gift-burst"><text :x="94+890*goalPercent/100" y="282" text-anchor="middle" fill="#ffe1a0" font-size="30">+{{giftBurst.amount}} 暖心值</text></g>
      </g>
      <text v-if="musicShown && !musicFeedbackShown" x="810" y="1570" text-anchor="middle" fill="#d1d7c4" font-size="17" letter-spacing="2" data-testid="stage-action-label">{{ actionLabel }}</text>
      <g v-if="state.config.stage.safeArea" class="safe-area"><rect data-testid="platform-chat-reserve" x="24" y="1340" width="620" height="540" rx="12" fill="#70d9dc" fill-opacity=".08" stroke="#70d9dc" stroke-dasharray="14 10"/><text x="42" y="1374" fill="#70d9dc" font-size="22">抖音左下弹幕预留区</text><rect x="108" y="326" width="799" height="922" rx="12" fill="none" stroke="#70d9dc" stroke-width="3" stroke-dasharray="14 10"/><path d="M108 326H907M108 1248H907" stroke="#70d9dc" stroke-width="2" stroke-dasharray="14 10"/><text x="128" y="350" fill="#70d9dc" font-size="20">直播安全区参考线</text></g>
    </svg>
    <div v-if="!loaded" class="stage-loading"><span class="loading-fish">◕</span><p>{{ loadError || '小店正在点亮灯光…' }}</p></div>
  </div>
</template>

<style scoped>
.fish-stage{position:relative;width:100%;height:100%;aspect-ratio:9/16;overflow:hidden;background:#203033;isolation:isolate;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
.fish-stage svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.shop-scene{z-index:1}.character-layer{z-index:2;overflow:visible}.counter-layer{z-index:3;pointer-events:none}.counter-props{z-index:4;pointer-events:none}.stage-overlay{z-index:6;pointer-events:none}.character-shadow{fill:#0c1c20;opacity:.2}
.fish-stage :deep(.p-heart){fill:#f5a9b4;stroke:#f095a2}.fish-stage :deep(.p-dust){stroke:#bcbaa0}.fish-stage :deep(.eye){stroke:#7dadd3}.fish-stage :deep(.tearf){fill:#8fd0ff}
.fish-stage :deep(.speech-bubble){height:calc(100% - 27px);background:#f1ecdc;border:2px solid #fbf3dc;border-radius:25px;padding:16px 20px;color:#33443f;font-size:28px;line-height:1.3;display:flex;align-items:center;box-shadow:0 10px 28px #071b2240;position:relative;overflow-wrap:anywhere;font-family:"PingFang SC","Microsoft YaHei",sans-serif;box-sizing:border-box;transform-origin:50% 100%;animation:bubbleIn .42s cubic-bezier(.3,1.5,.5,1) both}
.fish-stage :deep(.speech-bubble)::after{content:"";position:absolute;bottom:-20px;left:calc(80% - 17px);border:20px solid transparent;border-top-color:#f1ecdc;border-bottom:0}
.stage-loading{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#203033ed;color:#d6d8bd;text-align:center;font-size:14px;padding:24px}.loading-fish{font-size:45px;color:#99b4c0;animation:float 2s ease-in-out infinite}.stage-loading p{line-height:1.6}
.status-dot{animation:light 3s ease-in-out infinite}
.slide-in{animation:slideIn .5s cubic-bezier(.2,1.2,.4,1) both}
.vote-bar{transition:width .8s cubic-bezier(.2,1,.3,1)}
.goal-bar{transition:width 1s cubic-bezier(.2,1,.3,1)}
.feed-line{animation:feedIn .4s ease-out both}
.gift-burst{animation:burst 2.6s ease-out both}
.bankrupt{animation:stamp .5s cubic-bezier(.3,1.6,.5,1) both}
@keyframes stamp{from{opacity:0;transform:translate(838px,1020px) rotate(-8deg) scale(1.8)}to{opacity:.9;transform:translate(838px,1020px) rotate(-8deg) scale(1)}}
@keyframes bubbleIn{from{opacity:0;transform:scale(.6) translateY(20px)}to{opacity:1;transform:none}}
@keyframes slideIn{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}
@keyframes feedIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes burst{0%{opacity:0;transform:translateY(20px)}15%{opacity:1;transform:translateY(0)}80%{opacity:1}100%{opacity:0;transform:translateY(-30px)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}@keyframes light{0%,100%{opacity:.6}50%{opacity:1}}
</style>
