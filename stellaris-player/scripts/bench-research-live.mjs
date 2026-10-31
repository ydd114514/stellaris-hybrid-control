import { mkdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createWindowsDriver } from '../src/driver.mjs'
import { createResearchSkill } from '../src/research-skill.mjs'
import { loadDeepSeekKey } from '../src/credentials.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),directory=join(root,'.local','research-bench',String(Date.now()))
await mkdir(directory,{recursive:true})
const driver=createWindowsDriver({pythonPath:'C:/Program Files/Python315/python.exe',gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',assumePaused:true,focusOnStart:true})
const apiKey=await loadDeepSeekKey();let sequence=0
const evidence=[],events=[],results=[]
const skill=createResearchSkill({driver,apiKey,onEvent:event=>{events.push(event);console.log(JSON.stringify(event))},onEvidence:async({stage,image,ocr,ui})=>{
  const file=`${String(++sequence).padStart(2,'0')}-${stage}.png`,bytes=Buffer.from(image.imageBase64,'base64')
  await writeFile(join(directory,file),bytes)
  evidence.push({stage,file,observationId:image.id,sha256:createHash('sha256').update(bytes).digest('hex'),ocr,ui})
  console.log(JSON.stringify({stage,ui}))
}})
const stopping=()=>{skill.stop();void driver.stop()}
process.on('SIGINT',stopping);process.on('SIGTERM',stopping)
try{
  for(const area of process.argv.slice(2).length?process.argv.slice(2):['physics']){
    const result=await skill.run({area,context:{gameDate:'2200.01.01',empireName:'地球联合国',goal:'开局正常发展，从实际可见科技中选一项合适研究。'}})
    results.push(result);console.log(JSON.stringify({result}))
    if(result.status==='error'||result.status==='stopped'){process.exitCode=1;break}
  }
}finally{
  await driver.stop();process.off('SIGINT',stopping);process.off('SIGTERM',stopping)
  await writeFile(join(directory,'report.json'),JSON.stringify({directory,results,evidence,events},null,2))
  console.log(JSON.stringify({directory}))
}
