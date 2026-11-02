<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { AI_ROLE_LABELS, type AiAgentConfig, type AiDirectorConfig, type AiHubAction, type AiHubBridge, type AiHubView, type AiProvider } from '../../../packages/shared/src/ai'
import AiModelPicker from './AiModelPicker.vue'
const props = defineProps<{ api?: AiHubBridge }>()
const clock=ref(Date.now())
const view = ref<AiHubView>(), busy = ref(false), notice = ref(''), failed = ref(false)
// Drafts are edited locally; the 2-second poll only refreshes status, feed, blackboard and fetched models.
const agents = ref<AiAgentConfig[]>([]), director = ref<AiDirectorConfig>()
const editing = ref<(Omit<AiProvider, 'models'> & { isNew?: boolean })>(), keyInputs = reactive<Record<string, string>>({})
const rehearsal = reactive({ name: '彩排观众', text: '' })
let timer: ReturnType<typeof setInterval> | undefined, mounted = true
const kindNames = { openai: 'OpenAI 兼容', gemini: 'Gemini 原生', anthropic: 'Anthropic 原生' }
const kindOptions = Object.entries(kindNames) as [AiProvider['kind'], string][]
const running = computed(() => !!view.value?.status.running)
const healthRows = computed(() => (view.value?.agents || []).filter(a=>a.enabled && a.role!=='player').map(a=>({id:a.id,label:view.value?.basic?'大肥鱼':a.label,health:view.value?.status.health?.[a.role]})).filter(row=>row.health))
const snapshotLabel = computed(() => ({live:'游戏状态持续更新',stopped:'游戏控制已停止，聊天中枢独立运行',stale:'游戏快照已过期',missing:'尚无游戏快照',unknown:'游戏快照更新时间未知'}[view.value?.status.snapshot?.state || 'missing']))
const disabled = computed(() => !props.api || !!view.value?.localTest)
const providerOf = (id: string) => view.value?.providers.find(p => p.id === id)
const modelsOf = (id: string) => { const p = providerOf(id); return p?.models.length ? p.models.map(m => m.id) : view.value?.presets.find(x => x.id === p?.preset)?.suggestedModels || [] }
const catalogueOf=(id:string)=>providerOf(id)?.models.length?providerOf(id)!.models:modelsOf(id).map(id=>({id}))
const time = (at?: number) => at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'
const feedLabels = { danmaku: '弹幕', host: '场控', strategist: '参谋', directive: '指令', system: '系统', error: '错误' }
const taskLabels={querying:'查询中',ready:'待答复',unavailable:'不可查询',timed_out:'查询超时',cancelled:'已取消',answered:'已答复'}
const taskReasons:Record<string,string>={unsupported:'当前能力无法查询',stopped:'游戏状态未更新',queue_full:'待查队列已满',expired:'查询超时',result_expired:'事实已过期',cross_session:'游戏局已切换',invalid_entity:'星球未确认属于当前帝国',error:'读取失败',transport_error:'查询入口不可用',answer_unavailable:'未能整理出可靠答复'}
const taskReason=(reason?:string)=>taskReasons[reason||'']||''
const tasks=computed(()=>view.value?.blackboard.audience.tasks??[])
const execution=computed(()=>view.value?.operatorExecution)
const nativeIntent=computed(()=>execution.value?.nativeIntent)
const nativeIntentLabels={pending:'目标待生效',applied:'设置已确认，效果待观察',progressing:'实际效果在推进',stalled:'实际效果停滞',blocked:'执行受阻',suspended:'临时让路，目标保留'}
const monthly=(n:number|null|undefined)=>typeof n==='number'?`${n>=0?'+':''}${n.toFixed(1)}/月`:'未知'
const executionLabels={pending:'待执行核查',working:'执行中',verifying:'跟踪效果',succeeded:'结果已核实',blocked:'受阻，待调整',superseded:'已结束旧任务'}
const executionTasks=computed(()=>[...(view.value?.blackboard.executionTasks?.tasks??[])].sort((a,b)=>Number(['succeeded','superseded'].includes(a.status))-Number(['succeeded','superseded'].includes(b.status))))
const unityProgressLine=computed(()=>{
 const p=execution.value?.unityProgress;if(!p)return '尚无真实凝聚力进展读数。'
 const monthly=(n:number|null)=>n===null?'未知':`${n>=0?'+':''}${n.toFixed(1)}/月`
 const share=p.maintenanceShare===null?'未知':`${(p.maintenanceShare*100).toFixed(1)}%`
 const benchmark=p.targetNet===null?'':` · 参考净产 ${monthly(p.targetNet)}${p.deadlineYear===null?'':`（参考年份 ${p.deadlineYear}）`}`
 const diagnosis=p.reasons.length?p.reasons.join('；'):p.stagnating?'实际进展停滞':p.scalingBehind?'增长落后于规模/成本':p.known?'暂未发现停滞':'趋势样本尚不足'
 return `实际净产 ${monthly(p.net)}${benchmark} · 维护占收入 ${share} · ${diagnosis}`
})
const delivery=(at?:number)=>at&&clock.value-at<=120000?'已送达':'未送达'
const focusNames:Record<string,string>={balanced:'均衡',unity_traditions:'凝聚力与传统',consumer_stability:'消费品与稳定',alloys_military:'合金与军工',research:'科研'}
const operatorStatuses={on_track:'按要求推进',blocked:'暂时受阻',done:'退出条件已达到，等待本人确认'}
const usageText = (id: string) => {
  const u = view.value?.status.usage[id]; if (!u) return '尚未调用'
  const missing = u.cacheUsageMissing ?? 0
  const cache = missing === u.requests - u.failed ? '缓存用量未报告' : `缓存读取 ${u.cachedTokens ?? 0} tokens${u.cacheWriteTokens ? ` · 写入 ${u.cacheWriteTokens} tokens` : ''}${missing ? `（${missing} 次未报告缓存）` : ''}`
  return `${u.requests} 次请求${u.failed ? ` · 失败 ${u.failed}` : ''} · ${u.inputTokens}+${u.outputTokens} tokens${u.usageMissing ? `（${u.usageMissing} 次未返回用量）` : ''} · ${cache}`
}

