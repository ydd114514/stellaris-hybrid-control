import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createWindowsDriver } from '../src/driver.mjs'
import { recognizeGameText } from '../src/ocr.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),directory=join(root,'.local','fast-research',String(Date.now()))
await mkdir(directory,{recursive:true})
const driver=createWindowsDriver({pythonPath:'C:/Program Files/Python315/python.exe',gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',assumePaused:true,focusOnStart:true})
const evidence=[];let current,sequence=0
const normalize=text=>text.replace(/\s+/g,'')
async function observe(label){
  const started=performance.now();current=await driver.observe()
  const ocr=await recognizeGameText(current),file=`${String(++sequence).padStart(2,'0')}-${label}.png`
  await writeFile(join(directory,file),Buffer.from(current.imageBase64,'base64'))
  evidence.push({label,file,observationId:current.id,elapsedMs:Math.round(performance.now()-started),ocr})
  console.log(JSON.stringify({label,elapsedMs:Math.round(performance.now()-started),labels:ocr.labels?.map(row=>({text:row.text,x:row.centerX,y:row.centerY})),message:ocr.message}))
  return ocr.labels||[]
}
async function act(action){await driver.execute(action,{observationId:current.id});await new Promise(resolve=>setTimeout(resolve,250))}
function technology(labels){return labels.some(row=>/物理学/.test(normalize(row.text)))&&labels.some(row=>/社会学|工程学/.test(normalize(row.text)))}
try{
  let labels=await observe('initial')
  if(labels.some(row=>/征途.*星辰.*大海/.test(normalize(row.text)))){await act({type:'key',key:'ENTER'});labels=await observe('welcome-closed')}
  if(!technology(labels))for(const key of ['F4','F3','F2']){
    await act({type:'key',key});labels=await observe(key)
    if(technology(labels)){console.log(JSON.stringify({researchPanelKey:key,directory}));break}
  }
}finally{await driver.stop();await writeFile(join(directory,'probe.json'),JSON.stringify({directory,evidence},null,2));console.log(JSON.stringify({evidence:join(directory,'probe.json')}))}
