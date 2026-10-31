import { expect, test, type Page } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

async function fixture(page: Page, stage = false) {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false; state.stage.muted = true
  state.rations = { balance: 98120, earned: 0, spent: 1880, unknownRequests: 2 }
  Object.assign(state.wallet, { imaginedTokens: 10000 })
  state.show.startedAt = Date.now(); state.show.tokens = 99999
  Object.assign(state.costs, { inputTokens: 1200, outputTokens: 320, voiceInputTokens: 100, voiceOutputTokens: 260, brainUsageMissing: 1 })
  state.gifts[0]!.enabled = false
  state.history = [
    { id: 'chat-previous', viewerName: '模拟·听雨', heard: '今天想喝一杯不太甜的茶。', say: ['给你一杯早安茶，慢慢喝。'], face: 'happy', action: 'tea', station: null, voiceStyle: '', status: 'done', source: 'deepseek', createdAt: Date.now()-2000 },
    { id: 'chat-current', viewerName: '模拟·星星', heard: '那五颗小心心这一轮已经用掉了吗？', say: ['本轮播出就用掉，下次点歌重新算。'], face: 'happy', action: 'heart', station: null, voiceStyle: '', status: 'speaking', source: 'deepseek', createdAt: Date.now()-1000 },
  ]
  await page.addInitScript(initial => {
    let current = initial
    const listeners = new Set<(value: typeof current) => void>(), commands: any[] = []
    const broadcast = () => { for (const listener of listeners) listener(JSON.parse(JSON.stringify(current))) }
    Object.assign(window, {
      __rationCommands: commands,
      __rationOverdraw: () => { current.rations.balance = -7; broadcast() },
      __counterLongChat: () => { current.history.unshift({ ...current.history[0]!, id: 'chat-long', viewerName: '模拟·这是很长很长的观众昵称', heard: '下班路上看到一只小猫，想问问你喜欢小猫还是小狗呢？'.repeat(30), say: ['都喜欢，先陪你看看这只路边的小猫吧。'.repeat(30)], status: 'done', createdAt: Math.max(Date.now(), ...current.history.map(turn => turn.createdAt))+1 }); broadcast() },
      __rationChange: (kind: 'gift' | 'spend') => {
        if (kind === 'gift') { current.rations.balance += 2000; current.rations.earned += 2000; current.rations.lastTopUp = { name: '观众', tokens: 2000, at: Date.now(), origin: 'simulator' } }
        else { current.rations.balance -= 300; current.rations.spent += 300; current.costs.voiceOutputTokens += 300; current.rations.lastSpend = { tokens: 300, provider: 'qwen', at: Date.now() } }
        broadcast()
      },
    })
    window.shop = {
      async getState() { return current }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async command(command) {
        commands.push(command)
        if (command.type === 'rations-topup') { current.rations.balance += command.tokens; current.rations.earned += command.tokens; current.rations.lastTopUp = { name: '店长', tokens: command.tokens, at: Date.now(), origin: 'unknown' }; broadcast() }
        if (command.type === 'rations-reset') { current.rations = { balance: 100000, earned: 0, spent: 0, unknownRequests: 0 }; broadcast() }
        if (command.type === 'set-gifts') { current.gifts = command.gifts; broadcast() }
        if (command.type === 'set-config') { current.config = command.config; broadcast() }
        return { ok: true }
      }, async openStage() {}, async exportLogs() { return { ok: true } },
    }
  }, state)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (stage) await page.setViewportSize({ width: 540, height: 960 })
  await page.goto(stage ? '/?view=stage' : '/')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  if (!stage) await page.getByRole('navigation').getByRole('button', { name: '小店养成', exact: true }).click()
}

test('后台显示真实口粮累计，店长可整数补充并明确重置', async ({ page }, info) => {
  await fixture(page)
  const wallet = page.getByTestId('rations-wallet')
  await expect(wallet.getByTestId('rations-wallet-balance')).toHaveText('98,120')
  await page.getByText('展开元钱包玩法记录', { exact: true }).click()
  await expect(page.getByTestId('imagined-token-rations')).toHaveText('10,000 token')
  await expect(page.getByText('弹幕装傻剧情，独立于真实用量和礼物资格。', { exact: true })).toBeVisible()
  await expect(wallet.getByTestId('rations-wallet-balance')).toHaveText('98,120')
  await expect(wallet).toContainText('1,880'); await expect(wallet).toContainText('2 笔')
  await wallet.getByLabel('补充口粮数量').fill('-1')
  await expect(wallet.getByRole('button', { name: '店长补充口粮', exact: true })).toBeDisabled()
  await wallet.getByLabel('补充口粮数量').fill('20000')
  await wallet.getByRole('button', { name: '店长补充口粮', exact: true }).click()
  await expect(wallet.getByTestId('rations-wallet-balance')).toHaveText('118,120')
  await expect(wallet).toContainText('20,000')
  await wallet.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('rations-owner-wallet.png') })
  await wallet.getByRole('button', { name: '重置口粮至 100,000', exact: true }).click()
  await expect(wallet.getByTestId('rations-wallet-balance')).toHaveText('100,000')
  await expect(wallet).toContainText('0 笔')
  await page.getByRole('navigation').getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.segmented.tabs').getByRole('button', { name: '电费预算', exact: true }).click()
  await expect(page.getByLabel('开播后「好骗」多久 / 分钟', { exact: true })).toHaveCount(0)
  await expect(page.getByText('弹幕假礼物持续作为装傻剧情', { exact: false })).toBeVisible()
})

