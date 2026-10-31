import { build as bundle } from 'esbuild'
import { build as buildRenderer } from 'vite'
import { mkdir, copyFile, chmod, rm, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, sep } from 'node:path'

await buildRenderer()
await bundle({
  entryPoints: { main: 'apps/desktop/electron/main.ts', preload: 'apps/desktop/electron/preload.ts' },
  outdir: 'dist/electron', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron', 'node:*', '@yakult-green-tea/qq-music-api/serverless'], sourcemap: true,
})
// Discard a helper left by a build on another OS.
const nativeDirectory = resolve('dist/electron/native')
if (!nativeDirectory.startsWith(resolve(process.cwd()) + sep)) throw new Error('本机构建目录必须位于当前项目内。')
await rm(nativeDirectory, { recursive: true, force: true })
if (process.platform === 'win32') {
  await mkdir('dist/electron/native', { recursive: true })
  await mkdir('.local/native', { recursive: true })
  const script = await readFile('scripts/native/live-screen-ocr.ps1', 'utf8')
  for (const folder of ['dist/electron/native', '.local/native']) await writeFile(`${folder}/live-screen-ocr.ps1`, '\ufeff' + script.replace(/^\ufeff/u, ''), 'utf8')
} else if (process.platform === 'darwin') {
  await mkdir('dist/electron/native', { recursive: true })
  await mkdir('.local/native', { recursive: true })
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-parse-as-library', 'scripts/native/live-screen-ocr.swift', '-o', 'dist/electron/native/live-screen-ocr'], { stdio: 'inherit' })
  await copyFile('dist/electron/native/live-screen-ocr', '.local/native/live-screen-ocr')
  await chmod('dist/electron/native/live-screen-ocr', 0o755)
  await chmod('.local/native/live-screen-ocr', 0o755)
}
console.log('小店已构建：dist/renderer 和 dist/electron')
