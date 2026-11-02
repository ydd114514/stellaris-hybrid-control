import {it,expect} from 'vitest'
import {guardOperatorProgress,confirmedAscensionCount} from '../packages/core/src/operator-progress'
import {digestUnityProgress} from '../packages/core/src/ai-prompts'

it('增长参考值未达到不封锁实际在增长的自主发展状态',()=>{
 const progress=digestUnityProgress({known:true,focused:true,net:30,targetNet:400,targetMet:false,stagnating:false,scalingBehind:false})!
 const judgment={economyFocus:'unity_traditions' as const,until:{date:'',condition:'自主持续发展'},status:'on_track' as const,evidence:'真实凝聚力收入和传统推进均有改善'}
 expect(guardOperatorProgress(judgment,{note:'好好拉凝聚力',progress,ascensionPerkCount:1})).toBe(judgment)
})
it('已选飞升计数必须来自完整合法唯一列表，不能拿空槽或重复项凑数',()=>{
 expect(confirmedAscensionCount(undefined)).toBe(null)
 expect(confirmedAscensionCount([{key:'ap_one'},{key:'ap_one'}])).toBe(1)
 expect(confirmedAscensionCount([{key:'ap_one'},{key:'unknown'}])).toBe(null)
})
it('缺失或不完整凝聚力依据不得宣告完成，任意自定义退出条件不充当实际证明',()=>{
 const judgment={economyFocus:'unity_traditions' as const,until:{date:'2250.01.01',condition:'已经发展得足够好'},status:'done' as const,evidence:'看起来没有问题所以完成'}
 for(const progress of [undefined,digestUnityProgress({focused:true,known:false}),digestUnityProgress({focused:true,known:true,net:30}),digestUnityProgress({focused:false,known:true,net:30})]){
  expect(guardOperatorProgress(judgment,{note:'持续拉凝聚力',progress,ascensionPerkCount:null})).toMatchObject({status:'blocked'})
 }
 // Changing the model's proposed focus cannot bypass the standing unity goal.
 expect(guardOperatorProgress({...judgment,economyFocus:'research'},{note:'继续执行',previousFocus:'unity_traditions',ascensionPerkCount:null})).toMatchObject({status:'blocked'})
})
it('有真实健康增长也只代表持续推进，未知自定义结束条件不能据此完成',()=>{
 const judgment={economyFocus:'unity_traditions' as const,until:{date:'',condition:'完成所有发展任务'},status:'done' as const,evidence:'凝聚力增长所以完成'}
 for(const baseline of [{observedYears:4,netGrowthPercent:20,traditionsGained:0},{observedYears:4,netGrowthPercent:0,traditionsGained:2}]){
  const progress=digestUnityProgress({known:true,focused:true,net:45,baseline})!
  expect(guardOperatorProgress(judgment,{note:'好好拉凝聚力',progress,ascensionPerkCount:2})).toMatchObject({status:'on_track'})
 }
})
it('坏趋势仍阻止乐观推进，明确第三飞升后科研且实际已选足才允许阶段完成',()=>{
 const judgment={economyFocus:'research' as const,until:{date:'',condition:'第三飞升后科研'},status:'done' as const,evidence:'阶段完成'}
 const progress=digestUnityProgress({known:true,focused:true,stagnating:true,reasons:['四年未推进传统']})!
 expect(guardOperatorProgress(judgment,{note:'第三个飞升后科研',previousFocus:'unity_traditions',progress,ascensionPerkCount:2})).toMatchObject({status:'blocked'})
 for(const diagnostics of [undefined,progress]){
  expect(guardOperatorProgress(judgment,{note:'第三个飞升后科研',previousFocus:'unity_traditions',progress:diagnostics,ascensionPerkCount:3})).toBe(judgment)
 }
 expect(guardOperatorProgress({...judgment,economyFocus:'unity_traditions',status:'on_track'},{note:'持续凝聚力优先',progress,ascensionPerkCount:3})).toMatchObject({status:'blocked',evidence:'四年未推进传统'})
})
it('其他资源的判断不受凝聚力阶段守卫干扰',()=>{
 const judgment={economyFocus:'research' as const,until:{date:'',condition:'已确认的科研阶段'},status:'done' as const,evidence:'科研阶段完成'}
 expect(guardOperatorProgress(judgment,{note:'科研优先',ascensionPerkCount:null})).toBe(judgment)
})