test('礼物口粮可编辑，表演关闭不等于关闭补给', async ({ page }) => {
  await fixture(page)
  await page.getByLabel('小心心 补充口粮', { exact: true }).fill('2500')
  await expect(page.getByLabel('小心心 播放回应', { exact: true })).not.toBeChecked()
  await expect(page.getByText('补充口粮按每个礼物计算，填 0 表示不补充。', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  const commands = await page.evaluate(() => (window as typeof window & { __rationCommands: any[] }).__rationCommands)
  expect(commands.find(c => c.type === 'set-gifts').gifts[0]).toMatchObject({ tokens: 2500, enabled: false })
})

test('柜台显示观众原话和肥鱼最近两轮回复，长句有界且口粮只随真实状态改变', async ({ page }, info) => {
  const start = Date.parse('2026-10-26T05:00:00Z')
  await page.clock.setFixedTime(new Date(start)); await fixture(page, true)
  const guide = page.getByTestId('audience-care'), balance = guide.getByTestId('rations-balance')
  await expect(guide).toHaveAttribute('data-chat-count', '2'); await expect(balance).toHaveText('98,120')
  await expect(guide).toContainText('模拟·听雨'); await expect(guide).toContainText('今天想喝一杯不太甜的茶。')
  await expect(guide).toContainText('肥鱼：'); await expect(guide).toContainText('给你一杯早安茶，慢慢喝。')
  await expect(guide).not.toContainText('怎么陪肥鱼玩')
  await expect(guide.getByTestId('rations-unknown')).toHaveText('2 笔待核算')
  await page.clock.setFixedTime(new Date(start + 35000))
  await expect(guide.getByTestId('chat-turn').nth(0)).toHaveAttribute('data-reply-id', 'chat-previous')
  await expect(guide.getByTestId('chat-turn').nth(1)).toHaveAttribute('data-reply-id', 'chat-current')
  await expect(balance).toHaveText('98,120')
  await page.clock.setFixedTime(new Date(start + 42000))
  await expect(guide.getByTestId('chat-turn')).toHaveCount(2)
  await page.evaluate(() => (window as typeof window & { __rationChange: (kind: 'gift' | 'spend') => void }).__rationChange('gift'))
  await expect(balance).toHaveText('100,120'); await expect(guide.getByTestId('ration-change')).toContainText('演练补充 +2,000')
  await expect(guide.getByTestId('ration-change')).toHaveAttribute('data-origin', 'simulator')
  await page.screenshot({ path: info.outputPath('counter-chat-rations-540.png') })
  await page.evaluate(() => (window as any).__counterLongChat())
  await expect(guide.getByTestId('chat-turn').last()).toHaveAttribute('data-reply-id', 'chat-long')
  await expect(guide.getByTestId('chat-heard').last()).toContainText('…')
  for (const width of [540, 1080]) {
    await page.setViewportSize({ width, height: width*16/9 })
    const box = (await guide.boundingBox())!
    for (const line of await guide.locator('text').all()) {
      const bounds = (await line.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(box.x); expect(bounds.x+bounds.width).toBeLessThanOrEqual(box.x+box.width)
      expect(bounds.y).toBeGreaterThanOrEqual(box.y); expect(bounds.y+bounds.height).toBeLessThanOrEqual(box.y+box.height)
    }
    await page.screenshot({ path: info.outputPath(`counter-chat-long-${width}.png`) })
  }
  await page.clock.setFixedTime(new Date(start + 43000))
  await page.evaluate(() => (window as typeof window & { __rationChange: (kind: 'gift' | 'spend') => void }).__rationChange('spend'))
  await expect(balance).toHaveText('99,820'); await expect(guide.getByTestId('ration-change')).toContainText('配音 −300')
  await page.clock.setFixedTime(new Date(start + 55000))
  await expect(guide.getByTestId('ration-change')).toHaveCount(0); await expect(balance).toHaveText('99,820')
})

test('开播与侧栏统一两家token和口粮余额，首日投票默认关闭可另行开启', async ({ page }, info) => {
  await fixture(page)
  const navigation = page.getByRole('navigation')
  await navigation.getByRole('button', { name: '开播', exact: true }).click()
  const summary = page.getByTestId('session-token-summary'), dock = page.getByTestId('dock-token-summary')
  await expect(summary).toContainText('至少 1,880'); await expect(summary).toContainText('98,120')
  await expect(dock).toContainText('本场已报 至少 1,880 token'); await expect(dock).toContainText('余粮 98,120 token')
  await expect(dock).not.toContainText('99,999'); await expect(dock).not.toContainText('¥')
  await expect(navigation.getByRole('button', { name: '明日投票', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '明日投票', exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as any).__rationChange('spend'))
  await expect(summary).toContainText('至少 2,180'); await expect(dock).toContainText('余粮 97,820 token')
  await page.evaluate(() => (window as any).__rationOverdraw())
  await expect(dock).toContainText('余粮 -7 token · 透支'); await expect(summary).toContainText('口粮 token · 透支')
  await navigation.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.segmented.tabs').getByRole('button', { name: '直播画面', exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: /开启观众投票/ })
  await expect(toggle).not.toBeChecked(); await toggle.check()
  await expect(navigation.getByRole('button', { name: '明日投票', exact: true })).toBeVisible()
  await toggle.uncheck(); await expect(navigation.getByRole('button', { name: '明日投票', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('vote-off-and-token-rations.png') })
})
