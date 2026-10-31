/** Run only through voice-auditions.mjs --generate. Never logs credentials or signed audio URLs. */
import { app, safeStorage } from 'electron'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { synthesizeQwen } from '../packages/core/src/voice'
import type { AppConfig } from '../packages/shared/src/index'
import plan from './voice-auditions-plan.json'

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || ''
const project = resolve(argument('project'))
const output = resolve(argument('output'))
const outputRoot = join(project, '.local', 'voice-auditions')
if (!argument('project') || !argument('output') || !output.startsWith(`${outputRoot}${sep}`)) throw new Error('请通过项目的声音试听脚本启动。')
const runtimeBase = join(output, '.runtime')
for (const folder of [runtimeBase, join(runtimeBase, 'session'), join(runtimeBase, 'crashes'), join(runtimeBase, 'logs')]) mkdirSync(folder, { recursive: true, mode: 0o700 })
// Matching the real app name selects its OS safeStorage key. A separate userData
// prevents this short-lived Electron process from opening or changing the shop profile.
app.setName('赛博肥鱼')
app.setPath('userData', runtimeBase)
app.setPath('sessionData', join(runtimeBase, 'session'))
app.setPath('crashDumps', join(runtimeBase, 'crashes'))
app.setAppLogsPath(join(runtimeBase, 'logs'))
app.commandLine.appendSwitch('disable-background-networking')

type RecordItem = typeof plan.samples[number] & { status: 'pending' | 'ok' | 'failed' | 'skipped'; file?: string; durationSeconds?: number; bytes?: number; elapsedMs?: number; characters?: number; usage?: { inputTokens?: number; outputTokens?: number }; message?: string }
const manifest = { createdAt: new Date().toISOString(), text: plan.text, sources: plan.sources, maxSynthesisCalls: 12, synthesisCalls: 0, samples: plan.samples.map(sample => ({ ...sample, status: 'pending' as const })) as RecordItem[] }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const maximumBytes = 32 * 1024 * 1024

