import { test, expect } from '@playwright/test'

test('AI 中枢：添加服务商、拉取模型、给两个角色分配不同模型并启动场控', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: any[] = []; Object.assign(window, { __aiCalls: calls })
    const presets = [{ id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: 'sk-…', suggestedModels: ['deepseek-flash'] }, { id: 'gemini', name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHint: 'AIza…', suggestedModels: ['gemini-2.5-flash'] }]
    const view: any = { localTest: false, encrypted: true, presets, overlayUrl: undefined,
      providers: [{ id: 'deepseek', name: 'DeepSeek', kind: 'openai', preset: 'deepseek', baseUrl: 'https://api.deepseek.com', enabled: true, models: [], hasKey: true }],
      agents: [{ id: 'host', role: 'host', label: '场控老师', enabled: true, providerId: '', model: '', temperature: 1, maxTokens: 600, thinking: false }, { id: 'strategist', role: 'strategist', label: '游戏参谋', enabled: true, providerId: 'deepseek', model: 'deepseek-flash', temperature: 0.4, maxTokens: 1200, thinking: false }],
      director: { replyIntervalSeconds: 8, batchSize: 12, strategyIntervalSeconds: 180, maxRequestsPerHour: 240, idleCommentSeconds: 150, hostNote: '', strategyNote: '' },
      status: { running: false, message: '场控未启动。', busy: [], pending: 0, hourRequests: 0, usage: {} },
      blackboard: { game: { summary: '', threats: [], goals: [] }, plan: { focus: '', nextSteps: [], talkingPoint: '' }, audience: { mood: '', hotTopics: [], suggestions: [] }, notes: [] }, feed: [] }
    const ok = (message: string) => ({ ok: true, message, view: structuredClone(view) })
    const status = { phase: 'stopped', message: '控制器已停止。', canStart: true, canStop: false }
    ;(window as any).stellaris = { getStatus: async () => status, start: async () => ({ ok: true, status }), stop: async () => ({ ok: true, status }), chooseProject: async () => ({ ok: true, status }),
      ai: { view: async () => structuredClone(view), action: async (a: any) => {
        calls.push(a)
        if (a.type === 'save-provider') { view.providers.push({ ...a.provider, models: [], hasKey: false }); return ok('已添加。') }
        if (a.type === 'save-key') { view.providers.find((p: any) => p.id === a.id).hasKey = true; return ok('密钥已加密保存。') }
        if (a.type === 'list-models') { view.providers.find((p: any) => p.id === a.id).models = [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }]; return ok('已拉取 2 个模型。') }
        if (a.type === 'save-agents') { view.agents = a.agents; return ok('角色分工已保存。') }
        if (a.type === 'start') { view.status = { ...view.status, running: true, message: '场控运行中，等待弹幕。' }
          view.feed = [{ id: 'f2', at: Date.now(), kind: 'host', agentId: 'host', name: '阿黎', text: '阿黎晚上好，本舰长刚出港！' }, { id: 'f1', at: Date.now(), kind: 'danmaku', name: '阿黎', text: '舰长晚上好' }]
          view.blackboard.game.summary = '刚开局，经济平稳。'; view.blackboard.plan = { focus: '先探索周边', nextSteps: ['派科研船', '建第二个采矿站'], talkingPoint: '旁边好像有个奇怪的信号' }
          view.blackboard.audience = { mood: '热闹', hotTopics: ['开局'], suggestions: [{ id: 's1', name: '老王', text: '去打旁边的机械帝国', at: 1, status: 'declined', reply: '舰队还太少，先发育' }] }
          return ok('场控已启动。') }
        return ok('')
      } } }
  })
  await page.goto('/stellaris.html')
  await page.getByRole('button', { name: 'AI 中枢', exact: true }).click()
  await expect(page.getByTestId('director-state')).toHaveText('场控未启动')
  await page.getByRole('button', { name: '+ Google Gemini' }).click()
  await page.getByTestId('provider-editor').getByRole('button', { name: '添加' }).click()
  await page.getByLabel('Google Gemini 密钥').fill('AIza-offline-test')
  await page.getByTestId('provider-gemini').getByRole('button', { name: '保存密钥' }).click()
  await page.getByTestId('fetch-models-gemini').click()
  await expect(page.getByTestId('provider-gemini')).toContainText('2 个模型')
  const host = page.getByTestId('agent-host')
  await host.getByLabel('服务商').selectOption('gemini')
  await expect(host.getByRole('combobox',{name:'模型',exact:true})).toContainText('gemini-2.5-flash')
  await host.getByRole('button', { name: '保存并测试', exact: true }).click()
  await expect.poll(async () => page.evaluate(() => (window as any).__aiCalls.at(-1)?.type)).toBe('test-agent')
  await page.getByTestId('director-start').click()
  await expect(page.getByTestId('director-state')).toContainText('场控运行中')
  await expect(page.getByTestId('ai-feed')).toContainText('阿黎晚上好，本舰长刚出港！')
  await expect(page.getByTestId('blackboard')).toContainText('先探索周边')
  await page.screenshot({ path: 'test-results/stellaris-ai.png', fullPage: true })
  const calls = await page.evaluate(() => (window as any).__aiCalls)
  const testIndex=calls.findIndex((c:any)=>c.type==='test-agent');expect(calls[testIndex-1].type).toBe('save-agents')
  expect(calls.find((c: any) => c.type === 'save-agents').agents.find((a: any) => a.role === 'host')).toMatchObject({ providerId: 'gemini', model: 'gemini-2.5-flash' })
  expect(JSON.stringify(calls.filter((c: any) => c.type !== 'save-key'))).not.toContain('AIza-offline-test')
})