function adopt(next: AiHubView, drafts = false) {
  view.value = next
  if (drafts || !director.value) { agents.value = structuredClone(next.agents); director.value = { ...next.director } }
}
async function refresh() { clock.value=Date.now(); if (!props.api || busy.value) return; try { const next = await props.api.view(); if (mounted) adopt(next) } catch { if (mounted) { notice.value = '无法读取 AI 中枢，请刷新桌面端。'; failed.value = true } } }
async function run(action: AiHubAction, drafts = false) {
  if (!props.api || busy.value) return
  busy.value = true; notice.value = ''
  // Vue proxies cannot cross the IPC structured clone; send plain data.
  try { const result = await props.api.action(JSON.parse(JSON.stringify(action))); if (mounted) { adopt(result.view, drafts); notice.value = result.message || ''; failed.value = !result.ok } return result }
  catch { if (mounted) { notice.value = '操作未完成，请稍后重试。'; failed.value = true } }
  finally { busy.value = false }
}
function addProvider(presetId: string) {
  const preset = view.value?.presets.find(p => p.id === presetId); if (!preset) return
  const taken = new Set(view.value?.providers.map(p => p.id))
  let id = preset.id; for (let n = 2; taken.has(id); n++) id = `${preset.id}-${n}`
  editing.value = { id, name: preset.name, kind: preset.kind, preset: preset.id, baseUrl: preset.baseUrl, enabled: true, isNew: true }
}
function editProvider(p: AiProvider) { editing.value = { id: p.id, name: p.name, kind: p.kind, preset: p.preset, baseUrl: p.baseUrl, enabled: p.enabled } }
async function saveProvider() {
  if (!editing.value) return
  const { isNew: _, ...provider } = editing.value
  const result = await run({ type: 'save-provider', provider })
  if (result?.ok) editing.value = undefined
}
async function removeProvider(p: AiProvider) { if (confirm(`删除「${p.name}」及其已保存的密钥？`)) await run({ type: 'remove-provider', id: p.id }, true) }
async function saveKey(id: string) { const result = await run({ type: 'save-key', id, key: keyInputs[id] || '' }); if (result?.ok) keyInputs[id] = '' }
function addSeat() { agents.value.push({ id: `player-${Date.now().toString(36)}`, role: 'player', label: `对战席位 ${agents.value.filter(a => a.role === 'player').length + 1}`, enabled: false, providerId: '', model: '', temperature: 0.6, maxTokens: 1200, thinking: true, empire: '' }) }
function pickProvider(agent: AiAgentConfig) { const options = modelsOf(agent.providerId); if (!options.includes(agent.model)) agent.model = options[0] || '' }
async function sendRehearsal() { const result = await run({ type: 'rehearse', name: rehearsal.name, text: rehearsal.text }); if (result?.ok) rehearsal.text = '' }
async function testAgent(id: string) { const saved = await run({ type: 'save-agents', agents: agents.value }, true); if (saved?.ok) await run({ type: 'test-agent', id }) }
onMounted(async () => { mounted = true; await refresh(); if (mounted) timer = setInterval(() => void refresh(), 2000) })
onUnmounted(() => { mounted = false; clearInterval(timer) })
</script>

