/*
 * 大肥鱼 DSH 的 AI 中枢主进程服务。
 *
 * - 配置（服务商、角色、场控参数、黑板）存 userData/ai-hub.json；密钥单独用系统安全存储加密存 ai-keys.enc.json，
 *   视图里只有“是否已保存”，密钥正文永不离开主进程、不进日志。
 * - 读取群星控制器检查点给参谋；场控说的话写入 .local/commentary/host-replies.jsonl，并由本机 127.0.0.1 字幕页显示；
 *   参谋的方针写入 .local/commentary/strategy-directive.json，供控制器读取。不会把弹幕交给游戏命令或 Shell。
 * - 独立测试模式不联网、不读真实目录、不启动场控。
 */
import { createServer, type Server } from 'node:http'
import { appendFile, mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import type { AiAgentConfig, AiHubAction, AiHubResult, AiHubView, AiProvider, AiProviderKind,AiAudienceQueryBus } from '../../../packages/shared/src/ai'
import type { LiveEvent } from '../../../packages/shared/src/index'
import { AI_PROVIDER_PRESETS, aiFailure, chat, listModels, redact, validateBaseUrl, type AiMessage, type Fetch } from '../../../packages/core/src/ai-providers'
import { createDirector, DEFAULT_DIRECTOR, normalizeDirector, type Directive, type Spoken } from '../../../packages/core/src/ai-director'
import { audienceGuidance, clip, createBlackboard, restoreBlackboard } from '../../../packages/core/src/ai-blackboard'
import {safePublicGameText} from '../../../packages/core/src/public-game-text'

export interface SecretCodec { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
interface Options {
  dataDirectory: string
  disabled?: boolean
  basic?: boolean
  getProject(): Promise<string | undefined>
  secrets: SecretCodec
  fetch?: Fetch
  copy?(text: string): void
  now?: () => number
  /** 0 picks a free port (tests); undefined uses the fixed overlay port so OBS keeps working across launches. */
  overlayPort?: number
  playbackOrigin?: string
  tickMs?: number
  onSpoken?(lines:Spoken[]):void
}

const OVERLAY_PORT = 17659
const MAX_AGENTS = 10
const KINDS: AiProviderKind[] = ['openai', 'gemini', 'anthropic']
const ROLES = ['host', 'strategist', 'player'] as const

function defaults(basic = false) {
  const deepseek: AiProvider = { id: 'deepseek', name: 'DeepSeek', kind: 'openai', preset: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, models: [] }
  const agents: AiAgentConfig[] = [
    { id: 'host', role: 'host', label: '场控老师', enabled: true, providerId: '', model: '', temperature: 1, maxTokens: 600, thinking: false },
    { id: 'strategist', role: 'strategist', label: '游戏参谋', enabled: true, providerId: 'deepseek', model: 'deepseek-flash', temperature: 0.4, maxTokens: 1200, thinking: false },
  ]
  return { providers: [deepseek], agents: basic ? [{ ...agents[0]!, label: '大肥鱼', providerId: 'deepseek', model: 'deepseek-flash' }] : agents, director: { ...DEFAULT_DIRECTOR }, blackboard: createBlackboard() }
}
const safeId = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : ''
function normalizeProvider(value: any, previous?: AiProvider): AiProvider {
  const id = safeId(value?.id)
  if (!id) throw new Error('服务商编号无效。')
  const name = clip(value?.name, 40)
  if (!name) throw new Error('请填写服务商名称。')
  const kind: AiProviderKind = KINDS.includes(value?.kind) ? value.kind : 'openai'
  const preset = AI_PROVIDER_PRESETS.some(p => p.id === value?.preset) ? value.preset : 'custom'
  const baseUrl = validateBaseUrl(String(value?.baseUrl || ''))
  // A changed address or protocol means the cached catalogue may belong to someone else.
  const keepModels = previous && previous.baseUrl === baseUrl && previous.kind === kind
  return { id, name, kind, preset, baseUrl, enabled: value?.enabled !== false, models: keepModels ? previous.models : [], ...(keepModels && previous.modelsFetchedAt ? { modelsFetchedAt: previous.modelsFetchedAt } : {}) }
}
function normalizeAgent(value: any, providers: AiProvider[]): AiAgentConfig {
  const role = ROLES.includes(value?.role) ? value.role : 'player'
  const id = safeId(value?.id) || `${role}-${randomUUID().slice(0, 8)}`
  const providerId = providers.some(p => p.id === value?.providerId) ? value.providerId : ''
  const n = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
  return { id, role, label: clip(value?.label, 20) || (role === 'host' ? '场控老师' : role === 'strategist' ? '游戏参谋' : '对战席位'), enabled: value?.enabled !== false,
    providerId, model: clip(value?.model, 120), temperature: Math.round(n(value?.temperature, 0, 2, 0.8) * 100) / 100, maxTokens: Math.round(n(value?.maxTokens, 64, 32000, 800)), thinking: !!value?.thinking,
    ...(role === 'player' ? { empire: clip(value?.empire, 40) } : {}) }
}

function overlayPage(playbackOrigin='http://127.0.0.1:17661') {
  const source=new URL(playbackOrigin)
  if(source.protocol!=='http:'||source.hostname!=='127.0.0.1'||source.username||source.password||source.pathname!=='/'||source.search||source.hash)throw Error('字幕只连接本机语音状态。')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>大肥鱼 · 场控字幕</title><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif}
#lines{position:fixed;left:48px;right:48px;bottom:40px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.line{max-width:1100px;padding:12px 20px;border-radius:14px;background:rgba(18,46,84,.82);color:#fff;font-size:30px;line-height:1.45;box-shadow:0 4px 18px rgba(0,0,0,.25);border-left:5px solid #6ab8ff}
.line b{color:#9fd3ff;font-weight:600;margin-right:10px}.line.old{opacity:.55;font-size:24px}
@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
</style></head><body><div id="lines"></div><script>
const box=document.getElementById('lines'),retired=new Set();let sessionId='',sequence=-1,lastAt=0;
function clear(){box.replaceChildren();box.dataset.playbackId='';box.dataset.playbackStatus='idle'}
const stream=new EventSource(${JSON.stringify(source.origin+'/playback/events')});
stream.onmessage=event=>{try{const s=JSON.parse(event.data);if(s.version!==1||typeof s.sessionId!=='string'||retired.has(s.sessionId)||!Number.isSafeInteger(s.sequence))return;
if(s.sessionId!==sessionId){if(sessionId)retired.add(sessionId);sessionId=s.sessionId;sequence=-1}if(s.sequence<sequence)return;sequence=s.sequence;lastAt=Date.now();clear();box.dataset.playbackSession=sessionId;box.dataset.playbackSequence=String(sequence);
if(s.enabled&&s.status==='playing'&&typeof s.id==='string'&&typeof s.text==='string'){const line=document.createElement('div');line.className='line';line.textContent=s.text.slice(0,140);box.append(line);box.dataset.playbackId=s.id;box.dataset.playbackStatus='playing'}
}catch{}};stream.onerror=clear;setInterval(()=>{if(Date.now()-lastAt>=6000)clear()},250);window.addEventListener('beforeunload',()=>stream.close());clear();
</script></body></html>`
}

export function createStellarisAi(options: Options) {
  const now = options.now || Date.now
  const configPath = join(options.dataDirectory, 'ai-hub.json'), keyPath = join(options.dataDirectory, 'ai-keys.enc.json')
  const fetcher: Fetch = options.fetch || ((url, init) => fetch(url, { ...init, redirect: 'error' }) as any)
  let config = defaults(options.basic), keys: Record<string, string> = {}, saveTimer: ReturnType<typeof setTimeout> | undefined, ticker: ReturnType<typeof setInterval> | undefined
  let server: Server | undefined, overlayUrl: string | undefined, spoken: Spoken[] = [], disposed = false, ticking = false, busy = false
  let hostWake:ReturnType<typeof setTimeout>|undefined,hostWakeAt=0,hostWakeGeneration=0
  let saves = Promise.resolve(), keySaves = Promise.resolve(), audits = Promise.resolve(), directives = Promise.resolve()
  let querySaves=Promise.resolve(),deliverySaves=Promise.resolve(),querySignature=''
  let delivered:Spoken[]=[]
  const deliveryPath=join(options.dataDirectory,'audience-answer-delivery.json')

  if (!options.disabled) {
    try {
      const saved = JSON.parse(readFileSync(configPath, 'utf8'))
      const providers: AiProvider[] = []
      for (const p of Array.isArray(saved?.providers) ? saved.providers : []) { try { if (!providers.some(x => x.id === p.id)) providers.push({ ...normalizeProvider(p), models: Array.isArray(p.models) ? p.models.slice(0, 2000).filter((m: any) => typeof m?.id === 'string') : [], ...(p.modelsFetchedAt ? { modelsFetchedAt: Number(p.modelsFetchedAt) } : {}) }) } catch { /* Skip one broken entry, keep the rest. */ } }
      const agents = (Array.isArray(saved?.agents) ? saved.agents : []).slice(0, MAX_AGENTS).map((a: any) => normalizeAgent(a, providers))
      config = { providers, agents: ensureRoles(agents), director: normalizeDirector(saved?.director), blackboard: restoreBlackboard(saved?.blackboard) }
    } catch { /* First launch: defaults. */ }
    try { const saved = JSON.parse(readFileSync(keyPath, 'utf8')); if (saved && typeof saved === 'object') keys = Object.fromEntries(Object.entries(saved).filter(([k, v]) => safeId(k) && typeof v === 'string')) as Record<string, string> } catch { /* No keys yet. */ }
  }
  if(!options.disabled)try{
    const saved=JSON.parse(readFileSync(deliveryPath,'utf8'))
    if(saved.version===1&&Array.isArray(saved.lines))delivered=saved.lines.slice(-64).filter((l:any)=>typeof l?.id==='string'&&/^answer-q-[a-zA-Z0-9_-]{1,100}$/.test(l.id)&&typeof l.taskId==='string'&&l.id===`answer-${l.taskId}`&&safePublicGameText(l.text,90)===l.text&&Number.isFinite(l.at)&&l.at>=0&&l.at<=now()+5000).map((l:any)=>({id:l.id,taskId:l.taskId,to:safePublicGameText(l.to,20),text:l.text,at:l.at,agentId:safeId(l.agentId)||'host'}))
    // Rebuild the public feed after a crash between durable enqueue and the in-memory update.
    // This does not replay speech or claim OBS/viewer delivery.
    spoken=delivered.filter(l=>now()-l.at<45000).slice(-4)
    for(const task of config.blackboard.audience.tasks??[]){const line=delivered.find(l=>l.taskId===task.id);if(line&&task.status!=='cancelled'){task.status='answered';task.answer=line.text;task.answerId=line.id;task.answeredAt=line.at;task.updatedAt=line.at}}
  }catch{/* First launch or invalid outbox. */}
  function ensureRoles(agents: AiAgentConfig[]) {
    if (options.basic) return [{ ...(agents.find(a => a.role === 'host') || defaults(true).agents[0]!), id: 'host', role: 'host' as const, label: '大肥鱼' }]
    const base = defaults().agents
    for (const role of ['host', 'strategist'] as const) if (!agents.some(a => a.role === role)) agents.unshift({ ...base.find(a => a.role === role)!, providerId: '', model: '' })
    return agents
  }
  const keyOf = (providerId: string) => { const encoded = keys[providerId]; if (!encoded || !options.secrets.available()) return ''; try { return options.secrets.decrypt(encoded) } catch { return '' } }
  function persist() {
    if (options.disabled) return Promise.resolve()
    const saved = JSON.stringify({ providers: config.providers, agents: config.agents, director: config.director, blackboard: director.board }, null, 2)
    const publicState = JSON.stringify(audienceGuidance(director.board, director.status(), now()))
    saves = saves.catch(() => {}).then(async () => {
      await mkdir(options.dataDirectory, { recursive: true })
      await writeFile(configPath + '.tmp', saved, { mode: 0o600 }); await rename(configPath + '.tmp', configPath)
      // This small, allowlisted snapshot bridges the separate stellaris-player overlay.
      // It is display data; the game controller does not read it as instructions.
      const project = await options.getProject(); if (!project) return
      const path = join(project, '.local/commentary/audience-guidance.json')
      await mkdir(join(project, '.local/commentary'), { recursive: true })
      await writeFile(path + '.tmp', publicState, { mode: 0o600 }); await rename(path + '.tmp', path)
    })
    return saves
  }
  function persistKeys() {
    const saved = JSON.stringify(keys)
    keySaves = keySaves.catch(() => {}).then(async () => {
      await mkdir(options.dataDirectory, { recursive: true })
      await writeFile(keyPath + '.tmp', saved, { mode: 0o600 }); await rename(keyPath + '.tmp', keyPath)
    })
    return keySaves
  }
  function scheduleSave() { if (options.disabled || saveTimer) return; saveTimer = setTimeout(() => { saveTimer = undefined; void persist().catch(() => {}) }, 1500); saveTimer.unref?.() }

  async function commentary(file: string) {
    const root = await options.getProject(); if (!root || disposed) return
    await mkdir(join(root, '.local/commentary'), { recursive: true }); return join(root, '.local/commentary', file)
  }
  function audit(row: Record<string,unknown>) {
    if(options.disabled)return
    audits=audits.catch(()=>{}).then(async()=>{const root=await options.getProject();if(!root)return;await mkdir(join(root,'.local/commentary'),{recursive:true});await appendFile(join(root,'.local/commentary/ai-usage.jsonl'),JSON.stringify(row)+'\n')}).catch(()=>{})
  }
  function publishDirective(directive?: Directive) {
    directives=directives.catch(()=>{}).then(async()=>{
      const root=await options.getProject();if(!root||options.disabled)return
      const path=join(root,'.local/commentary/strategy-directive.json')
      if(!directive){
        try{if(JSON.parse(await readFile(path,'utf8')).source==='cyberfish-ai-hub')await unlink(path)}catch{/* Already absent. */}
        return
      }
      await mkdir(join(root,'.local/commentary'),{recursive:true})
      await writeFile(path+'.tmp',JSON.stringify({version:1,source:'cyberfish-ai-hub',...directive},null,2));await rename(path+'.tmp',path)
    })
    return directives
  }
  function publishAudienceQueries(bus:AiAudienceQueryBus) {
    const signature=JSON.stringify({...bus,updatedAt:0})
    querySaves=querySaves.catch(()=>{}).then(async()=>{
      if(options.disabled||signature===querySignature)return
      const root=await options.getProject();if(!root)return
      const path=join(root,'.local/commentary/audience-queries.json')
      if(!bus.requests.length){try{if(JSON.parse(await readFile(path,'utf8')).source==='cyberfish-ai-hub')await unlink(path)}catch{/* Already clear. */}}
      else{await mkdir(join(root,'.local/commentary'),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(bus),{mode:0o600});await rename(path+'.tmp',path)}
      querySignature=signature
    })
    return querySaves
  }
  async function deliver(lines:Spoken[],canPublish:()=>boolean) {
    let accepted=false
    deliverySaves=deliverySaves.catch(()=>{}).then(async()=>{
      if(!canPublish()||disposed)return
      const fresh=lines.filter(l=>!l.taskId||!delivered.some(old=>old.id===l.id))
      const answers=fresh.filter(l=>l.taskId)
      if(answers.length&&!options.disabled){
        const next=[...delivered,...answers].slice(-64)
        await mkdir(options.dataDirectory,{recursive:true});await writeFile(deliveryPath+'.tmp',JSON.stringify({version:1,lines:next}),{mode:0o600});await rename(deliveryPath+'.tmp',deliveryPath);delivered=next
      }
      if(!canPublish()||disposed)return
      // The durable outbox is the publication acknowledgment. Its stable task IDs prevent replay after restart.
      spoken=[...spoken,...fresh].slice(-4)
      options.onSpoken?.(fresh)
      if(fresh.length)try{const path=await commentary('host-replies.jsonl');if(path)await appendFile(path,fresh.map(l=>JSON.stringify({id:l.id,type:'host',to:l.to,text:l.text,at:l.at,...(l.taskId?{taskId:l.taskId}:{})})).join('\n')+'\n')}catch{/* The outbox/feed remains the publication source when history append fails. */}
      accepted=true
    })
    await deliverySaves
    return accepted
  }
  async function requestAgent(agent:AiAgentConfig,messages:AiMessage[],signal?:AbortSignal,overrides:Partial<Parameters<typeof chat>[1]>={}) {
    const provider=config.providers.find(p=>p.id===agent.providerId)
    if(!provider||!provider.enabled)throw new Error('绑定的服务商不存在或已停用。')
    const requestId=randomUUID(),started=Date.now(),meta={requestId,agentId:agent.id,role:agent.role,providerId:provider.id,model:agent.model,promptChars:messages.reduce((n,m)=>n+m.content.length,0),systemHash:createHash('sha256').update(messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')).digest('hex')}
    audit({...meta,at:Date.now(),stage:'started'})
    try{
      const result=await chat(fetcher,{provider,key:keyOf(provider.id),model:agent.model,messages,json:true,temperature:agent.temperature,maxTokens:agent.maxTokens,thinking:agent.thinking,signal,timeoutMs:agent.thinking?90000:40000,...overrides})
      audit({...meta,at:Date.now(),stage:signal?.aborted?'cancelled-with-usage':'completed',latencyMs:Date.now()-started,usage:result.usage});return result
    }catch(error){audit({...meta,at:Date.now(),stage:signal?.aborted?'cancelled':'failed',latencyMs:Date.now()-started,usage:null,error:aiFailure(error)});throw error}
  }
  const director = createDirector({
    now, board: config.blackboard,
    agents: () => config.agents, config: () => config.director,
    async call(agent, messages, signal) {
      return requestAgent(agent,messages,signal)
    },
    async readSnapshot() {
      const root = await options.getProject(); if (!root) return
      const path = join(root, '.local/native-bridge/latest-session.json')
      if (!existsSync(path) || (await stat(path)).size > 4 * 1024 * 1024) return
      return {...JSON.parse((await readFile(path, 'utf8')).replace(/^\ufeff/, '')),observedAt:(await stat(path)).mtimeMs}
    },
    onSay(lines,canPublish){return deliver(lines,canPublish??(()=>director.status().running))},
    onQueries:publishAudienceQueries,
    async readQueryResults(){const root=await options.getProject();if(!root)return;const path=join(root,'.local/commentary/audience-query-results.json');try{if((await stat(path)).size>131072)return;return JSON.parse(await readFile(path,'utf8'))}catch{return}},
    onDirective(directive: Directive) {
      void publishDirective(directive).catch(()=>{})
    },
    onChange: scheduleSave,
  })

  function clearHostWake(){clearTimeout(hostWake);hostWake=undefined;hostWakeAt=0}
  function runDirectorTick(){
    if(disposed||options.disabled||ticking||!director.status().running)return
    ticking=true
    void director.tick().catch(()=>{/* The next bounded tick may retry local observation. */}).finally(()=>{ticking=false;scheduleHostWake()})
  }
  function scheduleHostWake(){
    const state=director.status(),host=config.agents.find(a=>a.role==='host'&&a.enabled&&a.providerId&&a.model)
    if(disposed||options.disabled||!state.running||!host||!state.pending||state.busy.includes('host')||state.health?.host?.circuitOpen||state.hourRequests>=config.director.maxRequestsPerHour){clearHostWake();return}
    // Briefly coalesce simultaneous events; thereafter retain the configured
    // request interval, provider backoff, and the director's shared hard budget.
    const due=Math.max(now()+25,state.lastHostAt===undefined?0:state.lastHostAt+config.director.replyIntervalSeconds*1000,state.health?.host?.nextRetryAt??0)
    if(hostWake&&hostWakeAt<=due)return
    clearHostWake();hostWakeAt=due;const ticket=hostWakeGeneration
    hostWake=setTimeout(()=>{hostWake=undefined;hostWakeAt=0;if(ticket===hostWakeGeneration)runDirectorTick()},Math.max(0,due-now()));hostWake.unref?.()
  }
  function feedAudience(event:LiveEvent){
    if(disposed||options.disabled||!director.status().running)return false
    const accepted=director.feed(event);if(accepted)scheduleHostWake();return accepted
  }

  async function startOverlay() {
    if (server || options.disabled || disposed) return
    const instance = createServer((req, res) => {
      const path = (req.url || '/').split('?')[0]
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      if (path === '/host') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' ${options.playbackOrigin||'http://127.0.0.1:17661'}` }).end(overlayPage(options.playbackOrigin)); return }
      if (path === '/host/feed') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ lines: spoken.filter(l => now() - l.at < 45000).map(l => ({ to: l.to, text: l.text })) })); return }
      res.writeHead(404).end()
    })
    await new Promise<void>((done, fail) => { instance.once('error', fail); instance.listen(options.overlayPort ?? OVERLAY_PORT, '127.0.0.1', () => done()) })
    server = instance
    const address = instance.address(); overlayUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : OVERLAY_PORT}/host`
  }

  function view(): AiHubView {
    return { basic: !!options.basic, localTest: !!options.disabled, encrypted: options.secrets.available(), presets: options.basic ? AI_PROVIDER_PRESETS.filter(p => p.id === 'deepseek') : AI_PROVIDER_PRESETS,
      providers: config.providers.map(p => ({ ...p, hasKey: !!keys[p.id] })), agents: structuredClone(config.agents), director: { ...config.director },
      status: director.status(), blackboard: structuredClone(director.board), feed: director.feedItems().slice(0, 80), ...(overlayUrl ? { overlayUrl } : {}) }
  }
  const result = (ok: boolean, message?: string): AiHubResult => ({ ok, ...(message ? { message } : {}), view: view() })

  async function action(input: AiHubAction): Promise<AiHubResult> {
    if (disposed) return result(false, '桌面端正在退出。')
    if (!input || typeof input !== 'object') return result(false, '不支持的操作。')
    const network = ['list-models', 'test-agent', 'start', 'start-chat', 'rehearse'].includes(input.type)
    if (options.disabled && (network || input.type === 'save-key' || input.type === 'copy-overlay')) return result(false, '独立测试不联网、不保存密钥，也不启动场控。')
    if (busy && network && input.type !== 'rehearse') return result(false, '正在处理上一次请求。')
    const ownsNetworkLock = network && input.type !== 'rehearse'
    if (ownsNetworkLock) busy = true
    try {
      switch (input.type) {
        case 'save-provider': {
          if (options.basic && (input.provider.id !== 'deepseek' || input.provider.baseUrl !== 'https://api.deepseek.com' || input.provider.kind !== 'openai')) return result(false, '基础版仅提供 DeepSeek 官方服务。')
          const index = config.providers.findIndex(p => p.id === input.provider?.id)
          if (index < 0 && config.providers.length >= 20) return result(false, '最多保存 20 个服务商。')
          const provider = normalizeProvider(input.provider, config.providers[index])
          if (index < 0) config.providers.push(provider); else config.providers[index] = provider
          await persist(); return result(true, index < 0 ? `已添加「${provider.name}」。保存密钥后可以拉取模型列表。` : `已保存「${provider.name}」。`)
        }
        case 'remove-provider': {
          if (options.basic) return result(false, '基础版保留 DeepSeek 官方服务，可清除或替换密钥。')
          if (director.status().running && config.agents.some(a => a.providerId === input.id && a.enabled)) return result(false, '场控运行中，有角色正在使用这个服务商，请先停止场控。')
          const provider = config.providers.find(p => p.id === input.id); if (!provider) return result(false, '服务商不存在。')
          config.providers = config.providers.filter(p => p.id !== input.id)
          config.agents = config.agents.map(a => a.providerId === input.id ? { ...a, providerId: '', model: '' } : a)
          if (keys[input.id]) { delete keys[input.id]; await persistKeys() }
          await persist(); return result(true, `已删除「${provider.name}」及其密钥；用到它的角色需要重新选择。`)
        }
        case 'save-key': {
          const provider = config.providers.find(p => p.id === input.id); if (!provider) return result(false, '服务商不存在。')
          const key = typeof input.key === 'string' ? input.key.trim() : ''
          if (!key) { delete keys[provider.id]; await persistKeys(); return result(true, `已清除「${provider.name}」的密钥。`) }
          if (!options.secrets.available()) return result(false, '系统安全存储不可用，请确认已登录 Windows 账户后重试；不会明文保存密钥。')
          if (key.length > 4096 || /\s/.test(key)) return result(false, '密钥格式不正确，请重新复制（不要带空格或换行）。')
          keys[provider.id] = options.secrets.encrypt(key); await persistKeys()
          return result(true, `「${provider.name}」的密钥已加密保存。`)
        }
        case 'list-models': {
          const provider = config.providers.find(p => p.id === input.id); if (!provider) return result(false, '服务商不存在。')
          busy = true
          const key = keyOf(provider.id)
          try {
            const models = await listModels(fetcher, provider, key)
            provider.models = models; provider.modelsFetchedAt = now(); await persist()
            return result(true, models.length ? `已拉取 ${models.length} 个模型。` : '服务商返回了空的模型列表，可以直接手动填写模型名。')
          } catch (error) { return result(false, redact(error instanceof Error ? error.message : '拉取失败。', [key])) }
        }
        case 'test-agent': {
          const agent = config.agents.find(a => a.id === input.id); if (!agent) return result(false, '角色不存在。')
          const provider = config.providers.find(p => p.id === agent.providerId); if (!provider) return result(false, `请先给「${agent.label}」选择服务商。`)
          busy = true
          const key = keyOf(provider.id)
          const messages: AiMessage[] = [{ role: 'system', content: '你在做连接测试。只输出 JSON：{"ok":true,"hello":"一句不超过15字的中文问候"}' }, { role: 'user', content: '测试连接' }]
          try {
            const reply = await requestAgent(agent,messages,undefined,{maxTokens:agent.thinking?2048:200,timeoutMs:60000})
            const usage = reply.usage.inputTokens !== undefined ? `，用量 ${reply.usage.inputTokens}+${reply.usage.outputTokens ?? '?'} tokens` : '，服务商未返回用量'
            return result(true, `「${agent.label}」连接成功（${provider.name} · ${agent.model}，${(reply.latencyMs / 1000).toFixed(1)} 秒${usage}）。`)
          } catch (error) { return result(false, redact(error instanceof Error ? error.message : '测试失败。', [key])) }
        }
        case 'save-agents': {
          if (!Array.isArray(input.agents) || input.agents.length > MAX_AGENTS) return result(false, `角色数量无效，最多 ${MAX_AGENTS} 个。`)
          const agents = input.agents.map(a => normalizeAgent(a, config.providers))
          if (new Set(agents.map(a => a.id)).size !== agents.length) return result(false, '角色编号重复。')
          config.agents = ensureRoles(agents); await persist(); return result(true, '角色分工已保存，下一次调用起生效。')
        }
        case 'save-director': config.director = normalizeDirector(input.director); await persist(); return result(true, '场控参数已保存。')
        case 'start-chat':
        case 'start': {
          // A strategist-only room is valid for the AI hub, but cannot answer chat.
          // Check before changing state, including when the hub is already running.
          if(input.type==='start-chat'){
            const host=config.agents.find(a=>a.role==='host'&&a.enabled)
            if(!host?.providerId||!host.model)return result(false,'请先在AI中枢为场控角色选择服务商和模型，才能回复弹幕。')
            const provider=config.providers.find(p=>p.id===host.providerId&&p.enabled)
            if(!provider)return result(false,'场控使用的服务商已停用或不存在，请先在AI中枢修复配置。')
            if(!keyOf(provider.id))return result(false,'场控服务商的密钥尚未保存或无法解密，请在AI中枢重新加密保存。')
          }
          const started = director.start(); if (!started.ok) return result(false, started.message)
          await startOverlay().catch(() => { /* Port taken: the room still works, subtitles just need the file feed. */ })
          clearInterval(ticker)
          ticker = setInterval(runDirectorTick, options.tickMs ?? 1000); ticker.unref?.();scheduleHostWake()
          return result(true, started.message + (overlayUrl ? '' : ' 字幕页端口被占用，场控的话仍会写入控制器目录。'))
        }
        case 'stop': {
          clearInterval(ticker);ticker=undefined;hostWakeGeneration++;clearHostWake();const stopped=director.stop()
          await director.flushQueries();await publishDirective();await persist();return result(true,stopped.message)
        }
        case 'clear-feed': director.clearFeed(); return result(true, '已清空实时记录。')
        case 'reset-blackboard': Object.assign(director.board, createBlackboard());await publishAudienceQueries({version:1,source:'cyberfish-ai-hub',runId:'reset',gameSessionId:'',updatedAt:now(),requests:[]}); await persist(); return result(true, '黑板已清空，参谋下一轮会重新判断局势。')
        case 'copy-overlay': {
          await startOverlay(); if (!overlayUrl) return result(false, '字幕页没有启动，端口可能被占用。')
          options.copy?.(overlayUrl); return result(true, '已复制场控字幕地址。在 OBS 添加浏览器源，尺寸 1920 × 1080。')
        }
        case 'rehearse': {
          if (!director.status().running) return result(false, '请先启动场控，再发送彩排弹幕。')
          const text = clip(input.text, 120); if (!text) return result(false, '请填写彩排弹幕内容。')
          feedAudience({ id: `rehearsal-${randomUUID()}`, kind: 'chat', platform: 'bilibili', user: { id: 'rehearsal', name: clip(input.name, 20) || '彩排观众' }, text, at: now() })
          return result(true, '彩排弹幕已排队，下一轮场控会回应（会实际调用模型）。')
        }
        default: return result(false, '不支持的操作。')
      }
    } catch (error) { return result(false, error instanceof Error ? error.message : '操作失败。') }
    finally { if (ownsNetworkLock) busy = false }
  }

  return {
    view, action,
    /** Real room events from the broadcast service. Dropped unless the host is running. */
    feed(event: LiveEvent) { feedAudience(event) },
    /** Generic agent call for future modules (multi-AI battle seats); same keys, providers and safety as the director. */
    async callAgent(agentId: string, messages: AiMessage[], signal?: AbortSignal) {
      if (options.disabled || disposed) throw new Error('独立测试或退出状态不调用模型。')
      const agent = config.agents.find(a => a.id === agentId); const provider = agent && config.providers.find(p => p.id === agent.providerId)
      if (!agent || !provider) throw new Error('角色或服务商不存在。')
      return requestAgent(agent,messages,signal,{json:false})
    },
    async dispose() {
      disposed = true;hostWakeGeneration++;clearHostWake(); clearInterval(ticker); director.stop(); clearTimeout(saveTimer)
      await director.flushQueries();await querySaves.catch(()=>{});await deliverySaves.catch(()=>{})
      await publishDirective().catch(()=>{})
      await persist().catch(() => {})
      await audits.catch(()=>{})
      await new Promise<void>(done => { if (!server) return done(); server.close(() => done()); server.closeAllConnections() }); server = undefined
    },
  }
}
