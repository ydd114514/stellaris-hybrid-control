import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Generate only selected, modified mod entries from the user's installed game.
// Vanilla game text is never copied into the repository or game installation.
function closingBrace(text,start){
 let depth=0,quoted=false,escaped=false,comment=false;
 for(let i=start;i<text.length;i++){
  const ch=text[i];
  if(comment){if(ch==='\n')comment=false;continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='#'){comment=true;continue;}if(ch==='"'){quoted=true;continue;}
  if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return i;
 }
 throw Error('区域脚本括号不完整，未生成引导覆盖');
}
export function researchZoneOverrides(text){
 if(typeof text!=='string'||text.length>4_000_000)throw Error('区域脚本过大或无效');
 const names=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
 const additions='\n\t\tmodifier = { add = 250 owner = { has_edict = cfsteer_economy_research } }\n';
 const entries=names.map(name=>{
  const match=new RegExp('^'+name+'\\s*=\\s*\\{','m').exec(text);
  if(!match)throw Error('4.5.2区域定义缺失：'+name);
  const open=text.indexOf('{',match.index),close=closingBrace(text,open);
  let entry=text.slice(match.index,close+1);
  const weight=/\badditional_ai_weight\s*=\s*\{/.exec(entry);
  if(weight){const at=entry.indexOf('{',weight.index)+1;entry=entry.slice(0,at)+additions+entry.slice(at);}
  else entry=entry.slice(0,-1)+'\n\tadditional_ai_weight = {'+additions+'\t}\n}';
  return entry;
 });
 const variables=text.match(/^\s*@\w+\s*=\s*[^\r\n#]+/gm)??[];
 return '# Generated locally from installed 4.5.2; only research-edict AI weights change.\n'+variables.join('\n')+'\n'+entries.join('\n\n')+'\n';
}
export async function generateSteeringZoneOverrides(gameDirectory){
 const text=await readFile(join(gameDirectory,'common/zones/00_zones.txt'),'utf8');
 return {path:'common/zones/zz_cfsteer_research_weights.txt',content:Buffer.from(researchZoneOverrides(text),'utf8')};
}
