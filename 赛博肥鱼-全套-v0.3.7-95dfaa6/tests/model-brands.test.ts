import {describe,it,expect} from 'vitest'
import {modelBrand,MODEL_BRANDS} from '../apps/desktop/src/model-brands'
describe('relay model brand recognition',()=>{
 it('模型名称优先于中转站 owned_by；未知型号使用通用标记',()=>{
  for(const [id,brand] of [['claude-opus-4-6-thinking','claude'],['gemini-3-flash','gemini'],['gpt-6.1-sol','openai'],['codex-auto-review','openai'],['gpt-oss-120b-medium','openai'],['deepseek-chat','deepseek'],['qwen-plus','qwen'],['moonshot-v1','kimi'],['grok-4','grok'],['llama-4','meta'],['codestral-latest','mistral']] as const){expect(modelBrand(id,'antigravity')).toBe(brand);expect(MODEL_BRANDS[brand].icon).toBeTruthy()}
  expect(modelBrand('relay-special','antigravity')).toBe('other');expect(modelBrand('custom-model','anthropic')).toBe('claude')
 })
})
