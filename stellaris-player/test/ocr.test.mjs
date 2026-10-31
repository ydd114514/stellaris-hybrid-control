import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { recognizeGameText } from '../src/ocr.mjs'

const png = Buffer.alloc(33)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(2560, 16); png.writeUInt32BE(1440, 20)
const image = { imageBase64: png.toString('base64'), mimeType: 'image/png' }
const box = (text, patch = {}) => ({ text, x: 200, y: 800, width: 100, height: 30, ...patch })

test('OCR accepts only supplied PNG bytes and forwards no window or account fields', async () => {
  let request
  const output = await recognizeGameText({ ...image, windowId: 'private-window', apiKey: 'must-not-forward' }, { invoke: async payload => {
    request = payload
    return { ok: true, labels: [box('开 始 游 戏', { confidence: .99, centerX: 0, centerY: 0, extra: 'ignored' })] }
  } })
  assert.deepEqual(request, image)
  assert.deepEqual(output.labels, [{ text: '开始游戏', x: 200, y: 800, width: 100, height: 30, centerX: 250, centerY: 815 }])
  assert.equal(JSON.stringify(output).includes('confidence'), false)
})

test('short UI labels are preferred, de-duplicated, and limited to 120', async () => {
  const labels = [box('说明文字'.repeat(20)), box('开始游戏'), box('开始游戏'), box('AB 中文 text')]
  for (let n = 0; n < 180; n++) labels.push(box(`UI${n}`, { x: n, y: n }))
  labels.push(box('x', { x: -1 }), box('y', { height: NaN }), box('z', { width: 1000 }), box('empty', { height: 0 }))
  const result = await recognizeGameText(image, { invoke: async () => ({ ok: true, labels }) })
  assert.equal(result.ok, true); assert.equal(result.labels.length, 120)
  assert.equal(result.labels.some(item => item.text === 'x' || item.text === 'y' || item.text === 'z' || item.text.length > 50), false)
  assert.equal(result.labels.filter(item => item.text === '开始游戏').length, 1)
  assert.equal(result.labels.every(item => item.centerX >= 0 && item.centerX <= 1000 && item.centerY >= 0 && item.centerY <= 1000), true)
})

test('bad MIME, oversized PNG dimensions and 32 MiB input fail before invoking OCR', async () => {
  let calls = 0
  const invoke = async () => { calls++; throw new Error('must not run') }
  const oversized = Buffer.from(png); oversized.writeUInt32BE(10000, 16)
  const values = [null, { ...image, mimeType: 'image/jpeg' }, { ...image, imageBase64: 'not a png' },
    { ...image, imageBase64: oversized.toString('base64') }, { ...image, imageBase64: 'A'.repeat(32 * 1024 * 1024) }]
  for (const value of values) {
    const result = await recognizeGameText(value, { invoke })
    assert.equal(result.ok, false); assert.deepEqual(result.labels, []); assert.ok(result.message)
  }
  assert.equal(calls, 0)
})

test('3x/4x and generic image preprocessing preserve native full-image coordinates', async () => {
  for (const scale of [3, 4]) {
    for (const preprocess of ['grayscale-invert', 'text-mask']) {
      let received
      const region = { x: 30, y: 170, width: 480, height: 500 }
      const result = await recognizeGameText(image, { region, scale, preprocess, invoke: async payload => {
        received = payload
        return { ok: true, labels: [box('测试标题', { x: 18.16, y: 160.94, width: 38.09, height: 10.94 })] }
      } })
      assert.deepEqual(received, { ...image, region, scale, preprocess })
      assert.equal(result.labels[0].x, 18.16); assert.equal(result.labels[0].y, 160.94)
    }
  }
  const large = Buffer.from(png); large.writeUInt32BE(4096, 16); large.writeUInt32BE(4096, 20)
  let calls = 0
  const invoke = async () => { calls++; return { ok: true, labels: [] } }
  assert.equal((await recognizeGameText({ ...image, imageBase64: large.toString('base64') }, { scale: 2, invoke })).ok, false)
  for (const preprocess of ['guess-titles', '', true, { name: 'text-mask' }]) {
    assert.equal((await recognizeGameText(image, { preprocess, invoke })).ok, false)
  }
  assert.equal(calls, 0)
})

