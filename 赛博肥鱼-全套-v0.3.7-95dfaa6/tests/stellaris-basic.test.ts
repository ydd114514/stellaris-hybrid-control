import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStellarisAi } from '../apps/desktop/electron/stellaris-ai'
const roots: string[] = [], services: ReturnType<typeof createStellarisAi>[] = []
afterEach(async () => { await Promise.all(services.map(s => s.dispose())); for (const root of roots) if (root.startsWith(join(tmpdir(), 'feiyu-basic-'))) await rm(root, { recursive: true, force: true }); roots.length = services.length = 0 })
it('基础版不带旧服务商、密钥和多角色；保存、重开后仍只有大肥鱼', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feiyu-basic-')); roots.push(root)
  const options = { dataDirectory: root, basic: true, getProject: async () => undefined, secrets: { available: () => true, encrypt: (s: string) => Buffer.from(s).toString('base64'), decrypt: (s: string) => Buffer.from(s, 'base64').toString() }, fetch: async () => { throw Error('No network allowed') } }
  const make = () => { const service = createStellarisAi(options); services.push(service); return service }
  const hub = make()
  expect(hub.view().presets.map(p => p.id)).toEqual(['deepseek'])
  expect(hub.view().providers.map(p => [p.id, p.hasKey])).toEqual([['deepseek', false]])
  expect(hub.view().agents.map(a => a.label)).toEqual(['大肥鱼'])
  expect(hub.view().status.running).toBe(false)
  const relay = await hub.action({ type: 'save-provider', provider: { id: 'relay', name: '中转站', kind: 'openai', preset: 'custom', baseUrl: 'https://relay.invalid/v1', enabled: true } })
  expect(relay.ok).toBe(false)
  await hub.action({ type: 'save-agents', agents: [...hub.view().agents, { ...hub.view().agents[0]!, id: 'extra', role: 'strategist', label: '额外参谋' }] })
  expect(make().view().agents.map(a => a.label)).toEqual(['大肥鱼'])
})
