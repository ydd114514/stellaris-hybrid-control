/** Offline/local-image performance benchmark only.
 * No window enumeration, desktop capture, input, game process or model API.
 * OCR is opt-in and reads only the PNG explicitly supplied through --image.
 * Example: node scripts/bench-local.mjs --image .local/.../001.png --ocr-runs 2
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { recognizeGameText } from '../src/ocr.mjs'

const bridgePath = fileURLToPath(new URL('../native/windows_bridge.py', import.meta.url))
const arguments_ = process.argv.slice(2)
const flag = (name, defaultValue) => {
  const index = arguments_.indexOf(name)
  return index < 0 ? defaultValue : arguments_[index + 1]
}
const imageArgument = flag('--image')
if (!imageArgument) throw new Error('请用 --image 明确指定已有本地 PNG；本脚本不会截图。')
const imagePath = resolve(imageArgument)
const ocrRuns = Number(flag('--ocr-runs', '0'))
if (!Number.isInteger(ocrRuns) || ocrRuns < 0 || ocrRuns > 3) throw new Error('--ocr-runs 必须在0至3之间；默认不调用 OCR。')
const pythonPath = flag('--python', 'python')
const round = value => Math.round(value * 100) / 100
const summary = values => ({ samples: values.map(round), minMs: round(Math.min(...values)), medianMs: round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]), maxMs: round(Math.max(...values)) })

function python(code, args = []) {
  const started = performance.now()
  return new Promise((resolveRun, reject) => {
    const child = spawn(pythonPath, ['-X', 'utf8', '-c', code, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    const chunks = []; let size = 0, done = false
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolveRun(value) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('离线 Python 基准超时。')) }, 30000)
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) { child.kill(); finish(new Error('基准结果超过上限。')) } else chunks.push(chunk) })
    child.stderr.resume()
    child.on('error', () => finish(new Error('无法启动 Python 离线基准。')))
    child.on('close', code => {
      if (code !== 0) { finish(new Error('离线 Python 基准失败；只支持本程序生成的 RGB、无交错 PNG。')); return }
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        finish(undefined, { elapsedMs: performance.now() - started, result: text ? JSON.parse(text) : undefined })
      } catch { finish(new Error('离线 Python 基准结果无效。')) }
    })
  })
}

const importer = `import importlib.util,sys
spec=importlib.util.spec_from_file_location('bench_windows_bridge',sys.argv[1])
bridge=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=bridge
spec.loader.exec_module(bridge)
`
const pngProfile = `${importer}
import json,struct,time,zlib
from pathlib import Path
started=time.perf_counter()
data=Path(sys.argv[2]).read_bytes()
assert data[:8]==b'\\x89PNG\\r\\n\\x1a\\n'
width,height,depth,color,compression,filtering,interlace=struct.unpack('>IIBBBBB',data[16:29])
assert width*height<=16777216 and depth==8 and color==2 and interlace==0
offset=8;idat=[]
while offset<len(data):
    length=struct.unpack_from('>I',data,offset)[0]
    if data[offset+4:offset+8]==b'IDAT':idat.append(data[offset+8:offset+8+length])
    offset+=length+12
filtered=zlib.decompress(b''.join(idat))
rowbytes=width*3
assert len(filtered)==height*(rowbytes+1)
assert all(filtered[row*(rowbytes+1)]==0 for row in range(height))
rgb=bytearray(width*height*3)
for row in range(height):rgb[row*rowbytes:(row+1)*rowbytes]=filtered[row*(rowbytes+1)+1:(row+1)*(rowbytes+1)]
bgra=bytearray(width*height*4)
bgra[0::4]=rgb[2::3];bgra[1::4]=rgb[1::3];bgra[2::4]=rgb[0::3]
decode_ms=(time.perf_counter()-started)*1000
validation=[];encoding=[];encoded=None
for trial in range(3):
    started=time.perf_counter();bridge.validate_capture_pixels(bgra);validation.append((time.perf_counter()-started)*1000)
    started=time.perf_counter();encoded=bridge.encode_png(width,height,bgra);encoding.append((time.perf_counter()-started)*1000)
compression_results=[]
for level in (0,1,3,6):
    elapsed=[];compressed=b''
    for trial in range(3):
        started=time.perf_counter();compressed=zlib.compress(filtered,level);elapsed.append((time.perf_counter()-started)*1000)
    compression_results.append({'level':level,'ms':elapsed,'deflateBytes':len(compressed)})
print(json.dumps({'width':width,'height':height,'pixels':width*height,'sourcePngBytes':len(data),'encodedPngBytes':len(encoded),'historicalDecodeMs':decode_ms,'blankValidationMs':validation,'productionPngEncodeMs':encoding,'deflateOnly':compression_results}))
`

const noop = [], imports = []
for (let n = 0; n < 3; n++) noop.push((await python('pass')).elapsedMs)
for (let n = 0; n < 3; n++) imports.push((await python(importer, [bridgePath])).elapsedMs)
const profile = await python(pngProfile, [bridgePath, imagePath])
const png = await readFile(imagePath)
if (png.length > 24 * 1024 * 1024) throw new Error('历史 PNG 超过基准读取上限。')
const base64Ms = [], jsonMs = [], parseMs = []
let base64, serialized
for (let n = 0; n < 5; n++) {
  let start = performance.now(); base64 = png.toString('base64'); base64Ms.push(performance.now() - start)
  start = performance.now(); serialized = JSON.stringify({ ok: true, imageBase64: base64, mimeType: 'image/png' }); jsonMs.push(performance.now() - start)
  start = performance.now(); JSON.parse(serialized); parseMs.push(performance.now() - start)
}
const ocr = []
for (let n = 0; n < ocrRuns; n++) {
  const started = performance.now()
  const result = await recognizeGameText({ imageBase64: base64, mimeType: 'image/png' })
  ocr.push({ elapsedMs: round(performance.now() - started), ok: result.ok, labels: result.labels.length,
    welcomeLabel: result.labels.find(label => label.text.includes('征途'))?.text, message: result.message })
}
const report = { mode: 'offline-and-explicit-local-image-only', note: '新子进程启动；系统文件和OCR模型缓存可能已热。未测 GDI 捕获，不是实际动作往返耗时。',
  pythonColdStart: summary(noop), pythonBridgeImportAndStart: summary(imports), pngProfileWallMs: round(profile.elapsedMs), png: profile.result,
  nodeBase64: summary(base64Ms), nodeJsonStringify: summary(jsonMs), nodeJsonParse: summary(parseMs), base64JsonBytes: Buffer.byteLength(serialized), ocr }
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
