import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import model from '../assets/figure/whale/model.json'
import { validateConfig } from '../packages/core/src/runtime'

describe('参考服装分层骨骼',()=>{
 it('幽灵装的远侧鱼鳍藏在脸后，鱼鳍根部由兜帽前缘遮住',()=>{
  const parts=(model.outfits.find(o=>o.id==='ghost') as any).parts as any[]
  const far=parts.find(p=>p.id==='fin_far'),near=parts.find(p=>p.id==='fin_near')
  const face=parts.find(p=>p.id==='face'),hood=parts.find(p=>p.id==='ghost_hood_front')
  expect(far.z).toBeLessThan(face.z)
  for(const fin of [far,near])expect(fin.z).toBeLessThan(hood.z)
 })
 it('幽灵兜帽遮住上半部后发，仅让下半部发梢从衣料下露出',()=>{
  const parts=(model.outfits.find(o=>o.id==='ghost') as any).parts as any[]
  const hair=parts.find(p=>p.id==='hair_back'),lower=parts.find(p=>p.id==='ghost_hair_lower'),hood=parts.find(p=>p.id==='ghost_hood_back')
  expect(hair.alpha).toBe(0);expect(lower.alpha).toBe(1)
  expect(lower.box[1]).toBeGreaterThan(hair.box[1]);expect(lower.uvBox[1]).toBeGreaterThan(0)
  expect(hood.z).toBeGreaterThan(lower.z)
  expect(lower.box[1]).toBeLessThan(hood.box[1]+hood.box[3])
 })
 for(const id of ['cowboy','pumpkin','ghost'])it(`${id} 保留动态关节、表情底图及坐姿，不退回女仆装`,()=>{
  expect(validateConfig({look:{scheme:'deepseek',outfit:id}}).look.outfit).toBe(id)
  const parts=(model.outfits.find(o=>o.id===id) as any).parts as any[]
  for(const part of ['arm_near','arm_far','leg_front','leg_back','skirt','skirt_sit','face','bangs','tail'])expect(parts.some(p=>p.id===part)).toBe(true)
  expect(parts.find(p=>p.id==='arm_near').parent).toBe('armNear')
  expect(parts.find(p=>p.id==='leg_front').parent).toBe('legFront')
  expect(parts.find(p=>p.id==='skirt_sit').parent).toBe('skirtSit')
  for(const p of parts.filter(p=>p.src)){
   expect(existsSync(resolve('assets/figure/whale',p.src)),p.src).toBe(true)
   const [u0,v0,u1,v1]=p.uvBox
   expect(u0).toBeGreaterThanOrEqual(0);expect(v0).toBeGreaterThanOrEqual(0);expect(u1).toBeLessThanOrEqual(1);expect(v1).toBeLessThanOrEqual(1);expect(u1).toBeGreaterThan(u0);expect(v1).toBeGreaterThan(v0)
  }
  const png=readFileSync(resolve('assets/figure/whale/outfits',id,'atlas.png'))
  expect(png[25],'atlas has alpha').toBe(6)
 })
})
