import { lstat, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const MOD_NAME = 'cyberfish_observer_v1'
const modSource = name => fileURLToPath(new URL(`../mod/${name}/`, import.meta.url))
const inspect = async path => { try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const digest = value => createHash('sha256').update(value).digest('hex')
const previousSteeringFiles={'common/economic_plans/cfsteer_plans.txt':'4b5eb5508d6735b6581d0f06c90294afcd2b2880867844bf6eba59bfbd1f1702'}

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
export async function installLocalMod({ documentsPath, dryRun = false, modName=MOD_NAME } = {}) {
  if(![MOD_NAME,'cyberfish_steering_v1'].includes(modName))throw Error('不支持的本地Mod名称');
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
  for (const file of files) plans.push({ path: resolve(target, file), content: await readFile(resolve(source, file)) })
  const descriptor = (await readFile(join(source, 'descriptor.mod'), 'utf8')) + `path="mod/${modName}"\n`
  plans.push({ path: join(modRoot, `${modName}.mod`), content: Buffer.from(descriptor, 'utf8') })
  for (const plan of plans) {
    await checkedParents(modRoot, plan.path)
    const entry = await inspect(plan.path)
    if(entry&&(!entry.isFile()||entry.isSymbolicLink()))throw new Error('同名Mod目标不是普通文件，未覆盖');
    const current=entry?await readFile(plan.path):null;
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
      previousSteeringFiles[relative(target,plan.path).split(sep).join('/')]==digest(current);
    if(current&&!current.equals(plan.content)&&!plan.upgrade)throw new Error('同名观测 Mod 文件已存在且内容不同，未覆盖；请保留它并另行核对。');
    plan.existing=!!entry&&!plan.upgrade
  }
  const created = []
  if (!dryRun) for (const plan of plans) {
    if (plan.existing) continue
    await mkdir(resolve(plan.path, '..'), { recursive: true })
    // wx handles races without ever overwriting another process's new file.
    await writeFile(plan.path, plan.content, { flag: plan.upgrade?'w':'wx' }); created.push(plan.path)
  }
  return { ok: true, dryRun, documentsPath: realDocuments, modName, modPath: target, created, files: plans.map(plan => ({ path: plan.path, sha256: digest(plan.content), existing: plan.existing })), enabledByInstaller: false, message: dryRun ? '安装计划已检查，没有写入文件。' : '观测 Mod 已就位；请在启动器的单独测试播放集中启用。未修改原播放集或启用列表。' }
}

export const installObserverMod = options => installLocalMod({...options,modName:MOD_NAME});
export const installSteeringMod = options => installLocalMod({...options,modName:'cyberfish_steering_v1'});
export async function installHybridMods(options){
  return Promise.all([installObserverMod(options),installSteeringMod(options)]);
}