<template>
  <section class="ai-hub" data-testid="stellaris-ai">
    <div class="hub-heading"><div><span>AI HUB</span><h2>{{ view?.basic ? '大肥鱼的 AI 中枢' : '两个大脑，一个直播间。' }}</h2></div>
      <b :class="{ on: running }" data-testid="director-state">{{ running ? `场控运行中${view?.status.busy.length ? ' · 思考中' : ''}` : '场控未启动' }}</b></div>
    <p v-if="view?.basic" class="intro">为大肥鱼配置你自己的 DeepSeek 官方密钥和模型。基础版只保留大肥鱼一个角色，首次使用没有账号和历史记录。</p>
    <p v-else class="intro">场控老师读弹幕、陪聊吐槽、带玩法；游戏参谋读游戏快照、定方针。两边通过共享黑板互通，可以各用不同厂商的模型。</p>
    <p v-if="!api || view?.localTest" class="hub-notice">{{ view?.localTest ? '独立离线测试：不联网、不保存密钥、不启动场控。' : '请打开群星控制器大肥鱼 桌面端使用 AI 中枢。' }}</p>
    <div v-if="notice" :class="['hub-notice', { failed }]" role="alert">{{ notice }}</div>

    <article class="control">
      <div class="control-row">
        <button class="primary" data-testid="director-start" :disabled="busy || disabled || running" @click="run({ type: 'start' })">启动场控</button>
        <button :disabled="busy || disabled || !running" @click="run({ type: 'stop' })">停止场控</button>
        <button :disabled="busy || disabled" @click="run({ type: 'copy-overlay' })">复制字幕地址</button>
        <span class="status">{{ view?.status.message }}</span>
      </div>
      <div class="counters"><span>排队弹幕 {{ view?.status.pending ?? 0 }}</span><span>本小时请求 {{ view?.status.hourRequests ?? 0 }} / {{ view?.director.maxRequestsPerHour ?? '—' }}</span><span>场控本小时 {{ view?.status.roleRequests?.host ?? 0 }} / {{ view?.status.roleLimits?.host ?? 0 }}</span><span v-if="!view?.basic">参谋本小时 {{ view?.status.roleRequests?.strategist ?? 0 }} / {{ view?.status.roleLimits?.strategist ?? 0 }}</span><span>{{ view?.basic ? '大肥鱼上次' : '场控上次' }} {{ time(view?.status.lastHostAt) }}</span><span v-if="!view?.basic">参谋上次 {{ time(view?.status.lastStrategyAt) }}</span><span v-if="view?.overlayUrl">字幕 {{ view.overlayUrl }}</span></div>
      <p class="hint" data-testid="game-snapshot-status">{{ snapshotLabel }} · 最近观察 {{ time(view?.status.snapshot?.observedAt) }}<span v-if="view?.status.pendingDropped"> · 超出队列上限省略 {{ view.status.pendingDropped }} 条</span></p>
      <div v-for="row in healthRows" :key="row.id" :class="['hub-notice', {failed: !!row.health?.consecutiveFailures}]" :data-testid="`health-${row.id}`" role="status">
        {{ row.label }} · 最后成功 {{ time(row.health?.lastSuccessAt) }}<span v-if="row.health?.consecutiveFailures"> · 连续失败 {{ row.health.consecutiveFailures }} 次 · {{ row.health.message }}<span v-if="row.health.httpStatus">（HTTP {{ row.health.httpStatus }}）</span> · {{ row.health.circuitOpen ? '已暂停该角色请求，检查后停止并重新启动场控' : `下次重试 ${time(row.health.nextRetryAt)}` }}</span>
      </div>
      <div class="rehearse"><input v-model="rehearsal.name" aria-label="彩排昵称" class="name"><input v-model="rehearsal.text" aria-label="彩排弹幕" placeholder="彩排弹幕，例如：舰长快去打旁边那个机械帝国！" @keyup.enter="sendRehearsal"><button :disabled="busy || disabled || !running || !rehearsal.text.trim()" @click="sendRehearsal">发送彩排弹幕</button></div>
    </article>

    <article data-testid="audience-question-tasks">
      <h3>观众问题进展 <small>查到事实后，还需要保存公开答复才算完成</small></h3>
      <p v-if="!tasks.length" class="hint">暂无需要补查的观众问题。普通聊天可直接答复，建议采纳不等于问题已答复。</p>
      <div v-for="task in tasks" :key="task.id" class="question-task" :data-testid="`question-${task.id}`">
        <div><strong>{{ task.name || '观众' }}</strong><span>{{ taskLabels[task.status] }}</span><small>{{ time(task.updatedAt) }}</small></div>
        <p>{{ task.question }}</p>
        <p v-if="task.status==='answered'" class="hint">已保存公开答复：{{ task.answer }}</p>
        <p v-else-if="task.status==='ready'" class="hint">已获得事实，等待最终答复。</p>
        <p v-else-if="taskReason(task.reason)" class="hint">{{ taskReason(task.reason) }}</p>
      </div>
    </article>

    <article>
      <h3>服务商 <small>密钥只加密保存在本机{{ view && !view.encrypted && !view.localTest ? ' · 系统安全存储不可用' : '' }}</small></h3>
      <div class="provider-list">
        <div v-for="p in view?.providers || []" :key="p.id" class="provider" :data-testid="`provider-${p.id}`">
          <div class="provider-head"><strong>{{ p.name }}</strong><em>{{ kindNames[p.kind] }}</em><span :class="['tag', { ok: p.hasKey }]">{{ p.hasKey ? '密钥已保存' : '未保存密钥' }}</span><span class="tag">{{ p.models.length ? `${p.models.length} 个模型` : '未拉取模型' }}</span>
            <span class="spacer"></span><button v-if="!view?.basic" class="small" :disabled="busy || disabled" @click="editProvider(p)">编辑</button><button v-if="!view?.basic" class="small danger" :disabled="busy || disabled" @click="removeProvider(p)">删除</button></div>
          <code>{{ p.baseUrl }}</code>
          <div class="key-row"><input v-model="keyInputs[p.id]" type="password" autocomplete="off" :aria-label="`${p.name} 密钥`" :placeholder="p.hasKey ? '已保存；重新填写可替换，留空保存即清除' : view?.presets.find(x => x.id === p.preset)?.keyHint || 'API 密钥'"><button :disabled="busy || disabled" @click="saveKey(p.id)">保存密钥</button><button :data-testid="`fetch-models-${p.id}`" :disabled="busy || disabled || !p.hasKey" @click="run({ type: 'list-models', id: p.id })">拉取模型列表</button></div>
          <p v-if="p.modelsFetchedAt" class="hint">模型列表更新于 {{ new Date(p.modelsFetchedAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
        </div>
      </div>
      <div v-if="!view?.basic" class="add-row"><span>添加服务商：</span><button v-for="preset in view?.presets || []" :key="preset.id" class="small" :disabled="busy || disabled" @click="addProvider(preset.id)">+ {{ preset.name }}</button></div>
      <div v-if="editing" class="editor" data-testid="provider-editor">
        <label>名称<input v-model="editing.name" maxlength="40"></label>
        <label>接口形态<select v-model="editing.kind"><option v-for="[id, name] in kindOptions" :key="id" :value="id">{{ name }}</option></select></label>
        <label class="wide">接口地址<input v-model="editing.baseUrl" placeholder="https://你的服务商/v1"></label>
        <label class="check"><input v-model="editing.enabled" type="checkbox">启用</label>
        <div class="editor-actions"><button class="primary" :disabled="busy" @click="saveProvider">{{ editing.isNew ? '添加' : '保存' }}</button><button :disabled="busy" @click="editing = undefined">取消</button></div>
        <p class="hint">OpenAI 兼容填到 /v1 为止（DeepSeek 可不带 /v1），会自动拼接 /chat/completions 与 /models；Gemini 原生填 …/v1beta；中转服务按对方文档选择形态。只允许 https，本机中转可用 http://127.0.0.1。</p>
      </div>
    </article>

    <article>
      <h3>角色分工 <small>模型列表来自“拉取模型列表”，也可直接输入模型名</small></h3>
      <div class="agents">
        <div v-for="agent in agents" :key="agent.id" :class="['agent', agent.role]" :data-testid="`agent-${agent.id}`">
          <div class="agent-head"><span class="role">{{ view?.basic ? '大肥鱼' : AI_ROLE_LABELS[agent.role] }}</span><input v-model="agent.label" class="label" maxlength="20" aria-label="角色名称" :readonly="view?.basic"><label class="check"><input v-model="agent.enabled" type="checkbox">启用</label>
            <button v-if="agent.role === 'player'" class="small danger" @click="agents = agents.filter(a => a !== agent)">移除</button></div>
          <div class="agent-grid">
            <label>服务商<select v-model="agent.providerId" @change="pickProvider(agent)"><option value="">未选择</option><option v-for="p in view?.providers || []" :key="p.id" :value="p.id">{{ p.name }}{{ p.hasKey ? '' : '（无密钥）' }}</option></select></label>
            <div class="model-field"><span>模型</span><AiModelPicker v-model="agent.model" :models="catalogueOf(agent.providerId)" :provider-name="providerOf(agent.providerId)?.name" :disabled="busy||disabled||!agent.providerId"/></div>
            <label>温度<input v-model.number="agent.temperature" type="number" min="0" max="2" step="0.1"></label>
            <label>输出上限<input v-model.number="agent.maxTokens" type="number" min="64" max="32000" step="100"></label>
            <label class="check"><input v-model="agent.thinking" type="checkbox">深度思考</label>
            <label v-if="agent.role === 'player'">指挥帝国<input v-model="agent.empire" placeholder="帝国名称"></label>
          </div>
          <div class="agent-foot"><span>{{ usageText(agent.id) }}</span><button class="small" :disabled="busy || disabled || !agent.providerId" @click="testAgent(agent.id)">保存并测试</button></div>
          <p v-if="agent.role === 'player'" class="hint">对战席位为多 AI 群星对战预留：每个席位绑定一个帝国和一个模型，共用同一块黑板。当前版本先保存配置，尚不参与操作游戏。</p>
        </div>
      </div>
      <div class="row-end"><button v-if="!view?.basic" class="small" :disabled="busy || disabled || agents.length >= 10" @click="addSeat">+ 对战席位</button><button class="primary" data-testid="save-agents" :disabled="busy || disabled" @click="run({ type: 'save-agents', agents }, true)">保存角色分工</button></div>
      <p class="hint">“保存并测试”会保存当前设置并实际调用所选模型。</p>
    </article>

    <article v-if="director">
      <h3>场控参数</h3>
      <div class="director-grid">
        <label>回复间隔（秒）<input v-model.number="director.replyIntervalSeconds" type="number" min="3" max="120"></label>
        <label>每轮最多读弹幕<input v-model.number="director.batchSize" type="number" min="1" max="40"></label>
        <label v-if="!view?.basic">参谋复盘间隔（秒）<input v-model.number="director.strategyIntervalSeconds" type="number" min="30" max="3600"></label>
        <label>每小时请求上限<input v-model.number="director.maxRequestsPerHour" type="number" min="10" max="3000"></label>
        <label>冷场多久后解说（秒，0 关闭）<input v-model.number="director.idleCommentSeconds" type="number" min="0" max="3600"></label>
      </div>
      <label class="block">{{ view?.basic ? '给大肥鱼的交代' : '给场控老师的交代' }}<textarea v-model="director.hostNote" rows="2" maxlength="600" placeholder="例如：今晚主题是“和平种田”，多请观众给新星球起名。"></textarea></label>
      <label v-if="!view?.basic" class="block">给游戏参谋的要求<textarea v-model="director.strategyNote" rows="2" maxlength="600" placeholder="例如：这局走科技胜利，尽量不主动宣战。"></textarea></label>
      <div class="row-end"><button class="primary" :disabled="busy || disabled" @click="run({ type: 'save-director', director }, true)">保存场控参数</button></div>
    </article>

    <article v-if="!view?.basic" data-testid="operator-execution">
      <h3>主播要求执行</h3>
      <dl>
        <dt>原文</dt><dd data-testid="operator-text">{{ view?.operatorExecution?.text || '尚未设置主播要求。' }}</dd>
        <dt>解析方针</dt><dd>{{ view?.operatorExecution?.economyFocus ? focusNames[view.operatorExecution.economyFocus] : '待解析' }}</dd>
        <dt>退出条件</dt><dd>{{ [view?.operatorExecution?.until.date,view?.operatorExecution?.until.condition].filter(Boolean).join('；') || '待解析' }}</dd>
        <dt>常驻要求</dt><dd data-testid="standing-delivery">{{ delivery(view?.operatorExecution?.standingRefreshedAt) }} · 最后刷新 {{ time(view?.operatorExecution?.standingRefreshedAt) }}</dd>
        <dt>参谋目标</dt><dd data-testid="directive-delivery">{{ delivery(view?.operatorExecution?.directiveRefreshedAt) }} · 最后刷新 {{ time(view?.operatorExecution?.directiveRefreshedAt) }}</dd>
        <dt>执行判断</dt><dd>{{ nativeIntent ? nativeIntentLabels[nativeIntent.status] : {on_track:'按计划推进',blocked:'受阻',done:'已达到退出条件，请主播确认'}[view?.operatorExecution?.status || 'blocked'] }}：{{ view?.operatorExecution?.evidence || '等待参谋解释主播要求。' }}</dd>
      </dl>
      <p data-testid="controller-receipt">{{ execution?.receipt ? execution.receipt.steeringApplied ? '引导档位已切换' : '控制器已读取，尚未确认切换' : '等待控制器回执' }}<span v-if="execution?.receipt"> · {{ focusNames[execution.receipt.appliedFocus || ''] || '尚无档位' }} · {{ time(execution.receipt.readAt) }} · {{ execution.receipt.reason }}</span></p>
      <p v-if="execution?.receipt?.steeringApplied" class="hint">档位回执只确认设置；经营效果以下方实际读数为准。</p>
      <p data-testid="operator-unity-progress">{{ unityProgressLine }}</p>

      <p class="hint">目标资源月净产 · 最近十次复盘快照（缺失读数显示未知；送达表示文件已写出）</p>
      <ol data-testid="operator-history" class="operator-history"><li v-for="(point,index) in view?.operatorExecution?.history || []" :key="index">{{ point.date || time(point.at) }} · {{ point.resource }}：{{ point.net === null ? '未知' : `${point.net >= 0 ? '+' : ''}${point.net.toFixed(1)}/月` }}</li></ol>
    </article>

    <article v-if="nativeIntent" data-testid="native-intent-execution">
      <h3>原生 AI 目标落实</h3>
      <p><b>{{ nativeIntentLabels[nativeIntent.status] }}</b> · {{ nativeIntent.objective }}</p>
      <p>{{ nativeIntent.reason }}</p>
      <dl>
        <dt>引导设置</dt><dd>{{ nativeIntent.controls.steeringConfirmed ? '已确认' : '待确认' }} · 目标执行合同 {{ nativeIntent.controls.ownerPolicyConfirmed ? '已确认' : '待确认' }}</dd>
        <dt>月净产</dt><dd>{{ nativeIntent.baseline.date || '基线日期未知' }}：{{ monthly(nativeIntent.baseline.net) }} → {{ nativeIntent.current.date || '当前日期未知' }}：{{ monthly(nativeIntent.current.net) }}</dd>
        <dt>实际变化</dt><dd>月净产变化 {{ monthly(nativeIntent.progress.netDelta) }} · 新增传统 {{ nativeIntent.progress.traditionsGained ?? '未知' }}</dd>
        <dt v-if="nativeIntent.correctiveAction">后续调整</dt><dd v-if="nativeIntent.correctiveAction">{{ nativeIntent.correctiveAction }}</dd>
        <dt v-if="nativeIntent.unsupported.length">能力受限</dt><dd v-if="nativeIntent.unsupported.length">{{ nativeIntent.unsupported.join('；') }}</dd>
      </dl>
    </article>

    <article v-if="!view?.basic" data-testid="advice-execution">
      <h3>意见执行 <small>{{ executionTasks.length }} 项</small></h3>
      <p class="hint">参谋行动与采纳的弹幕建议分别跟踪。采取措施后继续核对效果，有结果依据才显示已核实。</p>
      <ul v-if="executionTasks.length" class="execution-list">
        <li v-for="task in executionTasks" :key="task.id">
          <div><span :class="['execution-status',task.status]">{{ executionLabels[task.status] }}</span><b>{{ task.source === 'audience' ? '弹幕建议' : '参谋行动' }}</b> · {{ task.text }}</div>
          <p>{{ task.reason || '等待执行层核查当前条件。' }}<span v-if="task.date"> · 星历 {{ task.date }}</span></p>
          <p v-if="task.evidence" class="execution-evidence">结果依据：{{ task.evidence }}</p>
        </li>
      </ul>
      <p v-else class="hint">尚无本局执行任务。采纳建议或生成具体行动后会在这里持续显示。</p>
    </article>

    <div class="split">
      <article v-if="!view?.basic" class="board" data-testid="blackboard">
        <h3>共享黑板 <small>两位同事都读这里</small><span class="spacer"></span><button class="small" :disabled="busy || disabled" @click="run({ type: 'reset-blackboard' })">清空</button></h3>
        <dl>
          <dt>局势</dt><dd>{{ view?.blackboard.game.summary || '参谋尚未复盘。' }}<em v-if="view?.blackboard.game.date"> · 星历 {{ view.blackboard.game.date }}</em></dd>
          <dt>威胁</dt><dd>{{ view?.blackboard.game.threats.join('；') || '—' }}</dd>
          <dt>方针</dt><dd>{{ view?.blackboard.plan.focus || '—' }}</dd>
          <dt>下一步</dt><dd><ol v-if="view?.blackboard.plan.nextSteps.length"><li v-for="s in view.blackboard.plan.nextSteps" :key="s">{{ s }}</li></ol><template v-else>—</template></dd>
          <dt>话题</dt><dd>{{ view?.blackboard.plan.talkingPoint || '—' }}</dd>
          <dt>直播间</dt><dd>{{ view?.blackboard.audience.mood || '未知' }}{{ view?.blackboard.audience.hotTopics.length ? ' · ' + view.blackboard.audience.hotTopics.join('、') : '' }}</dd>
          <dt>观众建议</dt><dd><ul v-if="view?.blackboard.audience.suggestions.length"><li v-for="s in view.blackboard.audience.suggestions" :key="s.id"><b>{{ s.name }}</b>：{{ s.text }} <i :class="s.status">{{ { new: '待判断', adopted: '纳入计划，效果待确认', declined: '未采纳', answered: '已回答' }[s.status] }}</i><span v-if="s.execution"> · {{ executionLabels[s.execution.status] }}：{{ s.execution.reason }}</span><span v-if="s.reply"> — {{ s.reply }}</span></li></ul><template v-else>—</template></dd>
        </dl>
      </article>
      <article class="feed">
        <h3>实时记录<span class="spacer"></span><button class="small" :disabled="busy || disabled" @click="run({ type: 'clear-feed' })">清空</button></h3>
        <ul data-testid="ai-feed"><li v-for="item in view?.feed || []" :key="item.id" :class="item.kind"><span class="when">{{ time(item.at) }}</span><span class="kind">{{ feedLabels[item.kind] }}</span><span class="text"><b v-if="item.name">{{ item.kind === 'host' ? '@' : '' }}{{ item.name }}{{ item.kind === 'host' ? '' : '：' }}</b>{{ item.text }}</span></li>
          <li v-if="!view?.feed.length" class="empty">{{ view?.basic ? '启动后，这里显示弹幕和大肥鱼的回复。' : '启动场控后，这里显示弹幕、场控的回复和参谋的判断。' }}</li></ul>
      </article>
    </div>
    <p v-if="view?.basic" class="hint footer-hint">大肥鱼的回复保存在当前电脑并显示在字幕页。弹幕作为聊天数据处理，启动和停止游戏控制请使用“群星控制”页。</p>
    <p v-else class="hint footer-hint">场控的话写入控制器目录 .local/commentary/host-replies.jsonl 并显示在字幕页；参谋的方针写入 strategy-directive.json，供群星控制器读取。弹幕只作为聊天数据，不会变成游戏命令。</p>
  </section>
</template>
<style scoped>.question-task{border:1px solid #dce7f1;border-radius:8px;padding:12px;margin-top:10px;color:#496d8d}.question-task>div{display:flex;gap:14px;align-items:center}.question-task span{color:#5286af;font-size:12px}.question-task small{margin-left:auto;color:#8ca3b7}.question-task p{font-size:12px;line-height:1.7;margin-top:7px}</style>

<style scoped>
.ai-hub{color:#345b7c}.hub-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.hub-heading span{font:10px Consolas,monospace;color:#86a5c2;letter-spacing:2px}.hub-heading h2{font-size:24px;color:#244f7a;margin-top:10px}
.hub-heading b{font-size:11px;color:#8aa3b9;background:#eef3f8;border:1px solid #d3e0eb;padding:7px 10px;border-radius:6px;white-space:nowrap;font-weight:400}.hub-heading b.on{color:#298f88;background:#e7f5f2;border-color:#c8e4de}
.intro{font-size:13px;line-height:1.8;color:#7f9bb3;margin:14px 0 18px}
.hub-notice{background:#e7f4f2;border:1px solid #c8e4de;padding:11px 16px;border-radius:7px;font-size:12px;line-height:1.7;color:#518a80;margin:0 0 14px}.hub-notice.failed{background:#fff5e9;border-color:#ebd5bb;color:#ad7a50}
article{padding:20px 22px;background:#ffffffc7;border:1px solid #cbdff0;border-radius:12px;margin-bottom:15px;min-width:0}
h3{font-size:15px;font-weight:600;display:flex;align-items:center;gap:12px;margin-bottom:12px}h3 small{font-size:11px;font-weight:400;color:#8aa8bf}.spacer{flex:1}
button{border:1px solid #bcd8ed;background:#edf7ff;color:#3b7dad;border-radius:6px;font-size:12px;padding:8px 12px}button:hover:not(:disabled){background:#dfedff}button.primary{background:#398ddd;border-color:#398ddd;color:#fff}button.primary:hover:not(:disabled){background:#267dce}button.small{padding:5px 9px;font-size:11px}button.danger{color:#b8735e;border-color:#ecd2c8;background:#fff7f4}
input,select,textarea{font:inherit;font-size:12px;padding:7px 9px;border:1px solid #c7dced;border-radius:6px;background:#fff;color:#345b7c;min-width:0}textarea{resize:vertical;width:100%}
label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#7f9bb3}label.check{flex-direction:row;align-items:center;gap:6px}label.block{margin-top:12px}
.hint{font-size:11px;line-height:1.7;color:#94aabd;margin-top:8px}code{display:block;background:#f0f6fc;border:1px solid #dbe8f4;border-radius:6px;padding:7px 10px;font:11px Consolas,monospace;color:#5b83a8;overflow-wrap:anywhere;margin-top:8px}
.control-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.status{font-size:12px;color:#7391ac;margin-left:6px}.counters{display:flex;gap:18px;flex-wrap:wrap;font-size:11px;color:#91a9bd;margin-top:12px}
.rehearse{display:flex;gap:8px;margin-top:14px}.rehearse input{flex:1}.rehearse input.name{flex:none;width:120px}
.provider-list{display:flex;flex-direction:column;gap:10px}.provider{border:1px solid #dbe8f4;border-radius:9px;padding:12px 14px;background:#f8fbff}
.provider-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.provider-head strong{font-size:13px;color:#2f5f8a}.provider-head em{font-style:normal;font-size:11px;color:#8aa8bf}
.tag{font-size:10px;padding:3px 7px;border-radius:4px;background:#eef3f8;color:#8aa3b9}.tag.ok{background:#e7f5f2;color:#298f88}
.key-row{display:flex;gap:8px;margin-top:9px}.key-row input{flex:1}
.add-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px;font-size:11px;color:#8aa8bf}
.editor{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;padding:14px;border:1px dashed #b9d4ea;border-radius:9px;background:#f4f9ff}.editor .wide{grid-column:1/-1}.editor-actions{display:flex;gap:8px;align-items:flex-end}.editor .hint{grid-column:1/-1;margin:0}
.agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}.agent{border:1px solid #dbe8f4;border-radius:9px;padding:12px 14px;background:#f8fbff;border-top:3px solid #9cc4e6}.agent.host{border-top-color:#f0a35e}.agent.strategist{border-top-color:#5a9ed7}.agent.player{border-top-color:#9b8fd6}
.agent-head{display:flex;align-items:center;gap:9px}.agent-head .role{font-size:11px;color:#fff;background:#7aa9d1;padding:3px 8px;border-radius:4px}.agent.host .role{background:#e39550}.agent.strategist .role{background:#4b8fca}.agent.player .role{background:#8d80c9}.agent-head .label{flex:1}
.agent-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}.agent-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;font-size:10px;color:#94aabd}
.model-field{grid-column:1/-1;min-width:0;display:flex;flex-direction:column;gap:5px;font-size:11px;color:#7f9bb3}
.row-end{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.director-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:15px}.split article{margin-bottom:0}
.board dl{display:grid;grid-template-columns:62px 1fr;gap:8px 10px;margin:0;font-size:12px;line-height:1.7}.board dt{color:#8aa8bf}.board dd{margin:0;color:#46698a;min-width:0}.board ol,.board ul{margin:0;padding-left:16px}.board i{font-style:normal;font-size:10px;padding:1px 5px;border-radius:3px;background:#eef3f8;color:#8aa3b9}.board i.adopted{background:#e7f5f2;color:#298f88}.board i.declined{background:#fff3ec;color:#b8735e}.board i.answered{background:#e8f1ff;color:#3f7fbf}
.feed ul{list-style:none;margin:0;padding:0;max-height:430px;overflow:auto;font-size:12px}.feed li{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #edf3f9;line-height:1.6}.feed .when{color:#a3b6c7;font:10px Consolas,monospace;padding-top:3px;flex:none}.feed .kind{flex:none;font-size:10px;padding:1px 6px;border-radius:3px;background:#eef3f8;color:#8aa3b9;height:fit-content;margin-top:2px}
.feed li.host .kind{background:#fff0e0;color:#c27a3a}.feed li.strategist .kind,.feed li.directive .kind{background:#e3f0fc;color:#3f7fbf}.feed li.error .kind{background:#fff0ed;color:#c06e5d}.feed li.error .text{color:#b77750}.feed .text{min-width:0;overflow-wrap:anywhere;color:#46698a}.feed .text b{color:#5d86ab;font-weight:600;margin-right:4px}.feed li.empty{color:#a3b6c7;justify-content:center;padding:20px 0}
.footer-hint{margin-top:12px}
.execution-list{list-style:none;margin:0;padding:0;max-height:420px;overflow:auto;font-size:12px;color:#46698a}.execution-list li{padding:10px 0;border-bottom:1px solid #edf3f9;line-height:1.7}.execution-list p{margin:4px 0 0;color:#7391ac}.execution-status{display:inline-block;margin-right:8px;padding:1px 7px;border-radius:4px;background:#e8f1ff;color:#3f7fbf}.execution-status.blocked{background:#fff0e0;color:#a4662f}.execution-status.succeeded{background:#e7f5f2;color:#298f88}.execution-status.superseded{background:#eef3f8;color:#8aa3b9}.execution-list .execution-evidence{color:#298478}
@media(max-width:960px){.split{grid-template-columns:1fr}.agent-grid{grid-template-columns:1fr}}
</style>
