import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

export function findProjectDirectory(start: string) {
  let directory = resolve(start)
  for (let index = 0; index < 9; index++) {
    if (existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'apps', 'desktop'))) return directory
    const parent = dirname(directory); if (parent === directory) break; directory = parent
  }
}
export function resolveDataDirectory(options: { appPath: string; executable: string; documents: string; explicit?: string; testDirectory?: string; localTest: boolean }) {
  if (options.testDirectory) return resolve(options.testDirectory)
  const root = options.explicit ? resolve(options.explicit) : findProjectDirectory(options.appPath) || findProjectDirectory(dirname(options.executable)) || join(options.documents, '赛博肥鱼')
  return join(root, '.local', options.localTest ? 'test-data' : 'user-data')
}
/** One-time, read-only migration of this app's own previous profile. Never used by a test profile. */
export async function migrateLegacyProfile(legacy: string, target: string) {
  if (resolve(legacy) === resolve(target) || existsSync(join(target, 'shop.sqlite')) || !existsSync(join(legacy, 'shop.sqlite'))) return false
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const source = new DatabaseSync(join(legacy, 'shop.sqlite'), { readOnly: true })
  try { await backup(source, join(target, 'shop.sqlite')) } finally { source.close() }
  for (const name of ['config.json', 'credentials.enc.json']) if (existsSync(join(legacy, name)) && !existsSync(join(target, name))) copyFileSync(join(legacy, name), join(target, name))
  return true
}
