import { spawn as spawnProcess } from 'node:child_process'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const helperPath = fileURLToPath(new URL('../native/ocr_image.ps1', import.meta.url))
const MAX_REQUEST = 32 * 1024 * 1024
const MAX_OUTPUT = 256 * 1024
const fallback = message => ({ ok: false, labels: [], message })
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const finite = value => typeof value === 'number' && Number.isFinite(value)
const round = value => Math.round(value * 100) / 100

function requestFor(image, options) {
  if (!image || image.mimeType !== 'image/png' || typeof image.imageBase64 !== 'string' || !image.imageBase64) return fallback('OCR 只接受传入的 PNG 图片，已跳过文字辅助。')
  const value = image.imageBase64
  if (value.length > MAX_REQUEST - 128) return fallback('OCR 请求超过32 MiB，已跳过文字辅助。')
  if (value.length % 4 || /[^A-Za-z0-9+/=]/u.test(value) || value.indexOf('=') >= 0 && value.indexOf('=') < value.length - 2) return fallback('OCR 图片编码无效，已跳过文字辅助。')
  const header = Buffer.from(value.slice(0, 44), 'base64')
  if (header.length < 33 || !header.subarray(0, 8).equals(pngSignature) || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR') return fallback('OCR 图片不是有效 PNG，已跳过文字辅助。')
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) return fallback('OCR 图片尺寸过大或无效，已跳过文字辅助。')
  const scale = options.scale === undefined ? 1 : options.scale
  if (![1, 2, 3, 4].includes(scale)) return fallback('OCR 放大倍数只支持1至4的整数，已跳过文字辅助。')
  const preprocess = options.preprocess === undefined ? 'none' : options.preprocess
  if (!['none', 'grayscale-invert', 'text-mask'].includes(preprocess)) return fallback('OCR 图片预处理方式无效，已跳过文字辅助。')
  let region
  if (options.region !== undefined) {
    const supplied = options.region
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).sort().join(',') !== 'height,width,x,y' || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(supplied[key])) || supplied.x < 0 || supplied.y < 0 || supplied.width <= 0 || supplied.height <= 0 || supplied.x + supplied.width > width || supplied.y + supplied.height > height) return fallback('OCR 裁切区域必须是原图内完整的整数像素矩形，已跳过文字辅助。')
    region = { x: supplied.x, y: supplied.y, width: supplied.width, height: supplied.height }
  }
  if ((region?.width || width) * scale > 8192 || (region?.height || height) * scale > 8192 || (region?.width || width) * (region?.height || height) * scale * scale > 16777216) return fallback('OCR 裁切放大后的图片尺寸超过上限，已跳过文字辅助。')
  const payload = { imageBase64: value, mimeType: 'image/png', ...(region ? { region } : {}), ...(scale !== 1 ? { scale } : {}), ...(preprocess !== 'none' ? { preprocess } : {}) }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_REQUEST) return fallback('OCR 请求超过32 MiB，已跳过文字辅助。')
  return payload
}

function normalize(result) {
  if (!result || typeof result !== 'object' || result.ok !== true || !Array.isArray(result.labels)) {
    return fallback(typeof result?.message === 'string' && result.message.length <= 300 ? result.message : 'OCR 暂不可用，已跳过文字辅助。')
  }
  const candidates = []
  const seen = new Set()
  for (const label of result.labels.slice(0, 1000)) {
    if (!label || typeof label.text !== 'string') continue
    const text = label.text.replace(/(?<=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu, '').replace(/[\u0000-\u001f\u007f]/gu, '').trim()
    if (!text || [...text].length > 50 || ![label.x, label.y, label.width, label.height].every(finite) || label.x < 0 || label.y < 0 || label.width <= 0 || label.height <= 0 || label.x + label.width > 1000.02 || label.y + label.height > 1000.02) continue
    const x = round(label.x), y = round(label.y), width = round(Math.min(1000 - label.x, label.width)), height = round(Math.min(1000 - label.y, label.height))
    if (width <= 0 || height <= 0) continue
    const key = `${text}:${x}:${y}:${width}:${height}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ text, x, y, width, height, centerX: round(x + width / 2), centerY: round(y + height / 2) })
  }
  candidates.sort((a, b) => [...a.text].length - [...b.text].length || a.y - b.y || a.x - b.x)
  return { ok: true, labels: candidates.slice(0, 120), message: candidates.length ? '已从传入图片提取界面文字；OCR 可能有误，仍需核对截图。' : '传入图片未识别到短界面文字，继续依据有效截图观察。' }
}

function invokeWindowsOcr(payload, options) {
  return new Promise(resolve => {
    if (options.signal?.aborted) { resolve(fallback('OCR 已取消，未继续文字辅助。')); return }
    // This legacy host is a WinRT OCR runtime only, never an administration shell.
    // PowerShell 7 uses .NET rather than the needed .NET Framework projections.
    const executable = win32.join(options.systemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    let child, timer, settled = false, size = 0
    const chunks = []
    function finish(value, kill = false) {
      if (settled) return
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
      if (kill) child?.kill()
      resolve(value)
    }
    const abort = () => finish(fallback('OCR 已取消，未继续文字辅助。'), true)
    try {
      child = (options.spawn || spawnProcess)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
      options.signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => finish(fallback('OCR 超时，已跳过文字辅助，继续依据有效截图观察。'), true), options.timeoutMs)
      child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_OUTPUT) finish(fallback('OCR 返回文字过多，已跳过文字辅助。'), true); else chunks.push(chunk) })
      child.stderr.resume()
      child.on('error', () => finish(fallback('无法启动 Windows PowerShell 5.1 OCR 运行时，已跳过文字辅助。')))
      child.on('close', () => {
        if (settled) return
        try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/u, ''))) }
        catch { finish(fallback('OCR 没有返回有效文字结果，已跳过文字辅助。')) }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(payload), 'utf8')
    } catch { finish(fallback('无法启动 Windows OCR 文字辅助。'), true) }
  })
}

/** Optional, image-only UI label extraction. Call once when a local skill needs
 * text anchors; deliberately not installed in the per-frame capture loop.
 * options.region uses original-image pixels; options.scale is 1 to 4. Returned
 * labels always use original full-image 0..1000 coordinates, including crops.
 * Optional preprocess: grayscale-invert or text-mask, both local image-only.
 * Windows PowerShell 5.1 hosts the .NET Framework WinRT OCR projection only.
 * No desktop/window access, keys, screenshots, remote API or model invocation.
 */
export async function recognizeGameText(image, options = {}) {
  const payload = requestFor(image, options)
  if (payload.ok === false) return payload
  if (options.signal?.aborted) return fallback('OCR 已取消，未继续文字辅助。')
  if (!options.invoke && (options.platform || process.platform) !== 'win32') return fallback('本机没有 Windows OCR 运行时，已跳过文字辅助。')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, Math.min(30000, options.timeoutMs)) : 12000
  try {
    const result = await (options.invoke || (value => invokeWindowsOcr(value, { ...options, timeoutMs })))(payload)
    if (options.signal?.aborted) return fallback('OCR 已取消，未继续文字辅助。')
    return normalize(result)
  } catch { return fallback('OCR 暂不可用，已跳过文字辅助，继续依据有效截图观察。') }
}
