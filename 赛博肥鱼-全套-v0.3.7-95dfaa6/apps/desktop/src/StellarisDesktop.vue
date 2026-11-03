<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Icon from './Icon.vue'
import StellarisBroadcast from './StellarisBroadcast.vue'
import StellarisAi from './StellarisAi.vue'
import StellarisSpeech from './StellarisSpeech.vue'
import captain from '../../../assets/stellaris/feiyu-captain.png'
import type { StellarisStatus,StellarisOrderPhase } from '../../../packages/shared/src/stellaris'

const api = window.stellaris
const requestedPanel=new URLSearchParams(location.search).get('panel')
const view = ref<'game' | 'live' | 'ai' | 'speech'>(requestedPanel==='speech'?'speech':requestedPanel==='ai'?'ai':requestedPanel==='music'?'live':'game')
const status = ref<StellarisStatus>({ phase: 'unavailable', message: '正在读取本机控制器状态…', canStart: false, canStop: false })
const busy = ref(false), notice = ref(''), error = ref(false), loading = ref(false)
const gameKey = ref('')
const directorMode=ref<'auto'|'fixed'>('auto')
async function changeDirector(){
  if(!api?.presentationMode)return
  try{directorMode.value=await api.presentationMode(directorMode.value==='auto'?'fixed':'auto')}
  catch{notice.value='导播模式保存失败，请重试。';error.value=true}
}
async function saveGameKey() {
  if (!api?.saveGameKey || busy.value) return
  busy.value = true
  try { const result = await api.saveGameKey(gameKey.value); notice.value = result.message || ''; error.value = !result.ok; status.value = result.status; if (result.ok) gameKey.value = '' }
  finally { busy.value = false }
}
let timer: ReturnType<typeof setInterval> | undefined, mounted = true
const labels = { stopped: '已停止', starting: '正在启动', running: '运行中', waiting: '等待画面', attention: '处理事件', stopping: '正在停止', error: '运行异常', unavailable: '尚未就绪' }
const active = computed(() => ['starting', 'running', 'waiting', 'attention', 'stopping'].includes(status.value.phase))
const label = computed(() => labels[status.value.phase])
const lastSeen = computed(() => status.value.snapshot?.at ? new Date(status.value.snapshot.at).toLocaleString('zh-CN', { hour12: false }) : '尚无游戏记录')
const orderLabels:Record<StellarisOrderPhase,string>={submitted:'已提交',queued:'排队中',executing:'执行中',completed:'已确认完成',failed:'明确失败',expired_unknown:'超时未知'}
const campaignPhaseLabels:Record<string,string>={prepare:'备战',muster:'集结',declare:'核对开战',combat:'进攻与占领',peace:'争取和平结果',recover:'战后恢复',completed:'已确认本战结果',terminated:'已收束本战'}
const commandLabels:Record<string,string>={colonize:'殖民',build_district:'建设区划',build_building:'建设建筑',upgrade_building:'升级建筑',clear_blocker:'清除障碍',set_district_zone:'设立特区',build_ship:'造船',reinforce_fleet:'舰队增援',move_fleet:'舰队移动',survey:'调查星系',build_outpost:'建设哨站',build_stations:'建设资源站',upgrade_fleet:'舰队升级',follow_fleet:'舰队跟随',diplomacy:'外交提议',respond_diplomacy:'外交回应',select_research:'选择科研'}
const quality=computed(()=>status.value.snapshot?.quality)
const qualityReasons:Record<string,string>={missing:'暂无 OBS 观测',cross_session:'当前游戏局尚无对应观测',stale:'OBS 观测已过期',not_configured:'本机 OBS 观测未配置',invalid_config:'OBS 观测配置不可用',unavailable:'暂时无法读取 OBS',authentication:'OBS 认证不可用',invalid_response:'OBS 观测无效',request_failed:'OBS 状态读取失败'}
const qualityLabel=computed(()=>quality.value?.status==='observed'?'已读取本机 OBS':qualityReasons[quality.value?.reason||'missing']||'OBS 状态未知')
const observedTime=(at?:number)=>at?new Date(at).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'未知'
async function refresh() {
  if (!api || loading.value || busy.value) return
  loading.value = true
  try { const next = await api.getStatus(); if (mounted) status.value = next }
  catch { if (mounted) { notice.value = '暂时无法读取状态，请稍后刷新。'; error.value = true } }
  finally { loading.value = false }
}
async function changeSurvey(event:Event){
  if(!api?.setHybridSurvey||busy.value||active.value)return
  const enabled=(event.target as HTMLInputElement).checked
  busy.value=true;notice.value='';error.value=false
  try{const result=await api.setHybridSurvey(enabled);if(mounted){status.value=result.status;notice.value=result.message||'';error.value=!result.ok}}
  catch{notice.value='调查模式保存失败，请刷新后重试。';error.value=true}
  finally{busy.value=false;await refresh()}
}
async function changeCountryAI(event:Event){
  if(!api?.setNativeCountryAI||busy.value||active.value)return
  busy.value=true;notice.value='';error.value=false
  try{const result=await api.setNativeCountryAI((event.target as HTMLInputElement).checked);if(mounted){status.value=result.status;notice.value=result.message||'';error.value=!result.ok}}
  catch{notice.value='国家 AI 模式保存失败，请刷新后重试。';error.value=true}
  finally{busy.value=false;await refresh()}
}
async function run(action: 'start' | 'stop' | 'chooseProject') {
  if (!api || busy.value) return
  if (action === 'start' && !status.value.canStart || action === 'stop' && !status.value.canStop) return
  busy.value = true; notice.value = ''; error.value = false
  try {
    const result = await api[action]()
    if (!mounted) return
    status.value = result.status; notice.value = result.message || ''; error.value = !result.ok
  } catch { if (mounted) { notice.value = '操作未完成，请刷新状态后再试。'; error.value = true } }
  finally { busy.value = false; if (mounted) await refresh() }
}
onMounted(async () => {
  mounted = true
  if (!api) { status.value = { phase: 'unavailable', message: '这里是界面预览，请使用「群星控制器大肥鱼.exe」连接本机控制器。', canStart: false, canStop: false }; return }
  await refresh(); if (mounted) timer = setInterval(() => void refresh(), 2000)
  if(api.presentationMode)directorMode.value=await api.presentationMode()
})
onUnmounted(() => { mounted = false; clearInterval(timer) })
</script>

