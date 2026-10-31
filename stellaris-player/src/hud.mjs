import { recognizeGameText } from './ocr.mjs'
import{findStarTargets}from'./star-targets.mjs'

/** Read only the game HUD from an already supplied PNG. */
export async function readHud(image,{recognize=recognizeGameText,signal}={}){
  const width=Math.min(360,image.width),height=Math.min(95,image.height)
  const options={region:{x:image.width-width,y:0,width,height},scale:4,signal}
  const ocr=await recognize(image,options)
  let parsed=parseHudLabels(ocr.labels||[])
  if(parsed.paused===null||!parsed.gameDate){
    const masked=await recognize(image,{...options,preprocess:'text-mask'})
    const recovered=parseHudLabels(masked.labels||[])
    parsed={...parsed,gameDate:recovered.gameDate||parsed.gameDate,paused:recovered.paused===null?parsed.paused:recovered.paused}
  }
  return parsed
}
export async function readGameScreen(image,options={}){
  const recognize=options.recognize||recognizeGameText
  const rightWidth=Math.min(350,image.width),rightHeight=Math.min(600,image.height-110)
  const [hud,ui,right]=await Promise.all([readHud(image,options),recognize(image,{signal:options.signal}),recognize(image,{signal:options.signal,region:{x:image.width-rightWidth,y:110,width:rightWidth,height:rightHeight},scale:2,preprocess:'text-mask'})])
  const cutX=(image.width-rightWidth)*1000/image.width,cutTop=110*1000/image.height,cutBottom=(110+rightHeight)*1000/image.height
  let rightLabels=right.labels||[]
  const header=rightLabels.find(label=>label.text.replace(/\s/g,'')==='通用舰船')
  if(header&&(!rightLabels.some(label=>/科研船/.test(label.text))||!rightLabels.some(label=>/工程船/.test(label.text)))){
    const y=Math.max(0,Math.floor(header.centerY*image.height/1000-10)),width=Math.min(310,image.width)
    const detail=await recognize(image,{signal:options.signal,region:{x:image.width-width,y,width,height:Math.min(135,image.height-y)},scale:2,preprocess:'text-mask'})
    if(detail.ok)rightLabels=[...rightLabels.filter(label=>!(label.centerY>=y*1000/image.height&&label.centerY<=(y+135)*1000/image.height)),...detail.labels]
  }
  let whole=(ui.labels||[]).filter(label=>!(right.ok&&label.centerX>=cutX&&label.centerY>=cutTop&&label.centerY<=cutBottom))
  const action=options.lastAction
  if(action?.type==='click'&&action.button==='right'&&Date.now()-action.at<8000){
    const x=Math.max(0,Math.min(image.width-440,Math.round(action.x*image.width/1000)-12))
    const y=Math.max(0,Math.min(image.height-480,Math.round(action.y*image.height/1000)-15))
    const menu=await recognize(image,{signal:options.signal,region:{x,y,width:440,height:480},scale:3,preprocess:'text-mask'})
    if(menu.ok){
      whole=whole.filter(label=>!(label.centerX>=x*1000/image.width&&label.centerX<=(x+440)*1000/image.width&&label.centerY>=y*1000/image.height&&label.centerY<=(y+480)*1000/image.height))
      whole.push(...menu.labels)
    }
  }
  const labels=[...whole,...rightLabels].filter(label=>/[\p{L}\p{Script=Han}]/u.test(label.text)&&label.text.length<=30).slice(0,90).map(label=>({text:label.text,x:label.centerX,y:label.centerY}))
  const targets=labels.map((label,index)=>({id:`t${index}`,...label}))
  const bottom=labels.filter(label=>label.x>400&&label.x<600&&label.y>960).map(label=>label.text).join('')
  const mapMode=/帝国母星/.test(bottom)?'system':/联合国|民主制|独裁制|君主制|寡头制|集体意识/.test(bottom)?'galaxy':'unknown'
  const selection=labels.filter(label=>label.x<250&&label.y>700).map(label=>label.text).join('')
  const selectedShipType=/工程船/.test(selection)?'construction':/科研船/.test(selection)?'science':null
  const stars=mapMode==='galaxy'?findStarTargets(image,ui.labels||[]).map(({pixelX,pixelY,...star})=>star):[]
  return{...hud,mapMode,selectedShipType,labels,targets,stars}
}
export function parseHudLabels(labels){
  const text=labels.map(row=>row.text).join('\n').replace(/[．。]/g,'.').replace(/\s+/g,'')
  const date=text.match(/(\d{4})[.,，]([0-9IlLoO]{2})[.,，]?([0-9IlLoO]{2})/)
  const number=value=>value.replace(/[IlL]/g,'1').replace(/[oO]/g,'0')
  const month=date&&number(date[2]),day=date&&number(date[3])
  const gameDate=date&&Number(month)>=1&&Number(month)<=12&&Number(day)>=1&&Number(day)<=31?`${date[1]}.${month}.${day}`:null
  const paused=/暂停|Paused/i.test(text)
  const running=/极慢|慢速|常速|快速|极快|Fast|Normal|Slow/i.test(text)
  return{gameDate,paused:paused?true:running?false:null,text:text.slice(0,300)}
}
