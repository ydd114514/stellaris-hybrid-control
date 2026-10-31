import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createWindowsDriver } from '../src/driver.mjs'
import { recognizeGameText } from '../src/ocr.mjs'

// Test setup only: no model, console, save overwrite or strategic decisions.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=join(root,'.local','test-world',String(Date.now()))
await mkdir(directory,{recursive:true})
const driver=createWindowsDriver({pythonPath:'C:/Program Files/Python315/python.exe',gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',assumePaused:true,focusOnStart:true})
const evidence=[];let image,labels=[],failure,sequence=0
const clean=text=>text.replace(/\s+/g,'')
async function observe(stage){
  image=await driver.observe();const ocr=await recognizeGameText(image)
  if(!ocr.ok)throw new Error(ocr.message)
  labels=ocr.labels;const file=`${String(++sequence).padStart(2,'0')}-${stage}.png`
  await writeFile(join(directory,file),Buffer.from(image.imageBase64,'base64'))
  evidence.push({stage,file,labels});console.log(JSON.stringify({stage,labels:labels.filter(row=>/铁人|关闭|开始征程|征途|星辰|暂停|选择|研究|物理|社会|工程|新游戏|地球联合国/.test(row.text)).map(row=>({text:row.text,x:row.centerX,y:row.centerY}))}))
}
async function clickText(expression,stage){
  const targets=labels.filter(row=>expression.test(clean(row.text)))
  if(targets.length!==1)throw new Error(`测试准备无法唯一匹配 ${expression}，停止。`)
  const target=targets[0]
  await driver.execute({type:'click',x:target.centerX,y:target.centerY,button:'left',count:1},{observationId:image.id})
  await new Promise(resolve=>setTimeout(resolve,300));await observe(stage)
}
try{
  await observe('initial')
  if(labels.some(row=>clean(row.text)==='新游戏'))await clickText(/^新游戏$/,'empire-picker')
  if(labels.some(row=>clean(row.text)==='地球联合国')&&labels.some(row=>clean(row.text)==='选择'))await clickText(/^选择$/,'new-game-settings')
  if(labels.some(row=>clean(row.text)==='铁人模式')&&labels.some(row=>clean(row.text)==='通用设置')){
    const iron=labels.find(row=>clean(row.text)==='铁人模式')
    if(!labels.some(row=>clean(row.text)==='关闭'&&Math.abs(row.centerY-iron.centerY)<10&&row.centerX>iron.centerX))throw new Error('没有核验到铁人模式关闭，停止新局测试。')
    // The game's start button exposes ENTER, independent of hover-text OCR.
    await driver.execute({type:'key',key:'ENTER'},{observationId:image.id})
    await new Promise(resolve=>setTimeout(resolve,300));await observe('loading')
    for(let attempt=0;attempt<20&&!labels.some(row=>/征途.*星辰.*大海/.test(clean(row.text)));attempt++){
      await new Promise(resolve=>setTimeout(resolve,1800));await observe(`loading-${attempt+1}`)
    }
    if(!labels.some(row=>/征途.*星辰.*大海/.test(clean(row.text))))throw new Error('新局尚未显示可核验的欢迎窗，未继续。')
  }
  if(labels.some(row=>/征途.*星辰.*大海/.test(clean(row.text)))){
    await driver.execute({type:'key',key:'ENTER'},{observationId:image.id});await new Promise(resolve=>setTimeout(resolve,250));await observe('welcome-closed')
  }
  if(labels.some(row=>/关了这玩意/.test(clean(row.text))))await clickText(/关了这玩意/,'tutorial-disabled')
  // Deliberately stop after unknown setup screens. Extend using actual evidence.
}catch(error){failure={message:error.message};console.log(JSON.stringify({failure}));process.exitCode=1}
finally{await driver.stop();await writeFile(join(directory,'report.json'),JSON.stringify({directory,evidence,failure},null,2));console.log(JSON.stringify({directory}))}
