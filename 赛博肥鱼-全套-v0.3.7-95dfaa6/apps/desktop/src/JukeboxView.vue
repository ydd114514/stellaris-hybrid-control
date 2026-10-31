<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { MUSIC_LIBRARY_LIMIT, MUSIC_QUEUE_LIMIT } from '../../../packages/shared/src/music-limits'
import { musicLibraryFull } from '../../../packages/core/src/jukebox'
import { normalizeMusicText } from '../../../packages/core/src/music-match'
import Icon from './Icon.vue'
import type { AppState, Command, CommandResult, MusicTrack, QQMusicLogin, QQMusicSearch, QQMusicStatus } from '../../../packages/shared/src'
const props = defineProps<{ state: AppState; execute: (command: Command, message?: string) => Promise<CommandResult | undefined> }>()
const title = ref(''), artist = ref(''), source = ref(''), query = ref('')
const editing = ref(false)
const policy = reactive(JSON.parse(JSON.stringify(props.state.config.music)))
const current = computed(() => props.state.music.tracks.find(t => t.id === props.state.music.current?.trackId))
const track = (id: string) => props.state.music.tracks.find(t => t.id === id)
const tracks = computed(() => {const words=query.value.split(/\s+/).map(normalizeMusicText).filter(Boolean);return props.state.music.tracks.filter(t => words.every(q=>normalizeMusicText(`${t.title} ${t.artist}`).includes(q)))})
const libraryPage=ref(1),bgmPage=ref(1),bgmQuery=ref('')
const libraryPages=computed(()=>Math.max(1,Math.ceil(tracks.value.length/50)))
const visibleTracks=computed(()=>tracks.value.slice((libraryPage.value-1)*50,libraryPage.value*50))
watch(query,()=>{libraryPage.value=1});watch(libraryPages,n=>{libraryPage.value=Math.min(libraryPage.value,n)})
const waiting = computed(() => props.state.music.queue.filter(r => r.status === 'queued'))
const reviewing = computed(() => props.state.music.queue.filter(r => r.status === 'pending'))
const onlineSearches = computed(() => props.state.music.searches || [])
const autoSearchEnabled = computed(() => props.state.config.music.qqAutoSearch !== false)
const bgmEnabled = computed(() => props.state.config.music.bgmEnabled !== false)
const isBgm = computed(() => props.state.music.current?.isBgm === true)
const bgmIds = computed<string[]>(() => props.state.config.music.bgmTrackIds || [])
const bgmTracks = computed(() => bgmIds.value.map(id => track(id)).filter((song): song is MusicTrack => !!song))
const missingBgmIds = computed<string[]>(() => (policy.bgmTrackIds || []).filter((id: string) => !track(id)))
const bgmChoices = computed(() => {
 const order = new Map<string, number>((policy.bgmTrackIds || []).map((id: string, index: number) => [id, index]))
 return [...props.state.music.tracks].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
})
const filteredBgmChoices=computed(()=>{const words=bgmQuery.value.split(/\s+/).map(normalizeMusicText).filter(Boolean);return bgmChoices.value.filter(t=>words.every(q=>normalizeMusicText(t.title+' '+t.artist).includes(q)))})
const bgmPages=computed(()=>Math.max(1,Math.ceil(filteredBgmChoices.value.length/50)))
const visibleBgmChoices=computed(()=>filteredBgmChoices.value.slice((bgmPage.value-1)*50,bgmPage.value*50))
watch(bgmQuery,()=>{bgmPage.value=1});watch(bgmPages,n=>{bgmPage.value=Math.min(bgmPage.value,n)})
const bgmTitle = computed(() => bgmTracks.value.map(song => song.title).join(' / ') || (bgmIds.value.length ? '背景歌单待就绪' : '尚未选择 QQ 背景曲'))
const audienceWaiting = computed(() => props.state.music.queue.length > 0 || onlineSearches.value.length > 0)
const musicLabel = computed(() => {
 if (!props.state.music.current && audienceWaiting.value) return '观众点歌处理中 · BGM已停'
 if (isBgm.value) return props.state.music.status === 'playing' ? '背景音乐 · 正在播放' : props.state.music.status === 'paused' ? '背景音乐 · 已暂停' : '背景音乐 · 准备中'
 if (props.state.music.current) return props.state.music.status === 'playing' ? '正在播放' : props.state.music.status === 'paused' ? '已暂停' : '准备播放'
 return bgmEnabled.value ? (bgmIds.value.length ? '背景音乐 · 待播' : '背景音乐 · 未选曲') : '等待一首歌'
})
function toggleBgmTrack(id: string, checked: boolean) {
 const ids: string[] = Array.isArray(policy.bgmTrackIds) ? policy.bgmTrackIds : []
 policy.bgmTrackIds = checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)
}
function moveBgmTrack(id: string, direction: number) {
 const ids: string[] = [...(policy.bgmTrackIds || [])], index = ids.indexOf(id), next = index + direction
 if (index < 0 || next < 0 || next >= ids.length) return
 ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]; policy.bgmTrackIds = ids
}
const autoSearchBusy = ref(false)
const qqQuery = ref(''), qqTracks = ref<MusicTrack[]>([])
const qqStatus = ref<QQMusicStatus>({ loggedIn: false, loginPending: false, message: '正在检查 QQ 音乐连接…' })
const qqLogin = ref<QQMusicLogin>(), qqChannel = ref<'qq' | 'wechat' | 'qqmusic'>('qq')
const qqLoginChannel = ref<'qq' | 'wechat' | 'qqmusic'>('qq')
const qqSearching = ref(false), qqLoginBusy = ref(false), qqAdding = ref(''), qqSearched = ref(false), qqSearchMessage = ref('')
let disposed = false, loginRevision = 0, searchRevision = 0, pollTimer: ReturnType<typeof setTimeout> | undefined
const songSource = (song: MusicTrack) => song.source.startsWith('shop-qqmusic:') ? 'QQ 音乐' : song.source.startsWith('shop-media:') ? '本项目本地文件' : 'HTTPS 音频'
const copyTracks = (songs: MusicTrack[]): MusicTrack[] => JSON.parse(JSON.stringify(songs))
const inLibrary = (id: string) => props.state.music.tracks.some(song => song.id === id)
const alreadyQueued = (id: string) => props.state.music.current?.trackId === id || props.state.music.queue.some(song => song.trackId === id)
function clearLogin() { clearTimeout(pollTimer); pollTimer = undefined; qqLogin.value = undefined }
function readStatus(result: CommandResult | undefined) {
 const status = result?.data as QQMusicStatus | undefined
 if (result?.ok && status && typeof status.loggedIn === 'boolean' && typeof status.loginPending === 'boolean') qqStatus.value = status
 else if (result?.message) qqStatus.value = { loggedIn: false, loginPending: false, message: result.message }
}
async function refreshQQStatus() {
 const revision = loginRevision
 const result = await props.execute({ type: 'qq-status' })
 if (!disposed && revision === loginRevision) readStatus(result)
}
async function pollQQLogin(revision: number) {
 if (disposed || revision !== loginRevision || !qqLogin.value) return
 if (Date.now() >= qqLogin.value.expiresAt) { clearLogin(); qqStatus.value = { loggedIn: false, loginPending: false, message: '二维码已过期，请重新获取后扫码。' }; return }
 const result = await props.execute({ type: 'qq-login-poll' })
 if (disposed || revision !== loginRevision) return
 readStatus(result)
 if (!result?.ok || qqStatus.value.loggedIn || !qqStatus.value.loginPending) { clearLogin(); return }
 pollTimer = setTimeout(() => void pollQQLogin(revision), 2000)
}
async function startQQLogin() {
 if (qqLoginBusy.value) return
 const revision = ++loginRevision
 qqLoginChannel.value = qqChannel.value
 clearLogin(); qqLoginBusy.value = true
 try {
  const result = await props.execute({ type: 'qq-login-start', channel: qqChannel.value })
  if (disposed || revision !== loginRevision) return
  const data = result?.data as QQMusicLogin | undefined
  // Only an image returned through the desktop bridge is displayed; no remote QR URL is loaded.
  if (result?.ok && data && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.qrDataUrl) && data.qrDataUrl.length <= 1024 * 1024 && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now()) {
   qqLogin.value = data
   qqStatus.value = { loggedIn: false, loginPending: true, message: data.message || '用所选 App 扫码，并在手机上确认登录。' }
   pollTimer = setTimeout(() => void pollQQLogin(revision), 2000)
  } else qqStatus.value = { loggedIn: false, loginPending: false, message: result?.message || '暂时没有获取到登录二维码，请稍后重试。' }
 } finally { if (!disposed && revision === loginRevision) qqLoginBusy.value = false }
}
async function logoutQQ() {
 const revision = ++loginRevision
 clearLogin(); qqLoginBusy.value = true
 try { const result = await props.execute({ type: 'qq-logout' }); if (!disposed && revision === loginRevision) readStatus(result) }
 finally { if (!disposed && revision === loginRevision) qqLoginBusy.value = false }
}
async function searchQQ() {
 const keywords = qqQuery.value.trim()
 if (!keywords || qqSearching.value) return
 const revision = ++searchRevision
 qqSearching.value = true; qqSearchMessage.value = ''
 try {
  const result = await props.execute({ type: 'qq-search', query: keywords })
  if (disposed || revision !== searchRevision) return
  qqSearched.value = true
  const data = result?.data as QQMusicSearch | undefined
  qqTracks.value = result?.ok && Array.isArray(data?.tracks) ? data.tracks : []
  qqSearchMessage.value = result?.ok ? data?.message || (qqTracks.value.length ? `找到 ${qqTracks.value.length} 首，店长可直接加入队列，收藏到曲库为可选操作。` : '没有找到歌曲，试试完整歌名和歌手。') : result?.message || 'QQ 音乐搜索暂时不可用，请稍后重试。'
 } finally { if (!disposed && revision === searchRevision) qqSearching.value = false }
}
async function addQQTrack(song: MusicTrack, queue = false) {
 if (qqAdding.value) return
 qqAdding.value = song.id
 try {
  if (!inLibrary(song.id)) {
   if (musicLibraryFull(props.state.music.tracks)) { qqSearchMessage.value = `小店自选曲库已满 ${MUSIC_LIBRARY_LIMIT} 首，请先移除一些歌曲。`; return }
   const result = await props.execute({ type: 'music-set-tracks', tracks: copyTracks([...props.state.music.tracks, song]) }, queue ? undefined : 'QQ 歌曲已收藏到小店曲库。')
   if (!result?.ok || disposed) return
  }
  if (queue && !disposed) await props.execute({ type: 'music-request', trackId: song.id }, '已加入队列，当前歌曲会继续播放。')
 } finally { if (!disposed) qqAdding.value = '' }
}
onMounted(() => void refreshQQStatus())
onUnmounted(() => { disposed = true; loginRevision++; searchRevision++; clearLogin() })
async function importMusic() {
 const result = await props.execute({ type: 'import-music' })
 const data = result?.data as { tracks?: MusicTrack[] } | undefined
 if (result?.ok && data?.tracks?.length) await props.execute({ type:'music-set-tracks', tracks:copyTracks([...new Map([...props.state.music.tracks, ...data.tracks].map(track=>[track.id,track])).values()]) }, `已导入 ${data.tracks.length} 首歌曲`)
}
async function addTrack() {
 if (!title.value.trim() || !source.value.trim()) return
 const result = await props.execute({ type:'music-set-tracks', tracks:copyTracks([...props.state.music.tracks,{id:crypto.randomUUID(),title:title.value.trim(),artist:artist.value.trim(),source:source.value.trim()}]) },'歌曲已加入曲库')
 if(result?.ok){title.value='';artist.value='';source.value='';editing.value=false}
}
async function removeTrack(id:string) { await props.execute({type:'music-set-tracks',tracks:copyTracks(props.state.music.tracks.filter(t=>t.id!==id))},'已从曲库移除') }
async function savePolicy() { const config=JSON.parse(JSON.stringify(props.state.config));config.music=JSON.parse(JSON.stringify(policy));await props.execute({type:'set-config',config},'点歌规则已保存') }
async function setAutoSearch(enabled: boolean) {
 if (autoSearchBusy.value) return
 autoSearchBusy.value = true
 try {
  const config = JSON.parse(JSON.stringify(props.state.config)); config.music.qqAutoSearch = enabled
  const result = await props.execute({ type: 'set-config', config }, enabled ? '已开启弹幕自动 QQ 搜歌，可播放就按顺序入队。' : '已关闭弹幕自动搜歌，观众仍可点已收录曲目。')
  if (result?.ok) policy.qqAutoSearch = enabled
 } finally { if (!disposed) autoSearchBusy.value = false }
}
</script>
<template>
 <section class="card music-now" data-testid="jukebox-now">
  <div class="music-record" :class="{spinning:state.music.status==='playing'}"><span><Icon name="music" :size="26"/></span></div>
  <div class="music-now-copy">
   <span class="eyebrow">小店点歌台 · {{musicLabel}}</span><h2>{{current?.title||(audienceWaiting?'等待观众点歌就绪':bgmEnabled?bgmTitle:'给小店添一点旋律')}}</h2>
   <p v-if="isBgm&&current" class="muted small">{{current.artist||songSource(current)}} · 空队列按歌单循环；有待搜或待播点歌就停 BGM，全部清空才恢复。</p>
   <p v-else class="muted small">{{current?[current.artist||songSource(current),'@'+state.music.current?.userName+' 点播'].join(' · '):audienceWaiting?'有待搜或待播点歌就停 BGM，全部清空才恢复。':bgmEnabled?(bgmIds.length?'背景歌单空队列循环；本页仅预览，实际声音由直播画面输出。':'尚未选择 QQ 背景曲，选曲后保存。'):'弹幕「点歌 歌名」加入队列，当前歌曲会继续播放。'}}</p>
   <p v-if="state.music.current&&!isBgm" class="small muted">切歌投票 {{state.music.skipVotes.length}} / {{state.music.skipRequired}} · 每位观众只计一票</p>
   <p v-if="!isBgm&&state.music.current?.consumedHearts" class="small muted" data-testid="music-consumed-hearts">本轮已消耗 {{state.music.current.consumedHearts.toLocaleString('zh-CN')}} 颗小心心 · 已播出，下一轮从 0 算起</p>
  </div>
  <div class="row music-transport"><button class="btn primary" :disabled="!!state.audioReservation" @click="execute({type:state.music.status==='playing'?'music-pause':state.music.status==='paused'?'music-resume':'music-play'})"><Icon :name="state.music.status==='playing'?'pause':'play'" :size="16"/>{{state.music.status==='playing'?'暂停':state.music.status==='paused'?'继续':'播放队列'}}</button><button class="btn ghost" :disabled="!state.music.current||!!state.audioReservation" @click="execute({type:'music-next'})">店长切歌</button><button class="btn ghost" :disabled="state.music.status==='stopped'" @click="execute({type:'music-stop'})">停止</button></div>
 </section>
 <div v-if="state.music.bgmError" class="notice warning" role="alert" data-testid="bgm-error">{{state.music.bgmError}}</div>
 <div v-if="state.music.lastMessage" class="notice" role="status">{{state.music.lastMessage}}</div>
 <section class="card qq-music" data-testid="qq-music">
  <div class="card-head"><div><span class="eyebrow">在线曲库</span><h2>QQ 音乐点歌</h2></div><span :class="['tag', { mint: qqStatus.loggedIn }]">{{qqStatus.loggedIn?'已登录 QQ 音乐':'尚未登录'}}</span></div>
  <p class="muted small" data-testid="qq-auto-explainer">{{autoSearchEnabled?'观众发「点歌 歌名 歌手」，自动搜索 QQ 音乐；找到账号可完整播放的版本就直接排队，无需店长先加曲库或逐首批准。':'弹幕自动搜歌已关闭，观众仍可点已收录曲目。店长可以在这里手动搜索并加入队列。'}}当前歌曲继续播放，切歌仍有保护期和独立观众投票。</p>
  <label class="check qq-auto-switch"><input :checked="autoSearchEnabled" :disabled="autoSearchBusy" type="checkbox" @change="setAutoSearch(($event.target as HTMLInputElement).checked)"/><span>弹幕自动搜索 QQ 音乐<small>立即生效；QQ 可播歌曲直接入队，本地导入歌曲可保留人工确认。</small></span></label>
  <div class="qq-account"><p class="small" role="status">{{qqStatus.message}}</p><div class="row"><template v-if="!qqStatus.loggedIn"><label class="qq-channel">扫码方式<select v-model="qqChannel" :disabled="qqLoginBusy"><option value="qq">手机 QQ</option><option value="wechat">微信</option></select></label><button class="btn ghost" :disabled="qqLoginBusy" @click="startQQLogin">{{qqLoginBusy?'正在连接…':qqLogin?'刷新二维码':'扫码登录 QQ 音乐'}}</button></template><button v-else class="btn ghost" :disabled="qqLoginBusy" @click="logoutQQ">退出 QQ 音乐</button></div></div>
  <div v-if="qqLogin" class="qq-login"><img :src="qqLogin.qrDataUrl" alt="QQ 音乐登录二维码" width="180" height="180"/><div><strong>请用{{qqLoginChannel==='qqmusic'?' QQ 音乐 App':qqLoginChannel==='qq'?'手机 QQ':'微信'}}扫码</strong><p class="muted small">在手机上确认登录，完成后此处会自动更新。登录仅保存在这份小店应用中。</p><p class="muted small">完整播放和可用音质以你的账号权限及 QQ 音乐返回结果为准。</p></div></div>
  <form class="qq-search" @submit.prevent="searchQQ"><label>搜索 QQ 音乐<input v-model="qqQuery" maxlength="100" placeholder="输入歌名和歌手，如：稻香 周杰伦"/></label><button class="btn primary" type="submit" :disabled="!qqQuery.trim()||qqSearching">{{qqSearching?'正在搜索…':'搜索 QQ 歌曲'}}</button></form>
  <p v-if="qqSearchMessage" class="small muted" role="status">{{qqSearchMessage}}</p>
  <div v-if="qqTracks.length" class="table-wrap"><table><thead><tr><th>歌名</th><th>歌手</th><th>操作</th></tr></thead><tbody><tr v-for="song in qqTracks" :key="song.id"><td><strong>{{song.title}}</strong></td><td>{{song.artist||'—'}}</td><td><div class="row"><button class="btn ghost small" :disabled="!!qqAdding||inLibrary(song.id)" @click="addQQTrack(song)">{{inLibrary(song.id)?'已在曲库':'加入小店曲库'}}</button><button class="btn primary small" :disabled="!!qqAdding||alreadyQueued(song.id)" @click="addQQTrack(song,true)">{{alreadyQueued(song.id)?'已在播放或排队':'加入点歌队列'}}</button></div></td></tr></tbody></table></div>
  <p v-else-if="!qqSearched" class="small muted">先扫码登录即可自动点歌，不必预先收录歌曲。下方搜索供店长选歌；登录、会员或播放限制按 QQ 音乐实际结果提示。</p>
 </section>
 <div class="grid two">
 <section class="card">
  <div class="card-head"><h2>接下来听什么</h2><span class="tag">{{waiting.length}} 首排队<span v-if="onlineSearches.length"> · {{onlineSearches.length}} 首搜索中</span><span v-if="reviewing.length"> · {{reviewing.length}} 首本地曲待确认</span></span></div>
  <p class="small muted" data-testid="music-heart-ranking">点歌后送「小心心」给自己的本轮加数，待播按本轮数量从多到少排；同数按点歌先后。不抢当前歌，真正播出才消耗清零，下轮重新计算。未开播就失败或取消，未消费的数量保留到本人下次点歌；优先值仅在本次应用运行内保留。口粮补充另按礼物规则计算。</p>
  <div v-if="onlineSearches.length" class="qq-search-progress" data-testid="music-search-progress" role="status">
   <div v-for="request in onlineSearches" :key="request.id" class="song-search-row" :data-status="request.status"><span :class="['search-progress-icon', {'is-searching':request.status==='searching'}]"><Icon :name="request.status==='searching'?'refresh':'clock'" :size="16"/></span><div><strong>{{request.query}}</strong><small>@{{request.userName}} · {{request.status==='searching'?'正在 QQ 音乐查找可完整播放的版本':'等待前面的点歌检索完成'}}</small><small class="song-heart-count">本轮小心心 {{(request.heartCount||0).toLocaleString('zh-CN')}}</small></div><span class="tag">{{request.status==='searching'?'搜索中':'等待搜索'}}</span></div>
   <p class="muted small">找到可播版本后自动入队；检索不会打断当前歌曲，也不需要店长批准。</p>
  </div>
  <div v-if="!state.music.queue.length&&!onlineSearches.length" class="empty"><Icon name="music" :size="28"/><p>{{autoSearchEnabled?'还没有点歌。观众发「点歌 歌名 歌手」，QQ 可播放就自动排队。':'还没有点歌。自动搜歌已关闭，可点已收录曲目或由店长选歌。'}}</p></div>
  <div v-for="request in state.music.queue" :key="request.id" class="song-queue-row" data-testid="song-queue-row" :data-request-id="request.id"><span class="song-position">{{request.status==='pending'?'?':waiting.findIndex(row=>row.id===request.id)+1}}</span><div><strong>{{track(request.trackId)?.title||'已移除的歌曲'}}</strong><small>@{{request.userName}} · {{request.status==='pending'?'本地曲等待店长确认':'已经排好队'}}</small></div><div class="row"><span class="tag song-heart-count">本轮小心心 {{(request.heartCount||0).toLocaleString('zh-CN')}}</span><template v-if="request.status==='pending'"><button class="btn primary small" @click="execute({type:'music-approve',requestId:request.id})">允许</button><button class="btn ghost small" @click="execute({type:'music-reject',requestId:request.id})">拒绝</button></template></div></div>
 </section>
  <section class="card"><div class="card-head"><h2>点歌秩序</h2><button class="btn primary small" @click="savePolicy">保存规则</button></div><label class="check"><input v-model="policy.enabled" type="checkbox"/><span>接受弹幕点歌</span></label><label class="check"><input v-model="policy.bgmEnabled" type="checkbox"/><span>空队列循环 QQ 背景音乐<small>有待搜或待播点歌就停 BGM，全部清空才恢复；讲话时自动降低音量，保存规则后生效。</small></span></label>
  <div class="bgm-playlist" data-testid="bgm-playlist"><strong>背景音乐歌单</strong><p class="muted small">从现有曲库勾选，按序循环。默认 QQ 歌单，可增删或调整先后；播放权限以 QQ 音乐实际结果为准。</p>
   <input v-model="bgmQuery" placeholder="筛选背景曲的歌名或歌手"/><div class="row"><button class="btn ghost small" :disabled="bgmPage<=1" @click="bgmPage--">上一页</button><span>{{bgmPage}} / {{bgmPages}} 页</span><button class="btn ghost small" :disabled="bgmPage>=bgmPages" @click="bgmPage++">下一页</button></div><div v-for="song in visibleBgmChoices" :key="song.id" class="bgm-option"><label class="check"><input :checked="policy.bgmTrackIds?.includes(song.id)" type="checkbox" :aria-label="'背景曲 ' + song.title" @change="toggleBgmTrack(song.id,($event.target as HTMLInputElement).checked)"/><span>{{song.title}}<small>{{song.artist||'未知歌手'}} · {{songSource(song)}}</small></span></label><div v-if="policy.bgmTrackIds?.includes(song.id)" class="row"><span class="tag">第 {{policy.bgmTrackIds.indexOf(song.id)+1}} 首</span><button class="btn ghost small" :disabled="policy.bgmTrackIds.indexOf(song.id)===0" :aria-label="song.title+' 背景曲上移'" @click="moveBgmTrack(song.id,-1)">↑</button><button class="btn ghost small" :disabled="policy.bgmTrackIds.indexOf(song.id)===policy.bgmTrackIds.length-1" :aria-label="song.title+' 背景曲下移'" @click="moveBgmTrack(song.id,1)">↓</button></div></div>
   <div v-for="id in missingBgmIds" :key="id" class="bgm-option"><span class="small muted">有一首背景曲已从曲库移除</span><button class="btn ghost small" @click="toggleBgmTrack(id,false)">从歌单移除</button></div>
   <p v-if="!policy.bgmTrackIds?.length" class="small muted">尚未选择 QQ 背景曲，选曲后保存。</p><p class="muted small">一首失败会挂起并尝试下一首，全失败后停止自动尝试；可关闭再重新启用背景音乐。此处也可选本地曲库歌曲。</p>
  </div><label>谁可以点歌<select v-model="policy.requestPolicy"><option value="open">所有观众 · 只排队</option><option value="regular">熟客才能点歌</option><option value="approval">本地曲目人工确认 · QQ 自动</option></select></label><div class="form-grid"><label>每人点歌间隔 / 秒<input v-model.number="policy.userCooldownSeconds" type="number" min="10" max="3600"/></label><label>全场请求间隔 / 秒<input v-model.number="policy.globalCooldownSeconds" type="number" min="1" max="120"/></label><label>队列最多歌曲<input v-model.number="policy.maxQueue" type="number" min="1" :max="MUSIC_QUEUE_LIMIT"/></label><label>当前歌曲保护 / 秒<input v-model.number="policy.minPlaySeconds" type="number" min="10" max="600"/></label><label>切歌最少票数<input v-model.number="policy.skipMinVotes" type="number" min="2" max="100"/></label><label>活跃观众同意比例 / %<input :value="Math.round(policy.skipRatio*100)" type="number" min="1" max="100" @input="policy.skipRatio=Number(($event.target as HTMLInputElement).value)/100"/></label></div><label class="check"><input v-model="policy.autoStart" type="checkbox"/><span>没有歌曲播放时，自动播放队列中的第一首</span></label><label>暂不接受的歌曲 · 每行歌名或编号<textarea :value="policy.blockedTracks.join('\n')" rows="2" @input="policy.blockedTracks=($event.target as HTMLTextAreaElement).value.split('\n').map(value=>value.trim()).filter(Boolean)"/></label><p class="muted small">每人最多一首待播或待检索，重复曲目不堆队。QQ 可播歌曲免人工确认，本地曲目可审批。观众发「切歌」只增加一票，达到保护时间和票数要求才会切换。</p></section>
 </div>
 <section class="card"><div class="card-head"><h2>我的曲库 <span class="tag">{{state.music.tracks.length}} 首</span></h2><div class="row"><button class="btn ghost" @click="editing=!editing"><Icon name="plus" :size="16"/>添加音频地址</button><button class="btn primary" @click="importMusic"><Icon name="download" :size="16"/>导入本地歌曲</button></div></div><p class="muted small">自选曲库最多 {{MUSIC_LIBRARY_LIMIT}} 首，另保留默认背景曲；QQ 弹幕点歌无需提前收录。也可导入本地歌曲，文件会复制到本项目的数据目录。</p><div v-if="editing" class="music-track-form"><div class="form-grid"><label>歌名<input v-model="title" maxlength="100"/></label><label>歌手<input v-model="artist" maxlength="100"/></label></div><label>可直接播放的 HTTPS 音频地址<input v-model="source" placeholder="https://…/song.mp3"/></label><div class="row-end"><button class="btn primary" :disabled="!title.trim()||!source.trim()" @click="addTrack">加入曲库</button></div></div><input v-if="state.music.tracks.length" v-model="query" class="search" placeholder="搜索歌名或歌手…"/><div v-if="!state.music.tracks.length" class="empty"><Icon name="music" :size="34"/><p>{{autoSearchEnabled?'还没有收藏歌曲，观众仍可发「点歌 歌名 歌手」自动查找 QQ 音乐。':'还没有收藏歌曲，可开启弹幕自动搜歌，或导入本地歌曲。'}}</p></div><div v-else class="table-wrap"><table><thead><tr><th>歌名</th><th>歌手</th><th>来源</th><th>操作</th></tr></thead><tbody><tr v-for="song in visibleTracks" :key="song.id"><td><strong>{{song.title}}</strong><span v-if="current?.id===song.id" class="tag mint">当前</span></td><td>{{song.artist||'—'}}</td><td class="muted small">{{songSource(song)}}</td><td><div class="row"><button class="btn ghost small" @click="execute({type:'music-request',trackId:song.id})">加入队列</button><button class="btn ghost small" :disabled="!!state.audioReservation" @click="execute({type:'music-play',trackId:song.id})">店长播放</button><button class="link muted" @click="removeTrack(song.id)">移除</button></div></td></tr></tbody></table></div><div v-if="libraryPages>1" class="row"><button class="btn ghost small" :disabled="libraryPage<=1" @click="libraryPage--">上一页</button><span>{{libraryPage}} / {{libraryPages}} 页 · {{tracks.length}} 首</span><button class="btn ghost small" :disabled="libraryPage>=libraryPages" @click="libraryPage++">下一页</button></div></section>
