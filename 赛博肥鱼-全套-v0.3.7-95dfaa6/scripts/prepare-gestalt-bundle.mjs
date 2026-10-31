// Build from a strict code allowlist; never copy project runtime/user profiles.
import { cp, copyFile, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const player = resolve(project, '../stellaris-player')
const stage = join(project, '.local/package-gestalt/bundle')
if (!stage.startsWith(join(project, '.local/package-gestalt') + '\\')) throw Error('Unexpected staging directory')
if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
const controller = join(stage, 'controller')
const excluded = new Set(['.git', '.local', '__pycache__', 'site-packages', 'test', 'tests', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip'])
async function copy(from, to) { await mkdir(dirname(to), { recursive: true }); await cp(from, to, { recursive: true, dereference: true, filter: path => !excluded.has(basename(path)) && !/\.(pyc|log|map|dpapi|sqlite|db|sav|pfx|pem|key)$/.test(path) }) }
for (const dir of ['src', 'plugins']) await copy(join(player, dir), join(controller, dir))
for (const file of ['package.json', 'LICENSE', 'native/windows_bridge.py', 'native/credential_store.ps1', 'native/research/LICENSE', 'scripts/autoplay-native.mjs', 'scripts/play-native-dsh.mjs', 'scripts/desktop-preflight.mjs', 'scripts/commentary-server.mjs', 'public/commentary.html', 'public/fatfish.svg', 'public/assets/feiyu-captain-v1.png', 'public/assets/feiyu-captain-animated-v1.gif']) await copy(join(player, file), join(controller, file))
for (const entry of await readdir(join(player, 'native/research'))) if (entry.endsWith('.py')) await copy(join(player, 'native/research', entry), join(controller, 'native/research', entry))
await copy(join(player, 'vendor/stellaris-native'), join(controller, 'licenses/stellaris-native'))
await copy(join(player, '.local/native-bridge/runtime/cyberfish-0.6.6-gestalt-war-r1/stellaris_bridge.dll'), join(controller, 'native/runtime/stellaris_bridge.dll'))
const nodeHome = dirname(process.execPath)
await copyFile(process.execPath, (await mkdir(join(stage, 'runtime/node'), { recursive: true }), join(stage, 'runtime/node/node.exe')))
const pythonHome = process.env.FEIYU_PYTHON_HOME || 'C:/Program Files/Python315'
for (const entry of await readdir(pythonHome)) if (/^(python(?:w|3|315)?\.(exe|dll)|vcruntime.*\.dll|LICENSE\.txt)$/.test(entry)) await copy(join(pythonHome, entry), join(stage, 'runtime/python', entry))
for (const dir of ['Lib', 'DLLs']) await copy(join(pythonHome, dir), join(stage, 'runtime/python', dir))
await writeFile(join(stage, 'runtime/python/python315._pth'), '.\nLib\nDLLs\n')
const dsh = process.env.FEIYU_DSH_PACKAGE || join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh')
console.log('正在复制官方 DSH 引擎及其依赖（不含 DSH 用户目录）。')
await copy(dsh, join(stage, 'engine/dsh'))
await mkdir(join(stage, 'licenses'), { recursive: true })
const nodeLicense = await readFile(join(project,'.local/package-basic/bundle/licenses/Node-LICENSE.txt'),'utf8')
await writeFile(join(stage, 'licenses/Node-LICENSE.txt'), nodeLicense)
await copy(join(dsh, 'LICENSE'), join(stage, 'licenses/DSH-MIT.txt'))
async function edit(path, transform) { const file = join(controller, path); const old = await readFile(file, 'utf8'); await writeFile(file, transform(old)) }
const ps = "process.env.CYBERFISH_POWERSHELL || 'powershell.exe'"
await edit('src/credentials.mjs', s => s.replace("'C:/Program Files/PowerShell/7/pwsh.exe'", ps))
await edit('native/credential_store.ps1', s => s.replace('Add-Type -AssemblyName System.Security.Cryptography.ProtectedData', 'Add-Type -AssemblyName System.Security').replace('[IO.File]::Move($taskTemporary,$CredentialPath,$true)', 'if ([IO.File]::Exists($CredentialPath)) { [IO.File]::Replace($taskTemporary,$CredentialPath,$null) } else { [IO.File]::Move($taskTemporary,$CredentialPath) }'))
await edit('src/native-bootstrap.mjs', s => s
  .replace("const gamePath = 'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe';", 'let gamePath = process.env.CYBERFISH_GAME_PATH;')
  .replace("const documents = 'C:/Users/YDD/Documents/Paradox Interactive/Stellaris';", "const documents = join(process.env.USERPROFILE, 'Documents/Paradox Interactive/Stellaris');")
  .replace("const python = 'C:/Program Files/Python315/python.exe';", 'const python = process.env.CYBERFISH_PYTHON;')
  .replace('../.local/native-bridge/runtime/cyberfish-0.6.6-gestalt-war-r1/stellaris_bridge.dll', '../native/runtime/stellaris_bridge.dll')
  .replace('return result.windows[0];', 'if (result.windows[0]) process.env.CYBERFISH_GAME_PATH = gamePath = result.windows[0].executable;\n  return result.windows[0];')
  .replaceAll("'C:/Program Files/PowerShell/7/pwsh.exe'", ps))
await edit('src/native-process.mjs', s => s.replace("'C:/Program Files/Python315/python.exe'", 'process.env.CYBERFISH_PYTHON'))
await edit('native/research/native_session.py', s => s.replace('import sys', 'import sys\nimport os').replace('GAME_PATH = "D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe"', 'GAME_PATH = os.environ.get("CYBERFISH_GAME_PATH", "")'))
await edit('scripts/desktop-preflight.mjs', s => s.replace('`${process.env.APPDATA}/npm/node_modules/@deepseek-ai/dsh/lib/bin.js`', 'new URL("./lib/bin.js", "file:///" + process.env.CYBERFISH_DSH_PACKAGE.replaceAll("\\\\", "/"))').replace('群星控制器尚未配置本机 DeepSeek 密钥，请先在控制器中完成配置。', '请展开“首次使用：配置游戏 AI 密钥”，保存你自己的 DeepSeek 官方密钥。'))
await edit('plugins/stellaris-dsh/game-compaction.mjs', s => s.replace("'C:/Users/YDD/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json'", 'process.env.CYBERFISH_DSH_PACKAGE'))
await edit('plugins/stellaris-dsh/cordis.patch.yml', s => s
  .replace(/name: '[^\n]*game-compaction\.mjs'/, "name: '__FEIYU_COMPACTION__'")
  .replace(/command: '[^\n]*node\.exe'/, "command: '__FEIYU_NODE__'")
  .replace(/- '[^\n]*native-mcp\.mjs'/, "- '__FEIYU_MCP__'")
  .replace(/cwd: '[^\n]*'/, "cwd: '__FEIYU_ROOT__'"))
await edit('scripts/play-native-dsh.mjs', s => s
  .replace("import {loadDeepSeekKey}", "import {readFile} from 'node:fs/promises';\nimport {join,dirname} from 'node:path';\nimport {loadDeepSeekKey}")
  .replace("const args = ['C:/Users/YDD/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js'", "const template = await readFile('plugins/stellaris-dsh/cordis.patch.yml','utf8');\nconst quote = value => value.replaceAll(\"'\", \"''\");\nconst patch = template.replaceAll('__FEIYU_COMPACTION__',quote(resolve('plugins/stellaris-dsh/game-compaction.mjs'))).replaceAll('__FEIYU_NODE__',quote(process.execPath)).replaceAll('__FEIYU_MCP__',quote(resolve('src/native-mcp.mjs'))).replaceAll('__FEIYU_ROOT__',quote(process.cwd()));\nawait mkdir('.local/native-bridge',{recursive:true});\nawait writeFile('.local/native-bridge/portable.patch.yml',patch);\nconst args = [join(dirname(process.env.CYBERFISH_DSH_PACKAGE),'lib/bin.js')")
  .replace("process.env.CYBERFISH_DSH_PATCH || 'plugins/stellaris-dsh/cordis.patch.yml'", "process.env.CYBERFISH_DSH_PATCH || '.local/native-bridge/portable.patch.yml'")
  .replace("process.env.CYBERFISH_DSH_HOME || 'C:/Users/YDD/AppData/Local/Cyberfish/dsh'", 'process.env.CYBERFISH_DSH_HOME')
  .replaceAll("'C:/Program Files/PowerShell/7/pwsh.exe'", ps))
// Only runtime helpers ship; diagnostic CLIs contain developer-specific defaults.
for (const file of ['src/cli.mjs']) await rm(join(controller, file), { force: true })
await edit('scripts/commentary-server.mjs', s => s.replace("'C:/Users/YDD/AppData/Local'", 'process.env.TEMP'))
await edit('licenses/stellaris-native/NOTICE.md', s => s.replaceAll('E:\\肥鱼直播\\.local\\research\\stellaris-mcp-native', '(build workspace)'))
await writeFile(join(stage, 'manifest.json'), JSON.stringify({ name: '群星控制器大肥鱼', edition: 'gestalt', version: '0.3.16', dshVersion: JSON.parse(await readFile(join(dsh, 'package.json'))).version, nodeVersion: process.versions.node, target: 'Windows x64', gameVersion: '4.5.2 (9776)', bridgeVersion:'cyberfish-0.6.6-gestalt-war-r1', bridgeSha256:createHash('sha256').update(await readFile(join(controller,'native/runtime/stellaris_bridge.dll'))).digest('hex'), containsUserData: false }, null, 2))
const readme = `群星控制器大肥鱼 0.3.16 · 格式塔首战版\r\n\r\n使用：安装版双击 EXE 安装；免安装版先完整解压 ZIP，再双击“大肥鱼 DSH.exe”，不要只复制 EXE。\r\n支持 Windows 10/11 x64；已内置 Node、Python 和 DSH，无需另装开发环境。\r\n游戏需自行安装：当前原生桥仅适配群星 4.5.2 (9776) 的已验证文件指纹，其他版本会拒绝接管。\r\n在“群星控制”展开首次使用设置，填写自己的 DeepSeek 官方密钥。先手动打开游戏、载入非铁人单人存档，再点击启动大肥鱼。\r\n保留当前 AI 中枢、点歌、语音与弹幕功能；密钥仍由你在设置中配置。\r\n本包没有任何旧密钥、账号、直播间、聊天记录、日志、截图、存档或个人定制音色。B站和QQ需要自己扫码登录；语音使用公共音色，仍需自己的服务密钥。\r\n桌面资料沿用本应用原有的用户资料目录；随包控制器保存在资料目录的.local/dsh-desktop/controller-0.3.16，安装包不包含个人资料。\r\n游戏控制和聊天为不同会话；保存密钥不会自动请求模型，启动后模型服务按自己的账号计费。\r\n首战已在用户授权加速测试局验证真实占领、议和、正常返航与60艘补员恢复；自然开局和长期经济仍待校准。请手动载入单人非铁人测试局，本程序不替你开播。开发代码、第三方许可证随包提供；自制控制台与官方 DeepSeek Harness 保留各自名称和出处。\r\n`
await writeFile(join(stage, '使用说明.txt'), '\uFEFF' + readme)
// Fail closed on identifying machine paths and on files outside the clean allowlist.
const hashes = []
async function audit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), relative = path.slice(stage.length + 1).replaceAll('\\', '/')
    if (entry.isDirectory()) { if (['.git', '.local', '__pycache__'].includes(entry.name)) throw Error('Private directory in package: ' + relative); await audit(path); continue }
    if (/^(?:credentials(?:\.enc)?\.json|ai-keys\.enc\.json|ai-hub\.json|Cookies|History)$|session\.enc|\.dpapi$|\.jsonl$|\.sav$/i.test(entry.name)) throw Error('Private state filename: ' + relative)
    if (relative.startsWith('controller/') && ['.mjs','.py','.ps1','.yml','.html','.md','.json','.patch'].includes(extname(path))) {
      const value = await readFile(path, 'utf8')
      if (/C:[/\\]+Users[/\\]+YDD|E:[/\\]+肥鱼直播|qwen-audio-3\.1-tts-flash-vd-/i.test(value)) throw Error('Personal path/voice in ' + relative)
    }
    hashes.push(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative}`)
  }
}
await audit(stage)
await writeFile(join(stage, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
console.log(`格式塔首战版组件准备完毕，${hashes.length} 个文件；已通过个人路径和数据文件检查。`)
