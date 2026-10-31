import claude from '../../../assets/model-logos/claude-color.svg'
import gemini from '../../../assets/model-logos/gemini-color.svg'
import openai from '../../../assets/model-logos/openai.svg'
import deepseek from '../../../assets/model-logos/deepseek-color.svg'
import qwen from '../../../assets/model-logos/qwen-color.svg'
import kimi from '../../../assets/model-logos/kimi-color.svg'
import grok from '../../../assets/model-logos/grok.svg'
import meta from '../../../assets/model-logos/meta-color.svg'
import mistral from '../../../assets/model-logos/mistral-color.svg'

export const MODEL_BRANDS = {
  claude:{name:'Claude · Anthropic',icon:claude},gemini:{name:'Gemini · Google',icon:gemini},
  openai:{name:'OpenAI',icon:openai},deepseek:{name:'DeepSeek',icon:deepseek},qwen:{name:'Qwen · 千问',icon:qwen},
  kimi:{name:'Kimi · 月之暗面',icon:kimi},grok:{name:'Grok · xAI',icon:grok},meta:{name:'Llama · Meta',icon:meta},
  mistral:{name:'Mistral',icon:mistral},other:{name:'其他模型',icon:''},
} as const
export type ModelBrand = keyof typeof MODEL_BRANDS
// Prefer the model's identity over the relay's owned_by field (often the relay itself).
export function modelBrand(id:string,owner=''):ModelBrand {
  const name=id.toLowerCase()
  if(/claude|anthropic/.test(name))return 'claude'
  if(/gemini|gemma/.test(name))return 'gemini'
  if(/(?:^|[/:])(?:gpt|chatgpt|codex|o[1-9])(?:[-/.:]|$)|openai/.test(name))return 'openai'
  if(/deepseek/.test(name))return 'deepseek'
  if(/qwen|qwq|qvq/.test(name))return 'qwen'
  if(/kimi|moonshot/.test(name))return 'kimi'
  if(/grok|xai/.test(name))return 'grok'
  if(/llama|meta-/.test(name))return 'meta'
  if(/mistral|mixtral|codestral|magistral/.test(name))return 'mistral'
  const known=owner.toLowerCase();if(['openai','anthropic','google','deepseek','qwen','moonshot','xai','meta','mistral'].includes(known))return ({anthropic:'claude',google:'gemini',moonshot:'kimi',xai:'grok'} as Record<string,ModelBrand>)[known]||known as ModelBrand
  return 'other'
}
