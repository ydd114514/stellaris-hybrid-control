import {existsSync} from 'node:fs'
import {join} from 'node:path'

/** Reuse this app's configured Windows profile so upgrades keep encrypted keys and login partitions. */
export function resolveStellarisProfile(options:{sourceRoot?:string;documents:string;appData:string;basic:boolean;testProfile?:string}){
  if(options.testProfile)return options.testProfile
  if(options.basic)return join(options.appData,'QunxingFeiyu')
  const preferred=join(options.sourceRoot||join(options.documents,'群星控制器大肥鱼'),'.local/dsh-desktop')
  const installed=join(options.documents,'群星控制器大肥鱼','.local/dsh-desktop')
  const legacy=join(options.documents,'大肥鱼 DSH','.local/dsh-desktop')
  const configured=(directory:string)=>['controller.json','ai-hub.json','captain-speech.json','ai-keys.enc.json','captain-speech-key.enc.json'].some(file=>existsSync(join(directory,file)))
  return configured(preferred)?preferred:configured(installed)?installed:configured(legacy)?legacy:preferred
}
