import { deflateSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'

const API_ORIGIN = 'https://api.deepseek.com'
const COLORS = ['black', 'white', 'green', 'red', 'yellow', 'blue', 'gray', 'orange', 'purple']
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
 let crc = value
 for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
 return crc >>> 0
})
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0 }
function pngChunk(type, data) {
 const name = Buffer.from(type, 'ascii'), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
 length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
 return Buffer.concat([length, name, data, checksum])
}

/** A deterministic valid PNG, generated in memory only. */
export function createColorProbePng() {
 const width = 128, height = 64, header = Buffer.alloc(13), rows = Buffer.alloc(height * (1 + width * 3))
 header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * (1 + width * 3) + 1 + x * 3 + (x < width / 2 ? 0 : 2)] = 255
 return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))])
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const abortError = () => Object.assign(new Error('请求已超时。'), { name: 'AbortError' })
function cancellable(work, signal) {
 if (signal.aborted) return Promise.reject(abortError())
 return new Promise((resolve, reject) => {
  const cancel = () => { signal.removeEventListener('abort', cancel); reject(abortError()) }
  signal.addEventListener('abort', cancel, { once: true })
  Promise.resolve().then(() => { if (signal.aborted) throw abortError(); return work() }).then(value => { signal.removeEventListener('abort', cancel); signal.aborted ? reject(abortError()) : resolve(value) }, error => { signal.removeEventListener('abort', cancel); reject(error) })
 })
}
function safeUsage(value) {
 if (!isObject(value)) return null
 const result = {}, number = candidate => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
 for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) if (number(value[key])) result[key] = value[key]
 for (const [group, keys] of [['prompt_tokens_details', ['cached_tokens']], ['completion_tokens_details', ['reasoning_tokens']]]) {
  if (!isObject(value[group])) continue
  const details = {}
  for (const key of keys) if (number(value[group][key])) details[key] = value[group][key]
  if (Object.keys(details).length) result[group] = details
 }
 return Object.keys(result).length ? result : null
}

/** Three bounded, non-interactive checks. No filesystem, desktop, game or tool
 * execution; no retries or redirects. The report contains allowlisted metadata,
 * never request data, credentials, images or model reasoning. */
