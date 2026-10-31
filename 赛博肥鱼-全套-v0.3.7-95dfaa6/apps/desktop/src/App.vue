<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import StageView from '../../stage/StageView.vue'
import Icon from './Icon.vue'
import JukeboxView from './JukeboxView.vue'
import LiveConnections from './LiveConnections.vue'
import InputStatistics from './InputStatistics.vue'
import ServiceUsage from './ServiceUsage.vue'
import GiftPriceReference from './GiftPriceReference.vue'
import { getBridge } from './bridge'
import { ACTIONS, BASE_ACTIONS, DECORATIONS, createDefaultState } from '../../../packages/core/src/defaults'
import { PLAN_LIBRARY, tally } from '../../../packages/core/src/vote'
import { DEFAULT_PERSONA } from '../../../packages/core/src/persona'
import { voiceBillingUnit } from '../../../packages/core/src/usage'
import { TIER_NAMES, tierOf } from '../../../packages/core/src/memory'
import { getShopSceneLabel, getShopTime, type ShopTimePeriod } from '../../../packages/shared/src/shop-time'
import { FACES, OUTFITS, SCENES, SKINS, STATIONS, getSkinIdentityLabel, type AppConfig, type Command, type GiftRule, type LiveEvent, type PlanOption, type SceneId } from '../../../packages/shared/src'

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
const bridge = getBridge()
const state = ref(createDefaultState())
const ready = ref(false)
const standalone = new URLSearchParams(location.search).get('view') === 'stage'
const isDesktop = !!window.shop
const page = ref('live')
const settingsTab = ref('ai')
const toast = ref('')
const toastError = ref(false)
let toastTimer: ReturnType<typeof setTimeout>
let unsubscribe = () => {}
const editConfig = reactive<AppConfig>(clone(state.value.config))
const editGifts = ref<GiftRule[]>(clone(state.value.gifts))
const editShop = reactive(clone(state.value.shop))
const keys = reactive({ deepseek: '', qwen: '' })
const saving = ref(false)
const say = ref('')
const editReply = ref('')
const sim = reactive({ name: '晚睡的猫', userId: 'demo-cat', text: '店里今天有什么好喝的？', giftId: 'heart', count: 1, comboKey: '' })
const simKind = ref<'chat' | 'gift' | 'enter' | 'follow' | 'like'>('chat')
let simSequence = 0
const actionGroup = ref('night')
const logFilter = ref('all')
const viewerSearch = ref('')
const setup = ref(false)
const designPreview = ref('')
const voiceDescription = ref('年轻、温暖的中文女声，声音清亮柔和，带一点慵懒和俏皮，像小咖啡店里亲切的店主。')
const previewText = ref(getShopTime().greeting)
const audioDevices = ref<MediaDeviceInfo[]>([])
const clock = ref(Date.now())
const shopTime = computed(() => getShopTime(clock.value, undefined, state.value.config.look?.timeOfDay || 'auto'))
const actualShopTime = computed(() => getShopTime(clock.value))
const shopPeriods: { id: ShopTimePeriod; label: string }[] = [{ id: 'auto', label: '跟随真实时间' }, { id: 'morning', label: '晨间布景' }, { id: 'day', label: '白天布景' }, { id: 'dusk', label: '黄昏布景' }, { id: 'night', label: '夜晚布景' }]
let clockTimer: ReturnType<typeof setInterval>
const voteDraft = reactive<{ title: string; minutes: number; options: PlanOption[] }>({ title: '明天演什么？', minutes: 15, options: [] })
const customOption = ref('')

