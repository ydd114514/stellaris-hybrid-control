import { expect,it,vi } from 'vitest'
import { synthesizeQwen } from '../packages/core/src/voice'
import { createDefaultState } from '../packages/core/src/defaults'
it.each(['https://dashscope.aliyuncs.com','https://dashscope.aliyuncs.com/api/v1','https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'])('Qwen3 TTS Cherry 使用历史已配置的官方接口：%s',async baseUrl=>{
 const config={...createDefaultState().config.voice,model:'qwen3-tts-flash',voice:'Cherry',baseUrl}
 const request=vi.fn(async(_url: string | URL | Request,_init?: RequestInit)=>new Response(JSON.stringify({output:{audio:{url:'https://audio.invalid/test.wav'}},usage:{input_tokens:5,output_tokens:30}}),{headers:{'Content-Type':'application/json'}}))
 const result=await synthesizeQwen({text:'本地配音测试',config,apiKey:'offline-test-key',fetch:request})
 expect(request.mock.calls[0]?.[0]).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
 const init=request.mock.calls[0]?.[1] as RequestInit
 expect(JSON.parse(init.body as string)).toEqual({model:'qwen3-tts-flash',input:{text:'本地配音测试',voice:'Cherry',language_type:'Chinese'}})
 expect(result).toMatchObject({kind:'url',usage:{inputTokens:5,outputTokens:30},charactersReported:false})
})
it.each(['qwen3-tts-instruct-flash','qwen3-tts-instruct-flash-2026-01-26'])('Qwen Instruct 把自然语气放入官方SDK对应的 parameters：%s',async model=>{
 const config={...createDefaultState().config.voice,model,voice:'Vivian',baseUrl:'https://dashscope.aliyuncs.com',instruction:'  活泼嘴贫，像和熟人聊天\n本句带一点笑意  '}
 const request=vi.fn(async()=>Response.json({output:{audio:{url:'https://audio.invalid/instruct.wav'}},usage:{characters:16}}))
 await synthesizeQwen({text:'来都来了，先坐会儿。',config,apiKey:'offline-test-key',fetch:request})
 const init=request.mock.calls[0]?.[1] as RequestInit
 const body=JSON.parse(init.body as string)
 expect(body.parameters).toEqual({instructions:'活泼嘴贫，像和熟人聊天\n本句带一点笑意',optimize_instructions:true})
 expect(body.input).toEqual({text:'来都来了，先坐会儿。',voice:'Vivian',language_type:'Chinese'})
})
it('空语气不发送无效的 Instruct 参数',async()=>{
 const config={...createDefaultState().config.voice,model:'qwen3-tts-instruct-flash',voice:'Cherry',baseUrl:'https://dashscope.aliyuncs.com',instruction:' '}
 const request=vi.fn(async()=>Response.json({output:{audio:{url:'https://audio.invalid/neutral.wav'}}}))
 await synthesizeQwen({text:'你好。',config,apiKey:'offline-test-key',fetch:request})
 expect(JSON.parse((request.mock.calls[0]?.[1] as RequestInit).body as string)).not.toHaveProperty('parameters')
})
