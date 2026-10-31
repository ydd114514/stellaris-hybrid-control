// Isolated application API/bootstrap smoke. Never displays or focuses a window,
// drives input, reads real user profiles, or calls a provider/platform.
import {_electron as electron,expect} from '@playwright/test'
import electronPath from 'electron'
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {join,resolve,dirname,basename} from 'node:path'
const root=process.cwd(),out=join(root,'.local/speech-sync-20261029'),profile=await mkdtemp(join(out,'isolated-smoke-'))
const executable=process.argv.find(x=>x.startsWith('--executable='))?.slice('--executable='.length),packaged=!!executable
const env={...process.env,CYBER_FISH_TEST_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE
let application
const report={passed:false,packaged,desktopControl:false,visibleWindows:false,focusedWindows:false,modelRequests:0,ttsRequests:0}
try{
 application=await electron.launch({executablePath:executable?resolve(executable):electronPath,args:[...(packaged?[]:['dist/dsh/electron/main.cjs']),'--dsh-offline-test','--dsh-headless-smoke'],env,timeout:30000})
 const page=await application.firstWindow();await page.waitForURL(/stellaris\.html/)
 const state=await page.evaluate(async()=>({speech:await window.stellaris.speech.view(),ai:await window.stellaris.ai.view(),controller:await window.stellaris.getStatus(),start:await window.stellaris.speech.action({type:'start'}),node:typeof window.require}))
 expect(state.controller.localTest).toBe(true);expect(state.speech.localTest).toBe(true);expect(state.speech.enabled).toBe(false);expect(state.speech.hasKey).toBe(false);expect(state.ai.status.running).toBe(false);expect(state.start.ok).toBe(false);expect(state.node).toBe('undefined')
 const windows=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})))
 expect(windows.length).toBe(1);expect(windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true)
 Object.assign(report,{passed:true,windows,restrictedIpc:true,offlineApiGuard:true})
 console.log('DSH隐藏接口启动验收通过：窗口不可见/不可聚焦，隔离资料与收费接口禁止保护正常。')
}catch(e){Object.assign(report,{error:e instanceof Error?e.message:String(e)});process.exitCode=1}
finally{
 await application?.close().catch(()=>{});await mkdir(out,{recursive:true});await writeFile(join(out,packaged?'packaged-headless-result.json':'source-headless-result.json'),JSON.stringify(report,null,2)+'\n')
 const target=await realpath(profile);if(dirname(target)!==await realpath(out)||!basename(target).startsWith('isolated-smoke-'))throw Error('Unexpected smoke cleanup target');await rm(target,{recursive:true,force:true})
}
