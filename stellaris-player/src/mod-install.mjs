import { lstat, mkdir, readFile, writeFile, realpath, readdir, unlink } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { generateSteeringZoneOverrides } from './steering-zone-overrides.mjs'
import { generateSteeringExpansionOverrides } from './steering-expansion-overrides.mjs'
import { generateStellarSteeringCompatibility,generateSteeringUnityPriorityOverrides,retiredUnityPersonalityFiles } from './stellar-steering-compat.mjs'
import { assertAiModCompatibility } from './ai-mod-conflicts.mjs'
import { generateAutomationCompatibility } from './automation-mod-compat.mjs'

export const MOD_NAME = 'cyberfish_observer_v1'
const modSource = name => fileURLToPath(new URL(`../mod/${name}/`, import.meta.url))
const inspect = async path => { try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const digest = value => createHash('sha256').update(value).digest('hex')
const previousSteeringFiles={'common/ai_budget/cfsteer_budget.txt':['0cc9ec9e801d1ce8e40627a96da5b7c0f9c63fd748ea19be235f3b4927a03350','79a76a74541ef36c6b20cbc121aaa494cdf08dd022912b38b13d400999688e01','19f7d2dce61a1e568ee463b8424757b78cd15077b834f6154917d8c17e857e00'],'localisation/english/cfsteer_l_english.yml':'6ea827c27e4345901cb24d55b1191804d87a7b9ba74072cbffe9fe6e126d8317','localisation/simp_chinese/cfsteer_l_simp_chinese.yml':'b88b334f5f8ecc4e9f34e6ef25d3d8bdd7125aaa7055f4991467ec9c93dd8c24','common/zones/zz_cfsteer_research_weights.txt':'c33c8bca91d4146d06dfed1ef50bdcadf2c1752c090f5efff399e05e68c6329f','common/economic_plans/cfsteer_plans.txt':'4b5eb5508d6735b6581d0f06c90294afcd2b2880867844bf6eba59bfbd1f1702'}
const unityUpgradeFiles={
 'common/economic_plans/cfsteer_unity_plan.txt':['be0d6118d89e5f5b577dbbc26d60baa91264e96567271cf1b5e74ae92cf25e79','9e05e1412ce4a2204dffad3ef5441c30f1c1a91683ef4f6503ed392e67ff090c'],
 'common/edicts/cfsteer_edicts.txt':'db9d22c15977aeeb1f9ae2b36e85aa3b6409279300088a806dcc5adfb3ae2e60',
 'localisation/english/cfsteer_l_english.yml':'217a8f13dfa8f19e2e6ead93889c000df8cd8cb98454e0c8957086df9772620b',
 'localisation/simp_chinese/cfsteer_l_simp_chinese.yml':'38f231e1d2d65cf14e70ba88d9cc5a594676c2fd94f7fb045680b184192853e0'
};

// Only retire an exact copy of the previously shipped steering personality.
const retiredPersonalityPath = 'common/personalities/cfsteer_personality.txt'
const retiredPersonalityHashes = new Set([
  'b1d16cf1a6c27727a66cba6062fc30d10956cc9694db0f023b5fed89038487ab',
  '4841db65213faeb9e432973df2e90a5c282268188912e0dde93e6885427e1ce7',
])

async function checkedParents(root, path) {
  const part = relative(root, path)
  if (part === '..' || part.startsWith(`..${sep}`) || resolve(root, part) !== path) throw new Error('观测 Mod 安装路径越出指定目录。')
  let current = root
  for (const segment of ['', ...part.split(sep).slice(0, -1)]) {
    if (segment) current = join(current, segment)
    const entry = await inspect(current)
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error('观测 Mod 目标目录含链接或非目录，未安装。')
  }
}

/** Install only this named local mod; never edit enabled_mods or launcher SQLite. */
export async function installLocalMod({ documentsPath, dryRun = false, modName=MOD_NAME, gameDirectory, stellarDirectory, ultimateDirectory,performanceDirectory,reserveEnergy,reserveAlloys,updateGenerated=false,backupDirectory } = {}) {
  if(![MOD_NAME,'cyberfish_steering_v1','cyberfish_stellar_ai_compat_v1','cyberfish_automation_compat_v1'].includes(modName))throw Error('不支持的本地Mod名称');
  if(updateGenerated&&(typeof backupDirectory!=='string'||!backupDirectory.trim()))throw Error('更新生成文件必须指定备份目录');
  const source=modSource(modName), files=[];
  async function visit(prefix=''){
    for(const entry of await readdir(join(source,prefix),{withFileTypes:true})){
      if(entry.isSymbolicLink())throw Error('Mod源目录不接受链接');
      const name=join(prefix,entry.name);if(entry.isDirectory())await visit(name);else if(entry.isFile())files.push(name);
    }
  }
  await visit();
  if (typeof documentsPath !== 'string' || !documentsPath.trim()) throw new Error('请指定群星文档目录。')
  const documents = resolve(documentsPath), modRoot = join(documents, 'mod'), target = join(modRoot, modName)
  const docsInfo = await inspect(documents)
  if (!docsInfo?.isDirectory()) throw new Error('群星文档目录尚不存在，请先启动一次游戏或填写正确路径。')
  // Resolving the explicit documents root supports a redirected Documents folder;
  // links below that root are refused so an existing mod cannot redirect writes.
  const realDocuments = await realpath(documents)
  const rootInfo = await inspect(modRoot)
  if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) throw new Error('群星 mod 目录不是普通目录，未写入任何文件。')
  const plans = []
  let integration
  const addGenerated=generated=>{
    for(const file of generated){
      if(!/^(common|localisation|events)\/[a-zA-Z0-9_./-]+\.(txt|yml)$/.test(file.path)||file.path.split('/').includes('..'))throw Error('兼容补丁输出路径无效');
      plans.push({path:resolve(target,file.path),content:file.content,generated:true});
    }
  };
  for (const file of files) plans.push({ path: resolve(target, file), content: await readFile(resolve(source, file)) })
  if(modName==='cyberfish_stellar_ai_compat_v1'){
    if(!stellarDirectory)throw Error('尚未取得Stellar AI实际文件；请先通过Steam订阅下载原版岗位产出版（3686836322）');
    const generated=await generateStellarSteeringCompatibility({gameDirectory,stellarDirectory});
    const sourceFiles=Object.fromEntries(await Promise.all(generated.sourceFiles.map(async row=>{
      const path=resolve(row.sourcePath??join(stellarDirectory,row.path));
      if(![stellarDirectory,gameDirectory].some(root=>{const part=relative(resolve(root),path);return part!== '..'&&!part.startsWith('..'+sep)&&!part.includes(':');}))throw Error('兼容输入源越出游戏或指定Mod目录');
      return [row.path,await readFile(path,'utf8')];
    })));
    const compatibility=assertAiModCompatibility({mods:[{workshopId:generated.workshopId,descriptorText:await readFile(join(stellarDirectory,'descriptor.mod'),'utf8'),files:sourceFiles}]});
    addGenerated(generated.files);
    const {files:_,...metadata}=generated;integration={...metadata,compatibility,runtimeTested:false};
    plans.push({path:resolve(target,'cyberfish-source-manifest.json'),content:Buffer.from(JSON.stringify(integration,null,2),'utf8'),generated:true});
  }
  if(modName==='cyberfish_automation_compat_v1'){
    for(const [directory,id]of [[ultimateDirectory,'2250100617'],[performanceDirectory,'2184737698']]){
      if(!directory)continue;
      const descriptor=await readFile(join(directory,'descriptor.mod'),'utf8');
      if(descriptor.match(/\bremote_file_id\s*=\s*"?(\d+)/)?.[1]!==id||!/supported_version\s*=\s*"v?4\.5(?:\.|\*)/.test(descriptor))throw Error('自动化源目录的创意工坊编号或4.5版本声明不符');
    }
    const generated=await generateAutomationCompatibility({ultimateDirectory,performanceDirectory,reserveEnergy,reserveAlloys});
    addGenerated(generated.files);
    const {files:_,...metadata}=generated;integration={...metadata,runtimeTested:false,requiresLoadAfter:['Ultimate Automation','AI Game Performance Optimisation','Cyberfish Steering v1']};
    plans.push({path:resolve(target,'cyberfish-source-manifest.json'),content:Buffer.from(JSON.stringify(integration,null,2),'utf8'),generated:true});
  }
  if(modName==='cyberfish_steering_v1'&&gameDirectory){
    const generated=await generateSteeringZoneOverrides(gameDirectory);
    plans.push({path:resolve(target,generated.path),content:generated.content,generated:true});
    for(const file of generated.extraFiles??[])plans.push({path:resolve(target,file.path),content:file.content,generated:true});
    const expansion=await generateSteeringExpansionOverrides(gameDirectory);
    plans.push({path:resolve(target,expansion.path),content:expansion.content,generated:true});
    addGenerated(await generateSteeringUnityPriorityOverrides(gameDirectory));
  }
  if (modName === 'cyberfish_steering_v1') {
    addGenerated(retiredUnityPersonalityFiles())
    plans.push({path: resolve(target, retiredPersonalityPath), retire: true})
  }
  const descriptor = (await readFile(join(source, 'descriptor.mod'), 'utf8')) + `path="mod/${modName}"\n`
  plans.push({ path: join(modRoot, `${modName}.mod`), content: Buffer.from(descriptor, 'utf8') })
  for (const plan of plans) {
    await checkedParents(modRoot, plan.path)
    const entry = await inspect(plan.path)
    if(entry&&(!entry.isFile()||entry.isSymbolicLink()))throw new Error('同名Mod目标不是普通文件，未覆盖');
    const current=entry?await readFile(plan.path):null;
    if (plan.retire) {
      if (current && !retiredPersonalityHashes.has(digest(current))) {
        throw new Error('旧引导 Mod 人格文件已被修改，未覆盖；请备份并移出 common/personalities/cfsteer_personality.txt。')
      }
      plan.existing = !entry
      plan.previous = current
      continue
    }
    // Paradox rewrites the external descriptor to absolute paths and its own
    // formatting. Preserve it when it still points to this exact local mod.
    if(current&&plan.path===join(modRoot,`${modName}.mod`)){
      const text=current.toString('utf8'),sourceText=descriptor;
      const field=(body,key)=>body.match(new RegExp('(?:^|\n)'+key+'\s*=\s*"([^"\n]*)"'))?.[1];
      const path=field(text,'path');
      if(path&&resolve(documents,path)===resolve(target)&&field(text,'name')===field(sourceText,'name')&&
          field(text,'version')===field(sourceText,'version')&&field(text,'supported_version')===field(sourceText,'supported_version')){
        plan.existing=true;continue;
      }
    }

    plan.upgrade=!!current&&!current.equals(plan.content)&&modName==='cyberfish_steering_v1'&&
      [previousSteeringFiles,unityUpgradeFiles].some(known=>[known[relative(target,plan.path).split(sep).join('/')]].flat().includes(digest(current)));
    if(current&&!current.equals(plan.content)&&updateGenerated&&plan.generated){plan.upgrade=true;plan.previous=current;}
    if(plan.upgrade&&updateGenerated)plan.previous=current;
    if(current&&!current.equals(plan.content)&&!plan.upgrade)throw new Error('同名观测 Mod 文件已存在且内容不同，未覆盖；请保留它并另行核对。');
    plan.existing=!!entry&&!plan.upgrade
  }
  const removed = []
  const created = [],backups=[]
  if(!dryRun&&updateGenerated)for(const plan of plans.filter(row=>row.previous)){
    const backupRoot=resolve(backupDirectory),backupPath=resolve(backupRoot,modName,relative(target,plan.path));
    await checkedParents(backupRoot,backupPath);await mkdir(resolve(backupPath,'..'),{recursive:true});
    await writeFile(backupPath,plan.previous,{flag:'wx'});backups.push(backupPath);
  }
  if (!dryRun) for (const plan of plans) {
    if (plan.existing) continue
    if (plan.retire) {
      if (!plan.previous.equals(await readFile(plan.path))) throw new Error('旧引导 Mod 人格文件已变化，未移除。')
      await unlink(plan.path)
      removed.push(plan.path)
      continue
    }
    if(plan.previous&&!plan.previous.equals(await readFile(plan.path)))throw Error('待更新生成文件在备份后发生变化，未覆盖该文件');
    await mkdir(resolve(plan.path, '..'), { recursive: true })
    // wx handles races without ever overwriting another process's new file.
    await writeFile(plan.path, plan.content, { flag: plan.upgrade?'w':'wx' }); created.push(plan.path)
  }
  return { ok: true, dryRun, documentsPath: realDocuments, modName, modPath: target, created,backups,removed, files: plans.filter(plan => !plan.retire).map(plan => ({ path: plan.path, sha256: digest(plan.content), existing: plan.existing })),...(integration?{integration}:{}), enabledByInstaller: false, message: dryRun ? '安装计划已检查，没有写入文件。' : integration?'兼容补丁已生成；需在对应原Mod与Cyberfish Steering之后加载。未改启用列表，尚未验证实机效果。':'观测 Mod 已就位；请在启动器的单独测试播放集中启用。未修改原播放集或启用列表。' }
}

export const installObserverMod = options => installLocalMod({...options,modName:MOD_NAME});
export const installSteeringMod = options => installLocalMod({...options,modName:'cyberfish_steering_v1'});
export const installStellarCompatibilityMod = options => installLocalMod({...options,modName:'cyberfish_stellar_ai_compat_v1'});
export const installAutomationCompatibilityMod = options => installLocalMod({...options,modName:'cyberfish_automation_compat_v1'});
/** Register an official downloaded source as a selectable local mod, never enable it. */
export async function registerDownloadedWorkshopMod({documentsPath,sourceDirectory,previousSourceDirectory,workshopId,dryRun=false}={}){
  if(!['3686836322','2250100617','2184737698','3814356797'].includes(String(workshopId)))throw Error('未授权的创意工坊Mod编号');
  if(!documentsPath||!sourceDirectory)throw Error('缺少群星文档或已下载Mod目录');
  const documents=resolve(documentsPath),source=await realpath(resolve(sourceDirectory)),modRoot=join(documents,'mod');
  if(!((await inspect(documents))?.isDirectory()))throw Error('群星文档目录不存在');
  const sourceDescriptor=await readFile(join(source,'descriptor.mod'),'utf8');
  if(sourceDescriptor.length>65536||/["\r\n]/.test(source))throw Error('下载Mod的描述文件或路径无效');
  if(sourceDescriptor.match(/\bremote_file_id\s*=\s*"?(\d+)/)?.[1]!==String(workshopId))throw Error('下载文件与指定创意工坊编号不符');
  if(!/supported_version\s*=\s*"v?4\.5(?:\.|\*)/.test(sourceDescriptor))throw Error('下载Mod尚未声明4.5兼容，未注册');
  if(/\bpath\s*=/.test(sourceDescriptor))throw Error('下载Mod描述包含自定义path，需先核对原始文件');
  const target=join(modRoot,`cyberfish_workshop_${workshopId}.mod`),content=Buffer.from(sourceDescriptor.trimEnd()+`\npath="${source.replaceAll('\\','/')}"\n`,'utf8');
  const rootInfo=await inspect(modRoot);
  if(rootInfo&&(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()))throw Error('群星mod目录不是普通目录，未注册');
  await checkedParents(modRoot,target);const existing=await inspect(target);
  if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw Error('同名Mod注册文件不是普通文件，未覆盖');
  const current=existing?await readFile(target):null;let migrated=false;
  if(current&&!current.equals(content)){
    if(previousSourceDirectory){
      const previous=await realpath(resolve(previousSourceDirectory)),previousDescriptor=await readFile(join(previous,'descriptor.mod'),'utf8');
      const expected=Buffer.from(previousDescriptor.trimEnd()+`\npath="${previous.replaceAll('\\','/')}"\n`,'utf8');
      migrated=previousDescriptor.match(/\bremote_file_id\s*=\s*"?(\d+)/)?.[1]===String(workshopId)&&current.equals(expected);
    }
    if(!migrated)throw Error('同名Mod注册文件已存在且内容不同，未覆盖');
  }
  if(!dryRun&&(!existing||migrated)){await mkdir(modRoot,{recursive:true});await writeFile(target,content,{flag:existing?'w':'wx'});}
  return {ok:true,dryRun,workshopId:String(workshopId),sourceDirectory:source,descriptorPath:target,created:!dryRun&&!existing,migrated:!dryRun&&migrated,enabledByInstaller:false,runtimeTested:false};
}
export async function installHybridMods(options){
  return Promise.all([installObserverMod(options),installSteeringMod(options)]);
}