function wav(pcm: Buffer, sampleRate: number) {
  if (!pcm.length || pcm.length % 2 || pcm.length > maximumBytes) throw new Error('AUDIO_FORMAT')
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/密钥无效|无法解密|未保存|安全存储/.test(message)) return { stop: true, skipModel: false, message: '无法使用当前已保存密钥，请检查本项目的千问密钥、地域或钥匙串授权。' }
  if (/过于频繁|额度不足/.test(message)) return { stop: true, skipModel: false, message: '配音额度不足或请求受限，已停止后续请求。' }
  if (/无法连接|超时/.test(message)) return { stop: true, skipModel: false, message: '配音网络连接失败或超时，已停止后续请求。' }
  if (/HTTP (400|404)|没有返回可播放|音色与模型/.test(message)) return { stop: false, skipModel: true, message: '该模型或音色当前不可用，已跳过此模型的后续样本。' }
  return { stop: false, skipModel: false, message: '本段语音未能完成，未自动重试。' }
}
async function save() {
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  const cards = manifest.samples.map(sample => `<article><h2>${escape(sample.id + ' · ' + sample.name)}</h2><p>${escape(sample.style)}</p><small>${escape(sample.model + ' / ' + sample.voice)}</small>${sample.status === 'ok' && sample.file ? `<audio controls preload="none" src="${escape(sample.file)}"></audio><a href="${escape(sample.file)}" download>保存这段语音</a>` : `<p>${escape(sample.message || (sample.status === 'pending' ? '等待生成' : '未生成'))}</p>`}</article>`).join('')
  await writeFile(join(output, '试听对比.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:"><title>大肥鱼 · 千问声线对比</title><style>body{margin:0;padding:36px;background:#10221e;color:#f2ead4;font:16px/1.6 system-ui}main{max-width:1080px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}article{padding:22px;border:1px solid #45604e;border-radius:18px;background:#182e27}h2{font-size:20px;margin:0}small{display:block;overflow-wrap:anywhere;color:#b7c6b4}audio{display:block;margin:20px 0;width:100%}a{color:#e1c285}.intro{padding:24px;background:#20382c;border-radius:18px;margin-bottom:24px}</style><main><h1>大肥鱼 · 千问声线对比</h1><div class="intro"><p>每段台词相同、语速均为 1.0，便于比较声音与模型；仅试听，不会修改直播设置。</p><p>${escape(plan.text)}</p><p>同声音对照：04 ↔ 08，05 ↔ 09，06 ↔ 10。</p></div><div class="grid">${cards}</div></main></html>`, { mode: 0o600 })
}
async function downloadAudio(url: string): Promise<{ bytes: Buffer; extension: string }> {
  let target = url
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(target)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname.endsWith('.aliyuncs.com')) throw new Error('AUDIO_FORMAT')
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(45000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers.get('location'); await response.body?.cancel(); if (!next) throw new Error('AUDIO_FORMAT'); target = new URL(next, target).toString(); continue }
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maximumBytes) { await response.body?.cancel(); throw new Error('AUDIO_FORMAT') }
    const chunks: Uint8Array[] = []; let size = 0
    const reader = response.body.getReader()
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximumBytes) throw new Error('AUDIO_FORMAT'); chunks.push(next.value) } }
    catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks), magic = bytes.subarray(0, 12).toString('ascii')
    const extension = magic.startsWith('RIFF') && magic.slice(8) === 'WAVE' ? 'wav' : magic.startsWith('ID3') || bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 ? 'mp3' : magic.startsWith('OggS') ? 'ogg' : magic.startsWith('fLaC') ? 'flac' : ''
    if (!extension || !bytes.length) throw new Error('AUDIO_FORMAT')
    return { bytes, extension }
  }
  throw new Error('AUDIO_FORMAT')
}
async function run() {
  const ownProfile = join(project, '.local', 'user-data')
  const stored = JSON.parse(await readFile(join(ownProfile, 'config.json'), 'utf8'))
  const voice = stored.voice as AppConfig['voice']
  if (!voice || typeof voice !== 'object') throw new Error('CONFIG')
  const workspace = argument('workspace')
  if (workspace) {
    if (!/^[a-zA-Z0-9-]+$/.test(workspace)) throw new Error('CONFIG')
    voice.workspaceId = workspace; voice.baseUrl = `https://${workspace}.cn-beijing.maas.aliyuncs.com`
  }
  // Only the encrypted value for this project's qwen provider is read. No other
  // app's profile, credentials, cookies, browser or project is accessed.
  if (!safeStorage.isEncryptionAvailable()) throw new Error('安全存储不可用')
  const record = JSON.parse(await readFile(join(ownProfile, 'credentials.enc.json'), 'utf8'))
  if (typeof record.qwen !== 'string') throw new Error('未保存千问密钥')
  let apiKey: string
  try { apiKey = safeStorage.decryptString(Buffer.from(record.qwen, 'base64')) } catch { throw new Error('无法解密本项目密钥') }
  if (!apiKey.trim()) throw new Error('未保存千问密钥')
  if (manifest.samples.length > 12 || !manifest.samples.length || plan.text.length > 100) throw new Error('PLAN')
  const skippedModels = new Set<string>(); let stopped = false
  await save()
  try {
    for (let index = 0; index < manifest.samples.length; index++) {
      const sample = manifest.samples[index]!
      if (stopped || skippedModels.has(sample.model)) { sample.status = 'skipped'; sample.message = stopped ? '本批次已停止，未发起请求。' : '该模型前一段不可用，未继续请求。'; await save(); continue }
      console.log(`正在合成 ${sample.id}/${manifest.samples.length}：${sample.name} · ${sample.model}`)
      const started = Date.now()
      try {
        if (++manifest.synthesisCalls > 12) throw new Error('PLAN')
        const result = await synthesizeQwen({ text: plan.text, config: { ...voice, model: sample.model, voice: sample.voice, rate: 1, instruction: '' }, apiKey })
        let bytes: Buffer, extension: string
        if (result.kind === 'pcm' && result.data) { const pcm = Buffer.from(result.data, 'base64'); bytes = wav(pcm, result.sampleRate); extension = 'wav'; sample.durationSeconds = +(pcm.length / (2 * result.sampleRate)).toFixed(2) }
        else if (result.kind === 'url' && result.url) ({ bytes, extension } = await downloadAudio(result.url))
        else throw new Error('AUDIO_FORMAT')
        sample.file = `${sample.id}-${sample.name}-${sample.model}.${extension}`
        await writeFile(join(output, sample.file), bytes, { mode: 0o600 })
        sample.status = 'ok'; sample.bytes = bytes.length; sample.characters = result.characters; sample.usage = result.usage
        console.log(`${sample.id} 已保存，可试听。`)
      } catch (error) {
        const safe = failure(error); sample.status = 'failed'; sample.message = safe.message
        console.log(`${sample.id}：${safe.message}`)
        if (safe.skipModel) skippedModels.add(sample.model)
        // The first sample is the connectivity/authentication probe. Do not
        // spend on nine more requests if this probe cannot produce usable audio.
        if (index === 0 || safe.stop) stopped = true
      }
      sample.elapsedMs = Date.now() - started
      await save()
    }
  } finally { apiKey = '' }
  const successes = manifest.samples.filter(sample => sample.status === 'ok').length
  console.log(`本批次结束：${successes}/${manifest.samples.length} 段可试听，实际发起 ${manifest.synthesisCalls} 次合成。`)
  console.log(`试听文件：${join(output, '试听对比.html')}`)
  if (!successes) process.exitCode = 1
}

void app.whenReady().then(run).catch(async error => {
  const message = failure(error).message
  console.error(message)
  manifest.samples.forEach(sample => { if (sample.status === 'pending') { sample.status = 'skipped'; sample.message = message } })
  await save().catch(() => {}); process.exitCode = 1
}).finally(async () => { await rm(runtimeBase, { recursive: true, force: true }).catch(() => {}); app.exit(Number(process.exitCode) || 0) })
