import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDefaultState } from '../../packages/core/src/defaults'
import type { AppState, Command, InputStatistics, ShopBridge } from '../../packages/shared/src'

test('连接零消息不声称收到互动，模拟与本机及未标明礼物分列并说明旧统计', async ({ page, context }) => {
  // Pure UI fixture: no live receiver, provider call, credentials, profile or real audience.
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort()
  })
  const state = createDefaultState(new Date('2026-10-26T03:30:00Z').getTime())
  state.config.voice.enabled = false; state.config.idle.enabled = false
  await page.addInitScript((fixture: AppState) => {
    const listeners = new Set<(state: AppState) => void>()
    const input = { status: 'connected', endpoint: '', token: '', received: 0, rejected: 0, message: '本机工具已连接，尚无转发事件。' }
    window.shop = {
      getState: async () => fixture,
      command: async (command: Command) => command.type === 'input-info' ? { ok: true, data: input } : command.type === 'get-runtime-info' ? { ok: true, data: { localTest: true, dataDirectory: '离线界面测试 · 不读取运行目录' } } : { ok: false, message: '离线界面测试不执行操作。' },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      openStage: async () => {}, exportLogs: async () => ({ ok: false }),
    } satisfies ShopBridge
    ;(window as any).__setInputStatistics = (statistics: InputStatistics) => { fixture.inputStatistics = statistics; for (const listener of listeners) listener(structuredClone(fixture)) }
  }, state)
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: '直播连接', exact: true }).click()
  const connection = page.locator('.card', { has: page.getByRole('heading', { name: '互动数据连接', exact: true }) })
  await expect(connection.locator('.card-head .tag')).toHaveText('本机工具已连接')
  await expect(connection).toContainText('本机转发接收 0 条')
  await expect(connection).toContainText('不是独立礼物件数')
  await expect(connection).not.toContainText('已接收互动')
  await expect(connection).not.toContainText('抖音已接通')
  await expect(page.getByTestId('input-last-event')).toContainText('本场尚无有效消息')
  const directory = resolve('.local/input-statistics-ui'); await mkdir(directory, { recursive: true })
  await page.screenshot({ path: resolve(directory, 'connected-without-events.png'), fullPage: true })

  const at = state.inputStatistics.startedAt
  const statistics: InputStatistics = {
    startedAt: at, legacyUnclassified: true, legacyValueUnclassified: true,
    counts: { simulator: { comments: 2, giftEvents: 1, giftCount: 2, reportedDiamonds: 0, refDiamonds: 2, unknownValueGiftCount: 0 }, bridge: { comments: 3, giftEvents: 2, giftCount: 5, reportedDiamonds: 6, refDiamonds: 0, unknownValueGiftCount: 2 }, unknown: { comments: 0, giftEvents: 1, giftCount: 1, reportedDiamonds: 0, refDiamonds: 0, unknownValueGiftCount: 1 } },
    lastEvent: { origin: 'bridge', kind: 'gift', at: at + 3000 },
    recentGifts: [
      { eventId: 'bridge-gift', userName: '本机客人', giftName: '小星星', count: 3, origin: 'bridge', at: at + 3000, unitDiamonds: 2, diamonds: 6, valueSource: 'event' },
      { eventId: 'sim-gift', userName: '模拟小猫', giftName: '小心心', count: 2, origin: 'simulator', at: at + 2000, unitDiamonds: 1, diamonds: 2, valueSource: 'reference' },
      { eventId: 'unknown-gift', userName: '未标客人', giftName: '小灯笼', count: 1, origin: 'unknown', at: at + 1000 },
    ],
  }
  await page.evaluate(statistics => (window as any).__setInputStatistics(statistics), statistics)
  const card = page.getByTestId('input-statistics')
  await expect(page.getByTestId('input-origin-simulator')).toHaveText(/模拟排练\s*2\s*1\s*2/)
  await expect(page.getByTestId('input-origin-bridge')).toHaveText(/本机接入 · 未核验\s*3\s*2\s*5/)
  await expect(page.getByTestId('input-origin-unknown')).toHaveText(/来源未标明\s*0\s*1\s*1/)
  await expect(page.getByTestId('input-last-event')).toContainText('本机接入 · 未核验 · 礼物')
  await expect(page.getByTestId('input-legacy')).toContainText('未猜测分配到上表')
  await expect(page.getByTestId('input-legacy-value')).toContainText('历史面值待核对')
  await expect(page.getByTestId('input-origin-simulator').locator('td').nth(5)).toHaveText('2')
  await expect(page.getByTestId('input-origin-bridge').locator('td').nth(4)).toHaveText('6')
  await expect(page.getByTestId('input-origin-unknown').locator('td').nth(6)).toHaveText('1')
  await expect(card).toContainText('不代表已核验抖音礼物或到账收入')
  await card.getByText('最近礼物 · 最多20条', { exact: true }).click()
  const gifts = card.locator('details tbody tr')
  await expect(gifts).toHaveCount(3)
  await expect(gifts.nth(0)).toContainText('本机客人小星星3 件本机接入 · 未核验')
  await expect(gifts.nth(1)).toContainText('模拟小猫小心心2 件模拟排练')
  await expect(gifts.nth(2)).toContainText('未标客人小灯笼1 件来源未标明')
  await expect(gifts.nth(0)).toContainText('事件上报'); await expect(gifts.nth(1)).toContainText('公开参考')
  await expect(gifts.nth(2)).toContainText('待核对'); await expect(gifts.nth(2)).toContainText('价值未知')
  await card.screenshot({ path: resolve(directory, 'source-gifts-and-legacy.png') })
  await page.getByRole('navigation').getByRole('button', { name: '小店养成', exact: true }).click()
  const prices = page.getByTestId('gift-price-reference')
  await prices.locator('summary').click(); await expect(prices.locator('tbody tr')).toHaveCount(9)
  const light = prices.locator('tr', { hasText: '粉丝团灯牌' })
  await expect(light.locator('td').nth(1)).toHaveText('1')
  await expect(light).toContainText('网络参考 · 待核对'); await expect(light).toContainText('2026-10-26')
  await expect(light.getByRole('link')).toHaveAttribute('href', /jingyan.baidu.com/)
  await expect(prices).toContainText('不换算人民币或到账收入')
  await prices.screenshot({ path: resolve(directory, 'gift-price-reference.png') })
})
