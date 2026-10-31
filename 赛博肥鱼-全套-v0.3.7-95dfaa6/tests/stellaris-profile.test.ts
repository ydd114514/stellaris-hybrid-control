import {it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveStellarisProfile} from '../apps/desktop/electron/stellaris-profile'

it('upgrades reuse configured legacy data including its login partitions without copying secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-profile-'))
 try{
  const options={sourceRoot:join(root,'source'),documents:join(root,'documents'),appData:join(root,'appdata'),basic:false}
  const preferred=join(options.sourceRoot,'.local/dsh-desktop'),legacy=join(options.documents,'大肥鱼 DSH','.local/dsh-desktop')
  expect(resolveStellarisProfile(options)).toBe(preferred)
  await mkdir(preferred,{recursive:true});await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'ai-keys.enc.json'),'{}')
  expect(resolveStellarisProfile(options)).toBe(legacy)
  await writeFile(join(preferred,'captain-speech.json'),'{}')
  expect(resolveStellarisProfile(options)).toBe(preferred)
  expect(resolveStellarisProfile({...options,basic:true})).toBe(join(options.appData,'QunxingFeiyu'))
  expect(resolveStellarisProfile({...options,testProfile:join(root,'isolated')})).toBe(join(root,'isolated'))
 }finally{await rm(root,{recursive:true,force:true})}
})


it('source delivery reuses this app installed profile when source has no configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-source-profile-'))
 try{
  const options={sourceRoot:join(root,'source'),documents:join(root,'documents'),appData:join(root,'appdata'),basic:false}
  const installed=join(options.documents,'群星控制器大肥鱼','.local/dsh-desktop')
  await mkdir(installed,{recursive:true});await writeFile(join(installed,'controller.json'),'{}')
  expect(resolveStellarisProfile(options)).toBe(installed)
  const source=join(options.sourceRoot,'.local/dsh-desktop');await mkdir(source,{recursive:true});await writeFile(join(source,'captain-speech.json'),'{}')
  expect(resolveStellarisProfile(options)).toBe(source)
 }finally{await rm(root,{recursive:true,force:true})}
})
