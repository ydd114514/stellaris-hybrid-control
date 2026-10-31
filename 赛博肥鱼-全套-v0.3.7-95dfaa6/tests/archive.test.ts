import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../packages/core/src/runtime'
import { asksAboutPast, createMemoryArchive, terms } from '../packages/core/src/archive'
import type { LiveEvent } from '../packages/shared/src/index'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const rt of runtimes.splice(0)) rt.dispose() })
let n = 0
const chat = (userId: string, text: string, at = Date.now()): LiveEvent => ({ id: `a-${++n}`, kind: 'chat', user: { id: userId, name: `客人${userId}` }, text, at })
const keys = { get: (provider: string) => provider === 'deepseek' ? 'sk-test-secret' : undefined, set: vi.fn(), encrypted: true }

describe('聊天档案', () => {
  it('中文分词检索：按共同词排序，不返回被过滤的消息和别人的消息', () => {
    const archive = createMemoryArchive()
    archive.append([
      { id: '1', userId: 'a', name: 'A', kind: 'chat', text: '我下周要考驾照，好紧张', at: 1 },
      { id: '2', userId: 'a', name: 'A', kind: 'chat', text: '今天加班到很晚', at: 2 },
      { id: '3', userId: 'a', name: 'A', kind: 'chat', text: '驾照的事别告诉别人', at: 3, hidden: true },
      { id: '4', userId: 'b', name: 'B', kind: 'chat', text: '我也在考驾照', at: 4 },
    ])
    expect(archive.search('a', terms('你还记得我考驾照的事吗'), 5).map(r => r.id)).toEqual(['1'])
    expect(asksAboutPast('上次说的那个')).toBe(true)
    expect(asksAboutPast('晚上好')).toBe(false)
  })

  it('所有事件都进档案；客人提到往事时自动带上旧记录', async () => {
    const bodies: any[] = []
    const fetch = vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: ['记得呀。'], face: 'happy', action: 'nod' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }) })
    const archive = createMemoryArchive([{ id: 'old', userId: 'a', name: '客人a', kind: 'chat', text: '我下周要考驾照', at: Date.now() - 7 * 86400000 }])
    const rt = createRuntime({ credentials: keys, fetch: fetch as unknown as typeof globalThis.fetch, archive }); runtimes.push(rt)
    const config = structuredClone(rt.getState().config); config.demo = false; config.idle.enabled = false; config.voice.enabled = false
    await rt.command({ type: 'set-config', config }); await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: chat('a', '还记得我上次说考驾照的事吗') }); await rt.flush()
    expect(bodies[0].messages.at(-1).content).toContain('我下周要考驾照')
    expect(archive.count('a')).toBe(3) // the old line, tonight's question, her answer
  })

  it('模型可以先要求翻档案，系统翻到后它再回答', async () => {
    let call = 0
    const bodies: any[] = []
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      const content = ++call === 1 ? { lookup: '猫咪名字' } : { say: ['你家猫叫团子嘛，我记着呢。'], face: 'happy', action: 'pet_cat' }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })
    })
    const archive = createMemoryArchive([{ id: 'cat', userId: 'a', name: '客人a', kind: 'chat', text: '我家猫咪名字叫团子', at: Date.now() - 86400000 }])
    const rt = createRuntime({ credentials: keys, fetch: fetch as unknown as typeof globalThis.fetch, archive }); runtimes.push(rt)
    const config = structuredClone(rt.getState().config); config.demo = false; config.idle.enabled = false; config.voice.enabled = false
    await rt.command({ type: 'set-config', config }); await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: chat('a', '猜猜我家主子叫啥') }); await rt.flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bodies[1].messages.at(-1).content).toContain('团子')
    // The second request repeats the first one's prefix, so it is served from the cache.
    expect(bodies[1].messages.slice(0, bodies[0].messages.length)).toEqual(bodies[0].messages)
    expect(rt.getState().stage.text).toContain('团子')
  })

  it('桌面版用 SQLite 永久保存档案，重开后还能检索', async () => {
    const { createPersistentStore } = await import('../apps/desktop/electron/storage')
    const dir = mkdtempSync(join(tmpdir(), 'fish-archive-'))
    try {
      const first = createPersistentStore(dir)
      first.archive.append([{ id: 'x', userId: 'a', name: 'A', kind: 'chat', text: '我最喜欢晚安茶', at: 1 }, { id: 'x', userId: 'a', name: 'A', kind: 'chat', text: '重复的不再写', at: 2 }])
      first.close()
      const again = createPersistentStore(dir)
      expect(again.archive.count('a')).toBe(1)
      expect(again.archive.search('a', terms('晚安茶好喝吗'), 3)[0]!.text).toBe('我最喜欢晚安茶')
      again.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