const nav = [
  { id: 'live', label: '开播', icon: 'live', about: '一键开播，看着画面随手互动。' },
  { id: 'jukebox', label: '点歌台', icon: 'music', about: '弹幕点歌先排队，听完这一首再换下一首。' },
  { id: 'connect', label: '直播连接', icon: 'link', about: '专用画面、专用声音和独立监听，让小店安静地营业。' },
  { id: 'vote', label: '明日投票', icon: 'vote', about: '让观众决定明天的场景和玩法：人人一票，礼物只助推。' },
  { id: 'look', label: '形象与动作', icon: 'palette', about: '换配色、换衣服、换场景，点一下就让肥鱼动起来。' },
  { id: 'rehearse', label: '互动排练', icon: 'flask', about: '不用开播，也能排练弹幕、礼物和投票。' },
  { id: 'grow', label: '小店养成', icon: 'shop', about: '大家一起养大的小店：装饰、礼物回应和熟客。' },
  { id: 'settings', label: '设置', icon: 'settings', about: 'AI、声音、安全和预算。不懂的保持默认即可。' },
]
const visibleNav = computed(() => nav.filter(item => item.id !== 'vote' || state.value.config.vote.enabled))
const currentPage = computed(() => nav.find(n => n.id === page.value)!)
watch(() => state.value.config.vote.enabled, enabled => { if (!enabled && page.value === 'vote') page.value = 'live' })
const reportedTokens = computed(() => (state.value.costs.inputTokens || 0) + (state.value.costs.outputTokens || 0) + (state.value.costs.voiceInputTokens || 0) + (state.value.costs.voiceOutputTokens || 0))
const tokenUsageIncomplete = computed(() => state.value.costs.brainUsageMissing > 0 || state.value.costs.voiceUsageMissing > 0 || !!state.value.costs.legacyUsageIncomplete)
const currentDraft = computed(() => state.value.drafts.find(d => d.status === 'draft' || d.status === 'ready'))
watch(() => currentDraft.value?.id, () => { editReply.value = '' })
const goalPercent = computed(() => Math.min(100, state.value.shop.points / Math.max(1, state.value.shop.goal) * 100))
const budgetPercent = computed(() => state.value.config.budget.sessionLimit > 0 ? Math.min(100, state.value.costs.session / state.value.config.budget.sessionLimit * 100) : 0)
const sessionCostUnknown = computed(() => state.value.costs.unpricedRequests > 0 || !!state.value.costs.legacyUsageIncomplete)
const todayCostUnknown = computed(() => state.value.costs.todayUnpricedRequests > 0 || !!state.value.costs.legacyTodayCostUnknown)
const voicePriceUnit = computed(() => voiceBillingUnit(editConfig.voice.model))
const actionName = computed(() => ACTIONS.find(a => a.id === state.value.stage.action)?.name || '守着小店')
const currentSong = computed(() => state.value.music.tracks.find(t=>t.id===state.value.music.current?.trackId))
const autoTalk = computed(() => state.value.config.mode !== 'manual')
const emojiOf: Record<string, string> = { wave: '👋', nod: '🙂', shake: '🙅', jump: '⬆️', hop: '🐇', look: '👀', turn: '↩️', spin: '🌀', sit: '🪑', sleep: '😴', dizzy: '💫', walk: '🚶', run: '🏃', bow: '🙇', shiver: '🥶', flap: '🐟', dance: '💃', stand: '🧍', wipe_cup: '🥛', brew_coffee: '☕', serve: '🫴', lean: '😪', listen: '👂', write_note: '📝', count: '🧮', tidy_shelf: '🫙', water_plant: '🪴', watch_rain: '🌧️', toggle_sign: '🏮', sweep: '🧹', yawn: '🥱', giggle: '🤭', akimbo: '😤', heart: '🫶', toast: '🥂', noodles: '🍜', tea: '🫖', cocoa: '🍫', read_chat: '📱', fortune: '🎋', pet_cat: '🐈', photo: '📸', cheer: '🪧', vote_call: '🗳️', gift_open: '🎁', lantern: '🏮', blanket: '🧣', stargaze: '✨', umbrella: '☂️', music: '🎧', goodnight: '🌙', sneeze: '🤧', fan: '🪭' }
const faceEmoji = ['😌', '😊', '😉', '😍', '☺️', '😮', '😠', '😢', '😴', '🤔', '😏', '😗', '😟', '😤', '😳', '😱', '🤩', '😭', '😵‍💫']
const quick = ['wave', 'heart', 'read_chat', 'tea', 'noodles', 'pet_cat', 'cheer', 'gift_open', 'music', 'photo', 'stargaze', 'goodnight']
const groupedActions = computed(() => ACTIONS.filter(a => actionGroup.value === 'base' ? BASE_ACTIONS.has(a.id) : actionGroup.value === 'shop' ? !BASE_ACTIONS.has(a.id) && ACTIONS.indexOf(a) < 35 : ACTIONS.indexOf(a) >= 35))
const logs = computed(() => state.value.logs.filter(l => logFilter.value === 'all' || logFilter.value === l.level))
const viewers = computed(() => state.value.viewers.filter(v => (v.name + v.note + (v.memory?.summary ?? '')).includes(viewerSearch.value)))
const tokens = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString('en-US')
const cacheRate = computed(() => { const hit = state.value.costs.cacheHitTokens ?? 0, miss = state.value.costs.cacheMissTokens ?? 0; return hit + miss ? Math.round(hit / (hit + miss) * 100) : 0 })
const topUpAmount = ref(5)
const rationTopUpAmount = ref(20000)
const rationTopUpValid = computed(() => Number.isSafeInteger(rationTopUpAmount.value) && rationTopUpAmount.value > 0 && rationTopUpAmount.value <= 1e12)
const rationCount = (n: number) => Math.round(n).toLocaleString('zh-CN')
const openViewer = ref('')
const record = reactive<{ viewer?: { id: string; name: string }; q: string; rows: { id: string; name: string; kind: string; text: string; at: number; hidden?: boolean }[]; total: number }>({ q: '', rows: [], total: 0 })
async function openRecord(viewer?: { id: string; name: string }) {
  if (viewer) { record.viewer = viewer; record.q = '' }
  if (!record.viewer) return
  const r = await bridge.command({ type: 'archive-query', userId: record.viewer.id, q: record.q.trim() || undefined })
  const data = r.data as { rows: typeof record.rows; total: number } | undefined
  record.rows = data?.rows ?? []; record.total = data?.total ?? 0
}
const day = (n: number) => new Date(n).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
async function endShow() { if (confirm('下播后会暂停营业，并把本场的聊天整理进客人的长期记忆。确定下播吗？')) await send({ type: 'end-show' }) }
const round = computed(() => state.value.vote.round)
const openRound = computed(() => round.value?.status === 'open' ? round.value : undefined)
const rows = computed(() => tally(round.value, state.value.config.vote))
const remaining = computed(() => { const r = openRound.value; if (!r) return ''; const s = Math.max(0, Math.round((r.closesAt - clock.value) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })
const kindName = { scene: '场景', activity: '玩法', behavior: '挑战' } as const
const money = (n: number) => n.toFixed(n < .1 && n > 0 ? 4 : 2)
const time = (n: number) => new Date(n).toLocaleTimeString('zh-CN', { hour12: false })
function notify(message: string, error = false) { toast.value = message; toastError.value = error; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4500) }
async function send(command: Command, message?: string) {
  try { const result = await bridge.command(command); if (!result.ok) notify(result.message || '操作未完成，请查看日志。', true); else if (message || result.message) notify(message || result.message!); return result }
  catch (error) { notify(error instanceof Error ? error.message : '操作失败，请查看日志。', true) }
}
function syncEdits() { Object.assign(editConfig, clone(state.value.config)); editGifts.value = clone(state.value.gifts); Object.assign(editShop, clone(state.value.shop)) }
function setPage(id: string) { page.value = id; syncEdits(); editReply.value = '' }
async function saveConfig() { saving.value = true; await send({ type: 'set-config', config: clone(editConfig) }, '设置已保存'); saving.value = false }
/** Small switches apply at once from the live config, so no page has a forgotten "save" button for them. */
async function patchConfig(patch: (c: AppConfig) => void, message?: string) { const c = clone(state.value.config); patch(c); const r = await send({ type: 'set-config', config: c }, message); if (r?.ok) patch(editConfig) }
async function setScene(scene: SceneId) { await send({ type: 'set-shop', shop: { ...clone(state.value.shop), scene } }, `窗外换成了${getShopSceneLabel(scene, shopTime.value.phase)}`) }
async function setShopPeriod(period: ShopTimePeriod) { await patchConfig(c => { c.look.timeOfDay = period }, period === 'auto' ? '小店已跟随电脑真实时间自动换景。' : `已切换为${shopPeriods.find(item => item.id === period)?.label}，可随时切回自动。`) }
async function goLive() {
  if (state.value.audioReservation) { notify(state.value.audioReservation.message, true); return }
  await bridge.openStage()
  if (!state.value.running) await send({ type: 'start' }, '开始营业！在直播伴侣里采集「直播画面」窗口即可。')
}
function openUsageBudget() { setPage('settings'); settingsTab.value = 'budget' }
async function voicePreview() { const r = await send({ type: 'set-config', config: clone(editConfig) }); if (r?.ok) await send({ type: 'voice-preview', text: previewText.value }) }
async function testConnection(provider: 'deepseek' | 'qwen') { const r = await send({ type: 'set-config', config: clone(editConfig) }); if (r?.ok) await send({ type: 'test-connection', provider }) }
async function saveKey(provider: 'deepseek' | 'qwen') { if (!keys[provider].trim()) return notify('请先填写密钥。', true); const r = await send({ type: 'save-key', provider, key: keys[provider].trim() }); if (r?.ok) keys[provider] = '' }
async function designVoice() {
  const r = await send({ type: 'design-voice', description: voiceDescription.value, previewText: previewText.value })
  if (r?.ok && r.data && typeof r.data === 'object' && 'voice' in r.data) { editConfig.voice.voice = String(r.data.voice); if ('previewUrl' in r.data) designPreview.value = String(r.data.previewUrl || ''); notify('专属音色已生成，保存设置即可使用。') }
}
function event(kind: LiveEvent['kind'], user: { id: string; name: string }, extra: Partial<LiveEvent> = {}): LiveEvent { return { id: `sim-${Date.now()}-${++simSequence}`, kind, user, at: Date.now(), ...extra } }
function inject(preset?: string) {
  const gift = state.value.gifts.find(g => g.id === sim.giftId)
  const user = { id: sim.userId.trim() || 'demo-viewer', name: sim.name.trim() || '路过的客人' }
  const e = event(preset ? 'chat' : simKind.value, user)
  if (preset) e.text = preset
  else if (e.kind === 'chat') e.text = sim.text
  else if (e.kind === 'gift') { e.giftId = sim.giftId; e.giftName = gift?.name; e.count = Math.max(1, sim.count); e.comboKey = sim.comboKey.trim() || undefined }
  send({ type: 'inject', event: e }, '模拟互动已送进小店')
}
const crowd = ['夜猫子阿离', '加班的小周', '失眠的鹿', '晚风', '路过的猫', '早睡失败', '星星收集者', '雨天的伞', '一碗泡面', '月亮邮差', '小熊软糖', '慢慢来']
async function simulateVotes() {
  const r = openRound.value
  if (!r) return notify('先在「明日投票」开始一轮投票。', true)
  for (let i = 0; i < 12; i++) await bridge.command({ type: 'inject', event: event('chat', { id: `crowd-${i}`, name: crowd[i]! }, { text: `投${1 + Math.floor(Math.random() * r.options.length)}` }) })
  notify('12 位模拟观众已投票')
}
async function simulateBoost() {
  if (!openRound.value) return notify('先在「明日投票」开始一轮投票。', true)
  await bridge.command({ type: 'inject', event: event('chat', { id: 'crowd-fan', name: '常来的阿暖' }, { text: '投2' }) })
  await bridge.command({ type: 'inject', event: event('gift', { id: 'crowd-fan', name: '常来的阿暖' }, { giftId: 'coffee', giftName: '热咖啡', count: 3 }) })
  notify('阿暖投了2号，并送了3杯热咖啡助推')
}
async function manualSay() { if (!say.value.trim()) return; const r = await send({ type: 'say', text: say.value.trim() }); if (r?.ok) say.value = '' }
async function approve() { if (currentDraft.value) { await send({ type: 'approve', id: currentDraft.value.id, text: editReply.value.trim() || undefined }); editReply.value = '' } }
function doAction(action: string) { send({ type: 'action', action }) }
function addOption(o: PlanOption) {
  if (voteDraft.options.length >= 4) return notify('一轮最多 4 个选项，选择太多观众会犹豫。', true)
  if (voteDraft.options.some(x => x.id === o.id)) return
  voteDraft.options.push(clone(o))
}
function addCustom() { const title = customOption.value.trim(); if (!title) return; addOption({ id: `custom-${Date.now()}`, kind: 'activity', title: title.slice(0, 30), about: '店长的新点子' }); customOption.value = '' }
async function openVote() { const r = await send({ type: 'vote-open', title: voteDraft.title, options: clone(voteDraft.options), minutes: voteDraft.minutes }); if (r?.ok) voteDraft.options = [] }
async function refreshDevices() { try { audioDevices.value = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); notify(`检测到 ${audioDevices.value.length} 个输出设备`) } catch { notify('未能读取音频设备，请在桌面应用中重试。', true) } }
function hotkey(e: KeyboardEvent) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); approve() } if (e.key === 'Escape') send({ type: 'interrupt' }) }
onMounted(async () => {
  try { state.value = await bridge.getState(); syncEdits(); voteDraft.minutes = state.value.config.vote.minutes; ready.value = true; unsubscribe = bridge.subscribe(s => state.value = s) } catch (e) { notify(String(e), true) }
  clockTimer = setInterval(() => clock.value = Date.now(), 1000)
  window.addEventListener('keydown', hotkey)
})
onUnmounted(() => { unsubscribe(); clearTimeout(toastTimer); clearInterval(clockTimer); window.removeEventListener('keydown', hotkey) })
</script>

