import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createStellarisAi } from '../apps/desktop/electron/stellaris-ai'
import { audienceGuidance, createBlackboard } from '../packages/core/src/ai-blackboard'
import type { Fetch } from '../packages/core/src/ai-providers'

const testData=resolve('.local/test-data')
const KEY = 'sk-offline-secret-abcdef'
const roots: string[] = [], services: ReturnType<typeof createStellarisAi>[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(s => s.dispose()))
  for (const root of roots.splice(0)) { if (dirname(root) !== testData || !basename(root).startsWith('cyberfish-ai-')) throw new Error('Unexpected temporary directory'); await rm(root, { recursive: true, force: true }) }
})
// Reversible stand-in for safeStorage; the test checks the saved file never holds the plain key.
const secrets = { available: () => true, encrypt: (v: string) => Buffer.from([...v].reverse().join('')).toString('base64'), decrypt: (v: string) => [...Buffer.from(v, 'base64').toString()].reverse().join('') }
async function setup(fetcher?: Fetch, disabled = false, now?:()=>number) {
  await mkdir(testData,{recursive:true});const root = await mkdtemp(join(testData, 'cyberfish-ai-')); roots.push(root)
  const data = join(root, 'data'), project = join(root, 'stellaris-player')
  await mkdir(join(project, '.local/native-bridge'), { recursive: true })
  await writeFile(join(project, '.local/native-bridge/latest-session.json'), JSON.stringify({ sessionId:'game-1', stopped: false, state: { date: '2201.01.01', capacities: { colonies: 1 } } }))
  const copied: string[] = []
  const make = () => { const s = createStellarisAi({ dataDirectory: data, disabled, getProject: async () => project, secrets, fetch: fetcher, overlayPort: 0, tickMs: 20, copy: t => copied.push(t),now }); services.push(s); return s }
  return { service: make(), make, data, project, copied }
}

