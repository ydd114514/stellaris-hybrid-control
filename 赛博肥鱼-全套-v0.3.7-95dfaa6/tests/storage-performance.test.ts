import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createDefaultState } from '../packages/core/src/defaults'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { createPersistentStore } from '../apps/desktop/electron/storage'
const directories: string[] = []
const stores: ReturnType<typeof createPersistentStore>[] = []
const databases: DatabaseSync[] = []
const directory = () => { const path=mkdtempSync(join(tmpdir(),'fish-store-'));directories.push(path);return path }
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const db of databases.splice(0))db.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});vi.useRealTimers()})
function audit(dir:string) {
 const db=new DatabaseSync(join(dir,'shop.sqlite'));databases.push(db)
 db.exec(`CREATE TABLE IF NOT EXISTS write_audit (table_name TEXT, row_id TEXT);
 CREATE TRIGGER IF NOT EXISTS viewers_changed AFTER UPDATE ON viewers BEGIN INSERT INTO write_audit VALUES('viewers',new.id); END;
 CREATE TRIGGER IF NOT EXISTS replies_changed AFTER UPDATE ON utterances BEGIN INSERT INTO write_audit VALUES('utterances',new.id); END;
 CREATE TRIGGER IF NOT EXISTS logs_changed AFTER UPDATE ON logs BEGIN INSERT INTO write_audit VALUES('logs',new.id); END;
 CREATE TRIGGER IF NOT EXISTS state_changed AFTER UPDATE ON app_state BEGIN INSERT INTO write_audit VALUES('app_state','1'); END;`)
 return db
}
const largeState=()=>{const state=createDefaultState();state.viewers=Array.from({length:3000},(_,i)=>({id:`v${i}`,name:`客人${i}`,visits:1,gifts:0,note:'',blocked:false}));return state}

describe('直播状态的低频增量持久化',()=>{
 it('3000位观众的连续60次状态更新只合并落一次，且仅改写变化的观众',()=>{
  vi.useFakeTimers();const dir=directory(),store=createPersistentStore(dir);stores.push(store);const state=largeState()
  store.save(state);store.flush();const db=audit(dir)
  for(let i=1;i<=60;i++){state.shop.points=i;state.viewers[1500]!.note=`最新备注${i}`;store.save(state)}
  expect(db.prepare('SELECT COUNT(*) AS n FROM write_audit').get()!.n).toBe(0)
  vi.advanceTimersByTime(200)
  expect(db.prepare('SELECT table_name,row_id FROM write_audit ORDER BY table_name').all()).toEqual([{table_name:'app_state',row_id:'1'},{table_name:'viewers',row_id:'v1500'}])
  expect(JSON.parse(String(db.prepare('SELECT payload FROM app_state WHERE id=1').get()!.payload)).shop.points).toBe(60)
  expect(db.prepare('SELECT COUNT(*) AS n FROM viewers').get()!.n).toBe(3000)
 })
 it('关闭立即刷入最新状态，档案始终逐条落盘，重开不重播',()=>{
  const dir=directory(),store=createPersistentStore(dir);stores.push(store);const state=createDefaultState();state.running=true;state.stage.speaking=true;state.stage.text='关闭前的一句';state.shop.points=77
  store.save(state)
  for(let i=0;i<100;i++)store.archive.append([{id:`event-${i}`,userId:'visitor',name:'客人',kind:'chat',text:`现场留言${i}`,at:i}])
  expect(store.archive.count('visitor')).toBe(100)
  store.close();const reopened=createPersistentStore(dir);stores.push(reopened);const restored=reopened.load()!
  expect(restored.shop.points).toBe(77);expect(restored.running).toBe(false);expect(restored.stage.speaking).toBe(false);expect(restored.stage.audio).toBeUndefined();expect(reopened.archive.count('visitor')).toBe(100)
 })
 it('重开后预热行缓存，立即读取可看到待写状态，配置仍即时保存',()=>{
  const dir=directory(),first=createPersistentStore(dir);stores.push(first);const state=largeState();first.save(state);first.close()
  const reopened=createPersistentStore(dir);stores.push(reopened);const restored=reopened.load()!;const db=audit(dir)
  restored.viewers[100].note='第二场的备注';restored.config.music.maxQueue=7;reopened.save(restored)
  expect(JSON.parse(readFileSync(join(dir,'config.json'),'utf8')).music.maxQueue).toBe(7)
  expect(reopened.load()!.viewers[100].note).toBe('第二场的备注')
  expect(db.prepare("SELECT row_id FROM write_audit WHERE table_name='viewers'").all()).toEqual([{row_id:'v100'}])
 })
 it('直播PCM和远端临时URL不落SQLite；用户自选试听样音保持原文件',()=>{
  const dir=directory(),store=createPersistentStore(dir);stores.push(store);const state=createDefaultState()
  mkdirSync(join(dir,'auditions'));const audition=join(dir,'auditions','selected-voice.wav');writeFileSync(audition,'user-selected-audition')
  const marker=Buffer.from('qwen-live-pcm-must-stay-transient').toString('base64')
  state.stage.audio={kind:'pcm',data:marker,sampleRate:24000};state.stage.speaking=true;store.save(state);store.flush()
  const db=audit(dir);expect(String(db.prepare('SELECT payload FROM app_state WHERE id=1').get()!.payload)).not.toContain(marker)
  const url='https://voice.example.test/expiring.wav?secret=ephemeral';state.stage.audio={kind:'url',url};store.save(state);store.close()
  expect(String(db.prepare('SELECT payload FROM app_state WHERE id=1').get()!.payload)).not.toContain(url)
  expect(readFileSync(audition,'utf8')).toBe('user-selected-audition')
 })
})