<template>
  <div v-if="standalone" class="standalone-stage"><StageView v-if="ready" :state="state" @stage-event="e => send({ type: 'stage-event', event: e })" @music-event="e => send(e)"/><div v-else class="stage-loading">正在连接肥鱼小店…</div></div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"><Icon name="fish" :size="24"/></div><div><strong>赛博肥鱼</strong><span>{{shopTime.label}}小店 · 直播工作台</span></div></div>
      <nav aria-label="工作台导航">
        <button v-for="item in visibleNav" :key="item.id" :class="['nav-item', { active: page === item.id }]" :aria-label="item.label" :aria-current="page === item.id ? 'page' : undefined" @click="setPage(item.id)">
          <Icon :name="item.icon" :size="18"/><span>{{ item.label }}</span>
          <i v-if="item.id === 'live' && state.drafts.length" class="nav-badge">{{ state.drafts.length }}</i>
          <i v-if="item.id === 'vote' && openRound" class="nav-badge live">投票中</i>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <button class="setup-link" @click="send({type:'open-local-test'})"><Icon name="flask" :size="16"/>独立本地测试</button>
        <button class="setup-link" @click="setup = true"><Icon name="help" :size="16"/>开播指南</button>
        <div class="version"><span :class="['dot', { on: state.running }]"/>{{ state.config.demo ? '试营业 · 不花钱' : '真实 AI 服务' }}<span>v{{ state.version }}</span></div>
      </div>
    </aside>

    <main class="workspace">
      <div v-if="state.audioReservation" class="notice warning audio-reservation" role="status" data-testid="audio-reservation"><Icon name="speaker" :size="18"/><div><strong>专用音频正在测试中</strong><p>{{state.audioReservation.message}}</p><p class="small">这扇正式工作台已停止送音；测试结束后，由你手动恢复营业。</p></div></div>
      <header class="page-heading">
        <div><h1>{{ currentPage.label }}</h1><p>{{ currentPage.about }}</p></div>
        <div class="heading-actions">
          <button v-if="page === 'settings'" class="btn primary" :disabled="saving" @click="saveConfig"><Icon name="check" :size="16"/>保存设置</button>
          <button v-if="page === 'settings' && settingsTab === 'logs'" class="btn ghost" @click="bridge.exportLogs().then(r => notify(r.message || '日志已导出'))"><Icon name="download" :size="16"/>导出日志</button>
        </div>
      </header>

      <!-- 开播 -->
      <template v-if="page === 'live'">
        <section v-if="!state.running" class="card hero">
          <div class="hero-copy"><span class="eyebrow">{{shopTime.description}}</span><h2>准备好就开门吧</h2>
            <ol class="steps"><li><b>1</b>点「开始营业」：打开小店专用画面窗口。</li><li><b>2</b>在抖音直播伴侣添加「程序窗口」，选「赛博肥鱼 · 抖音直播采集（9:16）」。</li><li><b>3</b>检查画面和声音后，在直播伴侣里开播。真实观众互动还需在「直播连接」接入消息来源。</li></ol>
          </div>
          <button class="btn primary huge" :disabled="!!state.audioReservation" @click="goLive"><Icon name="play" :size="20"/>开始营业</button>
        </section>
        <ServiceUsage :state="state" @open-budget="openUsageBudget"/>
        <section v-if="state.roomMood" class="card room-mood" data-testid="room-mood"><div class="card-head"><h2>{{({lively:'✨',cozy:'🐟',restless:'🫧',lonely:'🌙',reunited:'👋'})[state.roomMood.kind]}} {{state.roomMood.label}}</h2><span class="tag">最近互动带来的心情</span></div><p>{{state.roomMood.description}}</p><div class="row room-mood-footer"><small class="muted">按小店最近收到的互动变化，不代表真实在线人数。</small><button class="link" @click="setPage('settings'); settingsTab = 'display'">调整主动聊天节奏</button></div></section>
        <section v-if="state.show.startedAt || state.show.turns" class="card tonight">
          <div class="tonight-stats" data-testid="session-token-summary"><div><b>{{ state.show.talkers }}</b><span>位客人说过话</span></div><div><b>{{ state.show.turns }}</b><span>句对话已记住</span></div><div><b>{{ tokenUsageIncomplete ? '至少 ' : '' }}{{ rationCount(reportedTokens) }}</b><span>本场对话 + 配音已报 token{{ tokenUsageIncomplete ? ' · 待核算' : '' }}</span></div><div :class="{ warn: state.rations.balance < 0 }"><b>{{ rationCount(state.rations.balance) }}</b><span>{{ state.rations.balance < 0 ? '口粮 token · 透支' : '剩余口粮 token' }}</span></div></div>
          <button class="btn ghost" :disabled="state.show.consolidating" @click="endShow"><Icon name="moon" :size="15"/>{{ state.show.consolidating ? '正在整理记忆…' : '下播并整理记忆' }}</button>
        </section>
        <div class="grid two">
          <section class="card">
            <div class="card-head"><h2><Icon name="spark" :size="16"/>下一句</h2><span class="tag">{{ state.generating ? '正在构思…' : state.drafts.length ? state.drafts.length + ' 条待确认' : autoTalk ? 'AI 自动接话中' : '等待弹幕' }}</span></div>
            <template v-if="currentDraft">
              <div v-if="currentDraft.requiresReview" class="notice warning">{{ currentDraft.requiresReview }}</div>
              <div class="muted small">回应 @{{ currentDraft.viewerName || '小店客人' }} · {{ FACES.find(f => f.id === currentDraft?.face)?.name }} · {{ ACTIONS.find(a => a.id === currentDraft?.action)?.name }}</div>
              <textarea v-model="editReply" :placeholder="currentDraft.say.join('')" rows="3" aria-label="修改待确认台词"/>
              <div class="row-end"><button class="btn ghost" @click="send({ type: 'skip', id: currentDraft.id })">跳过</button><button class="btn primary" @click="approve"><Icon name="check" :size="15"/>通过并说出 <kbd>Ctrl ↵</kbd></button></div>
            </template>
            <div v-else class="empty"><Icon :name="state.generating ? 'spark' : 'coffee'" :size="24"/><p>{{ state.generating ? '肥鱼在认真想一句好听的话…' : autoTalk ? '有弹幕时肥鱼会自动接话。' : '人工确认模式：AI 起草的每句话会先放在这里。' }}</p></div>
            <div class="say-box"><input v-model="say" maxlength="500" placeholder="替肥鱼说一句，回车播出…" aria-label="让店主说一句" @keydown.enter="manualSay"/><button class="btn primary" :disabled="!say.trim()" @click="manualSay"><Icon name="mic" :size="15"/>说</button></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>随手一个小动作</h2><button class="link" @click="setPage('look')">全部 {{ ACTIONS.length }} 个 <Icon name="arrow" :size="13"/></button></div>
            <div class="action-chips"><button v-for="id in quick" :key="id" :class="{ playing: state.stage.action === id }" @click="doAction(id)"><span>{{ emojiOf[id] }}</span>{{ ACTIONS.find(a => a.id === id)?.name }}</button></div>
            <div class="face-row"><button v-for="(f, i) in FACES.slice(0, 10)" :key="f.id" :title="f.name" :class="{ selected: state.stage.face === f.id }" @click="send({ type: 'face', face: f.id })">{{ faceEmoji[i] }}</button></div>
          </section>
        </div>
        <div class="grid two">
          <section v-if="state.config.vote.enabled" class="card">
            <div class="card-head"><h2><Icon name="vote" :size="16"/>明日投票</h2><button class="link" @click="setPage('vote')">{{ openRound ? '查看' : '去发起' }} <Icon name="arrow" :size="13"/></button></div>
            <template v-if="openRound"><div class="mini-tally"><div v-for="(o, i) in openRound.options" :key="o.id"><span>{{ i + 1 }}号 {{ o.title }}</span><div class="bar"><i :style="{ width: (rows[i]?.score ?? 0) * 100 + '%' }"/></div><b>{{ rows[i]?.heads }}人</b></div></div><p class="muted small">剩余 {{ remaining }} · 观众发「投1」「投2」参与</p></template>
            <div v-else class="empty compact"><p>{{ state.vote.plans[0] ? `上次结果：「${state.vote.plans[0].option.title}」` : '让观众决定明天演什么，留住回头客。' }}</p></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>小店动态</h2><span class="tag">{{ state.viewers.length }} 位客人 · {{ state.shop.points }} 暖心值</span></div>
            <div v-for="l in state.logs.slice(0, 5)" :key="l.id" class="activity"><span :class="['dot', l.level]"/><span>{{ l.message }}</span><time>{{ time(l.at).slice(0, 5) }}</time></div>
          </section>
        </div>
      </template>

      <template v-else-if="page === 'jukebox'"><JukeboxView :state="state" :execute="send"/></template>
      <template v-else-if="page === 'connect'"><LiveConnections :state="state" :execute="send"/></template>

      <!-- 明日投票 -->
      <template v-else-if="page === 'vote' && state.config.vote.enabled">
        <section v-if="openRound" class="card vote-live">
          <div class="card-head"><h2><span class="live-dot"/>{{ openRound.title }}</h2><span class="tag strong">剩余 {{ remaining }} · {{ openRound.ballots.length }} 人已投</span></div>
          <div v-for="(o, i) in openRound.options" :key="o.id" class="tally-row">
            <div class="tally-title"><b>{{ i + 1 }}号</b>{{ o.title }}<span class="tag">{{ kindName[o.kind] }}</span><span v-if="rows[i]?.majority" class="tag mint">过半</span></div>
            <div class="bar big"><i :style="{ width: (rows[i]?.score ?? 0) * 100 + '%' }"/></div>
            <div class="tally-meta">{{ rows[i]?.heads }} 人投票 · 人数占 {{ Math.round((rows[i]?.headShare ?? 0) * 100) }}% · 助推 ✦{{ rows[i]?.boost }}</div>
          </div>
          <div class="row-end"><button class="btn ghost" @click="send({ type: 'vote-cancel' })">取消本轮</button><button class="btn primary" @click="send({ type: 'vote-close' })"><Icon name="check" :size="15"/>现在结束并公布</button></div>
          <div class="feed"><div v-for="f in state.vote.feed.slice(0, 6)" :key="f.id" :class="['feed-item', f.kind]">{{ f.text }}</div></div>
        </section>
        <div v-else class="grid two">
          <section class="card">
            <div class="card-head"><h2>1. 挑 2~4 个选项</h2><span class="tag">{{ voteDraft.options.length }} / 4</span></div>
            <div v-for="kind in (['scene', 'activity', 'behavior'] as const)" :key="kind" class="library"><span class="muted small">{{ kindName[kind] }}</span><div class="chips"><button v-for="o in PLAN_LIBRARY.filter(p => p.kind === kind)" :key="o.id" :class="{ selected: voteDraft.options.some(x => x.id === o.id) }" :title="o.about" @click="addOption(o)">{{ o.title }}</button></div></div>
            <div v-if="state.vote.suggestions.length" class="library"><span class="muted small">观众的提议（弹幕发「提议 xxx」）</span><div class="suggestions"><div v-for="s in state.vote.suggestions.slice(0, 6)" :key="s.id"><span><b>{{ s.name }}</b>：{{ s.text }}</span><button class="link" @click="addOption({ id: 'sug-' + s.id, kind: 'activity', title: s.text, about: s.name + ' 的提议', proposer: s.name })">采纳</button><button class="link muted" @click="send({ type: 'suggestion-dismiss', id: s.id })">忽略</button></div></div></div>
            <div class="say-box"><input v-model="customOption" maxlength="30" placeholder="自己写一个，比如：肥鱼学猫叫一晚" @keydown.enter="addCustom"/><button class="btn ghost" @click="addCustom"><Icon name="plus" :size="15"/>添加</button></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>2. 确认并开始</h2></div>
            <div v-if="!voteDraft.options.length" class="empty compact"><p>从左边挑选项，会出现在这里。</p></div>
            <div v-for="(o, i) in voteDraft.options" :key="o.id" class="draft-option"><b>{{ i + 1 }}号</b><span>{{ o.title }}<small>{{ o.about }}</small></span><button class="link muted" aria-label="移除选项" @click="voteDraft.options.splice(i, 1)"><Icon name="close" :size="14"/></button></div>
            <div class="form-grid"><label>投票标题<input v-model="voteDraft.title" maxlength="40"/></label><label>投票时长 / 分钟<input v-model.number="voteDraft.minutes" type="number" min="1" max="180"/></label></div>
            <button class="btn primary wide" :disabled="voteDraft.options.length < 2" @click="openVote"><Icon name="vote" :size="16"/>开始投票</button>
          </section>
        </div>
        <div class="grid two">
          <section class="card">
            <div class="card-head"><h2>投票结果 · 明日计划</h2></div>
            <div v-if="!state.vote.plans.length" class="empty compact"><p>还没有投出过计划。</p></div>
            <div v-for="p in state.vote.plans.slice(0, 6)" :key="p.id" class="plan-row"><div><b>{{ p.option.title }}</b><small>{{ new Date(p.decidedAt).toLocaleDateString('zh-CN') }} · {{ p.voters }} 人决定{{ p.boosters ? ` · ${p.boosters} 人助推` : '' }}</small></div><span v-if="p.applied" class="tag mint">本场执行中</span><button v-else class="btn ghost small" @click="send({ type: 'plan-apply', id: p.id })">本场执行</button></div>
          </section>
          <section class="card rules">
            <div class="card-head"><h2>公平规则</h2><span class="tag">观众看得懂才愿意参与</span></div>
            <ul><li><b>人人一票</b>：发「投1」「投2」，以最后一次为准。</li><li><b>礼物只助推</b>：投票期间送的礼物按暖心值助推自己选的项，效果按平方根递减，每人有上限。</li><li><b>过半直接赢</b>：一个选项拿到超过一半的人数，就算助推再多也不会被翻盘。</li><li><b>熟客加成</b>：来过 3 晚以上的客人自带一点免费助推。</li></ul>
            <div class="form-grid three">
              <label>人数票占比 <span>{{ Math.round(editConfig.vote.headWeight * 100) }}%</span><input v-model.number="editConfig.vote.headWeight" type="range" min="0.3" max="1" step="0.05" @change="patchConfig(c => c.vote.headWeight = editConfig.vote.headWeight)"/></label>
              <label>每人助推上限<input v-model.number="editConfig.vote.boostCap" type="number" min="1" @change="patchConfig(c => c.vote.boostCap = editConfig.vote.boostCap)"/></label>
              <label>熟客加成<input v-model.number="editConfig.vote.regularBonus" type="number" min="0" @change="patchConfig(c => c.vote.regularBonus = editConfig.vote.regularBonus)"/></label>
            </div>
          </section>
        </div>
      </template>

      <!-- 形象与动作 -->
      <template v-else-if="page === 'look'">
        <section class="card" data-testid="shop-time-setting">
          <div class="card-head"><h2>营业时段</h2><span class="tag">{{shopTime.manual?'手动布景':'按真实时间自动'}}</span></div>
          <p class="muted small">电脑时间 {{actualShopTime.timeLabel}} · {{actualShopTime.label}}，当前是「{{shopTime.title}}」。</p>
          <div class="segmented shop-periods"><button v-for="period in shopPeriods" :key="period.id" :class="{selected:(state.config.look.timeOfDay||'auto')===period.id}" :aria-pressed="(state.config.look.timeOfDay||'auto')===period.id" @click="setShopPeriod(period.id)">{{period.label}}</button></div>
          <p class="muted small">自动换景：06–10 点晨间，10–17 点白天，17–20 点黄昏，其余为夜晚。也可固定一个布景；画面时钟仍显示真实时间，天气与配色会保留。</p>
        </section>
        <div class="grid three-one">
          <section class="card">
            <div class="card-head"><h2>AI 形象与配色</h2><span class="tag">点一下立即换形象</span></div>
            <p class="skin-identity" data-testid="skin-identity">{{getSkinIdentityLabel(state.config.look.scheme)}}</p>
            <p class="muted small">观众可提议换 AI 形象；同时有已记录的关注和赠礼后，还要和肥鱼拉扯几轮。店长手动换装随时可用。</p>
            <div class="swatches" data-testid="ai-skins"><button v-for="s in SKINS" :key="s.id" :class="{ selected: state.config.look.scheme === s.id }" :aria-label="'形象 ' + s.ai + ' · ' + s.name" :aria-pressed="state.config.look.scheme === s.id" :data-skin="s.id" @click="patchConfig(c => c.look.scheme = s.id, `换上了${s.ai} · ${s.name}`)"><i :style="{ background: s.color }"/><span><strong>{{s.ai}}</strong><small>{{s.name}}</small></span></button></div>
            <div class="card-head spaced"><h2>服装</h2></div>
            <div class="segmented"><button v-for="o in OUTFITS" :key="o.id" :class="{ selected: state.config.look.outfit === o.id }" @click="patchConfig(c => c.look.outfit = o.id, `换上了${o.name}`)">{{ o.name }}</button></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>窗外的场景</h2></div>
            <div class="scene-grid"><button v-for="s in SCENES" :key="s.id" :class="['scene-' + s.id, { selected: state.shop.scene === s.id }]" @click="setScene(s.id)">{{ getShopSceneLabel(s.id,shopTime.phase) }}</button></div>
            <div class="card-head spaced"><h2>去哪儿待着</h2></div>
            <div class="segmented"><button v-for="s in STATIONS" :key="s.id" :class="{ selected: state.stage.station === s.id }" @click="send({ type: 'station', station: s.id })">{{ s.name }}</button></div>
          </section>
        </div>
        <section class="card">
          <div class="card-head"><div class="segmented"><button v-for="g in [{ id: 'night', name: '小店互动' }, { id: 'shop', name: '小店日常' }, { id: 'base', name: '基础动作' }]" :key="g.id" :class="{ selected: actionGroup === g.id }" @click="actionGroup = g.id">{{ g.name }}</button></div><span class="muted small">{{ groupedActions.length }} 个 · 点击立即表演</span></div>
          <div class="actions-grid"><button v-for="a in groupedActions" :key="a.id" :class="['action-card', { playing: state.stage.action === a.id }]" @click="doAction(a.id)"><span class="emoji">{{ emojiOf[a.id] || '✨' }}</span><h3>{{ a.name }}</h3><p>{{ a.about }}</p><small>{{ a.seconds }} 秒{{ a.station ? ' · ' + STATIONS.find(s => s.id === a.station)?.name : '' }}{{ a.whileTalking ? ' · 可边说边做' : '' }}</small></button></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>表情</h2></div>
          <div class="face-row wide"><button v-for="(f, i) in FACES" :key="f.id" :class="{ selected: state.stage.face === f.id }" @click="send({ type: 'face', face: f.id })"><span>{{ faceEmoji[i] }}</span>{{ f.name }}</button></div>
        </section>
      </template>

      <!-- 互动排练 -->
      <template v-else-if="page === 'rehearse'">
        <div class="grid two">
          <section class="card">
            <div class="card-head"><h2>发一条模拟互动</h2><span class="tag mint">{{ state.config.demo ? '不花钱' : '会调用真实 AI' }}</span></div>
            <div class="segmented"><button v-for="s in [{ id: 'chat', name: '弹幕' }, { id: 'gift', name: '礼物' }, { id: 'enter', name: '进场' }, { id: 'follow', name: '关注' }, { id: 'like', name: '点赞' }]" :key="s.id" :class="{ selected: simKind === s.id }" @click="simKind = s.id as typeof simKind">{{ s.name }}</button></div>
            <div class="form-grid"><label>观众昵称<input v-model="sim.name"/></label><label>稳定用户 ID<input v-model="sim.userId"/></label></div>
            <label v-if="simKind === 'chat'">弹幕内容<textarea v-model="sim.text" rows="3" maxlength="500"/></label>
            <template v-if="simKind === 'gift'"><div class="form-grid"><label>礼物<select v-model="sim.giftId"><option v-for="g in state.gifts" :key="g.id" :value="g.id">{{ g.name }}</option></select></label><label>数量（连击时填累计数量）<input v-model.number="sim.count" type="number" min="1" max="10000"/></label></div><label>连击标识 · 可留空<input v-model="sim.comboKey" placeholder="同一组连击填同一个标识"/></label></template>
            <div class="row-end"><button class="btn primary" @click="inject()"><Icon name="arrow" :size="16"/>发送模拟{{ ({ chat: '弹幕', gift: '礼物', enter: '进场', follow: '关注', like: '点赞' })[simKind] }}</button></div>
            <div v-if="!state.running" class="notice warning">小店还没营业。先去「开播」开始营业，肥鱼才会回应。</div>
          </section>
          <div class="stack">
            <section class="card"><div class="card-head"><h2>一键试试</h2></div><div class="preset-list"><button v-for="text in ['这么晚还不关门呀？', '今天上班好累，想喝杯热咖啡。', '给我比个心好不好？', '窗外下雨了，你喜欢雨天吗？', '提议 肥鱼讲鬼故事']" :key="text" @click="inject(text)"><Icon name="chat" :size="15"/><span>{{ text }}</span></button></div></section>
            <section v-if="state.config.vote.enabled" class="card"><div class="card-head"><h2>排练投票</h2></div><div class="row"><button class="btn ghost" @click="simulateVotes">12 位观众来投票</button><button class="btn ghost" @click="simulateBoost">熟客送礼助推</button></div><p class="muted small">先在「明日投票」开一轮，再来这里看看票数怎么跳。</p></section>
            <section class="card"><div class="card-head"><h2>排队中的互动</h2><span class="tag">{{ state.queue.length }} 条</span></div><div v-if="!state.queue.length" class="empty compact"><p>队列空空的，正好擦擦杯子。</p></div><div v-for="e in state.queue.slice(0, 6)" :key="e.id" class="activity"><span class="avatar">{{ e.user.name.slice(0, 1) }}</span><span><b>{{ e.user.name }}</b> {{ e.text || e.giftName || '走进了小店' }} {{ e.kind === 'gift' ? '× ' + e.count : '' }}</span></div></section>
          </div>
        </div>
      </template>

      <!-- 小店养成 -->
      <template v-else-if="page === 'grow'">
        <InputStatistics :statistics="state.inputStatistics"/>
        <div class="grid two">
          <section class="card">
            <div class="card-head"><h2>大家一起点亮的装饰</h2><span class="tag">{{ state.shop.points }} 暖心值</span></div>
            <div class="decorations"><div v-for="(d, i) in DECORATIONS" :key="d.id" :class="['decoration', { unlocked: state.shop.decorations.includes(d.id) }]"><span>{{ d.emoji }}</span><strong>{{ d.name }}</strong><small>{{ state.shop.decorations.includes(d.id) ? '已经住进小店' : (i + 1) * state.shop.goal + ' 暖心值' }}</small></div></div>
            <div class="bar big amber"><i :style="{ width: goalPercent + '%' }"/></div>
            <p class="muted small">暖心值来自小店玩法中的礼物事件，包含模拟赠礼；来源分列见上方。装饰会保留，所有人都能看到。</p>
          </section>
          <section class="card">
            <div class="card-head"><h2>小店信息</h2></div>
            <label>小店名字<input v-model="editShop.name"/></label>
            <label>小店的故事<textarea v-model="editShop.story" rows="3"/></label>
            <label>每件装饰需要的暖心值<input v-model.number="editShop.goal" type="number" min="1"/></label>
            <div class="row-end"><button class="btn primary" @click="send({ type: 'set-shop', shop: { ...clone(editShop), points: state.shop.points, totalGifts: state.shop.totalGifts, decorations: state.shop.decorations, scene: state.shop.scene } }, '小店设置已保存')">保存小店</button></div>
          </section>
        </div>
        <section class="card" data-testid="rations-wallet">
          <div class="card-head"><h2>肥鱼的口粮</h2><span class="tag mint">token 养成</span></div>
          <div class="stats"><div class="stat"><span>口粮余额</span><b data-testid="rations-wallet-balance">{{ rationCount(state.rations.balance) }}</b><small>token · 可低于零</small></div><div class="stat"><span>累计补充</span><b>{{ rationCount(state.rations.earned) }}</b><small>含礼物与店长补给</small></div><div class="stat"><span>实际已扣</span><b>{{ rationCount(state.rations.spent) }}</b><small>对话 + 配音已返回 token</small></div><div class="stat"><span>用量待核算</span><b>{{ rationCount(state.rations.unknownRequests) }} 笔</b><small>缺失用量不编造扣除</small></div></div>
          <p class="muted small">开局 100,000 token 口粮。礼物按下方规则补充，对话和配音返回真实用量后扣除；缓存 token 已包含在对话输入里，不重复扣。口粮会跨场保留，是小店养成数值；服务商费用见「设置 → 电费」。</p>
          <div class="say-box"><input v-model.number="rationTopUpAmount" type="number" min="1" max="1000000000000" step="1" aria-label="补充口粮数量"/><button class="btn primary" :disabled="!rationTopUpValid" @click="send({ type: 'rations-topup', tokens: rationTopUpAmount }, '店长口粮已补给')">店长补充口粮</button><button class="btn ghost" @click="send({ type: 'rations-reset' }, '口粮已重置为 100,000 token')">重置口粮至 100,000</button></div>
          <p class="muted small">重置会清空累计补充、已扣和待核算笔数，不清除服务商用量记录与玩法钱包。</p>
        </section>
        <div class="grid two">
          <section class="card">
            <div class="card-head"><h2>肥鱼的元钱包玩法</h2><span :class="['tag', state.wallet.bankrupt ? 'strong' : 'mint']">{{ state.wallet.bankrupt ? '破产中' : '营业中' }}</span></div>
            <details><summary>展开元钱包玩法记录</summary><div class="stats compact"><div class="stat"><span>余额</span><b>¥{{ state.wallet.balance.toFixed(2) }}</b></div><div class="stat"><span>礼物玩法增记</span><b>¥{{ state.wallet.earned.toFixed(2) }}</b></div><div class="stat"><span>已计价 AI 估值</span><b>¥{{ state.wallet.spent.toFixed(2) }}</b></div><div class="stat"><span>她以为收到的</span><b>¥{{ (state.wallet.imagined ?? 0).toFixed(0) }}</b></div></div>
            <div class="stat"><span>她脑内的白饭</span><b data-testid="imagined-token-rations">{{rationCount(state.wallet.imaginedTokens || 0)}} token</b><small>弹幕装傻剧情，独立于真实用量和礼物资格。</small></div>
            <p class="muted small">已计价 AI 费用估值从玩法钱包扣；礼物按店长设置估值的 {{ Math.round(state.config.wallet.share * 100) }}% 增记，包含模拟赠礼，不代表抖音到账收入。亏到 -¥{{ state.config.wallet.debtLimit }} 就破产，只说免费的预设台词，回正后恢复。「她以为收到的」与「她脑内的白饭」来自弹幕装傻剧情，不计入真实口粮或实际收入。</p>
            <div class="say-box"><input v-model.number="topUpAmount" type="number" min="0.1" step="1" aria-label="注资金额"/><button class="btn ghost" @click="send({ type: 'wallet-topup', yuan: topUpAmount })">店长注资</button><button class="btn ghost" @click="send({ type: 'wallet-reset' })">重置钱包</button></div></details>
          </section>
          <section class="card">
            <div class="card-head"><h2>账号营业日志</h2><span class="tag">{{ state.channel.firstShowAt ? `${day(state.channel.firstShowAt)} 接手 · 第 ${state.channel.shows} 场` : '还没下播过' }}</span></div>
            <div v-if="!state.channel.recaps.length" class="empty compact"><p>每次「下播并整理记忆」后，肥鱼会在这里写一条营业日志，下次开播她会记得。</p></div>
            <div v-for="r in state.channel.recaps.slice(0, 6)" :key="r.at" class="recap"><b>{{ day(r.at) }} · {{ r.minutes }} 分钟</b><p>{{ r.summary }}</p><small>{{ r.talkers }} 位客人说话 · {{ r.gifts }} 份礼物 · {{ tokens(r.tokens) }} token{{ r.plan ? ' · 计划：' + r.plan : '' }}</small></div>
            <div v-if="state.channel.milestones.length" class="chips"><span v-for="m in state.channel.milestones.slice(0, 6)" :key="m.at + m.text" class="tag">🏅 {{ m.text }}</span></div>
          </section>
        </div>
        <GiftPriceReference/>
        <section class="card">
          <div class="card-head"><h2>礼物 → 小店的回应</h2><button class="btn primary small" @click="send({ type: 'set-gifts', gifts: clone(editGifts) }, '礼物规则已保存')"><Icon name="check" :size="15"/>保存规则</button></div>
          <div class="table-wrap"><table><thead><tr><th>礼物</th><th>表演动作</th><th>回应台词</th><th>暖心值 / 个</th><th>补充口粮 / token</th><th>店长估值 / 元</th><th>播放回应</th><th></th></tr></thead><tbody><tr v-for="gift in editGifts" :key="gift.id"><td><input v-model="gift.name" class="short"/></td><td><select v-model="gift.action"><option v-for="a in ACTIONS" :key="a.id" :value="a.id">{{ a.name }}</option></select></td><td><textarea v-model="gift.template" rows="2"/></td><td><input v-model.number="gift.points" type="number" min="0" max="1000" class="short"/></td><td><input v-model.number="gift.tokens" type="number" min="0" max="1000000000" step="1" class="short" :aria-label="gift.name + ' 补充口粮'"/></td><td><input v-model.number="gift.yuan" type="number" min="0" step="0.1" class="short" :aria-label="gift.name + ' 店长估值'"/></td><td><input v-model="gift.enabled" type="checkbox" :aria-label="gift.name + ' 播放回应'"/></td><td><button class="btn ghost small" @click="simKind = 'gift'; sim.giftId = gift.id; inject()">测试</button></td></tr></tbody></table></div>
          <p class="muted small">补充口粮按每个礼物计算，填 0 表示不补充。「播放回应」只控制礼物表演，关闭后仍按规则补充口粮；演练赠礼会标明来源。</p>
          <p class="muted small">台词支持 {name}（昵称）和 {count}（数量）。肥鱼会一视同仁地道谢，不会因为礼物大小区别对待。</p>
        </section>
        <section class="card">
          <div class="card-head"><h2>熟客簿 <span class="tag">{{ state.viewers.length }} 位</span></h2><input v-model="viewerSearch" class="search" placeholder="搜索昵称或备注…"/></div>
          <div v-if="!viewers.length" class="empty compact"><p>小店还在等第一位熟客。</p></div>
          <div v-else class="table-wrap"><table><thead><tr><th>客人</th><th>来访</th><th>礼物</th><th>肥鱼记得</th><th>店长备注</th><th>屏蔽</th><th></th></tr></thead><tbody><tr v-for="v in viewers.slice(0, 100)" :key="v.id"><td><strong>{{ v.name }}</strong> <span :class="['tag', tierOf(v) === 'vip' ? 'strong' : tierOf(v) === 'regular' ? 'mint' : '']">{{ TIER_NAMES[tierOf(v)] }}</span><div class="muted small">{{ v.id }}{{ v.level ? ' · Lv' + v.level : '' }}</div></td><td>{{ v.visits }}</td><td>{{ v.gifts }}</td><td class="memory-cell"><template v-if="v.memory"><p>{{ v.memory.summary || '（还没有印象）' }}</p><button class="link" @click="openViewer = openViewer === v.id ? '' : v.id">{{ openViewer === v.id ? '收起' : `${v.memory.facts.length} 条记忆` }}</button><ul v-if="openViewer === v.id"><li v-for="f in v.memory.facts" :key="f">{{ f }}</li></ul><button class="link muted" @click="send({ type: 'forget-viewer', id: v.id })">忘记</button></template><span v-else class="muted small">还没有长期记忆</span><button class="link" @click="openRecord(v)">聊天档案</button></td><td><input v-model="v.note" placeholder="记下TA的小故事"/></td><td><input v-model="v.blocked" type="checkbox"/></td><td><button class="btn ghost small" @click="send({ type: 'set-viewer', viewer: clone(v) }, '熟客信息已保存')">保存</button></td></tr></tbody></table></div>
        </section>
      </template>

      <!-- 设置 -->
      <template v-else-if="page === 'settings'">
        <div class="segmented tabs"><button v-for="t in [{ id: 'ai', name: 'AI 与声音' }, { id: 'safety', name: '安全' }, { id: 'budget', name: '电费预算' }, { id: 'display', name: '直播画面' }, { id: 'logs', name: '运行日志' }]" :key="t.id" :class="{ selected: settingsTab === t.id }" @click="settingsTab = t.id">{{ t.name }}</button></div>
        <div v-if="settingsTab === 'ai'" class="grid two">
          <section class="card">
            <div class="card-head"><h2>对话 AI</h2><span :class="['tag', { mint: state.credentials.deepseek }]">{{ state.credentials.deepseek ? '密钥已保存' : '未配置密钥' }}</span></div>
            <div v-if="!isDesktop" class="notice warning">当前是浏览器预览，只能试营业。真实密钥请在桌面应用里填写。</div>
            <label class="check"><input v-model="editConfig.demo" type="checkbox"/><span>试营业模式<small>用内置台词，不调用付费 AI，适合排练</small></span></label>
            <label>{{ editConfig.brain.provider === 'qwen' ? '千问对话 API 密钥' : '对话 API 密钥' }}<div class="input-button"><input v-model="keys.deepseek" type="password" autocomplete="off" :placeholder="state.credentials.deepseek ? '已加密保存；填入可替换' : '填写 API Key'"/><button class="btn ghost small" :disabled="!isDesktop || !keys.deepseek" @click="saveKey('deepseek')">保存密钥</button></div></label>
            <label>店主名字<input v-model="editConfig.persona.name" maxlength="40"/></label>
            <label>人设（性格、说话方式、小脾气）<textarea v-model="editConfig.persona.personality" rows="10"/></label>
            <div class="row-end"><span class="muted small">直播间安全边界是固定的，改人设也改不掉，放心发挥。</span><button class="btn ghost small" @click="editConfig.persona.personality = DEFAULT_PERSONA">恢复默认人设</button></div>
            <details><summary>高级选项</summary>
              <div class="form-grid"><label>服务商<select v-model="editConfig.brain.provider"><option value="deepseek">DeepSeek</option><option value="qwen">千问兼容接口</option><option value="custom">自定义兼容接口</option></select></label><label>模型名称<input v-model="editConfig.brain.model"/></label></div>
              <label>接口地址<input v-model="editConfig.brain.baseUrl" placeholder="https://api.deepseek.com"/></label>
              <label>口头禅<input v-model="editConfig.persona.catchphrase"/></label>
              <label>每次回复最多字数<input v-model.number="editConfig.persona.maxLength" type="number" min="20" max="300"/></label>
              <label>不聊的话题<textarea v-model="editConfig.persona.forbidden" rows="2"/></label>
              <div class="row-end"><button class="btn ghost small" :disabled="!isDesktop" @click="testConnection('deepseek')">测试连接</button></div>
            </details>
          </section>
          <section class="card">
            <div class="card-head"><h2>声音</h2></div>
            <div class="form-grid"><label>配音方式<select v-model="editConfig.voice.provider"><option value="system">系统语音 · 免费</option><option value="qwen">千问云端语音</option></select></label><label>声音开关<select v-model="editConfig.voice.enabled"><option :value="true">开启配音</option><option :value="false">只显示字幕</option></select></label></div>
            <label>语速 <span>{{ editConfig.voice.rate }}×</span><input v-model.number="editConfig.voice.rate" type="range" min="0.5" max="1.5" step="0.05"/></label>
            <label>试听文本<input v-model="previewText"/></label>
            <div class="row-end"><button class="btn ghost" @click="voicePreview"><Icon name="speaker" :size="15"/>试听</button></div>
            <details><summary>千问配音与输出设备</summary>
              <label>千问 API 密钥<div class="input-button"><input v-model="keys.qwen" type="password" autocomplete="off" :placeholder="state.credentials.qwen ? '已加密保存；填入可替换' : '北京地域百炼 API Key'"/><button class="btn ghost small" :disabled="!isDesktop || !keys.qwen" @click="saveKey('qwen')">保存密钥</button></div></label>
              <div class="form-grid"><label>业务空间 ID<input v-model="editConfig.voice.workspaceId"/></label><label>语音模型<input v-model="editConfig.voice.model"/></label></div>
              <label>音色名称 / ID<input v-model="editConfig.voice.voice"/></label>
              <label>语气指令<input v-model="editConfig.voice.instruction"/></label>
              <p v-if="/^qwen(?:3)?-tts-flash(?:-|$)/i.test(editConfig.voice.model)" class="muted small">当前普通 Flash 模型不支持语气指令；需要控制情绪和说话节奏时，请使用支持指令的语音模型。</p>
              <label>完整接口地址 · 可留空<input v-model="editConfig.voice.baseUrl"/></label>
              <label>设计专属音色<textarea v-model="voiceDescription" rows="2" maxlength="500"/></label>
              <div class="row-end"><button class="btn ghost small" @click="designVoice">生成音色</button><button class="btn ghost small" :disabled="!isDesktop" @click="testConnection('qwen')">测试配音</button></div>
              <p v-if="designPreview" class="notice">音色已生成。请使用上方「试听」，声音会经过小店自己的输出与监听通道。</p>
              <button class="btn ghost" @click="setPage('connect')"><Icon name="link" :size="15"/>设置直播输出与本地监听</button>
            </details>
          </section>
        </div>
        <div v-else-if="settingsTab === 'safety'" class="grid two">
          <section class="card"><div class="card-head"><h2>聊天边界</h2></div><label>拦截词，每行一个<textarea :value="editConfig.safety.blockedWords.join('\n')" rows="7" @input="editConfig.safety.blockedWords = ($event.target as HTMLTextAreaElement).value.split('\n').filter(Boolean)"/></label><label class="check"><input v-model="editConfig.safety.reviewSensitive" type="checkbox"/><span>敏感话题转人工确认<small>金钱、个人信息、医疗、法律和未成年人话题</small></span></label></section>
          <section class="card"><div class="card-head"><h2>回应方式</h2></div><div v-for="m in [{ id: 'manual', name: '人工确认', about: 'AI 起草每句话，你通过后才播出。' }, { id: 'supervised', name: 'AI 自动回应', about: 'AI 直接回应，你随时打断或接管。' }, { id: 'auto', name: '全自动演示', about: '只适合本地排练。' }]" :key="m.id" :class="['mode-option', { selected: editConfig.mode === m.id }]" @click="editConfig.mode = m.id as AppConfig['mode']"><input type="radio" :checked="editConfig.mode === m.id" :aria-label="m.name"/><div><strong>{{ m.name }}</strong><p>{{ m.about }}</p></div></div><div class="notice">直播画面常驻「AI 形象」标识。Esc 随时打断。</div></section>
        </div>
        <div v-else-if="settingsTab === 'budget'">
          <div class="stats"><div class="stat"><span>本场估算</span><b>{{ sessionCostUnknown ? '待核算' : '¥ ' + money(state.costs.session) }}</b><small v-if="sessionCostUnknown">已知部分 ¥ {{ money(state.costs.session) }} · {{ state.costs.legacyUsageIncomplete ? '历史计价未完整记录' : state.costs.unpricedRequests + ' 笔未计全' }}</small><div class="bar"><i :style="{ width: budgetPercent + '%' }"/></div></div><div class="stat"><span>今日估算</span><b>{{ todayCostUnknown ? '待核算' : '¥ ' + money(state.costs.today) }}</b><small v-if="todayCostUnknown">已知部分 ¥ {{ money(state.costs.today) }} · {{ state.costs.legacyTodayCostUnknown ? '历史计价未完整记录' : state.costs.todayUnpricedRequests + ' 笔未计全' }}</small></div><div class="stat"><span>对话用量</span><b>{{ (state.costs.inputTokens + state.costs.outputTokens).toLocaleString() }} <small>tokens</small></b></div><div class="stat"><span>缓存命中率</span><b>{{ cacheRate }}<small>%</small></b></div></div>
          <ServiceUsage :state="state" @open-budget="openUsageBudget"/>
          <div class="grid two"><section class="card"><div class="card-head"><h2>预算上限</h2></div><label>每场预算 / 元<input v-model.number="editConfig.budget.sessionLimit" type="number" min="0.01"/></label><label>每日预算 / 元<input v-model.number="editConfig.budget.dailyLimit" type="number" min="0.01"/></label><div :class="['notice', { warning: state.degraded }]">{{ state.degraded ? '预算已用尽：已停止付费生成，改用预设台词和动作。' : '到 80% 提醒；到上限自动停用付费 AI，直播不中断。' }}</div><button class="btn ghost" @click="send({ type: 'reset-session' }, '本场计数已重置')">开启新一场统计</button>
            <div class="card-head spaced"><h2>token 钱包玩法</h2></div>
            <label class="check"><input v-model="editConfig.wallet.enabled" type="checkbox"/><span>开启钱包与破产<small>按已配置单价估算扣账，未计全的费用另列为待核算</small></span></label>
            <div class="form-grid"><label>礼物充值比例 <span>{{ Math.round(editConfig.wallet.share * 100) }}%</span><input v-model.number="editConfig.wallet.share" type="range" min="0" max="1" step="0.05"/></label><label>启动资金 / 元<input v-model.number="editConfig.wallet.start" type="number" min="0"/></label><label>亏多少破产 / 元<input v-model.number="editConfig.wallet.debtLimit" type="number" min="0"/></label></div><p class="muted small">弹幕假礼物持续作为装傻剧情；脑内白饭与真实口粮、实际用量和送礼资格分开。</p>
          </section>
          <section class="card"><div class="card-head"><h2>API 单价 · 元</h2></div><p class="muted small">填写服务商的实际单价，预算才算得准。0 表示尚未计价。</p><label>对话输入 / 每百万 tokens<input v-model.number="editConfig.brain.inputPrice" type="number" min="0" step="0.01"/></label><label>缓存命中的输入 / 每百万 tokens<input v-model.number="editConfig.brain.cachedInputPrice" type="number" min="0" step="0.01" placeholder="留 0 则按普通输入计"/></label><label>对话输出 / 每百万 tokens<input v-model.number="editConfig.brain.outputPrice" type="number" min="0" step="0.01"/></label><p class="muted small">当前配音模型 {{ editConfig.voice.model }}，按{{ voicePriceUnit === 'tokens' ? '输入与输出音频 token' : '服务返回的计费字符' }}估价，不混用两种单价。</p><template v-if="voicePriceUnit === 'tokens'"><label>千问配音输入 / 每百万 tokens<input v-model.number="editConfig.voice.inputPrice" type="number" min="0" step="0.01"/></label><label>千问输出音频 / 每百万 tokens<input v-model.number="editConfig.voice.outputPrice" type="number" min="0" step="0.01"/></label></template><label v-else>配音 / 每万计费字符<input v-model.number="editConfig.voice.pricePer10kChars" type="number" min="0" step="0.01"/></label></section></div>
        </div>
        <div v-else-if="settingsTab === 'display'" class="grid two">
          <section class="card"><div class="card-head"><h2>观众玩法</h2></div><label class="check"><input v-model="editConfig.vote.enabled" type="checkbox" @change="patchConfig(c => c.vote.enabled = editConfig.vote.enabled)"/><span>开启观众投票<small>首日默认关闭，以后粉丝多再开。关闭时隐藏投票入口与舞台计划，点歌和闲聊照常。</small></span></label></section>
          <section class="card"><div class="card-head"><h2>直播画面</h2></div><label class="check"><input v-model="editConfig.stage.showLedger" type="checkbox"/><span>显示小愿望进度条</span></label><label class="check"><input v-model="editConfig.stage.safeArea" type="checkbox"/><span>显示直播安全区辅助线<small>调整画面时用，开播前关掉</small></span></label><label class="check"><input v-model="editConfig.idle.enabled" type="checkbox"/><span>没人说话时，肥鱼自己找点事做</span></label><label>小动作间隔 / 秒<input v-model.number="editConfig.idle.seconds" type="number" min="10" max="600"/></label><div class="card-head spaced"><h2>主动聊天节奏</h2></div><label class="check"><input v-model="editConfig.idle.entertainment" type="checkbox"/><span>冷场小剧场：没人接话也会自娱自乐<small>开梗、添乱、自己接梗、收尾邀聊；纯剧情段穿插本地台词，真实弹幕优先。</small></span></label><label class="check"><input v-model="editConfig.idle.aiChatter" type="checkbox"/><span>主动闲聊可使用 DeepSeek<small>有开口额度才生成；关闭时只用预设台词。配音仍按实际用量计费。</small></span></label><div class="form-grid"><label>主动说话间隔 / 秒<input v-model.number="editConfig.idle.chatterSeconds" type="number" min="120" max="3600" step="30"/></label><label>每小时主动发声上限 / 轮<input v-model.number="editConfig.idle.hourlySpeechLimit" type="number" min="0" max="24" step="1"/></label></div><label>连续无人互动 3 轮后间隔 / 秒<input v-model.number="editConfig.idle.quietBackoffSeconds" type="number" min="120" max="600" step="30"/></label><p class="muted small">主动说话至少间隔 2 分钟，每小时最多 24 轮；预设和暖场共用额度。开启小剧场时按小时上限均匀分配，默认约每 2 分半钟一段，冷清时继续演，不因为没人回应自动放慢到 5–10 分钟。小剧场交替用 AI 和本地台词，配音按实际用量计费。填 0 只关主动说话，保留免费动作和文字；正常观众回复不占这份主动额度。保存设置后生效。</p></section>
        </div>
        <section v-else class="card">
          <div class="card-head"><div class="segmented"><button v-for="l in [{ id: 'all', name: '全部' }, { id: 'info', name: '信息' }, { id: 'warn', name: '提醒' }, { id: 'error', name: '错误' }]" :key="l.id" :class="{ selected: logFilter === l.id }" @click="logFilter = l.id">{{ l.name }}</button></div><button class="btn ghost small" @click="send({ type: 'clear-logs' })">清空</button></div>
          <div class="log-list"><div v-if="!logs.length" class="empty compact"><p>没有日志。</p></div><div v-for="l in logs" :key="l.id" class="log-line"><time>{{ time(l.at) }}</time><span :class="['log-level', l.level]">{{ ({ info: '信息', warn: '提醒', error: '错误' })[l.level] }}</span><span class="muted">{{ l.category }}</span><span>{{ l.message }}</span></div></div>
        </section>
      </template>
    </main>

    <!-- The live picture stays in view on every page. -->
    <aside class="dock" aria-label="直播画面">
      <div class="dock-head"><span :class="['live-pill', { on: state.running }]"><i/>{{ state.running ? '营业中' : '未营业' }}</span><button class="link" @click="bridge.openStage()">打开直播窗口 <Icon name="external" :size="13"/></button></div>
      <div class="preview-wrap"><StageView :state="state" :preview="true" @stage-event="e => send({ type: 'stage-event', event: e })" @music-event="e => send(e)"/></div>
      <div class="dock-wallet" data-testid="dock-token-summary"><span>本场已报 {{ tokenUsageIncomplete ? '至少 ' : '' }}{{ rationCount(reportedTokens) }} token</span><span :class="{ warn: state.rations.balance < 0 }">余粮 {{ rationCount(state.rations.balance) }} token{{ state.rations.balance < 0 ? ' · 透支' : '' }}</span></div>
      <div class="dock-now"><span>{{ emojiOf[state.stage.action] || '🐟' }} {{ actionName }}</span><span v-if="state.stage.speaking" class="tag mint">说话中</span></div>
      <div class="dock-audio"><span class="tag">{{state.config.audio.mode==='live'?'独立直播声卡':'本地测试'}}</span><button class="link" :disabled="!!state.audioReservation" @click="patchConfig(c=>c.audio.monitorEnabled=!c.audio.monitorEnabled)"><Icon :name="state.config.audio.monitorEnabled?'speaker':'mute'" :size="15"/>{{state.config.audio.monitorEnabled?'关闭本地监听':'打开本地监听'}}</button></div>
      <div v-if="currentSong" class="dock-song"><Icon name="music" :size="15"/><span>{{currentSong.title}}</span><span class="tag">{{state.music.status==='paused'?'已暂停':'点播中'}}</span></div>
      <div class="dock-controls">
        <button class="btn primary" :disabled="!!state.audioReservation" @click="state.running ? send({ type: 'pause' }) : goLive()"><Icon :name="state.running ? 'pause' : 'play'" :size="16"/>{{ state.running ? '暂停营业' : '开始营业' }}</button>
        <button :class="['btn ghost', { danger: state.stage.muted }]" :disabled="!!state.audioReservation&&state.stage.muted" @click="send({ type: state.stage.muted ? 'unmute' : 'mute' })"><Icon :name="state.stage.muted ? 'mute' : 'speaker'" :size="15"/>{{ state.stage.muted ? '恢复声音' : '紧急静音' }}</button>
        <button class="btn ghost icon" title="打断当前发言 · Esc" aria-label="打断当前发言" @click="send({ type: 'interrupt' })"><Icon name="stop" :size="16"/></button>
      </div>
      <div class="segmented dock-mode" role="group" aria-label="回应方式"><button :class="{ selected: !autoTalk }" @click="patchConfig(c => c.mode = 'manual')">人工确认</button><button :class="{ selected: autoTalk }" @click="patchConfig(c => c.mode = 'supervised')">AI 自动回应</button></div>
    </aside>

    <Transition name="toast"><div v-if="toast" :class="['toast-message', { error: toastError }]" role="status"><Icon :name="toastError ? 'help' : 'check'" :size="17"/>{{ toast }}</div></Transition>
    <div v-if="record.viewer" class="modal-backdrop" @click.self="record.viewer = undefined"><section class="modal record">
      <button class="modal-close" aria-label="关闭聊天档案" @click="record.viewer = undefined"><Icon name="close"/></button>
      <h2>{{ record.viewer.name }} 的聊天档案 <span class="tag">共 {{ record.total }} 条</span></h2>
      <p class="muted small">每一条弹幕、礼物和肥鱼的回答都会永久保存。长期记忆没覆盖到的往事，肥鱼会来这里翻。</p>
      <div class="say-box"><input v-model="record.q" placeholder="搜关键词，比如：咖啡、加班、生日" @keydown.enter="openRecord()"/><button class="btn ghost" @click="openRecord()">搜索</button></div>
      <div class="record-list"><div v-if="!record.rows.length" class="empty compact"><p>没有记录。</p></div><div v-for="r in record.rows" :key="r.id" :class="['record-row', r.kind, { hidden: r.hidden }]"><time>{{ new Date(r.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) }}</time><b>{{ r.kind === 'reply' ? '肥鱼' : r.name }}</b><span>{{ r.text }}{{ r.hidden ? '（已过滤，不会给 AI 看）' : '' }}</span></div></div>
    </section></div>
    <div v-if="setup" class="modal-backdrop" @click.self="setup = false"><section class="modal">
      <button class="modal-close" aria-label="关闭开播指南" @click="setup = false"><Icon name="close"/></button>
      <h2>开播只要三步</h2>
      <ol class="steps"><li><b>1</b>在「开播」页开始营业，会打开专用直播画面窗口。</li><li><b>2</b>抖音直播伴侣 → 添加「程序窗口」→ 选「赛博肥鱼 · 抖音直播采集（9:16）」。要有声音，Windows 先装 VB-CABLE（小店输出 CABLE Input、伴侣麦克风 CABLE Output）；Mac 使用 BlackHole 2ch。</li><li><b>3</b>默认是试营业（不花钱）。想让 AI 真正聊天，去「设置」填写对话服务和千问配音密钥，关掉试营业。</li></ol>
      <p v-if="state.config.vote.enabled" class="muted small">每场结束前，在「明日投票」发起一轮投票，第二天点「本场执行」，肥鱼就会按大家选的计划营业。</p>
      <button class="btn primary wide" @click="setup = false">知道了</button>
    </section></div>
  </div>
</template>

<style scoped>
.room-mood>p{font-size:13px;line-height:1.7;color:var(--text-2)}.room-mood-footer{justify-content:space-between;gap:10px;margin-top:12px;flex-wrap:wrap}.room-mood-footer small{font-size:11px}.room-mood-footer .link{font-size:12px}
.skin-identity{padding:11px 13px;margin-bottom:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);font-size:13px;color:var(--accent)}.swatches{grid-template-columns:repeat(2,minmax(0,1fr))}.swatches button{text-align:left;min-width:0}.swatches button>i{flex:none}.swatches button>span{display:grid;gap:3px;min-width:0}.swatches strong{font-size:12px;font-weight:600;overflow-wrap:anywhere}.swatches small{font-size:11px;color:var(--muted)}
.shop-periods{flex-wrap:wrap;align-self:flex-start}.shop-periods button{white-space:nowrap}
.audio-reservation{align-items:flex-start;margin-bottom:18px}.audio-reservation>svg{flex:none;margin-top:2px}.audio-reservation p{margin-top:5px;line-height:1.6}
</style>
