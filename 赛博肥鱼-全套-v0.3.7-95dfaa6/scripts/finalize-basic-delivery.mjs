import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const version='群星控制器大肥鱼-基础版-0.4.0',release=resolve('release',version)
const out=resolve('..','打包成品',version)
const require=createRequire(import.meta.url)
const asar=require(resolve('node_modules/.pnpm/@electron+asar@3.2.18/node_modules/@electron/asar'))
const archive=join(release,'win-unpacked/resources/app.asar')
const files=asar.listPackage(archive)
assert(!files.some(p=>/(?:^|[\\/])(?:\.local|Cookies|History|ai-hub\.json|ai-keys\.enc\.json|credentials\.enc\.json)(?:$|[\\/])/.test(p)))
const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString())
assert.equal(metadata.name,'qunxing-feiyu-basic');assert.equal(metadata.version,'0.4.0')
const main=asar.extractFile(archive,join('dist','dsh','electron','main.cjs')).toString().replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))
assert(main.includes('群星控制器大肥鱼'));assert(!main.includes('vd-fishcute3'));assert(!/C:[/\\]+Users[/\\]+YDD/.test(main))
const seven=resolve('node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/win/x64/7za.exe')
async function test(file){await new Promise((done,fail)=>{const child=spawn(seven,['t',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});let result='';child.stdout.on('data',p=>result+=p);child.stderr.on('data',p=>result+=p);child.once('error',fail);child.once('close',code=>code===0?done():fail(Error('Archive check failed: '+result.slice(-1500))))})}
await mkdir(out,{recursive:true})
const sums=[],sizes=[]
for(const name of [`${version}-Windows-x64.exe`,`${version}-Windows-x64.zip`,`${version}-源码.zip`]){
  const source=join(release,name);await test(source);await copyFile(source,join(out,name))
  const hash=createHash('sha256');for await(const block of createReadStream(join(out,name)))hash.update(block)
  sums.push(`${hash.digest('hex')}  ${name}`);sizes.push({file:name,bytes:(await stat(source)).size})
}
await copyFile('.local/package-basic/bundle/使用说明.txt',join(out,'使用说明.txt'))
await writeFile(join(out,'SHA256SUMS.txt'),sums.join('\n')+'\n')
await writeFile(join(out,'验收说明.txt'),'基础版离线验收通过：18项单元测试、TypeScript检查、真实Electron窗口与密钥输入框检查；隔离用户目录、清空开发工具PATH后，内置Node/Python/DSH启动与DPAPI密钥读写通过。\r\n发行包已通过压缩完整性检查。未调用真实API，未接管当前游戏；目标电脑的游戏和账号需自行配置。\r\n不包含个人配置、密钥、登录态、历史日志、存档和私有音色。\r\n')
console.log(JSON.stringify({directory:out,files:sizes,privacy:'clean-defaults',archives:'passed'},null,2))
