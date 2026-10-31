import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

if (process.platform !== 'win32') throw new Error('此检查需要 Windows。')
const root = process.cwd(), testRoot = join(root, '.local/test-data')
await mkdir(testRoot, { recursive: true })
const folder = await mkdtemp(join(testRoot, 'windows-ocr-'))
const helper = process.argv.includes('--packaged') ? join(root, 'release/win-unpacked/resources/app.asar.unpacked/dist/electron/native/live-screen-ocr.ps1') : join(root, 'dist/electron/native/live-screen-ocr.ps1')
const windows = process.env.SystemRoot || 'C:\\Windows'
let fixture
async function request(body) {
  const child = spawn(join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe','pipe','pipe'], windowsHide: true })
  let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', text => output += text); child.stderr.resume()
  const timer = setTimeout(() => child.kill(), 20000)
  child.stdin.end(JSON.stringify(body))
  try {
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Windows capture helper failed or timed out'))) })
    return JSON.parse(output)
  } finally { clearTimeout(timer) }
}
try {
  const exe = join(folder, 'douyin-ocr-fixture.exe'), idFile = join(folder, 'window-id.txt')
  execFileSync(join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo','/target:winexe',`/out:${exe}`,'/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',join(root,'tests/fixtures/ocr-window.cs')], { windowsHide: true, stdio: 'pipe' })
  fixture = spawn(exe, [idFile], { stdio: 'ignore', windowsHide: true })
  let windowId
  for (let attempt = 0; attempt < 50; attempt++) { try { windowId = Number(await readFile(idFile, 'utf8')); if (windowId) break } catch {}; await delay(100) }
  assert(windowId, 'Synthetic window did not start')
  const regions = [{ region:'comment',roi:{x:.03,y:.07,width:.9,height:.28} }, { region:'gift',roi:{x:.03,y:.4,width:.9,height:.3} }]
  const output = await request({windowId,regions})
  assert.equal(output.error, undefined, output.error)
  await build({entryPoints:['apps/desktop/electron/live-screen-parser.ts'],outfile:join(folder,'parser.mjs'),bundle:true,platform:'node',format:'esm'})
  const { parseScreenCandidates } = await import(pathToFileURL(join(folder,'parser.mjs')).href)
  const candidates = parseScreenCandidates(output.observations)
  assert(candidates.some(row => row.kind === 'chat' && row.userName === '小周' && row.text.includes('你好')), JSON.stringify(output))
  assert(candidates.some(row => row.kind === 'gift' && row.giftName === '小心心' && row.count === 3), JSON.stringify(output))
  const preview = await request({windowId,regions,preview:true})
  assert.equal(preview.error, undefined)
  assert.equal(preview.images.length,2)
  assert(preview.images.every(row=>/^data:image\/jpeg;base64,/.test(row.dataUrl)))
  const missing = await request({windowId:0,regions})
  assert.equal(missing.error,'window-missing')
  console.log('Windows window capture passed: isolated synthetic HWND, Chinese comment/gift/count parsing, two ROI previews, missing-window rejection; no real companion or paid API used.')
} finally {
  if (fixture && fixture.exitCode === null) { const closed = new Promise(resolve => fixture.once('exit',resolve)); fixture.kill(); await closed }
  // folder is a newly created child of the fixed project-local test root.
  assert(resolve(folder).startsWith(resolve(testRoot) + '\\'))
  await rm(folder, {recursive:true,force:true})
}
