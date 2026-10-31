import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Local development placeholder explicitly requested by the owner.
// Textures are excluded from the application's AGPL license; see THIRD_PARTY_NOTICES.md.
const commit = '4afc70898ac1065dd4559d891a2ce0bebd1261f8'
const folder = await mkdtemp(join(tmpdir(), 'cyber-fish-assets-'))
const git = (args) => { const result=spawnSync('git',args,{cwd:folder,stdio:'inherit'});if(result.status!==0)throw new Error('角色素材下载失败，请检查网络后重试。') }
try {
  git(['init','--quiet']);git(['remote','add','origin','https://github.com/Pal-AI-Lab/Coopanion.git']);git(['sparse-checkout','init','--cone']);git(['sparse-checkout','set','packages/cortico-world-desktop-pet/web/whale']);git(['fetch','--depth=1','origin',commit]);git(['checkout','--detach','FETCH_HEAD'])
  const source=join(folder,'packages/cortico-world-desktop-pet/web/whale'),target=resolve('assets/figure/whale')
  await mkdir(target,{recursive:true})
  for (const item of ['model.json','tex','feat','outfits','schemes']) await cp(join(source,item),join(target,item),{recursive:true})
  console.log('本机占位形象已恢复。贴图不是 AGPL 资产，请保留第三方声明。')
} finally { await rm(folder,{recursive:true,force:true}) }
