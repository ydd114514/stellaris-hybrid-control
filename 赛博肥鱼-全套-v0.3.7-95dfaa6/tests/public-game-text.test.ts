import {describe,it,expect} from 'vitest'
import {safePublicGameText} from '../packages/core/src/public-game-text'
describe('public game speech boundary',()=>{
  it('rejects source-role attribution even when the model ignores its instructions',()=>{
    for(const text of ['我让参谋查查','场控老师让我这么做','场\u200b控提醒了我','the host told me','幕后指导要我扩张'])expect(safePublicGameText(text)).toBe('')
    expect(safePublicGameText('食物还在亏，我先检查农夫岗位。')).toBe('食物还在亏，我先检查农夫岗位。')
  })
})
