import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, basename, dirname, extname } from 'node:path'
import { spawn } from 'node:child_process'
const root=resolve('.local/package-basic/source'),out=resolve('release/群星控制器大肥鱼-基础版-0.4.0')
await mkdir(root,{recursive:true});await mkdir(out,{recursive:true})
async function copy(from,to){await mkdir(dirname(to),{recursive:true});await cp(from,to,{recursive:true,filter:p=>!['.local','.git','node_modules','__pycache__'].includes(basename(p))&&!/\.(log|dpapi|sqlite|sav)$/.test(p)})}
for(const dir of ['apps','packages','licenses','assets/model-logos','assets/stellaris'])await copy(dir,join(root,dir))
for(const file of ['package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.electron.json','vite.config.ts','stellaris.html','electron-builder.basic.json','LICENSE','THIRD_PARTY_NOTICES.md','assets/app-icon.png','scripts/build-dsh.mjs','scripts/prepare-basic-bundle.mjs','scripts/smoke-basic-desktop.mjs','scripts/export-basic-source.mjs'])await copy(file,join(root,file))
await copy('.local/package-basic/bundle/controller',join(root,'stellaris-player'))
const recipe=join(root,'scripts/prepare-basic-bundle.mjs')
await writeFile(recipe,(await readFile(recipe,'utf8')).replace(/C:[/\\]+Users[/\\]+YDD/g,'C:/Users/BUILD_USER').replace(/E:[/\\]+肥鱼直播/g,'C:/Build'))
// The build transform uses a public voice. Do not distribute a private voice ID in source.
const voice=join(root,'packages/core/src/stellaris-voice-presets.ts')
await writeFile(voice,(await readFile(voice,'utf8')).replace(/qwen-audio-3\.1-tts-flash-vd-[A-Za-z0-9-]+/g,'Cherry').replaceAll('qwen-audio-3.1-tts-flash','qwen3-tts-flash'))
await writeFile(join(root,'BUILD.txt'),'群星控制器大肥鱼 · 基础版源码\n\n控制台源代码为 AGPL-3.0-or-later。第三方保留各自许可证与来源。\n安装 pnpm 依赖后使用 node scripts/build-dsh.mjs --basic 构建界面和主进程。\n便携控制器的适配后源码在 stellaris-player，安装包 runtime 和 engine 提供对应运行环境。\n打包配置：electron-builder.basic.json。原生 DLL 的来源、完整补丁与许可证在 stellaris-player/licenses/stellaris-native。\n源码包不含用户配置、密钥、账号和历史数据。\n')
async function audit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await audit(p);else if(['.ts','.vue','.mjs','.json','.ps1','.py','.yml','.md'].includes(extname(p))){const t=await readFile(p,'utf8');if(/C:[/\\]+Users[/\\]+YDD|E:[/\\]+肥鱼直播|qwen-audio-3\.1-tts-flash-vd-[a-z0-9-]{8}/i.test(t))throw Error('Personal path in '+p)}}}
await audit(root)
const seven=resolve('node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/win/x64/7za.exe'),file=join(out,'群星控制器大肥鱼-基础版-0.4.0-源码.zip')
await new Promise((done,fail)=>{const child=spawn(seven,['a','-tzip','-mx=5',file,'.'],{cwd:root,windowsHide:true,stdio:'ignore'});child.on('error',fail);child.on('close',c=>c===0?done():fail(Error('Source ZIP failed')))})
console.log('基础版源码包已导出，并通过个人路径检查。')
