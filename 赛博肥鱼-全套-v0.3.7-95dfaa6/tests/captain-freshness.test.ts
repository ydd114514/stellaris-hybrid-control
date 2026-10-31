import {it,expect} from 'vitest'
import {qualifyCaptainReply} from '../packages/core/src/stellaris-captain'
it('enforces an audible historical qualifier despite present-tense model output',()=>{
 const text='现在食物和消费品都是负的，手里十三颗星球。',old={stopped:true,observedAt:100,state:{date:'2288.07.01'}}
 expect(qualifyCaptainReply(text,old,100)).toBe('按上次游戏记录，当时食物和消费品都是负的，手里十三颗星球。')
 expect(qualifyCaptainReply(text,{state:{},observedAt:100},101)).toBe(text)
 expect(qualifyCaptainReply(text,{state:{},observedAt:100},30101)).toContain('按上次游戏记录，')
 expect(qualifyCaptainReply(text,undefined,100)).toContain('游戏实时状态未确认，')
 expect(qualifyCaptainReply('欢迎上舰！',old,100)).toBe('欢迎上舰！')
 const once=qualifyCaptainReply(text,old,100);expect(qualifyCaptainReply(once,old,100)).toBe(once)
 expect(qualifyCaptainReply('现在'+ '星球'.repeat(100),old,100).length).toBeLessThanOrEqual(90)
})