test('ROI uses original-image integer pixels and scale is explicitly bounded', async () => {
  const region = { x: 0, y: 35, width: 1100, height: 800 }
  let forwarded
  const result = await recognizeGameText(image, { region, scale: 2, invoke: async payload => {
    forwarded = payload
    // Native OCR already maps a crop box into the original 2560x1440 image.
    // This simulates a glyph at ROI-local (100,200), size (80,20), after 2x OCR.
    return { ok: true, labels: [box('选择科技', { x: 39.06, y: 163.19, width: 31.25, height: 13.89 })] }
  } })
  assert.deepEqual(forwarded, { ...image, region, scale: 2 })
  assert.deepEqual(result.labels[0], { text: '选择科技', x: 39.06, y: 163.19, width: 31.25, height: 13.89, centerX: 54.69, centerY: 170.14 })
  let calls = 0
  const invoke = async () => { calls++; throw new Error('invalid ROI must not launch runtime') }
  const badOptions = [{ scale: 0 }, { scale: 5 }, { scale: '2' }, { scale: true }, { region: null },
    { region: { ...region, x: -1 } }, { region: { ...region, y: 0.5 } }, { region: { ...region, width: 0 } },
    { region: { ...region, x: 2500 } }, { region: { ...region, y: 1000 } }, { region: { ...region, height: NaN } },
    { region: { ...region, windowId: 'not allowed' } }]
  for (const options of badOptions) {
    const invalid = await recognizeGameText(image, { ...options, invoke })
    assert.equal(invalid.ok, false); assert.deepEqual(invalid.labels, [])
  }
  assert.equal(calls, 0)
})

test('missing OCR, missing language and errors fall back without throwing into player', async () => {
  const unsupported = await recognizeGameText(image, { platform: 'linux' })
  assert.equal(unsupported.ok, false); assert.match(unsupported.message, /Windows OCR/u)
  const language = await recognizeGameText(image, { invoke: async () => ({ ok: false, labels: [], message: 'Windows 简体中文 OCR 语言组件不可用。' }) })
  assert.equal(language.ok, false); assert.match(language.message, /中文/u)
  const failed = await recognizeGameText(image, { invoke: async () => { throw new Error('internal-secret-error') } })
  assert.equal(failed.ok, false); assert.equal(JSON.stringify(failed).includes('secret'), false)
})

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const input = []
  child.stdin = new Writable({ write(chunk, encoding, done) { input.push(Buffer.from(chunk)); done() } })
  child.kill = () => { child.killed = true }
  child.request = () => JSON.parse(Buffer.concat(input).toString('utf8'))
  return child
}

test('real runner uses hidden PowerShell 5.1 WinRT runtime without a shell or desktop APIs', async () => {
  const child = fakeChild(); let argumentsUsed
  const pending = recognizeGameText(image, { platform: 'win32', systemRoot: 'C:\\Windows', spawn: (...args) => { argumentsUsed = args; return child } })
  assert.match(argumentsUsed[0], /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/u)
  assert.equal(argumentsUsed[2].windowsHide, true); assert.equal(argumentsUsed[2].shell, false)
  assert.ok(argumentsUsed[1].includes('-NoProfile')); assert.ok(argumentsUsed[1].includes('-NonInteractive'))
  assert.deepEqual(child.request(), image)
  child.stdout.end(JSON.stringify({ ok: true, labels: [box('确定')] })); child.emit('close', 0)
  assert.equal((await pending).labels[0].text, '确定')
  const helper = await readFile(new URL('../native/ocr_image.ps1', import.meta.url))
  assert.deepEqual([...helper.subarray(0, 3)], [239, 187, 191])
  const source = helper.toString('utf8')
  assert.match(source, /System\.Runtime\.WindowsRuntime/u)
  assert.doesNotMatch(source, /DllImport|PrintWindow|CopyFromScreen|SendInput|GetForegroundWindow|Get-Process/u)
})

test('timeout and cancellation terminate OCR runtime and degrade to screenshot-only', async () => {
  const child = fakeChild()
  const timeout = await recognizeGameText(image, { platform: 'win32', timeoutMs: 100, spawn: () => child })
  assert.equal(timeout.ok, false); assert.match(timeout.message, /超时/u); assert.equal(child.killed, true)
  const cancelledChild = fakeChild(), controller = new AbortController()
  const pending = recognizeGameText(image, { platform: 'win32', signal: controller.signal, spawn: () => cancelledChild })
  controller.abort()
  const cancelled = await pending
  assert.equal(cancelled.ok, false); assert.match(cancelled.message, /取消/u); assert.equal(cancelledChild.killed, true)
})
