import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findProjectDirectory, migrateLegacyProfile, resolveDataDirectory } from '../apps/desktop/electron/portable'
const roots:string[]=[]
const temporary=()=>{const p=mkdtempSync(join(tmpdir(),'fish-portable-'));roots.push(p);return p}
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
describe('项目自己的运行目录',()=>{
 it('项目内的开发及打包路径都定位同一.local目录，本地测试独立',()=>{
  const root=temporary();mkdirSync(join(root,'apps','desktop'),{recursive:true});writeFileSync(join(root,'package.json'),'{}')
  const packaged=join(root,'release','mac-arm64','鱼.app','Contents','Resources','app.asar')
  expect(findProjectDirectory(packaged)).toBe(root)
  const options={appPath:packaged,executable:packaged,documents:join(root,'Documents'),localTest:false}
  expect(resolveDataDirectory(options)).toBe(join(root,'.local','user-data'))
  expect(resolveDataDirectory({...options,localTest:true})).toBe(join(root,'.local','test-data'))
  expect(resolveDataDirectory({...options,testDirectory:join(root,'isolated')})).toBe(join(root,'isolated'))
 })
 it('只读备份自己的旧数据库，迁移后保留旧文件且不覆盖新档',async()=>{
  const root=temporary(),legacy=join(root,'legacy'),target=join(root,'project','.local','user-data');mkdirSync(legacy,{recursive:true})
  const db=new DatabaseSync(join(legacy,'shop.sqlite'));db.exec("CREATE TABLE example(value TEXT); INSERT INTO example VALUES('熟客记录');");db.close()
  writeFileSync(join(legacy,'config.json'),'{"demo":true}');writeFileSync(join(legacy,'credentials.enc.json'),'{"deepseek":"encrypted-placeholder"}')
  expect(await migrateLegacyProfile(legacy,target)).toBe(true)
  const migrated=new DatabaseSync(join(target,'shop.sqlite'),{readOnly:true});expect(migrated.prepare('SELECT value FROM example').get()?.value).toBe('熟客记录');migrated.close()
  expect(readFileSync(join(legacy,'config.json'),'utf8')).toBe('{"demo":true}')
  writeFileSync(join(target,'config.json'),'new-settings');expect(await migrateLegacyProfile(legacy,target)).toBe(false)
  expect(readFileSync(join(target,'config.json'),'utf8')).toBe('new-settings')
 })
})
