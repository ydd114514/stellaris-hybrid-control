// Offline archive and version checks. Never launches Electron, the game or DSH.
import {readFile,writeFile,readdir,mkdir,copyFile,cp,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd();
const release=resolve('release/dsh-gestalt-0.3.16'),resources=join(release,'win-unpacked/resources');
const bundle=join(resources,'feiyu-bundle'),controller=join(bundle,'controller');
const out=resolve('../打包成品/格式塔首战新版-0.3.16');await mkdir(out,{recursive:true});
const sha=async path=>{const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');};
const asar=require(resolve('node_modules/.pnpm/@electron+asar@3.2.18/node_modules/@electron/asar'));
const appArchive=join(resources,'app.asar');
const pkg=JSON.parse(asar.extractFile(appArchive,'package.json').toString());assert.equal(pkg.version,'0.3.16');
const paths=asar.listPackage(appArchive);assert(!paths.some(p=>/(?:^|[\\/])(?:\.local|Cookies|History|ai-keys\.enc\.json|credentials\.enc\.json)(?:$|[\\/])/.test(p)));
const main=asar.extractFile(appArchive,join('dist','dsh','electron','main.cjs')).toString();assert(main.includes('preferredProject'));assert(main.includes('feiyu-bundle'));
const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));assert.equal(manifest.version,'0.3.16');assert.equal(manifest.bridgeVersion,'cyberfish-0.6.6-gestalt-war-r1');
assert.equal(await sha(join(controller,'native/runtime/stellaris_bridge.dll')),manifest.bridgeSha256);
const pe=await readFile(join(controller,'native/runtime/stellaris_bridge.dll'));const peOffset=pe.readUInt32LE(0x3c);assert.equal(pe.readUInt16LE(peOffset+4),0x8664);assert(pe.includes(Buffer.from(manifest.bridgeVersion)));
const sourceFiles=['first-war','war-actions','native-game','gestalt-campaign','gestalt-tasks','native-mcp','bridge-capabilities','order-tracker','fleet-capacity','market-maintenance'];
for(const name of sourceFiles)assert.equal(await sha(join(controller,`src/${name}.mjs`)),await sha(resolve('../stellaris-player/src',name+'.mjs')));
const bootstrap=await readFile(join(controller,'src/native-bootstrap.mjs'),'utf8');assert(bootstrap.includes('../native/runtime/stellaris_bridge.dll'));assert(!bootstrap.includes('.local/native-bridge/runtime/'));
const mcp=await readFile(join(controller,'src/native-mcp.mjs'),'utf8');assert(mcp.includes('war_fleets'));assert(mcp.includes("name:'campaign'"));
await new Promise((done,fail)=>{
 const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
 const p=spawn(join(bundle,'runtime/node/node.exe'),[join(controller,'src/native-mcp.mjs')],{cwd:controller,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
 p.stdout.on('data',b=>output+=b);p.stderr.resume();p.on('error',fail);
 p.on('close',code=>{try{assert.equal(code,0);const tools=JSON.parse(output.trim()).result.tools;const commands=tools.find(t=>t.name==='apply_orders').inputSchema.properties.orders.items.properties.command.enum;for(const name of ['declare_war','land_armies','offer_peace','recruit_planet_army','embark_all_armies'])assert(commands.includes(name));done();}catch(e){fail(e);}});
 p.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
});
if(process.argv.includes('--preflight')){console.log('版本、DLL、随包源码与内置 Node 的 MCP 命令清单离线验证通过；未启动游戏或 Electron。');process.exit(0);}
const seven=resolve('node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/win/x64/7za.exe');
async function command(args){return new Promise((done,fail)=>{const p=spawn(seven,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',b=>text=(text+b).slice(-3000));p.stderr.on('data',b=>text=(text+b).slice(-3000));p.on('error',fail);p.on('close',code=>code?fail(Error(text)):done());});}
const files=[];
for(const filename of ['Cyberfish-DSH-Gestalt-0.3.16-Windows-x64.exe','Cyberfish-DSH-Gestalt-0.3.16-Windows-x64.zip']){
 const path=join(release,filename);await command(['t',path]);await copyFile(path,join(out,filename));files.push({filename,bytes:(await stat(path)).size,sha256:await sha(join(out,filename))});
}
await new Promise((done,fail)=>{
 const h=createHash('sha256'),p=spawn(seven,['x','-so',join(out,'Cyberfish-DSH-Gestalt-0.3.16-Windows-x64.zip'),'resources/feiyu-bundle/controller/src/gestalt-tasks.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>h.update(b));p.stderr.resume();p.on('error',fail);p.on('close',async code=>{try{assert.equal(code,0);assert.equal(h.digest('hex'),await sha(join(controller,'src/gestalt-tasks.mjs')));done();}catch(e){fail(e);}});
});
await copyFile(join(controller,'native/runtime/stellaris_bridge.dll'),join(out,'stellaris_bridge.dll'));
files.push({filename:'stellaris_bridge.dll',bytes:pe.length,sha256:manifest.bridgeSha256});
const source=join(out,'配套源码');await mkdir(source,{recursive:true});
for(const dir of ['src','test','plugins','native','scripts','public'])await cp(resolve('../stellaris-player',dir),join(source,'stellaris-player',dir),{recursive:true,filter:p=>!/[\\/](?:__pycache__|\.local|node_modules)(?:[\\/]|$)/.test(p)&&!p.endsWith('.pyc')});
for(const name of ['package.json','LICENSE','README.md'])await copyFile(resolve('../stellaris-player',name),join(source,'stellaris-player',name));
await cp(resolve('integrations/native-bridge/gestalt-war-20261029'),join(source,'native-bridge'),{recursive:true});
for(const dir of ['apps','packages','scripts','tests','licenses'])await cp(resolve(dir),join(source,'desktop',dir),{recursive:true,filter:p=>!/[\\/](?:node_modules|\.local|__pycache__)(?:[\\/]|$)/.test(p)});
for(const name of await readdir(root))if(/^(package\.json|pnpm-lock\.yaml|tsconfig.*\.json|vite\.config\.ts|vitest\.config\.ts|electron-builder.*\.json|stellaris\.html|LICENSE|THIRD_PARTY_NOTICES\.md|AGENTS\.md)$/.test(name))await copyFile(join(root,name),join(source,'desktop',name));
await mkdir(join(source,'desktop/assets'),{recursive:true});await copyFile('assets/app-icon.png',join(source,'desktop/assets/app-icon.png'));
await cp('assets/captain-tuned',join(source,'desktop/assets/captain-tuned'),{recursive:true});
for(const dir of ['stellaris','model-logos'])await cp(join('assets',dir),join(source,'desktop/assets',dir),{recursive:true});
for(const name of ['STELLARIS_GESTALT_PLAN.md','GESTALT_IMPLEMENTATION.md','GESTALT_M2_DELIVERY.md','GESTALT_0.3.16_DELIVERY.md','GESTALT_LIVE_VERIFICATION.json'])await copyFile(resolve('..',name),join(source,name));
await copyFile(resolve('../启动大肥鱼控制器.bat'),join(source,'启动大肥鱼控制器.bat'));
await copyFile(resolve('打开大肥鱼DSH-Windows.bat'),join(source,'desktop/打开大肥鱼DSH-Windows.bat'));
const sourceZip=join(out,'格式塔首战新版-0.3.16-配套源码.zip');await command(['a','-tzip','-mx=5',sourceZip,join(source,'*')]);await command(['t',sourceZip]);files.push({filename:'格式塔首战新版-0.3.16-配套源码.zip',bytes:(await stat(sourceZip)).size,sha256:await sha(sourceZip)});
await writeFile(join(out,'SHA256SUMS.txt'),files.map(f=>`${f.sha256}  ${f.filename}`).join('\n')+'\n');
const liveProof=JSON.parse(await readFile(resolve('../GESTALT_LIVE_VERIFICATION.json'),'utf8'));for(const value of Object.values(liveProof.checks))assert.equal(value,true);assert.equal(liveProof.result.phase,'completed');await copyFile(resolve('../GESTALT_LIVE_VERIFICATION.json'),join(out,'实机首战验证.json'));
const report={version:'0.3.16',bridge:manifest.bridgeVersion,files,checks:{appVersion:true,amd64:true,sourceAndBundledCodeMatch:true,bridgeHash:true,archives:true,zipContainsFinalRestartFix:true,mcpSchemaSmoke:true,appAsarPrivateStateAbsent:true},gameWasLaunched:false,liveWarValidated:liveProof.checks.campaignCompleted&&liveProof.checks.actualOwnership&&liveProof.checks.actualReinforcement};
await writeFile(join(out,'验收结果.json'),JSON.stringify(report,null,2));await copyFile(resolve('../GESTALT_0.3.16_DELIVERY.md'),join(out,'运行与验证说明.md'));console.log(JSON.stringify(report,null,2));
