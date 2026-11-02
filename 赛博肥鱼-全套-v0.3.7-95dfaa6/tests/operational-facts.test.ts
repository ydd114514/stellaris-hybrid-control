import {describe,it,expect} from 'vitest'
import {operationalFactLines,capabilityLines} from '../packages/core/src/operational-facts'
import {digestSnapshot,STRATEGIST_SYSTEM} from '../packages/core/src/ai-prompts'
import {captainContext} from '../packages/core/src/stellaris-captain'

describe('跨角色的已核实游戏事实',()=>{
 it('v3实际凝聚力进展和科研增长优先保留，未知字段不进入摘要',()=>{
  const unityProgress={known:true,focused:true,income:240,expense:210,net:30,traditionCost:9000,monthsToNextTradition:200,stagnating:true,scalingBehind:true,baseline:{observedYears:4,netGrowthPercent:1,traditionCostGrowthPercent:40,traditionsGained:0},reasons:['四年未推进传统'],private:'PRIVATE_SECRET'}
  const state={strategy:{version:3,focus:'解除产能瓶颈',priorities:['核验科研岗位'],growth:{known:true,observedYears:15,scienceGrowthPercent:4},unityProgress},resources:{unity:{stockpile:3000,net:30},...Object.fromEntries(Array.from({length:20},(_,i)=>['资源'.repeat(100)+i,{stockpile:100,net:1}]))}}
  const digest=digestSnapshot({state})
  expect(digest.text).toContain('解除产能瓶颈');expect(digest.text).toContain('15年，科研月产变化4%')
  expect(digest.text).toContain('凝聚力进展诊断');expect(digest.text).toContain('净产30/月');expect(digest.text).toContain('同局4年');expect(digest.text).toContain('传统增加0');expect(digest.text).toContain('实际进展停滞')
  expect(digest.text).toContain('unity 3000（+30.0/月）');expect(digest.text.length).toBeLessThanOrEqual(3500)
  expect(digest.unityProgress).toMatchObject({net:30,stagnating:true,baseline:{traditionsGained:0}})
  expect(JSON.stringify(digest)).not.toContain('PRIVATE_SECRET')
 })
 it('新版增长诊断及可执行优先项进入参谋摘要',()=>{
  const text=digestSnapshot({state:{strategy:{version:2,focus:'解除产能瓶颈',priorities:['核验科研岗位'],ordinaryExpansionAllowed:true,resumeWhen:'条件改善后重评',growth:{known:true,observedYears:15,scienceGrowthPercent:4}}}}).text
  expect(text).toContain('解除产能瓶颈');expect(text).toContain('核验科研岗位');expect(text).toContain('15年，科研月产变化4%')
 })
 it('近期传统明细可用于答复；过期、未来和非清单字段不混入',()=>{
  const now=Date.now(),state={operationalFacts:[{topic:'traditions',observedAt:now,facts:'传统树探索、繁荣；飞升科技至上'},{topic:'jobs',observedAt:now-60001,facts:'过期岗位'},{topic:'government',observedAt:now+5001,facts:'未来政体'},{topic:'private',observedAt:now,facts:'PRIVATE_SECRET'}]}
  const cp={sessionId:'game-1',observedAt:now,state}
  expect(operationalFactLines(state,now)).toEqual(['近期查询/traditions（操作前重新核验）：传统树探索、繁荣；飞升科技至上'])
  expect(digestSnapshot(cp,3500,now).text).toContain('科技至上');expect(captainContext(cp,now)).toContain('探索、繁荣')
  expect(digestSnapshot(cp,3500,now).text).not.toMatch(/过期岗位|未来政体|PRIVATE_SECRET/)
 })
 it('保留能力受限且不把建议或空数组当执行证据',()=>{
  const now=Date.now(),cp={state:{capabilities:{version:1,limitations:['首府及建筑升级尚无执行接口']},operationalFacts:[{topic:'buildings',observedAt:now,facts:'建筑候选3/3；空数组不证明空槽'}]}}
  expect(capabilityLines(cp.state)).toEqual(['首府及建筑升级尚无执行接口'])
  expect(digestSnapshot(cp).text).toContain('首府及建筑升级尚无执行接口');expect(captainContext(cp,now)).toContain('不无限承诺')
  expect(STRATEGIST_SYSTEM).toContain('已满员岗位再设优先不增加容量')
 })
 it('大详情仍服从摘要预算，重复观察时间不破坏语义缓存',()=>{
  const now=Date.now(),state={operationalFacts:Array.from({length:10},()=>({topic:'planet',observedAt:now,facts:'事实'.repeat(5000)}))};
  expect(digestSnapshot({state}).text.length).toBeLessThanOrEqual(3500)
  const first=digestSnapshot({state:{operationalFacts:[{topic:'jobs',observedAt:now-1000,facts:'工匠200/200'}]}})
  const second=digestSnapshot({state:{operationalFacts:[{topic:'jobs',observedAt:now,facts:'工匠200/200'}]}})
  expect(first.signature).toBe(second.signature)
 })
 it('详情不能覆盖当前已变化的海军容量',()=>{
  const now=Date.now(),s={capacities:{naval_capacity:{used:505,capacity:512}},operationalFacts:[{topic:'military',observedAt:now,basis:{navalUsed:300,navalCapacity:450},facts:'旧舰队300/450'}]}
  expect(operationalFactLines(s,now)).toEqual([])
 })
 it('长详情不会裁掉历史限定与能力限制',()=>{
  const now=Date.now(),cp={stopped:true,observedAt:now,state:{player:{name:'名字'.repeat(50)},strategy:{focus:'重点'.repeat(100)},capabilities:{version:1,limitations:Array.from({length:5},()=>('首府升级尚无执行接口；'.repeat(15)))},operationalFacts:[{topic:'planet',observedAt:now,facts:'大详情'.repeat(400)}]}}
  const text=captainContext(cp,now);expect(text.length).toBeLessThanOrEqual(1200);expect(text).toContain('能力限制：');expect(text).toContain('不能说成当前现场');expect(text).toContain('不无限承诺')
 })
})
