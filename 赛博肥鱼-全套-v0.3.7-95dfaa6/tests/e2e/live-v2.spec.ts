import {test,expect,type Page} from '@playwright/test'
import {createDefaultState} from '../../packages/core/src/defaults'
async function nav(page:Page,name:string){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click()}
test.beforeEach(async({page})=>{
 const state=createDefaultState();state.config.voice.enabled=false;state.config.idle.enabled=false;state.config.music.autoStart=false
 state.music.tracks=[{id:'rain',title:'雨夜',artist:'店长',source:'https://example.invalid/rain.wav'},{id:'stars',title:'星星',artist:'店长',source:'https://example.invalid/stars.wav'}]
 await page.addInitScript(initial=>{if(!localStorage.getItem('cyber-fish-demo'))localStorage.setItem('cyber-fish-demo',JSON.stringify(initial))},state)
 await page.goto('/');await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded','true');await page.evaluate(()=>{window.open=()=>null})
})
test('弹幕点歌只进入队列，不会让当前曲被抢播',async({page},info)=>{
 await page.locator('.dock').getByRole('button',{name:'开始营业',exact:true}).click();await nav(page,'互动排练');await page.getByLabel('弹幕内容').fill('点歌 雨夜');await page.getByRole('button',{name:'发送模拟弹幕',exact:true}).click();await nav(page,'点歌台')
 await expect(page.locator('.song-queue-row')).toContainText('雨夜');await expect(page.getByTestId('jukebox-now')).toContainText('等待观众点歌就绪')
 await page.screenshot({path:info.outputPath('jukebox-queue.png')})
 await page.getByLabel('谁可以点歌').selectOption('approval');await page.getByLabel('全场请求间隔 / 秒').fill('1');await page.getByRole('button',{name:'保存规则',exact:true}).click();await nav(page,'互动排练');await page.getByLabel('观众昵称').fill('另一位客人');await page.getByLabel('稳定用户 ID').fill('guest-2');await page.getByLabel('弹幕内容').fill('点歌 星星');await page.waitForTimeout(1100);await page.getByRole('button',{name:'发送模拟弹幕',exact:true}).click();await nav(page,'点歌台')
 const row=page.locator('.song-queue-row',{hasText:'星星'});await expect(row).toContainText('等待店长确认');await row.getByRole('button',{name:'允许',exact:true}).click();await expect(row).toContainText('已经排好队')
})
test('直播连接单独设置监听和直播目标，保持模拟模式可用',async({page},info)=>{
 await nav(page,'直播连接');await expect(page.getByRole('heading',{name:'直播音频输出',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'本地监听',exact:true})).toBeVisible()
 const summary=page.locator('.connection-summary');await summary.getByRole('button',{name:'打开本地监听',exact:true}).click();await expect(summary.getByRole('button',{name:'关闭本地监听',exact:true})).toBeVisible();await summary.getByRole('button',{name:'关闭本地监听',exact:true}).click();await expect(summary.getByRole('button',{name:'打开本地监听',exact:true})).toBeVisible()
 await page.getByRole('combobox',{name:'直播音频运行模式',exact:true}).selectOption('live');await page.getByRole('button',{name:'保存音频与连接设置',exact:true}).click();await expect(summary).toContainText('专用直播输出');await expect(page.locator('.dock-audio')).toContainText('独立直播声卡')
 await page.screenshot({path:info.outputPath('isolated-audio.png')})
})
test('曲库网址校验清晰，本地任意路径不能作为音频地址',async({page})=>{
 await nav(page,'点歌台');await page.getByRole('button',{name:'添加音频地址',exact:true}).click();await page.getByLabel('歌名',{exact:true}).fill('测试文件');await page.getByLabel('可直接播放的 HTTPS 音频地址').fill('file:///etc/passwd');await page.getByRole('button',{name:'加入曲库',exact:true}).click();await expect(page.locator('.toast-message')).toContainText('HTTPS')
 await page.getByLabel('可直接播放的 HTTPS 音频地址').fill('https://example.invalid/test.wav');await page.getByRole('button',{name:'加入曲库',exact:true}).click();await expect(page.locator('tbody')).toContainText('测试文件')
})
