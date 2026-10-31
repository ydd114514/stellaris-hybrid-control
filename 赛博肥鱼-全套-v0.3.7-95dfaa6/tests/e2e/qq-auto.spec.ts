import { expect, test, type Page } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'

async function fixture(page: Page, searches = false, hearts = false, background = false) {
  const state = createDefaultState()
  state.config.voice.enabled = false; state.config.idle.enabled = false
  state.config.music.qqAutoSearch = true; state.config.music.requestPolicy = 'approval'; state.config.music.autoStart = false
  if (searches) state.music.searches = [
    { id: 'search-1', query: '稻香 周杰伦', userId: 'guest-1', userName: '点歌客人一', at: Date.now(), status: 'searching', heartCount: hearts ? 2 : 0 },
    { id: 'search-2', query: '雨的印记 李闰珉', userId: 'guest-2', userName: '点歌客人二', at: Date.now(), status: 'waiting', heartCount: 0 },
  ]
  if (hearts) {
    state.music.tracks = ['当前歌曲', '本轮第一', '本轮第二'].map((title, i) => ({ id: `test-${i}`, title, artist: '离线样本', source: `https://example.invalid/${i}.mp3` }))
    state.music.current = { id: 'current', trackId: 'test-0', userId: 'now', userName: '正在听的客人', at: Date.now(), status: 'queued', heartCount: 0, consumedHearts: 7 }
    state.music.queue = [
      { id: 'priority-5', trackId: 'test-1', userId: 'first', userName: '优先客人', at: Date.now(), status: 'queued', heartCount: 5 },
      { id: 'priority-3', trackId: 'test-2', userId: 'second', userName: '下一位客人', at: Date.now(), status: 'queued', heartCount: 3 },
    ]
  }
  if (background) {
    state.music.current = { id: 'background', trackId: state.config.music.bgmTrackIds[0]!, userId: '__bgm__', userName: '小店背景音乐', at: Date.now(), status: 'queued', heartCount: 0, consumedHearts: 99, isBgm: true }
    state.music.status = 'playing'
    state.music.bgmError = '另一首背景曲暂时不可播放，已挂起；全部失败后停止自动尝试。'
  }
  await page.addInitScript(initial => {
    let current = initial
    const listeners = new Set<(value: typeof initial) => void>(), changes: boolean[] = [], commands: string[] = []
    const broadcast = () => { for (const listener of listeners) listener(JSON.parse(JSON.stringify(current))) }
    Object.assign(window, {
      __autoQQChanges: changes, __autoQQCommands: commands,
      __resolveQQSearch: () => {
        current.music.searches = current.music.searches.filter(request => request.id !== 'search-1')
        current.music.tracks = [{ id: 'qq:001DaoXiang', title: '稻香', artist: '周杰伦', source: 'shop-qqmusic://track/001DaoXiang' }]
        current.music.queue.push({ id: 'search-1', trackId: 'qq:001DaoXiang', userId: 'guest-1', userName: '点歌客人一', at: Date.now(), status: 'queued', heartCount: 0 })
        broadcast()
      },
    })
    window.shop = {
      async getState() { return current }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async command(command) {
        commands.push(command.type)
        if (command.type === 'qq-status') return { ok: true, data: { loggedIn: true, loginPending: false, message: 'QQ 音乐登录样本（离线）' } }
        if (command.type === 'set-config') { current = { ...current, config: command.config }; changes.push(command.config.music.qqAutoSearch); broadcast() }
        return { ok: true }
      }, async openStage() {}, async exportLogs() { return { ok: true } },
    }
  }, state)
  await page.goto('/'); await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('navigation').getByRole('button', { name: '点歌台', exact: true }).click()
  return state
}

test('QQ 未预录也可显示自动检索进度，找到后直接排队且不出现审批', async ({ page }, info) => {
  await fixture(page, true)
  const panel = page.getByTestId('qq-music'), progress = page.getByTestId('music-search-progress')
  await expect(page.getByTestId('jukebox-now')).toContainText('观众点歌处理中 · BGM已停')
  await expect(page.getByTestId('jukebox-now').getByRole('heading')).toHaveText('等待观众点歌就绪')
  await expect(panel.getByTestId('qq-auto-explainer')).toContainText('无需店长先加曲库或逐首批准')
  await expect(panel.getByRole('checkbox', { name: /弹幕自动搜索 QQ 音乐/ })).toBeChecked()
  await expect(progress.locator('[data-status="searching"]')).toContainText('稻香 周杰伦')
  await expect(progress.locator('[data-status="waiting"]')).toContainText('等待前面的点歌检索完成')
  await expect(page.locator('.song-queue-row')).toHaveCount(0)
  await page.evaluate(() => (window as typeof window & { __resolveQQSearch: () => void }).__resolveQQSearch())
  await expect(page.locator('.song-queue-row')).toContainText('稻香')
  await expect(page.locator('.song-queue-row')).toContainText('已经排好队')
  await expect(page.getByRole('button', { name: '允许', exact: true })).toHaveCount(0)
  await expect(progress.locator('.song-search-row')).toHaveCount(1)
  await expect(page.getByLabel('谁可以点歌')).toHaveValue('approval')
  await page.screenshot({ path: info.outputPath('auto-qq-progress-and-queue.png') })
  const commands = await page.evaluate(() => (window as typeof window & { __autoQQCommands: string[] }).__autoQQCommands)
  expect(commands).not.toContain('music-approve')
})

