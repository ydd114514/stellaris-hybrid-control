import { lstat, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const MOD_NAME = 'cyberfish_observer_v1'
const modSource = name => fileURLToPath(new URL(`../mod/${name}/`, import.meta.url))
const inspect = async path => { try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const digest = value => createHash('sha256').update(value).digest('hex')

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
    if (entry && (!entry.isFile() || entry.isSymbolicLink() || !(await readFile(plan.path)).equals(plan.content))) throw new Error('同名观测 Mod 文件已存在且内容不同，未覆盖；请保留它并另行核对。')
    plan.existing = !!entry
  }
  const created = []
  if (!dryRun) for (const plan of plans) {
    if (plan.existing) continue
    await mkdir(resolve(plan.path, '..'), { recursive: true })
    // wx handles races without ever overwriting another process's new file.
    await writeFile(plan.path, plan.content, { flag: 'wx' }); created.push(plan.path)
  }
  return { ok: true, dryRun, documentsPath: realDocuments, modName, modPath: target, created, files: plans.map(plan => ({ path: plan.path, sha256: digest(plan.content), existing: plan.existing })), enabledByInstaller: false, message: dryRun ? '安装计划已检查，没有写入文件。' : '观测 Mod 已就位；请在启动器的单独测试播放集中启用。未修改原播放集或启用列表。' }
}

export const installObserverMod = options => installLocalMod({...options,modName:MOD_NAME});
export const installSteeringMod = options => installLocalMod({...options,modName:'cyberfish_steering_v1'});
export async function installHybridMods(options){
  return Promise.all([installObserverMod(options),installSteeringMod(options)]);
}
