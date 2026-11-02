import {describe,expect,it} from 'vitest'
import {createCaptainGameNarration} from '../packages/core/src/captain-game-narration'
import {spokenText} from '../packages/core/src/stellaris-captain'

const at=100000
const contract={economyFocus:'unity_traditions',expansionStance:'aggressive',militaryStance:'peaceful',steeringConfirmed:true,reason:'reasoning_content: 私有推理不朗读',at:1}
const checkpoint=()=>({sessionId:'game-1',stopped:false,state:{countryAIControl:{enabled:true,owner:'native'},strategyContract:{...contract}}})

describe('原生国家 AI 的公开游戏打算',()=>{
  it('同一方针下默认每30秒轮换真实局势，不等待新的战略合同',()=>{
    let now=at;const narrator=createCaptainGameNarration(()=>now),c:any=checkpoint()
    c.state.research={physics:{current:{is_researching:true,key:'tech_lasers_2',name:'蓝激光发射器'}}}
    c.state.resources={minerals:{stockpile:600,net:20,stockpile_known:true,net_known:true}}
    expect(narrator.observe(c,now)?.text).toContain('顾凝聚力')
    now+=29999;expect(narrator.observe(c,now)).toBeUndefined()
    now++;const research=narrator.observe(c,now)!
    expect(research.text).toContain('蓝激光发射器');expect(spokenText(research.text)).toBe(research.text)
    now+=30000;const economy=narrator.observe(c,now)!
    expect(economy.text).toContain('矿物大概还有600');expect(economy.id).not.toBe(research.id)
    now+=30000;expect(narrator.observe(c,now)).toBeUndefined()
    now+=30000;expect(narrator.observe(c,now)?.text).toContain('蓝激光发射器')
  })
  it('间隔调整即时生效，暂停或未知事实不生成填空式解说',()=>{
    let now=at;const narrator=createCaptainGameNarration(()=>now),c:any=checkpoint()
    c.state.resources={energy:{stockpile:1000,net:-5,net_known:true}}
    narrator.observe(c,now);now+=15000
    expect(narrator.observe(c,now)).toBeUndefined()
    const line=narrator.observe(c,now,{intervalSeconds:15})!
    expect(line.text).toContain('能源每个月要亏5')
    now+=30000;c.state.paused=true;expect(narrator.observe(c,now,{intervalSeconds:15})).toBeUndefined()
    c.state.paused=false;c.state.resources.energy.net_known=false
    expect(narrator.observe(c,now,{intervalSeconds:15})).toBeUndefined()
  })
  it('当前殖民和排队建设可轮换解说，排队不被说成完工',()=>{
    let now=at;const narrator=createCaptainGameNarration(()=>now),c:any=checkpoint()
    c.state.colonies=[{colonies_summary:[{name:'阿图拉',is_colonizing:true},{name:'地球',has_construction:true}]}]
    narrator.observe(c,now);now+=30000
    expect(narrator.observe(c,now)?.text).toContain('阿图拉》还在殖民')
    now+=30000;const line=narrator.observe(c,now)!
    expect(line.text).toContain('地球》还有建设排着');expect(line.text).not.toMatch(/已经完成|建成了/)
  })
  it('当前确认方针生成第一人称打算，不读取私有推理、不声称建设已完成',()=>{
    const line=createCaptainGameNarration(()=>at).observe(checkpoint(),at)
    expect(line).toMatchObject({kind:'game',at})
    expect(line!.text).toContain('我先顾凝聚力和传统')
    expect(line!.text).toContain('向外扩张')
    expect(line!.text).not.toMatch(/推理|已完成|原生AI|StrategyContract/)
    expect(spokenText(line!.text)).toBe(line!.text)
  })
  it('相同方针不重复朗读，改变方向和新会话使用不同语音标识',()=>{
    const narrator=createCaptainGameNarration(()=>at),c=checkpoint()
    const first=narrator.observe(c,at)
    expect(narrator.observe({...c,state:{...c.state,strategyContract:{...contract,at:at+1,reason:'新的内部说明'}}},at)).toBeUndefined()
    c.state.strategyContract.economyFocus='research'
    const next=narrator.observe(c,at)
    expect(next!.text).toContain('科研');expect(next!.id).not.toBe(first!.id)
    c.state.strategyContract.economyFocus='unity_traditions'
    expect(narrator.observe(c,at)!.id).not.toBe(first!.id)
    expect(narrator.observe({...c,sessionId:'game-2'},at)!.id).toContain('game-2')
  })
  it('停止、过期、尚未确认和原生 AI 已收权时不朗读旧计划',()=>{
    const observe=(c:any,time=at)=>createCaptainGameNarration(()=>at).observe(c,time)
    expect(observe({...checkpoint(),stopped:true})).toBeUndefined()
    expect(observe(checkpoint(),at-30001)).toBeUndefined()
    expect(observe(checkpoint(),at+5001)).toBeUndefined()
    expect(observe({...checkpoint(),state:{strategyContract:{...contract,steeringConfirmed:false}}})).toBeUndefined()
    expect(observe({...checkpoint(),state:{strategyContract:{...contract,economyFocus:'unknown'}}})).toBeUndefined()
    expect(observe({...checkpoint(),state:{strategyContract:contract,countryAIControl:{enabled:false,owner:'human'}}})).toBeUndefined()
  })
  it('读取保存在检查点顶层的合同，备战只说打算而不编造战果',()=>{
    const line=createCaptainGameNarration(()=>at).observe({sessionId:'game-1',state:{},strategyContract:{...contract,economyFocus:'alloys_military',expansionStance:'consolidate',militaryStance:'prepare_war'}},at)
    expect(line!.text).toContain('合金和军工');expect(line!.text).toContain('舰队和后勤得先备好')
    expect(line!.text).not.toMatch(/已经开战|取得胜利|占领了/)
  })
})