<template>
  <div class="dsh-desktop" data-testid="dsh-desktop">
    <header class="topbar"><div class="wordmark"><span class="brand-icon"><Icon name="fish" :size="23"/></span><div><h1>群星控制器大肥鱼</h1><p>FEIYU STELLARIS CONTROLLER</p></div></div><div class="manual-mode"><span></span>手动接管 · 不自动打开游戏</div></header>
    <main>
      <nav class="workspace-tabs" aria-label="桌面功能"><button :class="{ selected: view === 'game' }" @click="view = 'game'">群星控制</button><button :class="{ selected: view === 'live' }" @click="view = 'live'">B 站直播</button><button :class="{ selected: view === 'ai' }" @click="view = 'ai'">AI 中枢</button><button :class="{selected:view==='speech'}" @click="view='speech'">舰长语音与聊天</button></nav>
      <StellarisBroadcast v-if="view === 'live'" :api="api?.live" :music="api?.music"/>
      <StellarisAi v-if="view === 'ai'" :api="api?.ai"/>
      <StellarisSpeech v-if="view === 'speech'" :api="api?.speech" :chat-api="api?.ai"/>
      <div v-show="view === 'game'">
      <div class="workspace-label"><span>STELLARIS</span><i></i>群星控制台</div>
      <section class="control-panel" aria-label="群星 DSH 控制器">
        <div class="control-main">
          <div :class="['state-pill', status.phase]" role="status" data-testid="controller-phase"><i></i>{{ label }}</div>
          <h2>{{ active ? '肥鱼正在星海值班。' : '下一段星海旅程，等你开场。' }}</h2>
          <p class="status-message" data-testid="controller-message">{{ status.message }}</p>
          <div class="actions">
            <button class="primary" :disabled="busy || !status.canStart" @click="run('start')"><Icon name="play" :size="18"/>{{ busy && !status.canStop ? '正在处理…' : '启动大肥鱼' }}</button>
            <button class="secondary" :disabled="busy || !status.canStop" @click="run('stop')"><Icon name="stop" :size="17"/>停止并接管</button>
            <button class="refresh" :disabled="busy || loading || !api" aria-label="刷新运行状态" title="刷新运行状态" @click="refresh"><Icon name="refresh" :size="18"/></button>
          </div>
          <div class="hybrid-mode" data-testid="hybrid-settings">
            <label><input type="checkbox" :checked="status.hybrid?.nativeCountryAIEnabled === true" :disabled="busy || active || !api?.setNativeCountryAI || status.localTest" @change="changeCountryAI">原生国家 AI 托管：全面日常运营</label>
            <p v-if="status.hybrid?.nativeCountryAIEnabled">原生AI自己经营、扩张和调兵；大肥鱼用方针引导，仅决定宣战、议和和外交。停止会关闭原生AI。</p>
            <button v-if="status.hybrid?.nativeCountryAIEnabled" class="secondary" :disabled="!api?.presentationMode" @click="changeDirector">{{directorMode==='auto'?'自动导播中 · 点击固定当前画面':'画面已固定 · 点击恢复自动导播'}}</button>
            <p v-if="status.director">{{!status.director.active?'导播已停止':directorMode==='fixed'?'画面已固定':`当前展示：${status.director.topic}`}} · {{!status.director.active?'星图自动展示未运行':directorMode==='fixed'?'恢复自动后优先补逾期星图':status.director.galaxyOverdue?'银河全图待展示':`距下次银河全图最多 ${status.director.galaxyRemainingSeconds} 秒`}}</p>
            <p v-if="status.director?.blocked==='event_window'">事件窗口优先，处理后补展示。</p>
            <p v-if="status.director?.blocked==='presentation_failed'">展示暂不可用，原生经营继续；稍后重试。</p>
            <p v-if="status.director?.blocked==='configuration_invalid'">导播配置异常，画面保持固定；可点击恢复自动重新保存。</p>
            <template v-else>
              <label><input type="checkbox" :checked="status.hybrid?.surveyEnabled === true" :disabled="busy || active || !api?.setHybridSurvey || status.localTest" @change="changeSurvey">旧模式：混合调查</label>
              <p>{{ status.hybrid?.configurationKnown ? (status.hybrid.surveyEnabled ? '仅把调查交给原生自动调查，其他操作由大肥鱼安排。' : '普通模式：操作由大肥鱼逐项安排。') : '控制模式配置尚未确认。' }}运行前可更改。</p>
            </template>
          </div>
          <div class="launch-note"><Icon name="shield" :size="15"/><span>先手动打开群星并载入测试存档，再启动大肥鱼。</span></div>
        </div>
        <div class="captain-portrait" aria-hidden="true"><div class="orbit a"></div><div class="orbit b"></div><span class="cross c1">＋</span><span class="cross c2">＋</span><img :src="captain" alt=""><span class="portrait-label">FEIYU / READY FOR THE STARS</span></div>
      </section>
      <div v-if="notice" :class="['notice', { failed: error }]" role="alert">{{ notice }}</div>
      <section class="snapshot-panel" aria-label="最近游戏记录">
        <div class="section-heading"><h3><Icon name="dashboard" :size="17"/>{{ active ? '最近游戏快照' : '上次游戏记录' }}</h3><span>{{ lastSeen }}</span></div>
        <div class="metrics">
          <div class="metric"><span>星历</span><strong class="date">{{ status.snapshot?.date || '—' }}</strong><small>游戏内日期</small></div>
          <div class="metric"><span>本轮指令</span><strong>{{ status.snapshot?.orders ?? '—' }}<em v-if="status.snapshot">次</em></strong><small v-if="status.snapshot">{{ status.snapshot.verified }} 次有游戏回读</small><small v-else>启动后更新</small></div>
          <div class="metric"><span>现役舰船</span><strong>{{ status.snapshot?.ships ?? '—' }}<em v-if="status.snapshot">艘</em></strong><small>最近快照中的军舰</small></div>
          <div class="metric"><span>殖民地</span><strong>{{ status.snapshot?.colonies ?? '—' }}<em v-if="status.snapshot">颗</em></strong><small v-if="status.snapshot?.alloysNet !== undefined">合金月净产 {{ status.snapshot.alloysNet >= 0 ? '+' : '' }}{{ status.snapshot.alloysNet.toFixed(1) }}</small><small v-else>经济与建设同步经营</small></div>
        </div>
      </section>
      <section v-if="status.snapshot?.campaign" class="snapshot-panel" aria-label="战役推进" data-testid="campaign-control">
        <div class="section-heading"><h3>战役推进</h3><span>{{ status.snapshot.campaign.active ? '持续推进中' : '最近战役记录' }}</span></div>
        <p>{{ campaignPhaseLabels[status.snapshot.campaign.phase] ?? '状态待核对' }} · {{ status.snapshot.campaign.goal }}</p>
        <p>战斗{{ status.snapshot.campaign.battleObserved ? '已观察' : '待确认' }} · 占领{{ status.snapshot.campaign.occupationObserved ? '已观察' : '待确认' }} · {{ status.snapshot.campaign.gainKnown ? `已确认获得 ${status.snapshot.campaign.gainedSystems ?? 0} 个星系、${status.snapshot.campaign.gainedPlanets} 颗殖民地` : '战果仍需确认' }}</p>
        <p v-if="status.snapshot.campaign.needsAttention">{{ status.snapshot.campaign.needsAttention }}</p>
        <p v-if="status.snapshot.campaign.nextReviewRequired">本战恢复后继续评估下一目标。</p>
        <p class="observation-note">最近确认的战役状态；提交命令和提出议和不代表胜利或领土已取得。</p>
      </section>
      <section v-if="status.snapshot?.countryAI" class="snapshot-panel" aria-label="国家 AI 控制权" data-testid="country-ai-control">
        <div class="section-heading"><h3>国家 AI 控制权</h3><span>{{ status.snapshot.countryAI.historical ? '上轮记录' : ({native:'原生持权',human:'已接管',unconfirmed:'待核对'}[status.snapshot.countryAI.owner]) }}</span></div>
        <p>{{ status.snapshot.countryAI.message }}</p>
        <p>托管范围：{{ status.snapshot.countryAI.domains.map(d=>d==='native_country_operations'?'全部日常运营（保留外交决定）':d==='research'?'科研':'殖民地建设').join('、') || '等待委派' }}</p>
        <p v-if="status.snapshot.countryAI.steering">当前方针：{{ status.snapshot.countryAI.steering.economyFocus }} / {{ status.snapshot.countryAI.steering.expansionStance }} / {{ status.snapshot.countryAI.steering.militaryStance }}</p>
        <p v-if="status.snapshot.countryAI.lastStrategyReason">最近战略：{{ status.snapshot.countryAI.lastStrategyReason }}</p>
        <ul v-if="status.snapshot.countryAI.goals?.length" aria-label="战略目标与进度" data-testid="strategy-goals">
          <li v-for="(goal,index) in status.snapshot.countryAI.goals" :key="index">
            {{ goal.label }} {{ goal.current }} / {{ goal.target }} · 截至 {{ goal.byDate }} · {{ goal.status }}{{ goal.progress ? `（${goal.progress}）` : '' }}
          </li>
        </ul>
        <p>保留命令拦截：{{ status.snapshot.countryAI.blockedCommands ?? 0 }}</p>
        <p v-if="status.snapshot.countryAI.reviewNoDecision">本次战略复查模型未给出决定，原生 AI 继续运营，下次复查再试。</p>
        <p v-if="status.snapshot.countryAI.reviewDue">已到战略复查点；大肥鱼可调整方针或做保留决定，原生AI继续运营。</p>
      </section>
      <section v-if="status.snapshot?.survey" class="snapshot-panel" aria-label="调查分工" data-testid="survey-control">
        <div class="section-heading"><h3>调查分工</h3><span>最近一次回读</span></div>
        <p>已委派 {{ status.snapshot.survey.assigned }} 艘 · 正在调查 {{ status.snapshot.survey.working }} 艘 · 控制权待核对 {{ status.snapshot.survey.uncertain }} 艘</p>
        <p>大肥鱼保留关键决策；原生自动化执行例行调查。待命不计为正在调查。</p>
      </section>
      <section v-if="status.snapshot?.work" class="snapshot-panel" aria-label="贸易与星球托管" data-testid="hybrid-work">
        <div class="section-heading"><h3>贸易与星球托管</h3><span>{{ status.snapshot.work.stopped ? '控制器已停止' : '本会话控制记录' }}</span></div>
        <p>月度订单已登记 {{ status.snapshot.work.monthlyRegistered }} 条 · 待核对 {{ status.snapshot.work.monthlyUncertain }} 条</p>
        <p v-if="status.snapshot.work.monthlyRecoveryRequired">旧会话有 {{ status.snapshot.work.monthlyRecoveryRequired }} 条月度记录需要核对收回；旧计划未恢复，相关预算暂不释放。</p>
        <p v-if="status.snapshot.work.monthlyLifecyclePilotEnabled">月度库存/期限条件：有条件订单 {{ status.snapshot.work.monthlyConditional ?? 0 }} 条 · 条件结束并确认收回 {{ status.snapshot.work.monthlyPolicyCompleted ?? 0 }} 条；控制器按实际回读复查并撤单。</p>
        <p>本地住房托管 {{ status.snapshot.work.localColonies }} 颗 · 暂停派发 {{ status.snapshot.work.colonyPaused ?? 0 }} 颗 · 已排施工 {{ status.snapshot.work.colonyQueued }} 颗 · 需要检查 {{ status.snapshot.work.colonyBlocked }} 颗</p>
        <p v-if="status.snapshot.work.upgradePilotEnabled || status.snapshot.work.upgradeColonies || status.snapshot.work.upgradeBlocked">预算建筑升级 {{ status.snapshot.work.upgradeColonies ?? 0 }} 颗 · 已排施工 {{ status.snapshot.work.upgradeQueued ?? 0 }} 颗 · 需要检查 {{ status.snapshot.work.upgradeBlocked ?? 0 }} 颗；按合法候选及本轮预算派发。</p>
        <p v-if="status.snapshot.work.colonyRetainedQueues || status.snapshot.work.upgradeRetainedQueues">收回后保留的施工记录：住房 {{ status.snapshot.work.colonyRetainedQueues ?? 0 }} 颗 · 升级 {{ status.snapshot.work.upgradeRetainedQueues ?? 0 }} 颗；仅为停止派发前的最后确认，后续完工请在游戏中核对。</p>
        <p class="observation-note">登记不等于逐笔成交确认。星球托管按预算使用普通建设与升级命令；收回后保留已排施工，不自动取消或退款。</p>
      </section>
      <section class="snapshot-panel tracking-panel" aria-label="异步操作追踪" data-testid="order-tracking">
        <div class="section-heading"><h3>异步操作进展</h3><span>只追踪支持的异步操作</span></div>
        <p class="observation-note">接受回执和排队不等于完成；超时仍未知的操作不会自动重放。</p>
        <div v-if="status.snapshot?.orderTracking" class="tracking-counts"><span v-for="(text,key) in orderLabels" :key="key">{{ text }} <b>{{ status.snapshot.orderTracking.counts[key] ?? '未知' }}</b></span></div>
        <p v-else class="observation-note">暂无异步操作追踪数据。</p>
        <ul v-if="status.snapshot?.orderTracking?.recent.length" class="tracking-list"><li v-for="row in [...status.snapshot.orderTracking.recent].reverse()" :key="row.id"><strong>{{ commandLabels[row.command] || '游戏操作' }}</strong><span>{{ orderLabels[row.status] }}</span><small>{{ observedTime(row.updatedAt) }}</small><p v-if="row.reason">{{ row.reason }}</p></li></ul>
      </section>
      <section class="snapshot-panel" aria-label="直播质量观测" data-testid="broadcast-quality">
        <div class="section-heading"><h3>直播质量观测</h3><span>{{ qualityLabel }} · {{ observedTime(quality?.at) }}</span></div>
        <div v-if="quality?.status==='observed'" class="quality-metrics">
          <span>OBS 帧率 <b>{{ quality.stats?.activeFps?.toFixed(1) ?? '未知' }}</b></span>
          <span>渲染跳帧 <b>{{ quality.stats?.renderSkippedFrames ?? '未知' }} / {{ quality.stats?.renderTotalFrames ?? '未知' }}</b></span>
          <span>编码跳帧 <b>{{ quality.stats?.outputSkippedFrames ?? '未知' }} / {{ quality.stats?.outputTotalFrames ?? '未知' }}</b></span>
          <span>本机推流 <b>{{ quality.stream?.reconnecting ? '正在重连' : quality.stream?.active ? '已开启' : '未开启' }}</b></span>
          <span>本机录制 <b>{{ quality.record?.active ? '已开启' : '未开启' }}</b></span>
        </div>
        <p v-else class="observation-note">暂无当前局的新鲜 OBS 数据，不能据此判断整场推流质量。</p>
        <p class="observation-note">音轨隔离：未测量 · 观众端延迟：未测量。OBS 本机统计不能代替平台观众侧验收。</p>
      </section>
      <section class="connection-panel"><div><h3><Icon name="link" :size="16"/>本机控制器</h3><p :title="status.projectDirectory">{{ status.projectDirectory || '尚未选择控制器目录' }}</p></div><button class="text-button" :disabled="busy || active || !api || status.localTest" @click="run('chooseProject')">更换目录<Icon name="arrow" :size="16"/></button></section>
      <details class="engine-details"><summary>首次使用：配置游戏 AI 密钥</summary><p>填写你自己的 DeepSeek 官方密钥，保存后手动打开群星并载入单人存档。密钥仅在本机加密保存。</p><form @submit.prevent="saveGameKey" style="display:flex;gap:12px;margin-top:12px"><input v-model="gameKey" type="password" autocomplete="off" aria-label="游戏 DeepSeek 密钥" placeholder="sk-…" style="flex:1;padding:9px"><button class="secondary" :disabled="busy || active || !api?.saveGameKey || status.localTest || !gameKey.trim()">保存游戏密钥</button></form></details>
      <details class="engine-details"><summary>{{ status.engine ? `官方 DSH · ${status.engine.version}` : 'DSH 引擎详情' }}<span>{{ status.engine?.pid ? `PID ${status.engine.pid}` : '未运行' }}</span></summary><p>桌面控制台由大肥鱼项目提供；实际运行引擎为官方 DeepSeek Harness，使用命令行 headless 模式。</p><code v-if="status.engine">{{ status.engine.entrypoint }}</code><p v-if="!status.engine">{{ status.localTest ? '独立测试未读取本机引擎。' : '尚未检测到本机 DSH 安装信息。' }}</p></details>
      </div>
      <footer><span><i></i>状态在本机读取，不额外调用 AI</span><span>FEIYU / 0.4.0</span></footer>
    </main>
  </div>
