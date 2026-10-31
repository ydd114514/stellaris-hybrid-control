import { expect, test } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

test('心情来自近期互动并能调低主动聊天节奏，普通观众回复不受额度影响', async ({ page }, info) => {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false; state.stage.muted = true
  Object.assign(state.config.idle, { chatterSeconds: 120, hourlySpeechLimit: 12, quietBackoffSeconds: 300 })
  Object.assign(state, { roomMood: { kind: 'lively', label: '热闹开心', description: '刚才接连有人搭话，肥鱼的尾巴跟着轻快了。', face: 'happy', allowedActions: ['wave','music'], since: Date.now(), lastAudienceAt: Date.now(), heat: 70, activeChatters: 3, activeParticipants: 4 } })
  await page.addInitScript(initial => {
    let current = initial
    const listeners = new Set<(value: typeof current) => void>(), changes: typeof current.config[] = []
    const broadcast = () => { for (const listener of listeners) listener(JSON.parse(JSON.stringify(current))) }
    Object.assign(window, { __moodConfigChanges: changes, __quietMood: () => { current.roomMood = { ...current.roomMood, kind: 'lonely', label: '安静得冒泡', description: '有一阵没人接话，肥鱼把节奏放慢，自己小声嘀咕。', heat: 0, activeChatters: 0, activeParticipants: 0 }; broadcast() } })
    window.shop = { async getState() { return current }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, async command(command) { if (command.type === 'set-config') { current.config = command.config; changes.push(JSON.parse(JSON.stringify(command.config))); broadcast() }; return { ok: true } }, async openStage() {}, async exportLogs() { return { ok: true } } }
  }, state)
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  const mood = page.getByTestId('room-mood')
  await expect(mood).toContainText('热闹开心'); await expect(mood).toContainText('不代表真实在线人数')
  await expect(mood).not.toContainText('4 人在线')
  await page.evaluate(() => (window as any).__quietMood())
  await expect(mood).toContainText('安静得冒泡'); await expect(mood).toContainText('把节奏放慢')
  await mood.screenshot({ path: info.outputPath('room-mood-recent-interaction.png') })
  await mood.getByRole('button', { name: '调整主动聊天节奏', exact: true }).click()
  const entertainment = page.getByRole('checkbox', { name: '冷场小剧场：没人接话也会自娱自乐', exact: false })
  await expect(entertainment).toBeChecked()
  const interval = page.getByLabel('主动说话间隔 / 秒', { exact: true }), limit = page.getByLabel('每小时主动发声上限 / 轮', { exact: true }), quiet = page.getByLabel('连续无人互动 3 轮后间隔 / 秒', { exact: true })
  await expect(interval).toHaveValue('120'); await expect(interval).toHaveAttribute('min','120')
  await expect(limit).toHaveValue('12'); await expect(limit).toHaveAttribute('min','0'); await expect(limit).toHaveAttribute('max','24')
  await expect(quiet).toHaveValue('300'); await expect(quiet).toHaveAttribute('min','120'); await expect(quiet).toHaveAttribute('max','600')
  await expect(page.getByText('主动说话至少间隔 2 分钟', { exact: false })).toContainText('正常观众回复不占这份主动额度')
  await interval.fill('180'); await limit.fill('6'); await quiet.fill('600')
  await entertainment.uncheck()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  const changes = await page.evaluate(() => (window as any).__moodConfigChanges)
  expect(changes.at(-1).idle).toMatchObject({ chatterSeconds: 180, hourlySpeechLimit: 6, quietBackoffSeconds: 600, entertainment: false, enabled: false })
  expect(changes.at(-1).voice.enabled).toBe(false)
  await limit.fill('0'); await page.getByRole('button', { name: '保存设置', exact: true }).click()
  expect((await page.evaluate(() => (window as any).__moodConfigChanges)).at(-1).idle.hourlySpeechLimit).toBe(0)
  await expect(page.getByText('主动说话至少间隔 2 分钟', { exact: false })).toContainText('填 0 只关主动说话')
  await quiet.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('proactive-speech-settings.png') })
})
