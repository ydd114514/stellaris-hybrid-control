import { test, expect } from '@playwright/test'

test('desktop opens stopped and only explicit buttons start/stop the controller', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = []; Object.assign(window, { __dshCalls: calls })
    let status: any = { phase: 'stopped', message: '控制器已停止。打开桌面端不会启动群星。', canStart: true, canStop: false, projectDirectory: 'C:/offline-fixture/stellaris-player', snapshot: { date: '2200.01.01', at: 1, orders: 0, verified: 0, ships: 3, colonies: 1 } }
    window.stellaris = {
      async getStatus() { calls.push('status'); return status },
      async start() { calls.push('start'); status = { ...status, phase: 'running', message: '离线测试：控制器运行中', canStart: false, canStop: true }; return { ok: true, status } },
      async stop() { calls.push('stop'); status = { ...status, phase: 'stopped', message: '离线测试：控制器已停止', canStart: true, canStop: false }; return { ok: true, status } },
      async chooseProject() { calls.push('choose'); return { ok: true, status } },
    }
  })
  await page.goto('/stellaris.html')
  const phase = page.getByTestId('controller-phase')
  await expect(phase).toHaveText('已停止')
  await expect(page.getByRole('button', { name: '停止控制', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '启动大肥鱼', exact: true })).toBeEnabled()
  expect((await page.evaluate(() => (window as any).__dshCalls)).filter((x: string) => x !== 'status')).toEqual([])
  await page.getByRole('button', { name: '启动大肥鱼', exact: true }).click()
  await expect(phase).toHaveText('运行中')
  await expect(page.getByRole('button', { name: '启动大肥鱼', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '停止控制', exact: true }).click()
  await expect(phase).toHaveText('已停止')
  expect((await page.evaluate(() => (window as any).__dshCalls)).filter((x: string) => x !== 'status')).toEqual(['start', 'stop'])
})

test('web preview without the desktop bridge cannot launch anything', async ({ page }) => {
  await page.goto('/stellaris.html')
  await expect(page.getByTestId('controller-message')).toContainText('群星控制器大肥鱼.exe')
  await expect(page.getByRole('button', { name: '启动大肥鱼', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '停止控制', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '更换目录', exact: false })).toBeDisabled()
})

test('desktop distinguishes asynchronous progress and local OBS measurements from viewer verification',async({page})=>{
  await page.addInitScript(()=>{
    const now=Date.now(),status:any={phase:'running',message:'离线状态示例',canStart:false,canStop:true,snapshot:{date:'2324.05.01',at:now,orders:8,verified:5,colonies:3,ships:74,pendingEvents:0,orderTracking:{counts:{submitted:1,queued:2,executing:1,completed:3,failed:0,expired_unknown:1},recent:[{id:'q1',command:'build_building',status:'queued',reason:'已看到施工队列，尚未完工',updatedAt:now},{id:'q2',command:'diplomacy',status:'expired_unknown',reason:'结果仍未知，禁止自动重放',updatedAt:now}]},quality:{status:'observed',source:'local_obs',at:now,stats:{activeFps:59.9,renderSkippedFrames:0,renderTotalFrames:1000,outputSkippedFrames:2,outputTotalFrames:1000},stream:{active:true,reconnecting:false},record:{active:false},audioIsolation:'not_measured',viewerLatency:'not_measured'}}}
    ;(window as any).stellaris={getStatus:async()=>status}
  })
  await page.goto('/stellaris.html')
  const ledger=page.getByTestId('order-tracking'),quality=page.getByTestId('broadcast-quality')
  await expect(ledger).toContainText('已确认完成 3');await expect(ledger).toContainText('排队中 2');await expect(ledger).toContainText('超时未知 1')
  await expect(ledger).toContainText('接受回执和排队不等于完成');await expect(ledger).toContainText('禁止自动重放')
  await expect(quality).toContainText('已读取本机 OBS');await expect(quality).toContainText('59.9');await expect(quality).toContainText('编码跳帧 2 / 1000')
  await expect(quality).toContainText('音轨隔离：未测量');await expect(quality).toContainText('观众端延迟：未测量')
})

test('desktop shows stale OBS data as unknown instead of claiming no dropped frames',async({page})=>{
  await page.addInitScript(()=>{const status:any={phase:'stopped',message:'已停止',canStart:true,canStop:false,snapshot:{date:'2324.05.01',at:Date.now(),orders:0,verified:0,colonies:3,ships:74,pendingEvents:0,quality:{status:'unknown',reason:'stale',audioIsolation:'not_measured',viewerLatency:'not_measured'}}};(window as any).stellaris={getStatus:async()=>status}})
  await page.goto('/stellaris.html')
  await expect(page.getByTestId('broadcast-quality')).toContainText('OBS 观测已过期')
  await expect(page.getByTestId('broadcast-quality')).toContainText('不能据此判断整场推流质量')
  await expect(page.getByTestId('broadcast-quality')).not.toContainText('渲染跳帧')
  await expect(page.getByTestId('order-tracking')).toContainText('暂无异步操作追踪数据')
})
