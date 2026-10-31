<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

const props = defineProps<{ send: (command: any) => Promise<any>; desktop: boolean; localTest: boolean }>()
interface BilibiliInputInfo { state: string; message: string; received: number; reconnects: number; lastEventAt?: number | string; configured: boolean }
const input = ref<BilibiliInputInfo>()
const fields = reactive({ accessKeyId: '', accessKeySecret: '', appId: '', identityCode: '' })
const busy = ref(false), loading = ref(false), notice = ref(''), failed = ref(false)
let timer: ReturnType<typeof setInterval> | undefined, mounted = true
const available = computed(() => props.desktop && !props.localTest)
const filled = computed(() => Object.values(fields).filter(value => value.trim()).length)
const canSave = computed(() => available.value && !busy.value && filled.value > 0 && (input.value?.configured || filled.value === 4))
const stateName = computed(() => ({ stopped: '未连接', connecting: '连接中', connected: '已连接', reconnecting: '重连中', error: '连接异常' })[input.value?.state || 'stopped'] || '等待连接状态')
const count = (value?: number) => Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : 0
const lastEvent = computed(() => {
 if (!input.value?.lastEventAt) return '尚未收到'
 const date = new Date(input.value.lastEventAt)
 return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '尚未收到'
})
function humanMessage(value: unknown, fallback: string) {
 if (typeof value !== 'string' || !/[\u3400-\u9fff]/.test(value)) return fallback
 let message = value
 for (const credential of Object.values(fields)) if (credential.trim()) message = message.split(credential.trim()).join('（已隐藏）')
 return message.slice(0, 300)
}
const statusMessage = computed(() => humanMessage(input.value?.message, '配置 B 站官方凭据后，手动连接弹幕与礼物。'))
async function refresh() {
 if (!props.desktop || loading.value) return
 loading.value = true
 try {
  const result = await props.send({ type: 'bilibili-input-info' })
  if (!mounted) return
  if (result?.ok && result.data) input.value = { state: String(result.data.state || 'stopped'), message: typeof result.data.message === 'string' ? result.data.message : '', received: count(result.data.received), reconnects: count(result.data.reconnects), lastEventAt: result.data.lastEventAt, configured: result.data.configured === true }
  else { notice.value = '无法获取 B 站连接状态，请稍后刷新。'; failed.value = true }
 } catch {
  if (mounted) { notice.value = '无法获取 B 站连接状态，请检查桌面应用是否正常运行。'; failed.value = true }
 } finally { loading.value = false }
}
async function run(type: 'bilibili-input-save' | 'bilibili-input-start' | 'bilibili-input-stop' | 'bilibili-input-clear') {
 if (busy.value || !props.desktop || (props.localTest && type !== 'bilibili-input-stop')) return
 if (type === 'bilibili-input-save' && !canSave.value) return
 if (type === 'bilibili-input-start' && !input.value?.configured) return
 if (type === 'bilibili-input-save' && fields.appId.trim() && !/^\d+$/.test(fields.appId.trim())) { notice.value = '项目 ID 只能填写数字，请复制官方项目 ID。'; failed.value = true; return }
 const messages = {
  'bilibili-input-save': ['B 站连接凭据已保存；请点击连接接收互动消息。', '保存失败，请核对凭据，并确认系统安全存储可用。'],
  'bilibili-input-start': ['正在连接 B 站互动消息，请留意下方状态。', '连接失败，请核对开发密钥、项目 ID 和主播身份码，以及平台项目权限。'],
  'bilibili-input-stop': ['B 站互动消息连接已断开。', '断开失败，请稍后重试。'],
  'bilibili-input-clear': ['B 站连接凭据已清除，重新连接前需要再次填写。', '清除失败，请稍后重试。'],
 }
 busy.value = true; notice.value = ''; failed.value = false
 try {
  const result = await props.send(type === 'bilibili-input-save' ? { type, accessKeyId: fields.accessKeyId.trim(), accessKeySecret: fields.accessKeySecret.trim(), appId: fields.appId.trim(), identityCode: fields.identityCode.trim() } : { type })
  if (!mounted) return
  if (result?.ok) {
   if (type === 'bilibili-input-save' || type === 'bilibili-input-clear') Object.assign(fields, { accessKeyId: '', accessKeySecret: '', appId: '', identityCode: '' })
   notice.value = messages[type][0]
  } else { notice.value = messages[type][1]; failed.value = true }
 } catch {
  if (mounted) { notice.value = messages[type][1]; failed.value = true }
 } finally { busy.value = false; if (mounted) await refresh() }
}
onMounted(async () => { mounted = true; await refresh(); if (mounted) timer = setInterval(() => { if (!busy.value) void refresh() }, 4000) })
onUnmounted(() => { mounted = false; clearInterval(timer); Object.assign(fields, { accessKeyId: '', accessKeySecret: '', appId: '', identityCode: '' }) })
</script>