describe('Stellaris AI hub service', () => {
  it('弹幕启动需要可用场控，而非仅参谋启动成功；配置检查不会调用模型',async()=>{
    let requests=0
    const {service}=await setup(async()=>{requests++;throw Error('不应调用模型')})
    expect((await service.action({type:'start-chat'}))).toMatchObject({ok:false,view:{status:{running:false}}})
    expect((await service.action({type:'start-chat'})).message).toContain('场控角色')
    await service.action({type:'save-agents',agents:service.view().agents.map(a=>a.role==='host'?{...a,providerId:'deepseek',model:'deepseek-flash'}:a)})
    expect((await service.action({type:'start-chat'})).message).toContain('密钥')
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await service.action({type:'save-provider',provider:{id:'deepseek',name:'DeepSeek',kind:'openai',preset:'deepseek',baseUrl:'https://api.deepseek.com',enabled:false}})
    expect((await service.action({type:'start-chat'})).message).toContain('停用')
    await service.action({type:'save-provider',provider:{id:'deepseek',name:'DeepSeek',kind:'openai',preset:'deepseek',baseUrl:'https://api.deepseek.com',enabled:true}})
    expect((await service.action({type:'start-chat'}))).toMatchObject({ok:true,view:{status:{running:true}}})
    expect(requests).toBe(0)
    await service.action({type:'save-agents',agents:service.view().agents.map(a=>a.role==='host'?{...a,enabled:false}:a)})
    expect((await service.action({type:'start-chat'}))).toMatchObject({ok:false,view:{status:{running:true}}})
    expect(requests).toBe(0)
  })
  it('添加自定义服务商、加密保存密钥、拉取模型并持久化；视图不含密钥', async () => {
    const seen: string[] = []
    const fetcher: Fetch = async (url, init) => { seen.push(`${url} ${init.headers.Authorization}`); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'relay-chat' }, { id: 'relay-embed-embedding' }] }) } }
    const { service, make, data } = await setup(fetcher)
    expect((await service.action({ type: 'save-provider', provider: { id: 'relay', name: '我的中转', kind: 'openai', preset: 'custom', baseUrl: 'https://relay.example/v1', enabled: true } })).ok).toBe(true)
    expect((await service.action({ type: 'save-provider', provider: { id: 'bad', name: '坏', kind: 'openai', preset: 'custom', baseUrl: 'http://relay.example', enabled: true } })).message).toContain('https')
    const saved = await service.action({ type: 'save-key', id: 'relay', key: KEY })
    expect(saved.ok).toBe(true); expect(JSON.stringify(saved.view)).not.toContain(KEY)
    expect(await readFile(join(data, 'ai-keys.enc.json'), 'utf8')).not.toContain(KEY)
    const listed = await service.action({ type: 'list-models', id: 'relay' })
    expect(listed.message).toBe('已拉取 1 个模型。'); expect(seen).toEqual([`https://relay.example/v1/models Bearer ${KEY}`])
    expect(listed.view.providers.find(p => p.id === 'relay')).toMatchObject({ hasKey: true, models: [{ id: 'relay-chat' }] })
    const reopened = make().view()
    expect(reopened.providers.find(p => p.id === 'relay')).toMatchObject({ hasKey: true, models: [{ id: 'relay-chat' }] })
    expect(JSON.stringify(reopened)).not.toContain(KEY)
  })
  it('两个角色用不同服务商；场控说的话写入控制器目录和字幕页，参谋指令写入方针文件', async () => {
    const hits: string[] = []
    const fetcher: Fetch = async (url, init) => {
      if (url.includes('127.0.0.1')) return fetch(url) as any
      hits.push(url)
      const system = JSON.parse(init.body!).systemInstruction?.parts?.[0]?.text ?? JSON.parse(init.body!).messages?.[0]?.content ?? ''
      const strategist = system.includes('游戏参谋')
      const out = strategist ? { summary: '刚开局。', focus: '探索周边', nextSteps: ['派科研船'], directive: { priority: 'normal', text: '优先探索周边星系' } } : { replies: [{ to: '阿黎', text: '阿黎晚上好，我们刚出港！' }], toStrategist: [] }
      return { ok: true, status: 200, json: async () => url.includes('generateContent') ? { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] } : { choices: [{ message: { content: JSON.stringify(out) } }] } }
    }
    const { service, project } = await setup(fetcher)
    await service.action({ type: 'save-provider', provider: { id: 'gemini', name: 'Gemini', kind: 'gemini', preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', enabled: true } })
    await service.action({ type: 'save-key', id: 'gemini', key: KEY }); await service.action({ type: 'save-key', id: 'deepseek', key: KEY + '2' })
    const agents = service.view().agents.map(a => a.role === 'host' ? { ...a, providerId: 'gemini', model: 'gemini-2.5-flash' } : a)
    expect((await service.action({ type: 'save-agents', agents })).ok).toBe(true)
    const started = await service.action({ type: 'start' })
    expect(started.ok).toBe(true); expect(started.view.overlayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/host$/)
    service.feed({ id: 'b1', platform: 'bilibili', kind: 'chat', user: { id: 'u1', name: '阿黎' }, text: '舰长晚上好', at: Date.now() })
    await expect.poll(async () => { try { return await readFile(join(project, '.local/commentary/host-replies.jsonl'), 'utf8') } catch { return '' } }, { timeout: 3000 }).toContain('阿黎晚上好')
    await expect.poll(async () => { try { return JSON.parse(await readFile(join(project, '.local/commentary/strategy-directive.json'), 'utf8')) } catch { return {} } }, { timeout: 3000 }).toMatchObject({ source: 'cyberfish-ai-hub', text: '优先探索周边星系', focus: '探索周边',gameSessionId:'game-1' })
    expect(hits.some(u => u.includes('generateContent'))).toBe(true); expect(hits.some(u => u === 'https://api.deepseek.com/chat/completions')).toBe(true)
    const feed = await (await fetch(started.view.overlayUrl!.replace('/host', '/host/feed'))).json()
    expect(feed.lines).toEqual([{ to: '阿黎', text: '阿黎晚上好，我们刚出港！' }])
    expect((await service.action({ type: 'stop' })).view.status.running).toBe(false)
    await expect(readFile(join(project,'.local/commentary/strategy-directive.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'})
  })
  it('主播常驻要求直接写入、心跳续期，清空/停止/换局撤销且不泄漏旧要求',async()=>{
    let t=1000000
    const {service,project}=await setup(async()=>{throw new Error('离线不调用模型')},false,()=>t)
    const path=join(project,'.local/commentary/operator-standing.json')
    const read=async()=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return null}}
    await service.action({type:'save-director',director:{...service.view().director,strategyNote:'前期主拉凝聚力'}})
    await service.action({type:'start'})
    expect(await read()).toMatchObject({version:1,source:'cyberfish-ai-hub',kind:'operator-standing',gameSessionId:'game-1',text:'前期主拉凝聚力',economyFocus:null,until:{date:'',condition:''},setAt:t,refreshedAt:t})
    const id=(await read()).id;t+=60001;await expect.poll(async()=>(await read())?.refreshedAt).toBe(t);expect((await read()).id).toBe(id)
    await service.action({type:'save-director',director:{...service.view().director,strategyNote:''}});expect(await read()).toBeNull()
    await service.action({type:'save-director',director:{...service.view().director,strategyNote:'优先研究'}});expect((await read()).text).toBe('优先研究')
    await service.action({type:'stop'});expect(await read()).toBeNull()
    await service.action({type:'start'});expect(await read()).not.toBeNull()
    await writeFile(join(project,'.local/native-bridge/latest-session.json'),JSON.stringify({sessionId:'game-2',state:{date:'2200.01.01'}}))
    await expect.poll(async()=>service.view().status.running).toBe(false);await expect.poll(read).toBeNull()
    t+=120000;await new Promise(r=>setTimeout(r,50));expect(await read()).toBeNull()
    await writeFile(path,JSON.stringify({source:'another-controller',text:'其他来源'}));await service.action({type:'stop'});expect(await read()).toMatchObject({source:'another-controller'})
  })
  it('参谋解释写回约定常驻格式，目标续期和最近十点净产在执行面板视图可见',async()=>{
    let t=1000000,calls=0
    const {service,project}=await setup(async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({operator:{economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:'完成首个传统树'},status:'on_track',evidence:'凝聚力月净产增长'},directive:++calls===1?{text:'优先凝聚力',targetResource:'unity'}:null})}}]})}),false,()=>t)
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await service.action({type:'save-director',director:{...service.view().director,strategyNote:'开局主拉凝聚力',strategyIntervalSeconds:30}})
    const snapshot=join(project,'.local/native-bridge/latest-session.json'),path=join(project,'.local/commentary/operator-standing.json'),goal=join(project,'.local/commentary/strategy-directive.json')
    await writeFile(snapshot,JSON.stringify({sessionId:'game-1',state:{date:'2201.01.01',resources:{unity:{net:10}}}}))
    await service.action({type:'start'})
    await expect.poll(()=>service.view().operatorExecution?.history.length).toBe(1)
    const original=JSON.parse(await readFile(goal,'utf8'))
    await writeFile(snapshot,'{');await new Promise(r=>setTimeout(r,60))
    expect(service.view().operatorExecution?.history).toHaveLength(1)
    expect(JSON.parse(await readFile(path,'utf8')).economyFocus).toBe('unity_traditions')
    for(let n=1;n<12;n++){
      await writeFile(snapshot,JSON.stringify({sessionId:'game-1',state:{date:`2201.01.${String(n+1).padStart(2,'0')}`,resources:{unity:{net:10+n}}}}));t+=31000
      await expect.poll(()=>service.view().status.usage.strategist?.requests).toBe(n+1)
      await expect.poll(()=>service.view().operatorExecution?.standingRefreshedAt,{timeout:5000}).toBe(t)
      await expect.poll(()=>service.view().operatorExecution?.directiveRefreshedAt,{timeout:5000}).toBe(t)
      await expect.poll(()=>service.view().operatorExecution?.history.at(-1)?.net,{timeout:5000}).toBe(10+n)
    }
    const standing=JSON.parse(await readFile(path,'utf8')),directive=JSON.parse(await readFile(goal,'utf8'))
    expect(Object.keys(standing).sort()).toEqual(['version','source','kind','id','gameSessionId','text','economyFocus','until','setAt','refreshedAt'].sort())
    expect(standing).toMatchObject({economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:'完成首个传统树'},text:'开局主拉凝聚力'})
    expect(directive).toMatchObject({id:original.id,text:original.text,at:t})
    expect(service.view().operatorExecution).toMatchObject({status:'on_track',evidence:'凝聚力月净产增长',history:Array.from({length:10},(_,i)=>({resource:'unity',net:12+i}))})
  })
  it('模型用量日志记录缓存和请求散列，不记录密钥、完整提示词或回复',async()=>{
    const {service,project}=await setup(async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'private-response'}}],usage:{prompt_tokens:1000,completion_tokens:20,prompt_cache_hit_tokens:768}})}))
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await service.callAgent('strategist',[{role:'system',content:'private-system-prompt'},{role:'user',content:'private-user-data'}])
    await service.dispose()
    const raw=await readFile(join(project,'.local/commentary/ai-usage.jsonl'),'utf8'),rows=raw.trim().split('\n').map(x=>JSON.parse(x))
    expect(rows.map(x=>x.stage)).toEqual(['started','completed']);expect(rows[1]).toMatchObject({usage:{inputTokens:1000,outputTokens:20,cachedTokens:768},model:'deepseek-flash'});expect(rows[1].systemHash).toMatch(/^[a-f0-9]{64}$/)
    for(const hidden of [KEY,'private-system-prompt','private-user-data','private-response'])expect(raw).not.toContain(hidden)
  })
  it('失败审计保留安全错误类型和HTTP状态，消费保持未知，原始错误不写日志',async()=>{
    const {service,project}=await setup(async()=>({ok:false,status:429,headers:{get:()=> '90'},json:async()=>({error:{message:`${KEY} https://private.example full-user-prompt`}})}))
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await expect(service.callAgent('strategist',[{role:'user',content:'full-user-prompt'}])).rejects.toThrow('429')
    await service.dispose()
    const raw=await readFile(join(project,'.local/commentary/ai-usage.jsonl'),'utf8'),rows=raw.trim().split('\n').map(x=>JSON.parse(x))
    expect(rows.map(x=>x.stage)).toEqual(['started','failed'])
    expect(rows[1]).toMatchObject({usage:null,error:{category:'rate_limit',httpStatus:429,retryAfterMs:90000,retryable:true}})
    for(const hidden of [KEY,'private.example','full-user-prompt'])expect(raw).not.toContain(hidden)
  })
  it('提问经受限查询文件和事实结果闭环，公开出站确认持久保存且恢复不重复答复',async()=>{
    let clock=Date.now(),calls=0
    const {service,project,data,make}=await setup(async(_url,init)=>{
      calls++
      const body=JSON.parse(init.body!),prompt=body.messages.map((m:any)=>m.content).join('\n'),taskId=/"taskId":"(q-[a-z0-9-]+)"/.exec(prompt)?.[1]
      const out=taskId?{replies:[{taskId,text:'三颗星球目前都有首府可升级提示。'}]}:{replies:[],queries:[{eventId:'question-1',topic:'upgrades',entityId:3}]}
      return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(out)}}]})}
    },false,()=>clock)
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await service.action({type:'save-agents',agents:service.view().agents.filter(a=>a.role==='host').map(a=>({...a,providerId:'deepseek',model:'deepseek-flash'}))})
    await service.action({type:'start'})
    service.feed({id:'question-1',platform:'bilibili',kind:'chat',user:{id:'u1',name:'观众甲'},text:'三颗首府能升级吗？',at:clock})
    const queryPath=join(project,'.local/commentary/audience-queries.json')
    await expect.poll(async()=>{try{return JSON.parse(await readFile(queryPath,'utf8')).requests.length}catch{return 0}}).toBe(1)
    const bus=JSON.parse(await readFile(queryPath,'utf8')),q=bus.requests[0]
    expect(JSON.stringify(bus)).not.toContain('观众甲');expect(JSON.stringify(bus)).not.toContain('首府能升级吗')
    expect(service.view().blackboard.audience.tasks![0]!.status).toBe('querying')
    clock+=8000
    await writeFile(join(project,'.local/commentary/audience-query-results.json'),JSON.stringify({version:1,source:'cyberfish-audience-query-results',runId:bus.runId,gameSessionId:bus.gameSessionId,updatedAt:clock,results:[{id:q.id,taskId:q.taskId,status:'ok',facts:'三颗星球均有首府可升级提示；合法升级需重新核验。',observedAt:clock}]}))
    await expect.poll(()=>service.view().blackboard.audience.tasks![0]?.status).toBe('answered')
    const ledger=JSON.parse(await readFile(join(data,'audience-answer-delivery.json'),'utf8'))
    expect(ledger.lines).toHaveLength(1);expect(ledger.lines[0]).toMatchObject({id:`answer-${q.taskId}`,taskId:q.taskId,text:'三颗星球目前都有首府可升级提示。'})
    const confirmed=JSON.parse(JSON.stringify(service.view().blackboard))
    await service.dispose()
    // Simulate crash between durable outbox publication and the board's answered-state save.
    const saved=JSON.parse(await readFile(join(data,'ai-hub.json'),'utf8'));saved.blackboard=confirmed;saved.blackboard.audience.tasks[0].status='ready';delete saved.blackboard.audience.tasks[0].answerId;delete saved.blackboard.audience.tasks[0].answer
    await writeFile(join(data,'ai-hub.json'),JSON.stringify(saved))
    const reopened=make();expect(reopened.view().blackboard.audience.tasks![0]).toMatchObject({status:'answered',answerId:`answer-${q.taskId}`})
    const restarted=await reopened.action({type:'start'});await new Promise(done=>setTimeout(done,50));expect(calls).toBe(2)
    const recoveredFeed=await(await fetch(restarted.view.overlayUrl!.replace('/host','/host/feed'))).json()
    expect(recoveredFeed.lines).toEqual([{to:'观众甲',text:'三颗星球目前都有首府可升级提示。'}])
    expect(JSON.parse(await readFile(join(data,'audience-answer-delivery.json'),'utf8')).lines).toHaveLength(1)
    clock+=45001
    expect((await(await fetch(restarted.view.overlayUrl!.replace('/host','/host/feed'))).json()).lines).toEqual([])
    await reopened.action({type:'stop'});await expect(readFile(queryPath,'utf8')).rejects.toMatchObject({code:'ENOENT'})
  })
  it('删除服务商同时删除密钥并解绑角色；缺少必需角色时自动补齐', async () => {
    const { service, data } = await setup()
    await service.action({ type: 'save-key', id: 'deepseek', key: KEY })
    const removed = await service.action({ type: 'remove-provider', id: 'deepseek' })
    expect(removed.ok).toBe(true); expect(removed.view.agents.find(a => a.role === 'strategist')).toMatchObject({ providerId: '', model: '' })
    expect(JSON.parse(await readFile(join(data, 'ai-keys.enc.json'), 'utf8'))).toEqual({})
    const saved = await service.action({ type: 'save-agents', agents: [] })
    expect(saved.view.agents.map(a => a.role).sort()).toEqual(['host', 'strategist'])
  })
  it('本地用量日志不可写时不阻塞或破坏模型请求',async()=>{
    const {service,project}=await setup(async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'ok'}}]})}))
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    await mkdir(join(project,'.local/commentary/ai-usage.jsonl'),{recursive:true})
    expect((await service.callAgent('strategist',[{role:'user',content:'offline'}])).text).toBe('ok')
    await service.dispose()
  })
  it('独立测试模式不联网、不保存密钥、不启动场控', async () => {
    const { service } = await setup(async () => { throw new Error('不应联网') }, true)
    for (const action of [{ type: 'save-key', id: 'deepseek', key: KEY }, { type: 'list-models', id: 'deepseek' }, { type: 'start' }] as const) expect((await service.action(action)).ok).toBe(false)
    expect(service.view()).toMatchObject({ localTest: true, status: { running: false } })
    await expect(service.callAgent('strategist',[])).rejects.toThrow('独立测试')
  })
  it('公开指导快照只发布建议与处理结论，并保留停止状态', async () => {
    const board=createBlackboard();board.plan.focus='探索周边';board.notes=[{id:'private',from:'参谋',to:'host',text:'不公开的同事留言',at:1}]
    board.audience.suggestions=[{id:'s1',name:'观众',text:'先补科研船',status:'adopted',reply:'等资源够后安排',at:2}]
    const guidance=audienceGuidance(board,{running:true,busy:[],message:'',pending:0,hourRequests:0,usage:{}},100)
    expect(guidance).toMatchObject({source:'cyberfish-ai-hub',status:'ready',items:[{status:'adopted',reply:'等资源够后安排'}]});expect(JSON.stringify(guidance)).not.toContain('不公开')
    const {service,project}=await setup();await service.action({type:'save-director',director:service.view().director})
    const file=JSON.parse(await readFile(join(project,'.local/commentary/audience-guidance.json'),'utf8'));expect(file).toMatchObject({version:1,status:'stopped',items:[]})
    expect(JSON.stringify(file)).not.toContain('providers')
  })
  it('并发保存不会争抢临时文件，彩排也不会解除其他请求的网络锁', async () => {
    let release!: () => void
    const {service}=await setup(async()=>new Promise(done=>{release=()=>done({ok:true,status:200,json:async()=>({data:[]})})}))
    await Promise.all(Array.from({length:6},()=>service.action({type:'save-director',director:service.view().director}))).then(rows=>expect(rows.every(r=>r.ok)).toBe(true))
    await service.action({type:'save-key',id:'deepseek',key:KEY})
    const first=service.action({type:'list-models',id:'deepseek'});await service.action({type:'rehearse',name:'测试',text:'无运行场控'})
    expect((await service.action({type:'list-models',id:'deepseek'})).message).toContain('上一次请求');release();expect((await first).ok).toBe(true)
  })
})
