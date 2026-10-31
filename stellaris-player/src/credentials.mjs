import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export const credentialPath = fileURLToPath(new URL('../.local/credentials/deepseek.dpapi', import.meta.url))
const script = fileURLToPath(new URL('../native/credential_store.ps1', import.meta.url))
function invoke(command, value = '', path = credentialPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('C:/Program Files/PowerShell/7/pwsh.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Command',command,'-CredentialPath',path], { windowsHide: true, stdio: ['pipe','pipe','pipe'] })
    const chunks=[]; let size=0, done=false
    const finish = (error,result) => { if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result) }
    const timer=setTimeout(()=>{child.kill();finish(new Error('本机密钥安全存储超时。'))},10000)
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4096){child.kill();finish(new Error('本机密钥安全存储返回异常。'))}else chunks.push(chunk)})
    child.stderr.resume()
    child.on('error',()=>finish(new Error('无法启动本机密钥安全存储。')))
    child.on('close',code=>code===0?finish(undefined,Buffer.concat(chunks).toString('utf8').trim()):code===3?finish(undefined,undefined):finish(new Error('无法加密或解密 DeepSeek 密钥，请重新配置。')))
    child.stdin.on('error',()=>{})
    // The key is never part of a command line, script source or diagnostic.
    child.stdin.end(value)
  })
}
export async function saveDeepSeekKey(key, { path = credentialPath } = {}) {
  if(typeof key!=='string'||!/^sk-[A-Za-z0-9_-]{20,200}$/.test(key.trim()))throw new Error('DeepSeek 密钥格式不正确。')
  if(await invoke('write',key.trim(),path)!=='OK')throw new Error('DeepSeek 密钥未能加密保存。')
  return {saved:true,storage:'Windows DPAPI CurrentUser'}
}
export async function loadDeepSeekKey({ environment = globalThis.process?.env || {}, path = credentialPath } = {}) {
  const environmental=environment.DEEPSEEK_API_KEY?.trim()
  if(environmental)return environmental
  if(!existsSync(path))return undefined
  return invoke('read','',path)
}
export function credentialStatus({ environment = globalThis.process?.env || {}, path = credentialPath } = {}){return {stored:existsSync(path),environment:!!environment.DEEPSEEK_API_KEY?.trim()}}
