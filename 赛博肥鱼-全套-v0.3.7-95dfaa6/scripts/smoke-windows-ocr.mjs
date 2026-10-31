import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

if (process.platform !== 'win32') throw new Error('此检查需要 Windows。')
const root = process.cwd()
const helper = process.argv.includes('--packaged')
  ? join(root, 'release/win-unpacked/resources/app.asar.unpacked/dist/electron/native/live-screen-ocr.ps1')
  : join(root, 'dist/electron/native/live-screen-ocr.ps1')
assert(existsSync(helper), '请先构建或打包 Windows 程序。')
const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let output = ''
child.stdout.setEncoding('utf8'); child.stdout.on('data', text => { output += text })
child.stderr.resume()
const timeout = setTimeout(() => { child.kill(); throw new Error('Windows OCR 预热超时。') }, 30000)
child.stdin.end(JSON.stringify({ windowId: 0, warmup: true, regions: [{ region: 'comment', roi: { x: .81, y: .48, width: .175, height: .44 } }, { region: 'gift', roi: { x: .81, y: .34, width: .175, height: .13 } }] }))
try {
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Windows OCR 组件退出异常。'))) })
  const result = JSON.parse(output)
  assert.equal(result.version, 1)
  assert.equal(result.error, undefined, result.error === 'ocr-language' ? '缺少简体中文 OCR 语言组件。' : 'Windows OCR 预热失败。')
  assert(Array.isArray(result.observations))
  console.log('Windows OCR 通过：使用内存中的中性中文测试图完成识别；未读取真实窗口。')
} finally { clearTimeout(timeout) }
