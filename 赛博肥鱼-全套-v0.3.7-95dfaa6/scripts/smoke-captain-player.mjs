// Offline Chromium decoding/feedback smoke. Replays a previously generated real
// revision-4 WAV through the production speech server and player page. No model,
// TTS, platform, real user profile, or credentials are used.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const baseOutput = join(root, '.local', 'captain-player-smoke')
const output = join(baseOutput, `run-${Date.now()}-${process.pid}`)
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(output, 'isolated-'))
const report = { offline: true, newlySynthesizedAudio: false, audibleSpeakerCheck: false, mutedChromiumDecode: true, realCredentialsRead: false, actualExternalRequests: 0, startedAt: new Date().toISOString(), checks: {} }
const wait = ms => new Promise(done => setTimeout(done, ms))
let service, application, lateResolve
const requests = [], feedback = [], audioDownloads = [], media = []
try {
  const bundle = join(profile, 'speech-service.mjs')
  await build({ stdin: { contents: `export {createStellarisSpeech} from './apps/desktop/electron/stellaris-speech'; export {inspectCaptainWav,tuneCaptainWav} from './packages/core/src/captain-audio'; export {CAPTAIN_TUNED_VOICE,CAPTAIN_TUNED_SAMPLE_SHA256} from './packages/core/src/captain-tuned'`, resolveDir: root, sourcefile: 'offline-captain-entry.ts', loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  const { createStellarisSpeech, inspectCaptainWav, tuneCaptainWav, CAPTAIN_TUNED_VOICE: tuned, CAPTAIN_TUNED_SAMPLE_SHA256: pinned } = await import(new URL(`file:///${bundle.replaceAll('\\', '/')}`).href)
  const sampleFile = join(root, 'assets/captain-tuned/20.wav')
  const rawFile = process.argv.find(x => x.startsWith('--raw-sample='))?.slice('--raw-sample='.length) || join(dirname(root), '语音小样/2026-10-29/呆萌平常话四调/B-平常话对照-原始.wav')
  const sample = await readFile(sampleFile), raw = await readFile(rawFile)
  const info = inspectCaptainWav(sample)
  assert.equal(info.sha256, pinned)
  assert.deepEqual(tuneCaptainWav(raw, tuned.gainDb, tuned.fadeMilliseconds), sample, 'Offline raw fixture must produce the exact shipped revision-4 WAV')
  let pcm, sampleRate
  for (let p = 12; p + 8 <= raw.length;) {
    const kind = raw.toString('ascii', p, p + 4), size = raw.readUInt32LE(p + 4), start = p + 8
    if (kind === 'fmt ') sampleRate = raw.readUInt32LE(start + 4)
    if (kind === 'data') pcm = raw.subarray(start, start + size)
    p = start + size + size % 2
  }
  assert.ok(pcm?.length && sampleRate)
  let mode = 'immediate', stubCalls = 0
  const result = () => ({ kind: 'pcm', data: pcm.toString('base64'), sampleRate, words: [], characters: tuned.sampleText.length, usage: { inputTokens: 0, outputTokens: 0 } })
  const codec = { available: () => true, encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() }
  service = createStellarisSpeech({ directory: join(profile, 'service-data'), getProject: async () => undefined, tunedSamplesDirectory: join(root, 'assets/captain-tuned'), secrets: codec, port: 0, synthesize: async options => {
    stubCalls++; options.onRequest?.()
    assert.equal(options.config.voice, tuned.voice)
    assert.equal(options.config.model, tuned.model)
    if (mode === 'late') return new Promise(done => { lateResolve = () => done(result()) })
    return result()
  } })
  assert.equal((await service.view()).config.voice, tuned.voice)
  assert.equal((await service.view()).tunedVoice.ready, true)
  assert.equal((await service.action({ type: 'save-key', key: 'offline-fixture-only-no-real-credential' })).ok, true)
  assert.equal((await service.action({ type: 'use-tuned-voice' })).ok, true)
  const started = await service.action({ type: 'start' })
  assert.equal(started.ok, true)
  const url = started.view.playerUrl
  console.log('离线语音服务与真实revision4 WAV核验就绪，正在启动隔离Chromium播放器。')
  const origin = new URL(url).origin
  const harness = join(profile, 'electron-player.cjs')
  await writeFile(harness, `const {app,BrowserWindow,session}=require('electron');
app.setName('CyberfishOfflineCaptainPlayer');
app.setPath('userData',process.env.CAPTAIN_SMOKE_PROFILE);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.commandLine.appendSwitch('mute-audio');
app.whenReady().then(async()=>{session.defaultSession.webRequest.onBeforeRequest((d,cb)=>{let allowed=false;try{const u=new URL(d.url);allowed=u.origin===process.env.CAPTAIN_SMOKE_ORIGIN||u.protocol==='devtools:'||u.protocol==='data:'}catch{}cb({cancel:!allowed})});const w=new BrowserWindow({show:false,width:920,height:240,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}});await w.loadURL(process.env.CAPTAIN_SMOKE_URL)});
app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env, CAPTAIN_SMOKE_PROFILE: join(profile, 'electron-profile'), CAPTAIN_SMOKE_URL: url, CAPTAIN_SMOKE_ORIGIN: origin }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ executablePath: electronPath, args: [harness], env, timeout: 30000 })
  console.log('隔离Electron已连接。')
  const page = await application.firstWindow({ timeout: 15000 })
  await page.addInitScript(() => {
    window.__captainMedia = []; window.__captainAudios = []
    const NativeAudio = window.Audio
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args); window.__captainAudios.push(audio)
      for (const kind of ['loadedmetadata', 'playing', 'pause', 'ended', 'error']) audio.addEventListener(kind, () => window.__captainMedia.push({ kind, duration: audio.duration, time: audio.currentTime, paused: audio.paused, readyState: audio.readyState, at: Date.now() }))
      return audio
    }
  })
  page.on('request', request => {
    requests.push({ method: request.method(), path: new URL(request.url()).pathname })
    if (request.url().endsWith('/player/feedback')) feedback.push({ ...request.postDataJSON(), at: Date.now() })
  })
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/audio/')) audioDownloads.push(response.body().then(bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })))
  })
  await page.reload()
  await expect.poll(() => requests.filter(x => x.path === '/player/poll').length).toBeGreaterThan(0)
  service.say({ id: 'offline-full', text: tuned.sampleText, kind: 'host', at: Date.now() })
  await service.poll()
  await expect.poll(() => feedback.some(x => x.id === 'offline-full' && x.kind === 'started'), { timeout: 15000 }).toBe(true)
  await expect.poll(async () => (await service.view()).current?.phase).toBe('playing')
  await page.screenshot({ path: join(output, 'revision4-playing.png') })
  await expect.poll(() => feedback.some(x => x.id === 'offline-full' && x.kind === 'ended'), { timeout: 20000 }).toBe(true)
  await expect.poll(async () => (await service.view()).current).toBeUndefined()
  report.checks.exactRealWavDecodedAndEnded = true

  service.say({ id: 'offline-stop', text: tuned.sampleText, kind: 'host', at: Date.now() })
  await service.poll()
  await expect.poll(() => feedback.some(x => x.id === 'offline-stop' && x.kind === 'started'), { timeout: 10000 }).toBe(true)
  await wait(250)
  await service.action({ type: 'stop' })
  await expect.poll(() => page.evaluate(() => { const a = window.__captainAudios.at(-1); return !!a && a.paused && a.getAttribute('src') === null })).toBe(true)
  const feedbackBeforeLateEvent = feedback.length
  await page.evaluate(() => { const a = window.__captainAudios.at(-1); a.onplaying?.(new Event('playing')); a.onended?.(new Event('ended')) })
  await wait(1000)
  assert.equal(feedback.length, feedbackBeforeLateEvent, 'Stale media events after stop must not be acknowledged')
  assert.equal((await service.view()).enabled, false)
  assert.equal((await service.view()).current, undefined)
  report.checks.stopClearsPlayingAudioAndStaleMediaEvents = true
  await page.screenshot({ path: join(output, 'revision4-stopped.png') })

  mode = 'late'
  assert.equal((await service.action({ type: 'start' })).ok, true)
  service.say({ id: 'offline-late', text: tuned.sampleText, kind: 'host', at: Date.now() })
  await service.poll()
  await expect.poll(() => !!lateResolve).toBe(true)
  await service.action({ type: 'stop' })
  lateResolve()
  await wait(1200)
  assert.equal((await service.view()).enabled, false)
  assert.equal((await service.view()).current, undefined)
  assert.equal(feedback.some(x => x.id === 'offline-late'), false)
  report.checks.lateOfflineSynthesisCannotReviveStoppedAudio = true
  media.push(...await page.evaluate(() => window.__captainMedia))
  const downloads = await Promise.all(audioDownloads)
  Object.assign(report, { sample: { file: sampleFile, rawFile, ...info, voice: tuned.voice, model: tuned.model, revision: tuned.revision }, stubCalls, feedback: feedback.map(({ client, ...row }) => row), media, audioDownloads: downloads, requests })
  assert.equal(downloads.length, 2)
  assert.ok(downloads.every(x => x.sha256 === info.sha256))
  // Chromium's media duration estimate can differ slightly from exact PCM
  // sample-count duration; downloaded bytes must still match the pinned WAV.
  const ended = media.find(x => x.kind === 'ended')
  Object.assign(report, { browserDurationSeconds: ended?.duration, durationToleranceSeconds: .1 })
  assert.ok(ended && Math.abs(ended.duration - info.duration) < .1)
  Object.assign(report, { passed: true })
  console.log('舰长播放器离线实机验收通过：Chromium实际解码revision4既有真实WAV，started/ended回执、停止清理、迟到合成保护通过；未新合成音频，未读取真实配置，未访问平台或模型。')
} catch (error) {
  Object.assign(report, { passed: false, error: error instanceof Error ? error.stack : String(error) })
  console.error(report.error)
  process.exitCode = 1
} finally {
  await application?.close().catch(() => {})
  await service?.dispose().catch(() => {})
  report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2))
  await writeFile(join(baseOutput, 'latest.json'), JSON.stringify({ directory: output, passed: report.passed, finishedAt: report.finishedAt }, null, 2))
  console.log(`证据目录：${output}`)
  const path = await realpath(profile)
  assert.equal(dirname(path), await realpath(output)); assert.ok(basename(path).startsWith('isolated-'))
  await rm(path, { recursive: true, force: true })
}