</template>

<style>
:root{font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;font-size:14px;color:#244568;background:#eef5ff;color-scheme:light;font-synthesis:none;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0}button{font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;border:0;transition:background .15s,box-shadow .15s}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible{outline:3px solid #70b9f4;outline-offset:3px}h1,h2,h3,p{margin:0}.dsh-desktop{min-height:100vh;background:linear-gradient(115deg,#f5faff,#eaf3ff);position:relative;overflow:hidden}.dsh-desktop:before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(#91b6de0c 1px,transparent 1px),linear-gradient(90deg,#91b6de0c 1px,transparent 1px);background-size:26px 26px}.topbar{position:relative;height:99px;padding:0 39px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8e7f6;background:#ffffff99}.wordmark{display:flex;align-items:center;gap:13px}.brand-icon{display:grid;place-items:center;height:43px;width:43px;border:1px solid #c2ddf3;border-radius:12px;background:#e8f4ff;color:#328ad0}.wordmark h1{font-size:23px;letter-spacing:2px;color:#1d4678}.wordmark h1 span{font:500 19px Consolas,monospace;letter-spacing:1px;color:#5590c3;margin-left:5px}.wordmark p{font:9px Consolas,monospace;color:#91aac4;letter-spacing:2px;margin-top:6px}.manual-mode{display:flex;align-items:center;gap:9px;font-size:12px;color:#6e8aaa}.manual-mode span{height:5px;width:5px;border:1px solid #7eaad3;background:#eef7ff}main{max-width:1170px;margin:auto;padding:25px 39px 17px;position:relative}.workspace-label{display:flex;gap:13px;align-items:center;font-size:12px;letter-spacing:2px;color:#6d90b2;margin-bottom:15px}.workspace-label span{font:11px Consolas,monospace;letter-spacing:3px;color:#92abc5}.workspace-label i{height:10px;width:1px;background:#bdcfe0}.control-panel{position:relative;display:flex;min-height:267px;background:linear-gradient(125deg,#fff,#f8fcff 65%,#e7f2ff);border:1px solid #bfd8ee;border-radius:16px;box-shadow:0 8px 30px #498ac10b;overflow:hidden}.control-panel:before{content:"";position:absolute;left:29px;top:0;width:61px;height:3px;background:#5a9ed7}.control-main{flex:1;min-width:0;padding:28px 0 25px 30px;position:relative;z-index:1}.state-pill{display:inline-flex;gap:7px;align-items:center;font-size:12px;border-radius:5px;background:#edf3fa;color:#7793ad;padding:5px 10px}.state-pill i{width:5px;height:5px;border-radius:50%;background:#8ca7bc}.state-pill.running,.state-pill.attention{background:#e7f5f2;color:#298f88}.state-pill.running i,.state-pill.attention i{background:#43a69a}.state-pill.starting,.state-pill.stopping,.state-pill.waiting{background:#fff4dc;color:#a28538}.state-pill.error{background:#fff0ed;color:#c06e5d}.control-main h2{font-size:25px;letter-spacing:.5px;font-weight:600;color:#234e7c;margin-top:17px}.status-message{font-size:13px;line-height:1.8;color:#7190ae;margin-top:9px;max-width:555px;min-height:24px}.actions{display:flex;gap:11px;align-items:center;margin-top:23px}.primary,.secondary{height:42px;padding:0 23px;border-radius:7px;font-size:14px}.primary{background:#398ddd;color:#fff;box-shadow:0 4px 12px #398ddd25}.primary:hover:not(:disabled){background:#267dce}.secondary{background:#f9fcff;color:#5684b0;border:1px solid #c8def0}.secondary:hover:not(:disabled){background:#eaf5ff}.refresh{height:37px;width:37px;border-radius:7px;color:#86a4be;background:transparent}.refresh:hover:not(:disabled){background:#e8f2fc}.launch-note{display:flex;gap:7px;align-items:center;font-size:11px;color:#91a6b9;margin-top:16px}.captain-portrait{position:relative;flex:none;width:266px;display:flex;align-items:center;justify-content:center;isolation:isolate}.captain-portrait img{position:relative;width:222px;height:246px;object-fit:contain;margin-top:-2px;filter:drop-shadow(0 6px 8px #406f9f15)}.orbit{position:absolute;border:1px solid #cadff2;border-radius:50%;width:219px;height:219px;z-index:-1}.orbit.b{width:176px;height:176px;background:#e4f2ff77;border-style:dashed}.cross{position:absolute;color:#a7c6e0;font-size:16px}.c1{right:25px;top:30px}.c2{left:14px;bottom:38px}.portrait-label{position:absolute;bottom:10px;font:8px Consolas,monospace;letter-spacing:1.5px;color:#a0b7cc}.snapshot-panel{background:#ffffffb3;border:1px solid #d1e1f0;border-radius:12px;margin-top:20px;padding:19px 23px 20px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-heading h3,.connection-panel h3{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:#5b7f9f}.section-heading>span{font-size:10px;color:#9aafc2}.metrics{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;margin-top:21px}.metric{padding-left:24px;border-left:1px solid #e1edf6;min-width:0}.metric:first-child{padding-left:0;border:0}.metric>span{display:block;font-size:11px;color:#8aa5bf;letter-spacing:1px}.metric strong{display:block;font:500 29px Consolas,monospace;letter-spacing:1px;color:#2f608c;margin:8px 0}.metric strong.date{font-size:23px;line-height:34px}.metric em{font:11px "Microsoft YaHei",sans-serif;color:#87a5be;letter-spacing:0;margin-left:6px;font-style:normal}.metric small{font-size:10px;color:#9cb0c2}.connection-panel{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:18px;border:1px solid #d3e4f3;border-radius:10px;padding:15px 19px;background:#eff7ff99}.connection-panel>div{min-width:0}.connection-panel p{font:11px Consolas,"Microsoft YaHei",sans-serif;color:#94a9bb;margin-top:7px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.text-button{flex:none;background:transparent;color:#6893b5;font-size:11px;gap:6px;padding:8px 0 8px 12px}.notice{padding:11px 16px;background:#e7f5ef;color:#498878;font-size:12px;border-radius:7px;margin-top:14px;border:1px solid #cce7dd}.notice.failed{color:#b77750;background:#fff5e9;border-color:#f1dec2}footer{display:flex;justify-content:space-between;gap:16px;color:#a0b5c7;font-size:10px;margin-top:17px}footer span:first-child{display:flex;align-items:center;gap:7px}footer i{width:4px;height:4px;border-radius:50%;background:#9bbcd4}footer span:last-child{font-family:Consolas,monospace;letter-spacing:1.5px}@media(max-width:960px){.topbar{padding:0 27px}main{padding:22px 27px 16px}.captain-portrait{width:213px}.captain-portrait img{width:198px}.orbit{width:190px;height:190px}.control-main{padding-left:25px}.control-main h2{font-size:22px}.status-message{max-width:450px}.primary,.secondary{padding:0 18px}}
</style>
<style>.observation-note{color:#7893ad;font-size:11px;line-height:1.8;margin-top:10px}.tracking-counts,.quality-metrics{display:flex;flex-wrap:wrap;gap:10px 20px;color:#6283a1;font-size:12px;margin-top:14px}.tracking-counts b,.quality-metrics b{color:#305f89;margin-left:5px}.tracking-list{list-style:none;padding:0;margin:13px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:8px}.tracking-list li{border:1px solid #dfebf4;border-radius:7px;padding:10px;font-size:11px;color:#7893ad}.tracking-list strong{color:#3d6b94;margin-right:10px}.tracking-list small{float:right;color:#95a9bc}.tracking-list p{margin-top:5px;line-height:1.6}@media(max-width:700px){.tracking-list{grid-template-columns:1fr}}</style>
<style>.workspace-tabs{display:flex;gap:5px;margin-bottom:24px;border-bottom:1px solid #ccdeee;padding-bottom:10px}.workspace-tabs button{padding:8px 17px;border-radius:6px;background:transparent;color:#86a2bd;font-size:12px}.workspace-tabs button.selected{color:#337db7;background:#dceeff}</style>
<style>.engine-details{margin-top:13px;border:1px solid #d8e6f2;border-radius:8px;padding:10px 14px;background:#ffffff77;color:#7e9ab4;font-size:11px}.engine-details summary{cursor:pointer;list-style:inside}.engine-details summary span{float:right;color:#9bb0c2;font:11px Consolas,"Microsoft YaHei",sans-serif}.engine-details p{margin-top:10px;line-height:1.8}.engine-details code{display:block;overflow-wrap:anywhere;font-size:10px;margin-top:7px;color:#96abc0}</style>

<style scoped>
.hybrid-mode{margin:16px 0;max-width:620px}.hybrid-mode label{display:flex;align-items:center;gap:9px;font-weight:600}.hybrid-mode input{accent-color:#42b7a3}.hybrid-mode p{font-size:12px;line-height:1.7;opacity:.75;margin:7px 0}
</style>
