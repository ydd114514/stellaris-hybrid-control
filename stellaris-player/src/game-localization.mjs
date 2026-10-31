import{readFile,readdir}from'node:fs/promises'
import{join}from'node:path'

export function parseLocalization(text){
  const result=new Map()
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\s*([\w.:%-]+):\d*\s+"((?:[^"\\]|\\.)*)"/)
    if(match)result.set(match[1],match[2].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\'))
  }
  return result
}
export function createNameResolver(entries){
  const lookup=entries instanceof Map?entries:new Map(Object.entries(entries))
  function resolve(value,depth=0){
    if(depth>10)return null
    const key=typeof value==='string'?value:value?.key
    if(typeof key!=='string')return null
    let text=lookup.get(key)
    if(typeof text!=='string')return null
    const variables=new Map((value?.variables||[]).filter(row=>row&&typeof row.key==='string').map(row=>[row.key,row.value]))
    let unknown=false
    text=text.replace(/\$([\w.:-]+)\$/g,(match,name)=>{
      const replacement=resolve(variables.get(name)??name,depth+1)
      if(replacement===null){unknown=true;return match}
      return replacement
    })
    if(unknown||/%\w+%/.test(text))return null
    return text.replace(/§./g,'').replace(/£[\w]+£/g,'').trim()
  }
  return{resolve}
}
export async function loadGameLocalization(gameDirectory){
  const root=join(gameDirectory,'localisation','simp_chinese'),entries=new Map()
  const files=(await readdir(root,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('_l_simp_chinese.yml'))
  for(const file of files){
    const text=await readFile(join(file.parentPath||file.path,file.name),'utf8')
    for(const[key,value]of parseLocalization(text))entries.set(key,value)
  }
  return createNameResolver(entries)
}
