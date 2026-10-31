import { build as bundle } from 'esbuild'
import { build as buildRenderer } from 'vite'
import { resolve } from 'node:path'
import { copyFile, readFile, mkdir, rm } from 'node:fs/promises'
const basic = process.argv.includes('--basic')
const publicVoice = text => text.replace(/qwen-audio-3\.1-tts-flash-vd-[A-Za-z0-9-]+/g, 'Cherry').replaceAll('qwen-audio-3.1-tts-flash', 'qwen3-tts-flash')
await buildRenderer({ plugins: basic ? [{ name: 'basic-public-voice', transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/stellaris-voice-presets.ts')) return publicVoice(code) } }] : [], build: { outDir: 'dist/dsh/renderer', emptyOutDir: true, rollupOptions: { input: resolve('stellaris.html') } } })
await copyFile('apps/desktop/src/music-player.html','dist/dsh/renderer/music-player.html')
// Public, already generated revision-4 sample. Never package userData or API credentials.
const tunedOutput=resolve('dist/dsh/captain-tuned')
if(basic)await rm(tunedOutput,{recursive:true,force:true})
else{
  await mkdir(tunedOutput,{recursive:true})
  for(const file of ['manifest.json','20.wav'])await copyFile(resolve('assets/captain-tuned',file),resolve(tunedOutput,file))
}
await bundle({ entryPoints: { main: 'apps/desktop/electron/stellaris-main.ts', preload: 'apps/desktop/electron/stellaris-preload.ts' },
  outdir: 'dist/dsh/electron', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:*','@yakult-green-tea/qq-music-api/serverless'],
  define: { 'process.env.CYBERFISH_BASIC_EDITION': basic ? '"1"' : '"0"' },
  plugins: basic ? [{ name: 'basic-public-voice', setup(build) { build.onLoad({ filter: /stellaris-voice-presets\.ts$/ }, async args => ({ contents: publicVoice(await readFile(args.path, 'utf8')), loader: 'ts' })) } }] : [] })
console.log('群星控制器大肥鱼 桌面端已构建；没有启动桌面程序、游戏或模型。')