<template>
 <section class="card" data-testid="bilibili-connection">
  <div class="card-head"><h2>B 站官方互动连接</h2><span class="tag" :class="{ mint: input?.state === 'connected' }">{{ stateName }}</span></div>
  <p class="muted small">通过哔哩哔哩直播开放平台接收弹幕与礼物。这里只连接互动消息，不会开启直播；画面和声音仍需在直播姬或 OBS 中配置并由你手动开播。</p>
  <div v-if="!desktop || localTest" class="notice warning">{{ localTest ? '当前为独立本地测试，不能保存、连接或清除真实 B 站凭据。' : '浏览器仅用于预览，请在桌面应用中配置 B 站连接。' }}</div>
  <p class="small" role="status">{{ statusMessage }}</p>
  <div class="row counters"><span>收到 {{ count(input?.received) }} 条</span><span>重连 {{ count(input?.reconnects) }} 次</span><span>最近消息：{{ lastEvent }}</span></div>
  <div class="form-grid">
   <label>开发密钥 ID · AccessKeyId<input v-model="fields.accessKeyId" :disabled="!available || busy" autocomplete="off" spellcheck="false" aria-label="B 站开发密钥 ID" :placeholder="input?.configured ? '已安全保存；留空保留' : '填写开发密钥 ID'"/></label>
   <label>开发密钥 Secret · AccessKeySecret<input v-model="fields.accessKeySecret" type="password" :disabled="!available || busy" autocomplete="new-password" spellcheck="false" aria-label="B 站开发密钥 Secret" :placeholder="input?.configured ? '已安全保存；留空保留' : '填写开发密钥 Secret'"/></label>
   <label>项目 ID · AppId<input v-model="fields.appId" inputmode="numeric" :disabled="!available || busy" autocomplete="off" spellcheck="false" aria-label="B 站项目 ID" :placeholder="input?.configured ? '已安全保存；留空保留' : '填写官方项目 ID，不是直播房间号'"/></label>
   <label>主播身份码<input v-model="fields.identityCode" type="password" :disabled="!available || busy" autocomplete="new-password" spellcheck="false" aria-label="B 站主播身份码" :placeholder="input?.configured ? '已安全保存；留空保留' : '填写本次授权主播的身份码'"/></label>
  </div>
  <p class="muted small">{{ input?.configured ? '已有安全保存的配置。只填写要更新的字段；留空会保留原值。' : '首次配置需要完整填写四项，房间号和登录 Cookie 不能替代这些凭据。' }} 保存成功后会清空输入框，已有密钥不会回填到页面。</p>
  <div class="row actions"><button class="btn primary" :disabled="!canSave" @click="run('bilibili-input-save')">保存连接凭据</button><button class="btn primary" :disabled="!available || busy || !input?.configured" @click="run('bilibili-input-start')">连接 B 站互动</button><button class="btn ghost" :disabled="!desktop || busy" @click="run('bilibili-input-stop')">断开 B 站互动</button><button class="btn ghost" :disabled="!available || busy || !input?.configured" @click="run('bilibili-input-clear')">清除已存凭据</button><button class="link" :disabled="!desktop || loading || busy" @click="refresh">刷新状态</button></div>
  <p v-if="notice" class="notice" :class="{ warning: failed }" :role="failed ? 'alert' : 'status'">{{ notice }}</p>
  <details class="setup-guide"><summary>没有这些凭据？查看 B 站官方接入步骤</summary><ol class="small"><li>在 <a href="https://open-live.bilibili.com/" target="_blank" rel="noopener noreferrer">直播开放平台</a> 申请开发者入驻，取得开发密钥 ID 和 Secret。</li><li>进入服务中心创建适合用途的项目，按平台要求申请、审核和配置可接收的消息，取得项目 ID。</li><li>由授权主播按平台指引取得主播身份码。身份码用于授权项目连接该主播的直播间，不是主播 UID、房间号或推流密钥。</li><li>填写上方四项并保存，再手动连接。项目权限、身份码或网络异常时，先按状态提示核对；不要在弹幕或聊天中分享这些凭据。</li></ol><p class="muted small"><a href="https://open-live.bilibili.com/document/849b924b-b421-8586-3e5e-765a72ec3840" target="_blank" rel="noopener noreferrer">官方快速开始</a> · <a href="https://open-live.bilibili.com/document/eba8e2e1-847d-e908-2e5c-7a1ec7d9266f" target="_blank" rel="noopener noreferrer">项目开启与主播身份码说明</a></p></details>
 </section>
</template>

<style scoped>
p{line-height:1.7;margin-bottom:12px}.counters{font-size:11px;color:var(--muted);gap:16px;margin:12px 0;flex-wrap:wrap}.actions{flex-wrap:wrap;margin-bottom:12px}.setup-guide{margin-top:16px;border-top:1px solid var(--border);padding-top:12px}.setup-guide summary{font-size:12px;color:var(--text-2);cursor:pointer}.setup-guide ol{padding-left:20px;margin:12px 0;line-height:1.8}.setup-guide li{margin-bottom:8px}.setup-guide a{color:var(--mint)}input{min-width:0}@media(max-width:680px){.form-grid{grid-template-columns:1fr}}
</style>
