import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Bundled code only. Never migrates another installation's profile or accounts. */
export async function prepareStellarisBundle(resources: string, data: string) {
  const bundle = join(resources, 'feiyu-bundle')
  if (!existsSync(join(bundle, 'manifest.json'))) return undefined
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'))
  const root = join(data, `controller-${manifest.version}`)
  const marker = join(root, 'bundle-ready.json')
  if (!existsSync(marker)) {
    await mkdir(root, { recursive: true })
    await cp(join(bundle, 'controller'), root, { recursive: true, force: true })
    await writeFile(marker, JSON.stringify({ version: manifest.version }))
  }
  process.env.CYBERFISH_NODE = join(bundle, 'runtime/node/node.exe')
  process.env.CYBERFISH_PYTHON = join(bundle, 'runtime/python/python.exe')
  process.env.CYBERFISH_DSH_PACKAGE = join(bundle, 'engine/dsh/package.json')
  process.env.CYBERFISH_DSH_HOME = join(data, 'dsh-home')
  process.env.CYBERFISH_POWERSHELL = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  process.env.CYBERFISH_REQUIRE_RUNNING_GAME = '1'
  return root
}
