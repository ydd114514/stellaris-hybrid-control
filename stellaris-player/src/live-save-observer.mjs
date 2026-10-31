import{readdir,stat}from'node:fs/promises'
import{join}from'node:path'
import{observeSave}from'./save-observer.mjs'

const calendar=value=>{
  const match=String(value||'').match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  return match?Number(match[1])*360+Number(match[2])*30+Number(match[3]):null
}
/** A manually selected current test-world folder only. Never selects a world
 * from unrelated saves; exports the parser's player-owned subset, with age.
 */
export function createLiveSaveObserver({directory,notBefore=Date.now(),readSave=observeSave,now=Date.now,resolveDisplayName}={}){
  let lastScan=0,lastFile,lastModified=0,cached
  return{async read(image){
    if(!directory)return null
    if(now()-lastScan>10000){
      lastScan=now()
      const entries=await readdir(directory,{withFileTypes:true}),files=[]
      for(const entry of entries){
        if(!entry.isFile()||!entry.name.endsWith('.sav'))continue
        const path=join(directory,entry.name),info=await stat(path)
        if(info.mtimeMs>=notBefore)files.push({path,modified:info.mtimeMs})
      }
      files.sort((a,b)=>b.modified-a.modified)
      const file=files[0]
      if(file&&(file.path!==lastFile||file.modified!==lastModified)){
        const state=await readSave({savePath:file.path,resolveDisplayName})
        lastFile=file.path;lastModified=file.modified;cached=state
      }
    }
    if(!cached)return null
    const saved=calendar(cached.gameDate),current=calendar(image?.hud?.gameDate)
    if(saved===null||current===null||current<saved||current-saved>370)return null
    const{player}=cached
    const research=Object.fromEntries(Object.entries(player.research||{}).map(([area,state])=>[area,{...state,...(state.current?{current:{...state.current,label:resolveDisplayName?.(state.current.technology)||state.current.technology}}:{}),availableNames:state.available?.map(id=>({id,label:resolveDisplayName?.(id)||id}))}]))
    return{source:'current-world-autosave',gameDate:cached.gameDate,ageGameDays:current-saved,warning:'保存时的己方快照，最新动作仍以当前画面为准；空/未知研究队列不能当作已有研究；populationRaw为原始值、单位未换算。',player:{name:player.name,resources:player.resources,planets:player.planets,fleets:player.fleets?.filter(fleet=>!['shipclass_mining_station','shipclass_research_station'].includes(fleet.shipClass)),research}}
  }}
}