test('QQ 自动搜歌开关即时生效，本地曲目审批规则保留', async ({ page }) => {
  await fixture(page)
  const panel = page.getByTestId('qq-music'), toggle = panel.getByRole('checkbox', { name: /弹幕自动搜索 QQ 音乐/ })
  await toggle.uncheck(); await expect(toggle).not.toBeChecked()
  await expect(panel.getByTestId('qq-auto-explainer')).toContainText('弹幕自动搜歌已关闭')
  await expect(page.getByLabel('谁可以点歌')).toHaveValue('approval')
  await toggle.check(); await expect(toggle).toBeChecked()
  await expect(panel.getByTestId('qq-auto-explainer')).toContainText('自动搜索 QQ 音乐')
  const changes = await page.evaluate(() => (window as typeof window & { __autoQQChanges: boolean[] }).__autoQQChanges)
  expect(changes).toEqual([false, true])
})

test('本轮小心心排行与检索进度清楚，已播消耗和口粮规则独立', async ({ page }, info) => {
  await fixture(page, true, true)
  const rows = page.getByTestId('song-queue-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-request-id', 'priority-5')
  await expect(rows.nth(0)).toContainText('本轮小心心 5'); await expect(rows.nth(1)).toContainText('本轮小心心 3')
  await expect(page.getByTestId('music-search-progress').locator('[data-status="searching"]')).toContainText('本轮小心心 2')
  await expect(page.getByTestId('music-consumed-hearts')).toContainText('本轮已消耗 7 颗小心心')
  await expect(page.getByTestId('music-heart-ranking')).toContainText('真正播出才消耗清零')
  await expect(page.getByTestId('music-heart-ranking')).toContainText('口粮补充另按礼物规则计算')
  await rows.nth(0).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('round-heart-priority.png') })
})

test('QQ背景音乐歌单默认勾选，可增删调序，开关保存后生效', async ({ page }, info) => {
  const initial = await fixture(page)
  const configured = initial.config.music.bgmTrackIds.map(id => initial.music.tracks.find(track => track.id === id)!)
  const now = page.getByTestId('jukebox-now'), playlist = page.getByTestId('bgm-playlist')
  await expect(now.getByRole('heading')).toHaveText(configured.map(track => track.title).join(' / '))
  await expect(now).toContainText('背景音乐 · 待播'); await expect(now).toContainText('本页仅预览')
  for (const track of configured) await expect(playlist.getByRole('checkbox', { name: '背景曲 ' + track.title, exact: true })).toBeChecked()
  const secondTrack = configured[1]!, second = playlist.getByRole('checkbox', { name: '背景曲 ' + secondTrack.title, exact: true })
  await second.uncheck(); await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(now.getByRole('heading')).toHaveText(configured.filter(track => track.id !== secondTrack.id).map(track => track.title).join(' / '))
  await second.check()
  for (let i = 0; i < configured.length - 1; i++) await playlist.getByRole('button', { name: secondTrack.title + ' 背景曲上移', exact: true }).click()
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(now.getByRole('heading')).toHaveText([secondTrack, ...configured.filter(track => track.id !== secondTrack.id)].map(track => track.title).join(' / '))
  await playlist.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('qq-background-playlist.png') })
  const toggle = page.getByRole('checkbox', { name: /空队列循环 QQ 背景音乐/ })
  await expect(toggle).toBeChecked(); await toggle.uncheck()
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(now).toContainText('给小店添一点旋律')
})

test('QQ背景音乐未选曲明确提示，不冒充播放或自动使用原创兜底', async ({ page }) => {
  const initial = await fixture(page)
  const playlist = page.getByTestId('bgm-playlist')
  for (const id of initial.config.music.bgmTrackIds) {
    const track = initial.music.tracks.find(track => track.id === id)!
    await playlist.getByRole('checkbox', { name: '背景曲 ' + track.title, exact: true }).uncheck()
  }
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(page.getByTestId('jukebox-now')).toContainText('尚未选择 QQ 背景曲，选曲后保存')
  await expect(page.getByTestId('jukebox-now')).toContainText('背景音乐 · 未选曲')
  await expect(playlist).toContainText('尚未选择 QQ 背景曲，选曲后保存')
  await expect(page.locator('body')).not.toContainText('原创轻音乐')
})

test('QQ背景音乐正在播放时显示背景身份与故障，不混入观众心心消费', async ({ page }) => {
  const initial = await fixture(page, false, false, true)
  const now = page.getByTestId('jukebox-now')
  await expect(now).toContainText('背景音乐 · 正在播放'); await expect(now).toContainText(initial.music.tracks.find(track => track.id === initial.music.current!.trackId)!.artist)
  await expect(now).toContainText('有待搜或待播点歌就停 BGM，全部清空才恢复')
  await expect(now).not.toContainText('点播'); await expect(now).not.toContainText('切歌投票')
  await expect(page.getByTestId('music-consumed-hearts')).toHaveCount(0)
  await expect(page.getByTestId('bgm-error')).toContainText('已挂起')
})
