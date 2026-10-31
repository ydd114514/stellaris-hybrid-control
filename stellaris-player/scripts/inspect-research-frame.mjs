import{readFile}from'node:fs/promises'
import{createResearchSkill}from'../src/research-skill.mjs'
const paths=process.argv.slice(2);if(!paths.length)throw new Error('需要输入已保存的PNG文件路径。')
const images=await Promise.all(paths.map(async path=>({width:2560,height:1440,imageBase64:(await readFile(path)).toString('base64'),mimeType:'image/png'})))
let sequence=0
const skill=createResearchSkill({apiKey:'offline-no-key',driver:{async observe(){return{...images[Math.min(sequence++,images.length-1)],id:`offline-${sequence}`}},async execute(action){console.log(JSON.stringify({simulatedAction:action}));return{ok:true}}},planner:async({candidates})=>{console.log(JSON.stringify({candidates}));return{ok:false,error:{message:'离线检查到此结束，未请求API。'}}},onEvidence:async({stage,ocr,ui})=>console.log(JSON.stringify({stage,labels:ocr.labels,ui})),settle:async()=>{}})
console.log(await skill.run({area:'society'}))