test('没有桌面桥时 AI 中枢只显示说明，不能操作', async ({ page }) => {
  await page.goto('/stellaris.html')
  await page.getByRole('button', { name: 'AI 中枢', exact: true }).click()
  await expect(page.getByTestId('stellaris-ai')).toContainText('请打开群星控制器大肥鱼 桌面端')
  await expect(page.getByTestId('director-start')).toBeDisabled()
})

test('场控显示失败退避、未知用量与游戏已停止的独立状态',async({page})=>{
  await page.addInitScript(()=>{
    const now=Date.now(),status={phase:'stopped',message:'控制器已停止。',canStart:true,canStop:false}
    const view:any={localTest:false,encrypted:true,presets:[],providers:[],agents:[{id:'host',role:'host',label:'场控老师',enabled:true,providerId:'',model:'',temperature:1,maxTokens:600,thinking:false}],director:{replyIntervalSeconds:8,batchSize:12,strategyIntervalSeconds:180,maxRequestsPerHour:240,idleCommentSeconds:150,hostNote:'',strategyNote:''},status:{running:true,message:'场控等待重试。',busy:[],pending:1,hourRequests:1,usage:{host:{requests:1,failed:1,inputTokens:0,outputTokens:0,usageMissing:1,cacheUsageMissing:0}},health:{host:{consecutiveFailures:1,lastSuccessAt:now-60000,nextRetryAt:now+30000,circuitOpen:false,message:'服务商限流或额度受限，等待后再试。',httpStatus:429}},snapshot:{state:'stopped',observedAt:now-60000}},blackboard:{game:{summary:'',threats:[],goals:[]},plan:{focus:'',nextSteps:[],talkingPoint:''},audience:{mood:'',hotTopics:[],suggestions:[]},notes:[]},feed:[]}
    ;(window as any).stellaris={getStatus:async()=>status,ai:{view:async()=>structuredClone(view),action:async()=>({ok:true,view:structuredClone(view)})}}
  })
  await page.goto('/stellaris.html');await page.getByRole('button',{name:'AI 中枢',exact:true}).click()
  await expect(page.getByTestId('health-host')).toContainText('最后成功')
  await expect(page.getByTestId('health-host')).toContainText('连续失败 1 次')
  await expect(page.getByTestId('health-host')).toContainText('HTTP 429')
  await expect(page.getByTestId('health-host')).toContainText('下次重试')
  await expect(page.getByTestId('game-snapshot-status')).toContainText('游戏控制已停止，聊天中枢独立运行')
  await expect(page.getByTestId('agent-host')).toContainText('1 次未返回用量')
})

test('基础版也显示问题查询、待答和公开确认，不把查到事实当作已答复',async({page})=>{
  await page.addInitScript(()=>{
    const now=Date.now(),task=(id:string,status:string)=>({id,sourceEventId:id,name:'观众',question:'首府能升级吗？',createdAt:now,updatedAt:now,status})
    const view:any={basic:true,localTest:false,encrypted:true,presets:[],providers:[],agents:[],director:{replyIntervalSeconds:8,batchSize:12,strategyIntervalSeconds:180,maxRequestsPerHour:240,idleCommentSeconds:150,hostNote:'',strategyNote:''},status:{running:true,message:'运行中',busy:[],pending:0,hourRequests:0,usage:{}},blackboard:{game:{summary:'',threats:[],goals:[]},plan:{focus:'',nextSteps:[],talkingPoint:''},audience:{mood:'',hotTopics:[],suggestions:[{id:'suggestion',name:'观众',text:'升级首府',at:now,status:'adopted'}],tasks:[task('q1','querying'),task('q2','ready'),{...task('q3','answered'),answer:'首府可以升级，执行前还要核验预算。'},{...task('q4','timed_out'),reason:'expired'}]},notes:[]},feed:[]}
    ;(window as any).stellaris={getStatus:async()=>({phase:'stopped',message:'已停止',canStart:true,canStop:false}),ai:{view:async()=>structuredClone(view),action:async()=>({ok:true,view:structuredClone(view)})}}
  })
  await page.goto('/stellaris.html');await page.getByRole('button',{name:'AI 中枢',exact:true}).click()
  await expect(page.getByTestId('audience-question-tasks')).toBeVisible()
  await expect(page.getByTestId('question-q1')).toContainText('查询中')
  await expect(page.getByTestId('question-q2')).toContainText('待答复');await expect(page.getByTestId('question-q2')).not.toContainText('已答复')
  await expect(page.getByTestId('question-q3')).toContainText('已保存公开答复')
  await expect(page.getByTestId('question-q4')).toContainText('查询超时')
})
