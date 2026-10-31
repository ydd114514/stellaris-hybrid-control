<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { Command, CommandResult } from '../../../packages/shared/src'
import type { LiveScreenPreview, LiveScreenSelection, LiveScreenStatus, LiveScreenWindow, NormalizedRect } from '../electron/live-screen-input'
import type { InputFailoverInfo } from '../electron/input-failover'
const props = defineProps<{ execute: (command: Command, message?: string) => Promise<CommandResult | undefined>; localTest?: boolean }>()
interface ScreenInfo { settings: { enabled: boolean; selection?: LiveScreenSelection }; status?: LiveScreenStatus; failover?: InputFailoverInfo }
const desktop = !!window.shop, screen = ref<ScreenInfo>(), windows = ref<LiveScreenWindow[]>([]), preview = ref<LiveScreenPreview['images']>([])
const primary = ref<{ state: string; room: string; message: string; received: number; configuredRoom?: string; automatic?: boolean }>(), room = ref(''), busy = ref(false)
const defaults = { commentRoi: { x: .81, y: .48, width: .175, height: .44 }, giftRoi: { x: .81, y: .34, width: .175, height: .13 } }
const edit = reactive({ enabled: false, windowId: '', commentRoi: { ...defaults.commentRoi }, giftRoi: { ...defaults.giftRoi } })
const regions = [{ key: 'commentRoi', label: '评论区' }, { key: 'giftRoi', label: '礼物区' }] as const
const axes = [{ key: 'x', label: '距左' }, { key: 'y', label: '距上' }, { key: 'width', label: '宽度' }, { key: 'height', label: '高度' }] as const
let initialized = false, primaryInitialized = false, timer: ReturnType<typeof setInterval> | undefined
const available = computed(() => desktop && !props.localTest)
const valid = (r: NormalizedRect) => [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width >= .01 && r.height >= .01 && r.x+r.width <= 1.000001 && r.y+r.height <= 1.000001
const selectionValid = computed(() => !!edit.windowId && valid(edit.commentRoi) && valid(edit.giftRoi))
const selection = (): LiveScreenSelection => ({ windowId: edit.windowId, commentRoi: { ...edit.commentRoi }, giftRoi: { ...edit.giftRoi } })
const sourceName = computed(() => screen.value?.failover?.selected === 'bridge' ? screen.value.settings.enabled && screen.value.status?.state==='reading' ? '后台优先 · 画面礼物补缺' : '后台主用' : screen.value?.failover?.selected === 'screen' ? '屏幕识别备用' : '等待来源')
async function refresh() {
 if (!desktop) return
 const [s,p] = await Promise.all([props.execute({ type: 'screen-input-info' }), props.execute({ type: 'douyin-input-info' })])
 if (s?.ok && s.data) { screen.value = { ...(s.data as ScreenInfo) }; if (!initialized) { const settings = screen.value.settings; edit.enabled = settings?.enabled || false; if (settings?.selection) { edit.windowId=settings.selection.windowId; Object.assign(edit.commentRoi,settings.selection.commentRoi); Object.assign(edit.giftRoi,settings.selection.giftRoi) }; initialized=true } }
 if (p?.ok && p.data) { primary.value = { ...(p.data as NonNullable<typeof primary.value>) }; if (!primaryInitialized) { room.value = primary.value?.configuredRoom ?? primary.value?.room ?? ''; primaryInitialized = true } }
}
async function run(work: () => Promise<unknown>) { if (busy.value) return; busy.value=true; try { await work() } finally { busy.value=false; await refresh() } }
async function list() { await run(async () => { const result=await props.execute({type:'screen-input-windows'}); if(result?.ok&&result.data)windows.value=(result.data as {windows:LiveScreenWindow[]}).windows||[] }) }
async function save() { await run(async () => { await props.execute({type:'screen-input-set',enabled:edit.enabled,selection:edit.windowId?selection():undefined}) }) }
async function showPreview() { await run(async () => { const result=await props.execute({type:'screen-input-preview',selection:selection()}); if(result?.ok&&result.data)preview.value=((result.data as LiveScreenPreview).images||[]).filter(image=>/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl)&&image.dataUrl.length<3*1024*1024) }) }
function setPreset() { Object.assign(edit.commentRoi,defaults.commentRoi); Object.assign(edit.giftRoi,defaults.giftRoi); preview.value=[] }
onMounted(async()=>{await refresh();timer=setInterval(()=>void refresh(),4000)})
onUnmounted(()=>clearInterval(timer))
</script>
<template>
 <section class="card" data-testid="input-failover">
  <div class="card-head"><h2>弹幕与礼物主备接收</h2><span class="tag mint" data-testid="input-selected-source">{{sourceName}}</span></div>
  <p class="small">{{screen?.failover?.message||'先接后台来源，再为直播助手选好备用读取区域。浏览器预览不会读取真实窗口。'}}</p>
  <p class="muted small">后台认证连接或心跳有效时优先用后台；安静没有弹幕不算故障。明确断连或心跳超时才由画面接管评论，后台稳定恢复后再切回。匿名后台可能漏部分礼物，画面礼物连续确认后等约2秒补缺，两路同份只算一次。切换只改变消息接收，画面、配音和音乐继续。</p>
  <div v-if="screen?.failover" class="row counters"><span>后台实际投递 {{screen.failover.deliveredBridge}} 条</span><span>屏幕实际投递 {{screen.failover.deliveredScreen}} 条</span><span>重复合并 {{screen.failover.duplicates}} 条</span><span>不确定已忽略 {{screen.failover.ignored}} 条</span><span>礼物核对中 {{screen.failover.pendingScreenGifts||0}} 条</span></div>
  <div class="grid two receiver-grid">
   <section class="receiver-box"><h3>A · 后台事件</h3><p class="small" role="status">{{primary?.message||'尚未连接直播房间。已有本机转发工具也可使用下方接收器。'}}</p><label>抖音直播房间号 / 内部房间号<input v-model="room" maxlength="300" placeholder="留空自动跟随；也可填直播号或19位内部号"/></label><div class="row"><button class="btn primary" :disabled="!available||busy" @click="run(()=>execute({type:'douyin-input-start',room:room.trim()}))">连接后台事件</button><button class="btn ghost" :disabled="!available||busy" @click="run(()=>execute({type:'douyin-input-stop'}))">断开后台事件</button></div><p class="muted small">手填房号优先；macOS 留空时可从伴侣日志发现公共房号；Windows 请手填当前直播房间号。只在开播前设置，不读取登录凭据或推流资料，也不替你开始直播。</p></section>
   <section class="receiver-box"><h3>B · 直播助手画面备用</h3><p class="small" role="status">{{screen?.status?.message||'尚未读取直播助手画面。'}}</p><p class="muted small">本机读图 {{screen?.status?.frames||0}} 帧 · 多帧确认候选 {{screen?.status?.candidates||0}} 条，候选不等于后台核验事件。</p><div class="row"><button class="btn ghost" :disabled="!available||busy" @click="list">列出直播助手窗口</button><button class="btn ghost" :disabled="!available||busy" @click="run(()=>execute({type:'screen-input-warmup'}))">预热本机识别</button></div><label>只读取这个直播助手窗口<select v-model="edit.windowId"><option value="">请选择窗口</option><option v-if="edit.windowId&&!windows.some(window=>window.id===edit.windowId)" :value="edit.windowId">已保存窗口 · 可重新列出核对</option><option v-for="window in windows" :key="window.id" :value="window.id">{{window.name}}</option></select></label><label class="check"><input v-model="edit.enabled" type="checkbox"/><span>开启画面热备与自动切换<small>仅读取选定窗口的评论、礼物区域，不采集整屏、排行榜或声音。</small></span></label></section>
  </div>
  <div class="card-head spaced"><h3>两块独立读取区域</h3><button class="btn ghost small" @click="setPreset">当前直播伴侣布局预置</button></div>
  <div class="grid two roi-grid"><section v-for="region in regions" :key="region.key"><h4>{{region.label}}</h4><div class="roi-fields"><label v-for="axis in axes" :key="axis.key">{{axis.label}} / %<input :value="+(edit[region.key][axis.key]*100).toFixed(3)" type="number" min="0" max="100" step="0.5" :aria-label="region.label+' '+axis.label+' 百分比'" @input="edit[region.key][axis.key]=Number(($event.target as HTMLInputElement).value)/100;preview=[]"/></label></div></section></div>
  <p v-if="edit.windowId&&!selectionValid" class="notice warning">两个区域都须位于窗口内，宽高至少1%。请调整后再预览或保存。</p>
  <div class="row"><button class="btn ghost" :disabled="!available||busy||!selectionValid" @click="showPreview">核对评论 / 礼物裁图</button><button class="btn primary" :disabled="!available||busy||(edit.enabled&&!selectionValid)" @click="save">保存主备接收设置</button></div>
  <div v-if="preview.length" class="grid two preview-grid" data-testid="screen-input-preview"><figure v-for="image in preview" :key="image.region"><figcaption>{{image.region==='comment'?'评论区':'礼物区'}} · 仅本机预览</figcaption><img :src="image.dataUrl" :alt="image.region==='comment'?'所选评论区域裁图':'所选礼物区域裁图'"/></figure></div>
  <p class="muted small">评论区的“送出了token”等文字仍是评论，不当真礼物。低置信、重复或同名歧义不猜认；屏幕识别不核验真实用户、礼物金额或关注资格。只保存区域设置，不保存截图和识别原文。</p>
  <p class="muted small">开播前核对裁图和权限；开播后让主备自动接收，不用刷新、重开或调整直播窗口。Windows 需安装简体中文 OCR 语言组件；最小化或无法读取的窗口不会改为整屏采集。macOS 需录屏权限，失败时后台事件仍继续。</p>
 </section>
</template>
<style scoped>
p{line-height:1.7;margin-bottom:12px}.counters{font-size:11px;color:var(--muted);gap:16px;margin:12px 0}.receiver-grid{margin-top:16px}.receiver-box{padding:15px;border:1px solid var(--border);border-radius:11px}.receiver-box h3,.roi-grid h4{font-size:13px;margin-bottom:12px}.receiver-box .row{flex-wrap:wrap}.roi-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.roi-fields label{font-size:11px}.roi-fields input{min-width:0}.preview-grid{margin-top:15px}.preview-grid figure{margin:0;min-width:0}.preview-grid img{max-width:100%;max-height:340px;display:block;border:1px solid var(--border);object-fit:contain;background:#171b20}.preview-grid figcaption{font-size:12px;color:var(--muted);margin-bottom:8px}.spaced{margin-top:18px}
</style>