</template>

<style scoped>
.bgm-playlist{padding:13px;border:1px solid var(--border);border-radius:10px;display:grid;gap:10px;margin-bottom:16px;max-height:420px;overflow-y:auto}.bgm-playlist>strong{font-size:13px}.bgm-option{display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--border)}.bgm-option>.check{flex:1;min-width:0;margin:0}.bgm-option>.check>span{overflow-wrap:anywhere}.bgm-option>.row{gap:4px;flex:none}.bgm-option .btn{padding:5px 7px}.bgm-option .tag{font-size:10px}
.qq-music .card-head h2{margin-top:5px}.qq-account{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 15px;border:1px solid var(--border);background:var(--surface-2);border-radius:12px}.qq-account>p{flex:1}.qq-channel{min-width:132px;font-size:11px;gap:4px}.qq-channel select{padding:7px 9px}.qq-login{display:flex;align-items:center;gap:22px;padding:18px;border:1px dashed var(--border-strong);border-radius:12px}.qq-login img{width:180px;height:180px;object-fit:contain;background:#fff;padding:8px;border-radius:9px;flex:none}.qq-login>div{display:grid;gap:12px;max-width:360px}.qq-search{display:flex;align-items:flex-end;gap:12px}.qq-search label{flex:1;margin:0}.qq-search>.btn{margin-bottom:0;min-height:40px;white-space:nowrap}
@media(max-width:1400px){.qq-account{flex-wrap:wrap}.qq-account>.row{width:100%}.qq-search{flex-wrap:wrap}.qq-search label{min-width:180px}.qq-login{flex-wrap:wrap}}
.qq-auto-switch{padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:#f0c07008}.qq-search-progress{padding:12px;border:1px dashed var(--border-strong);background:var(--surface-2);border-radius:11px}.song-search-row{display:flex;align-items:center;gap:10px;padding:9px 0}.song-search-row>div{flex:1;min-width:0}.song-search-row strong{font-size:13px;overflow-wrap:anywhere}.song-search-row small{display:block;margin-top:5px;font-size:11px;color:var(--muted)}.qq-search-progress>p{margin-top:8px;line-height:1.6}.search-progress-icon{display:grid;place-items:center;color:var(--accent);width:27px;height:27px;flex:none}.search-progress-icon.is-searching svg{animation:qq-search-spin 1.7s linear infinite}@keyframes qq-search-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.search-progress-icon.is-searching svg{animation:none}}
</style>