export async function verifyDeepSeekApi({ apiKey, fetch: fetchOption, timeoutMs = 30_000, model = 'deepseek-flash' } = {}) {
 const report = { ok: false, model: '', checks: { models: false, text: false, vision: false, tools: false }, actualRequests: 0, generatedRequests: 0, requests: [] }
 const clean = (value, limit = 240) => {
  if (typeof value !== 'string') return ''
  let text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (typeof apiKey === 'string' && apiKey) text = text.split(apiKey).join('（密钥已隐藏）')
  text = text.replace(/\bBearer\s+[^\s,;"'<>]+/gi, '认证信息已隐藏').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '密钥已隐藏')
  // A remote error may echo an entire request or reasoning. Do not excerpt it.
  if (/data:image|base64|reasoning_content|"(?:messages|headers|tools|authorization|api_key)"|request[_ ]body|Authorization\s*:/i.test(text)) return '服务端返回了包含请求细节的错误，已省略原文；请核对官方接口格式。'
  return text.slice(0, limit)
 }
 const identifier = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string' || (apiKey && value.includes(apiKey)) || !/^[A-Za-z0-9_.:-]{1,80}$/.test(value) || /^(?:sk-|Bearer)/i.test(value)) return undefined
  return value
 }
 const fail = (stage, code, message, record, remote) => {
  const error = { stage, code, message }
  if (record) error.httpStatus = record.httpStatus
  if (isObject(remote)) {
   const remoteCode = identifier(remote.code), remoteType = identifier(remote.type), remoteMessage = clean(remote.message)
   if (remoteCode) error.remoteCode = remoteCode
   if (remoteType) error.remoteType = remoteType
   if (remoteMessage) error.message = remoteMessage
  }
  if (record) record.error = error
  report.error = error
  return report
 }
 if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n\u0000]/.test(apiKey)) return fail('configuration', 'INVALID_KEY', '未提供有效的 DeepSeek API 密钥，未发送任何请求。')
 apiKey = apiKey.trim()
 if (typeof model !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(model) || model.includes(apiKey)) return fail('configuration', 'INVALID_MODEL', '模型名称无效，未发送任何请求。')
 if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) return fail('configuration', 'INVALID_TIMEOUT', '请求超时配置无效，未发送任何请求。')
 const fetchImpl = fetchOption ?? globalThis.fetch
 if (typeof fetchImpl !== 'function') return fail('configuration', 'FETCH_UNAVAILABLE', '当前 Node.js 不支持 fetch，未发送任何请求。')
 report.model = model

 async function request(stage, method, path, payload) {
  const record = { stage, method, path, elapsedMs: 0, httpStatus: null, returnedModel: null, usage: null, ok: false }
  report.requests.push(record)
  const start = performance.now(), controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
   const response = await cancellable(() => {
    report.actualRequests++; if (method === 'POST') report.generatedRequests++
    return fetchImpl(API_ORIGIN + path, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: 'error', signal: controller.signal })
   }, controller.signal)
   if (Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599) record.httpStatus = response.status
   let data
   try { data = await cancellable(() => response.json(), controller.signal) }
   catch (error) {
    if (timedOut) throw error
    fail(stage, response?.ok ? 'INVALID_JSON' : 'HTTP_ERROR', response?.ok ? '服务端没有返回有效 JSON，验证停止。' : '服务端拒绝请求，且未返回可安全解析的错误说明。', record)
    return { record, failed: true }
   }
   record.returnedModel = typeof data?.model === 'string' ? clean(data.model, 128) : null
   record.usage = safeUsage(data?.usage)
   if (!response?.ok) { fail(stage, 'HTTP_ERROR', 'DeepSeek 请求失败，验证已停止。', record, data?.error); return { record, failed: true } }
   if (!isObject(data)) { fail(stage, 'INVALID_RESPONSE', 'DeepSeek 响应结构无效，验证已停止。', record); return { record, failed: true } }
   return { data, record, failed: false }
  } catch {
   fail(stage, timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', timedOut ? 'DeepSeek 请求超时，验证已停止且不会自动重试。' : 'DeepSeek 网络请求失败，验证已停止；网络异常原文已省略。', record)
   return { record, failed: true }
  } finally { clearTimeout(timer); record.elapsedMs = Math.round((performance.now() - start) * 100) / 100 }
 }

 const models = await request('models', 'GET', '/models')
 if (models.failed) return report
 const selected = models.data.object === 'list' && Array.isArray(models.data.data) ? models.data.data.find(value => isObject(value) && value.id === model) : undefined
 if (!selected) return fail('models', 'MODEL_UNAVAILABLE', '该密钥返回的模型列表中没有指定模型，未开始生成。', models.record)
 if (!Array.isArray(selected.input_modalities) || !selected.input_modalities.includes('image') || !selected.input_modalities.includes('text')) return fail('models', 'IMAGE_UNSUPPORTED', '指定模型没有同时声明文本和图像输入，未开始生成。', models.record)
 models.record.ok = true; report.checks.models = true

 const text = await request('text', 'POST', '/chat/completions', { model, messages: [{ role: 'user', content: '仅回复 DEEPSEEK_CONNECTION_OK，不要添加其他内容。' }], thinking: { type: 'disabled' }, max_tokens: 32, stream: false })
 if (text.failed) return report
 const textChoice = text.data.choices?.[0]
 if (textChoice?.finish_reason !== 'stop' || typeof textChoice?.message?.content !== 'string' || textChoice.message.content.trim() !== 'DEEPSEEK_CONNECTION_OK' || (Array.isArray(textChoice.message.tool_calls) && textChoice.message.tool_calls.length)) return fail('text', 'TEXT_MISMATCH', '文本接口已响应，但未按要求返回连接验证标记。', text.record)
 text.record.ok = true; report.checks.text = true

 const vision = await request('vision-tools', 'POST', '/chat/completions', {
  model, messages: [{ role: 'user', content: [{ type: 'text', text: '观察图片，报告左半区域与右半区域各自的主颜色。根据图像判断，只调用 report_colors。' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${createColorProbePng().toString('base64')}`, detail: 'original' } }] }],
  tools: [{ type: 'function', function: { name: 'report_colors', description: '报告图像左右两半区域的主颜色。', parameters: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'string', enum: COLORS }, right: { type: 'string', enum: COLORS } } } } }],
  tool_choice: 'required', thinking: { type: 'disabled' }, max_tokens: 128, stream: false,
 })
 if (vision.failed) return report
 const choice = vision.data.choices?.[0], calls = choice?.message?.tool_calls
 if (choice?.finish_reason !== 'tool_calls' || !Array.isArray(calls) || calls.length !== 1 || calls[0]?.type !== 'function' || calls[0]?.function?.name !== 'report_colors' || typeof calls[0]?.function?.arguments !== 'string') return fail('vision-tools', 'INVALID_TOOL_CALL', '视觉接口未返回唯一且正确命名的 report_colors 工具调用。', vision.record)
 let colors
 try { colors = JSON.parse(calls[0].function.arguments) } catch { return fail('vision-tools', 'INVALID_TOOL_ARGUMENTS', '视觉工具参数不是有效 JSON。', vision.record) }
 if (!isObject(colors) || Object.keys(colors).length !== 2 || !COLORS.includes(colors.left) || !COLORS.includes(colors.right)) return fail('vision-tools', 'INVALID_TOOL_ARGUMENTS', '视觉工具参数没有严格符合左右颜色结构。', vision.record)
 report.checks.tools = true
 if (colors.left !== 'red' || colors.right !== 'blue') return fail('vision-tools', 'VISION_MISMATCH', '工具格式正确，但视觉识别没有正确区分图像左右颜色。', vision.record)
 report.checks.vision = true; vision.record.ok = true; report.ok = true
 return report
}
