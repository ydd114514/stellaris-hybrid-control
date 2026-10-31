import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDefaultState } from '../../packages/core/src/defaults'
import type { AppState } from '../../packages/shared/src/index'

test.use({ timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })

test('茶馆布局中点歌、投票和聊天净空互不遮挡', async ({ page }) => {
  const output = resolve('.local/validation-chat-sign')
  mkdirSync(output, { recursive: true })
  const now = Date.parse('2026-10-26T00:00:00Z')
  await page.clock.setFixedTime(new Date(now))
  const state = createDefaultState(now)
  state.running = true; state.config.voice.enabled = false; state.config.idle.enabled = false
  state.config.vote.enabled = true
  state.config.audio.monitorEnabled = false; state.config.look.timeOfDay = 'morning'; state.config.music.bgmEnabled = false
  state.shop.decorations = ['neon']; state.stage.muted = true
  state.shop.points = 36
  state.costs.inputTokens = 1200; state.costs.outputTokens = 320; state.costs.voiceInputTokens = 60; state.costs.voiceOutputTokens = 300
  state.rations.balance = 98120; state.rations.spent = 1880; state.rations.lastSpend = { tokens: 360, provider: 'qwen', at: now - 1000 }
  state.stage.commandId = 'music-layout-fixture'; state.stage.text = '先听完这一首，再慢慢点下一首。招牌、菜单和字幕都应该完整显示。'
  state.history = [{ id: 'layout-chat', eventId: 'layout-chat-event', viewerName: '小猫', heard: '店长今天心情怎么样？', say: [state.stage.text], face: 'happy', action: 'serve', station: 'counter', voiceStyle: '', status: 'done', source: 'mock', createdAt: now }]
  state.music.tracks = [{ id: 'qq:LayoutTest', title: '夜空中最亮的星与一直陪你等到黎明的鲸鱼小店特别超长歌名示例', artist: '名字特别长的温柔鲸鱼乐队与朋友们', source: 'shop-qqmusic://track/LayoutTest' }]
  state.music.current = { id: 'layout-request', trackId: 'qq:LayoutTest', userId: 'fixture-viewer', userName: '这是一个超过十二个字的深夜小店客人昵称', at: now, generationId: 'layout-generation', status: 'queued', heartCount: 0, consumedHearts: 9999 }
  state.music.status = 'playing'; state.music.skipRequired = 9999; state.music.lastMessage = '已经排好队啦，先听完这一首，再轮到下一位。'; state.music.messageAt = now
  state.vote.round = { id: 'fixture-vote', title: '下一场想听什么？', status: 'open', openedAt: now, closesAt: now + 180000, ballots: [], spare: [], options: [{ id: 'morning', kind: 'activity', title: '晨光茶话会', about: '' }, { id: 'music', kind: 'activity', title: '周末听歌夜', about: '' }] }
  state.vote.plans = [{ id: 'fixture-plan', option: { id: 'walk', kind: 'activity', title: '窗边听歌', about: '' }, applied: true, decidedAt: now, voters: 3, boosters: 0 }]
  state.vote.feed = [{ id: 'fixture-feed', kind: 'vote', text: '客人小猫给晨光茶话会投了一票', at: now }]
  await page.addInitScript(initial => {
    let state = initial
    const listeners = new Set<(value: AppState) => void>()
    const target = window as typeof window & { __setMusicLayout: (patch: { status?: AppState['music']['status']; showVote?: boolean; voteEnabled?: boolean; consumedTokens?: number; bgmEnabled?: boolean; bgmTrackIds?: string[]; qqBgm?: boolean; bgmError?: string; pending?: 'search' | 'queue' | 'none' }) => void }
    target.__setMusicLayout = patch => {
      if (patch.status) state = { ...state, music: { ...state.music, status: patch.status } }
      if (patch.showVote === false) state = { ...state, vote: { ...state.vote, round: undefined } }
      if (patch.voteEnabled !== undefined) state = { ...state, config: { ...state.config, vote: { ...state.config.vote, enabled: patch.voteEnabled } } }
      if (patch.bgmEnabled !== undefined) state = { ...state, config: { ...state.config, music: { ...state.config.music, bgmEnabled: patch.bgmEnabled } }, music: { ...state.music, current: undefined, status: 'stopped' } }
      if (patch.bgmTrackIds) state = { ...state, config: { ...state.config, music: { ...state.config.music, bgmTrackIds: patch.bgmTrackIds } } }
      if (patch.qqBgm) {
        const track = { id: 'qq:003eSmBj1FaFRE', title: '望むのは日常', artist: '近藤佑輔', source: 'shop-qqmusic://track/003eSmBj1FaFRE' }
        state = { ...state, music: { ...state.music, tracks: [...state.music.tracks, track], status: 'playing', current: { id: 'fixture-bgm', trackId: track.id, userId: 'background', userName: '不可显示的假点歌人', isBgm: true, at: Date.now(), generationId: 'fixture-bgm-generation', status: 'queued', heartCount: 0, consumedHearts: 9999, startedAt: Date.now() }, bgmError: undefined } }
      }
      if (patch.bgmError) state = { ...state, music: { ...state.music, current: undefined, status: 'stopped', bgmError: patch.bgmError } }
      if (patch.pending) state = { ...state, music: { ...state.music, current: undefined, status: 'stopped', searches: patch.pending === 'search' ? [{ id: 'pending-search', query: '待搜索歌名', userId: 'waiting', userName: '点歌客人', at: Date.now(), status: 'searching', heartCount: 0 }] : [], queue: patch.pending === 'queue' ? [{ id: 'pending-queue', trackId: 'qq:LayoutTest', userId: 'owner', userName: '店长', at: Date.now(), status: 'queued', heartCount: 0 }] : [] } }
      if (patch.consumedTokens) state = { ...state, costs: { ...state.costs, voiceOutputTokens: state.costs.voiceOutputTokens + patch.consumedTokens }, rations: { ...state.rations, balance: state.rations.balance - patch.consumedTokens, spent: state.rations.spent + patch.consumedTokens, lastSpend: { tokens: patch.consumedTokens, provider: 'qwen', at: Date.now() } } }
      for (const listener of listeners) listener(state)
    }
    window.shop = { async getState() { return state }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, async command() { return { ok: true } }, async openStage() {}, async exportLogs() { return { ok: true } } }
  }, state)
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return /^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname) ? route.abort() : route.continue()
  })
  await page.setViewportSize({ width: 540, height: 960 })
  await page.goto('/?view=stage')
  await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
  await expect(page.getByTestId('music-board')).toBeVisible()
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { voteEnabled?: boolean }) => void }).__setMusicLayout({ voteEnabled: false }))
  await expect(page.getByTestId('vote-board')).toHaveCount(0)
  await expect(page.getByTestId('plan-board')).toHaveCount(0)
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { voteEnabled?: boolean }) => void }).__setMusicLayout({ voteEnabled: true }))
  await expect(page.getByTestId('vote-board')).toBeVisible()
  await expect(page.getByTestId('shop-sign')).toBeVisible()
  await expect(page.getByTestId('stage-subtitle')).toBeVisible()
  await expect(page.getByTestId('audience-care')).toBeVisible()
  await expect(page.getByTestId('chat-invitation-sign')).toHaveCount(0)
  await page.evaluate(() => (window as any).__setMusicLayout({ voteEnabled: false }))
  await expect(page.getByTestId('chat-sign-heading')).toHaveText('清茶一盏 · 闲话半日')
  await expect(page.getByTestId('chat-sign-main')).toHaveText('和肥鱼喝杯茶')
  await expect(page.getByTestId('chat-sign-example')).toHaveText('发个「你好」，入座聊聊')
  await page.evaluate(() => (window as any).__setMusicLayout({ voteEnabled: true }))
  await expect(page.getByTestId('header-rations')).toHaveAttribute('data-balance', '98120')
  await expect(page.getByTestId('rations-balance')).toHaveAttribute('data-balance', '98120')
  await expect(page.getByTestId('stage-token-usage')).toContainText('1,880')
  await expect(page.getByTestId('counter-slogan')).toHaveCount(0)
  await expect(page.getByTestId('music-feedback')).toBeVisible()
  await expect(page.getByTestId('stage-action-label')).toHaveCount(0)
  await expect(page.getByTestId('music-votes')).toContainText('已用♡9,999')
  const title = (await page.getByTestId('music-title').textContent())!.replace(/^♫\s*/, '')
  expect(Array.from(title)).toHaveLength(11); expect(title.endsWith('…')).toBe(true)
  const labels = (await page.getByTestId('music-meta').textContent())!.split(' · @')
  for (const label of labels) { expect(Array.from(label).length).toBeLessThanOrEqual(8); expect(label.endsWith('…')).toBe(true) }
  const geometry: Record<string, unknown> = {}
  for (const width of [540, 1080]) {
    const height = width * 16 / 9
    await page.setViewportSize({ width, height })
    const boxes = await page.evaluate(() => {
      const names = ['music-board', 'shop-header', 'shop-clock', 'shop-menu', 'shop-sign', 'stage-subtitle', 'vote-board', 'music-title', 'music-status', 'music-meta', 'music-votes', 'audience-care', 'shop-cat', 'music-feedback', 'stage-token-usage', 'stage-character', 'stage-speech', 'stage-ledger', 'header-rations']
      return Object.fromEntries(names.map(name => { const rect = document.querySelector(`[data-testid="${name}"]`)!.getBoundingClientRect(); return [name, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }] }))
    })
    const music = boxes['music-board']!
    const intersects = (other: typeof music) => music.x < other.x + other.width && music.x + music.width > other.x && music.y < other.y + other.height && music.y + music.height > other.y
    for (const name of ['shop-header', 'stage-subtitle', 'vote-board']) expect(intersects(boxes[name]!), `${width}: music overlaps ${name}`).toBe(false)
    expect(music.y).toBeCloseTo(1336 * width / 1080, 1)
    expect(music.width).toBeCloseTo(320 * width / 1080, 1)
    expect(music.height).toBeCloseTo(157 * width / 1080, 1)
    expect(boxes['vote-board']!.y).toBeCloseTo(380.88 * width / 1080, 1)
    expect(boxes['music-title']!.x + boxes['music-title']!.width).toBeLessThanOrEqual(music.x + music.width - 4)
    expect(boxes['music-meta']!.y).toBeGreaterThan(boxes['music-status']!.y)
    const care = boxes['audience-care']!, feedback = boxes['music-feedback']!
    expect(care.y).toBeCloseTo(1060 * width / 1080, 1)
    expect(care.width).toBeGreaterThan(width * .6)
    expect(boxes['stage-character']!.height).toBeGreaterThan(height * .33)
    expect(boxes['stage-character']!.width).toBeGreaterThan(width * .55)
    expect(feedback.y).toBeCloseTo(1510 * width / 1080, 1)
    expect(feedback.y).toBeGreaterThan(care.y + care.height)
    for(const name of ['shop-header','header-rations','stage-subtitle','audience-care']){
      const box=boxes[name]!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x+box.width).toBeLessThanOrEqual(width)
      expect(box.y+box.height).toBeLessThan(height*.70)
    }
    expect(music.x).toBeGreaterThan(width*.59)
    geometry[`${width}x${height}`] = boxes
    await page.screenshot({ path: resolve(output, `music-vote-${width}x${height}.png`) })
  }
  await page.clock.setFixedTime(new Date(now + 9000))
  await expect(page.getByTestId('counter-chat')).toBeVisible()
  await expect(page.getByTestId('chat-turn')).toHaveCount(1)
  await expect(page.getByTestId('chat-heard')).toContainText('店长今天心情')
  await expect(page.getByTestId('rations-balance')).toHaveAttribute('data-balance', '98120')
  await expect(page.getByTestId('stage-token-usage')).toContainText('1,880')
  await expect(page.getByTestId('music-feedback')).toHaveCount(0)
  await expect(page.getByTestId('stage-action-label')).toBeVisible()
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { consumedTokens?: number }) => void }).__setMusicLayout({ consumedTokens: 240 }))
  await expect(page.getByTestId('rations-balance')).toHaveAttribute('data-balance', '97880')
  await expect(page.getByTestId('header-rations')).toHaveAttribute('data-balance', '97880')
  await expect(page.getByTestId('rations-balance')).toHaveText('97,880')
  await expect(page.getByTestId('stage-token-usage')).toContainText('2,120')
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { status?: AppState['music']['status']; showVote?: boolean }) => void }).__setMusicLayout({ showVote: false, status: 'paused' }))
  await expect(page.getByTestId('music-status')).toHaveText('唱片暂停')
  await expect(page.getByTestId('plan-board')).toBeVisible()
  await expect.poll(() => page.getByTestId('plan-board').evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(380.88, 1)
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { status?: AppState['music']['status'] }) => void }).__setMusicLayout({ status: 'stopped' }))
  await expect(page.getByTestId('music-board')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('plan-board').evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(380.88, 1)
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { bgmEnabled?: boolean; bgmTrackIds?: string[] }) => void }).__setMusicLayout({ bgmEnabled: true, bgmTrackIds: [] }))
  await expect(page.getByTestId('music-title')).toHaveText('♫ 尚未选择 QQ 背景音乐')
  await expect(page.getByTestId('music-board')).toHaveAttribute('data-bgm-kind', 'unselected')
  await expect(page.getByTestId('music-status')).toHaveText('等待选曲')
  await expect(page.getByTestId('music-votes')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('plan-board').evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(380.88, 1)
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { bgmTrackIds?: string[]; qqBgm?: boolean }) => void }).__setMusicLayout({ bgmTrackIds: ['qq:003eSmBj1FaFRE', 'qq:003NpbMs1qMVr1'], qqBgm: true }))
  await expect(page.getByTestId('music-board')).toHaveAttribute('data-bgm-kind', 'qq')
  await expect(page.getByTestId('music-title')).toHaveText('♫ 望むのは日常')
  await expect(page.getByTestId('music-status')).toHaveText('小店BGM · QQ音乐')
  await expect(page.getByTestId('music-meta')).toHaveText('近藤佑輔')
  await expect(page.getByTestId('music-votes')).toHaveCount(0)
  await page.screenshot({ path: resolve(output, 'qq-bgm-1080x1920.png') })
  await page.setViewportSize({ width: 540, height: 960 })
  await page.screenshot({ path: resolve(output, 'qq-bgm-540x960.png') })
  await page.evaluate(() => {
    (window as typeof window & { __setMusicLayout: (patch: { voteEnabled?: boolean }) => void }).__setMusicLayout({ voteEnabled: false })
    const mask = document.createElement('div'); mask.id = 'platform-occlusion-preview'
    mask.innerHTML = `<div style="position:fixed;inset:0 0 auto;height:17%;background:#172c32e8;display:flex;align-items:center;justify-content:center;color:#d3e1de;font:clamp(12px,2.4vw,24px) sans-serif">平台头像 / 关注 / 榜单遮挡示意</div><div style="position:fixed;inset:auto 0 0;height:35%;background:#172c32e8;display:flex;align-items:center;justify-content:center;color:#d3e1de;font:clamp(12px,2.4vw,24px) sans-serif">平台评论 / 礼物 / 输入框遮挡示意</div><div style="position:fixed;top:17%;bottom:35%;left:0;width:10%;background:#172c3290"></div><div style="position:fixed;top:17%;bottom:35%;right:0;width:16%;background:#172c3290"></div><div style="position:fixed;left:10%;right:16%;top:17%;bottom:35%;border:1px dashed #96c5b7"></div>`
    mask.style.cssText = 'position:fixed;inset:0;z-index:999;pointer-events:none'; document.body.append(mask)
  })
  for (const width of [540, 1080]) { await page.setViewportSize({ width, height: width * 16 / 9 }); await page.screenshot({ path: resolve(output, `mobile-safe-mask-${width}x${width * 16 / 9}.png`) }) }
  await page.evaluate(() => { document.getElementById('platform-occlusion-preview')?.remove(); (window as typeof window & { __setMusicLayout: (patch: { voteEnabled?: boolean }) => void }).__setMusicLayout({ voteEnabled: true }) })
  await page.setViewportSize({ width: 540, height: 960 })
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { status?: AppState['music']['status'] }) => void }).__setMusicLayout({ status: 'paused' }))
  await expect(page.getByTestId('music-status')).toHaveText('小店BGM · QQ音乐')
  await expect(page.getByTestId('music-meta')).toHaveText('近藤佑輔 · 唱片暂停')
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { bgmError?: string }) => void }).__setMusicLayout({ bgmError: '两首 QQ 背景曲均无法播放，请检查 QQ 音乐登录或播放权限。' }))
  await expect(page.getByTestId('music-board')).toHaveAttribute('data-bgm-kind', 'qq-error')
  await expect(page.getByTestId('music-title')).toHaveText('♫ QQ 背景音乐暂不可播')
  await expect(page.getByTestId('music-status')).toHaveText('播放失败')
  await expect(page.getByTestId('music-meta')).toContainText('检查 QQ')
  for (const pending of ['search', 'queue'] as const) {
    await page.evaluate(pending => (window as typeof window & { __setMusicLayout: (patch: { pending?: 'search' | 'queue' }) => void }).__setMusicLayout({ pending }), pending)
    await expect(page.getByTestId('music-board')).toHaveAttribute('data-bgm-kind', 'pending')
    await expect(page.getByTestId('music-title')).toHaveText('♫ 点歌处理中')
    await expect(page.getByTestId('music-status')).toHaveText('BGM已暂停')
    await expect(page.getByTestId('music-meta')).toContainText(pending === 'search' ? '正在查找 1 首' : '待播 1 首')
    await expect(page.getByTestId('music-votes')).toHaveCount(0)
    await expect.poll(() => page.getByTestId('plan-board').evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(190.44, 1)
  }
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { pending?: 'none' }) => void }).__setMusicLayout({ pending: 'none' }))
  await expect(page.getByTestId('music-board')).toHaveAttribute('data-bgm-kind', 'qq-error')
  await page.evaluate(() => (window as typeof window & { __setMusicLayout: (patch: { bgmEnabled?: boolean }) => void }).__setMusicLayout({ bgmEnabled: false }))
  await expect(page.getByTestId('music-board')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('plan-board').evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(190.44, 1)
  writeFileSync(resolve(output, 'geometry.json'), JSON.stringify(geometry, null, 2))
})
