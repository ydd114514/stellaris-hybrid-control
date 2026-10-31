import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime, type RuntimeOptions } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const data = Buffer.from('live-pcm-never-persist-'.repeat(4000)).toString('base64')
async function runtime(synthesize: NonNullable<RuntimeOptions['voice']>['synthesize'] = async () => ({ audio: { kind: 'pcm', data, sampleRate: 24000 }, usage: { inputTokens: 1, outputTokens: 2 } })) {
  const saved: string[] = [], fetch = vi.fn(async () => { throw new Error('离线测试禁止真实API') })
  const instance = createRuntime({ credentials: { get: provider => provider === 'qwen' ? 'offline-key' : undefined, set() {}, encrypted: true }, store: { load() {}, save(state) { saved.push(JSON.stringify(state)) } }, fetch, voice: { synthesize } })
  runtimes.push(instance)
  const config = structuredClone(defaultConfig);config.demo=false;config.wallet.enabled=false;config.idle.enabled=false;config.music.bgmEnabled=false;config.voice.provider='qwen'
  await instance.command({ type: 'set-config', config });await instance.command({ type: 'start' })
  return { instance, saved, fetch }
}
describe('直播配音仅在当前内存阶段持有', () => {
  it('播放中仍不把PCM交给任意store或历史，结束后stage也释放', async () => {
    const { instance, saved } = await runtime()
    await instance.command({ type: 'say', text: '这句话的临时声音播完就释放。' });await instance.flush()
    const state=instance.getState();expect(state.stage.audio?.data).toBe(data)
    expect(saved.every(snapshot=>!snapshot.includes(data))).toBe(true);expect(JSON.stringify(state.history)).not.toContain(data)
    await instance.command({type:'stage-event',event:{type:'speech-ended',replyId:state.stage.replyId!}})
    expect(instance.getState().stage.audio).toBeUndefined();expect(saved.every(snapshot=>!snapshot.includes(data))).toBe(true)
  })
  it.each(['pause','interrupt','mute','reset-session','end-show','dispose'] as const)('%s释放正在播放的PCM，不把它带进持久化',async type=>{
    const {instance,saved}=await runtime();await instance.command({type:'say',text:'临时配音。'});await instance.flush()
    expect(instance.getState().stage.audio?.data).toBe(data)
    if(type==='dispose')instance.dispose();else await instance.command({type})
    expect(instance.getState().stage.audio).toBeUndefined();expect(saved.every(snapshot=>!snapshot.includes(data))).toBe(true)
  })
  it('取消后迟到的PCM既不播放也不进入历史/持久化；远端URL同样不持久化',async()=>{
    let complete!:(value:any)=>void,started!:()=>void
    const began=new Promise<void>(resolve=>started=resolve),pending=new Promise<any>(resolve=>complete=resolve)
    const {instance,saved}=await runtime(async()=>{started();return pending})
    await instance.command({type:'say',text:'等待配音。'});await began;await instance.command({type:'pause'})
    complete({audio:{kind:'pcm',data,sampleRate:24000},usage:{inputTokens:1,outputTokens:2}});await instance.flush()
    expect(instance.getState().stage.audio).toBeUndefined();expect(saved.every(snapshot=>!snapshot.includes(data))).toBe(true);expect(JSON.stringify(instance.getState().history)).not.toContain(data)
    const url='https://voice.example.test/ephemeral-signed.wav?token=not-persisted'
    const next=await runtime(async()=>({audio:{kind:'url',url},usage:{inputTokens:1,outputTokens:2}}));await next.instance.command({type:'say',text:'链接只留当前播放。'});await next.instance.flush()
    expect(next.instance.getState().stage.audio?.url).toBe(url);expect(next.saved.every(snapshot=>!snapshot.includes(url))).toBe(true)
  })
})
