import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Generate derived candidates only in the user's mod, never in the game files
// or repository. Costs, jobs and building sets remain those of the base zone.
const names=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
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
 const condition='\n\t\towner = { has_edict = cfsteer_economy_research is_wilderness_empire = no }\n';
 const entries=names.map(name=>{
  const match=new RegExp('^'+name+'\\s*=\\s*\\{','m').exec(text);
  if(!match)throw Error('4.5.2区域定义缺失：'+name);
  const open=text.indexOf('{',match.index),close=closingBrace(text,open);
  let entry=text.slice(match.index,close+1).replace(new RegExp('^'+name),'cfsteer_'+name);
  // The actual 4.5.2 parser requires a scalar additional_ai_weight. A separate
  // candidate's potential supplies the edict condition without altering NPCs.
  const potential=/\bpotential\s*=\s*\{/.exec(entry);
  if(potential){const at=entry.indexOf('{',potential.index)+1;entry=entry.slice(0,at)+condition+entry.slice(at);}
  else entry=entry.slice(0,-1)+'\n\tpotential = {'+condition+'\t}\n}';
  if(/\badditional_ai_weight\s*=\s*\{/.test(entry))throw Error('4.5.2 additional_ai_weight必须是数值');
  entry=entry.replace(/\badditional_ai_weight\s*=\s*[-+0-9.eE]+/g,'additional_ai_weight = 250');
  if(!/\badditional_ai_weight\s*=/.test(entry))entry=entry.slice(0,-1)+'\n\tadditional_ai_weight = 250\n}';
  return entry;
 });
 const variables=text.match(/^\s*@\w+\s*=\s*[^\r\n#]+/gm)??[];
 return '# Generated locally from installed 4.5.2; player-edict candidates retain vanilla costs and jobs.\n'+variables.join('\n')+'\n'+entries.join('\n\n')+'\n';
}
export async function generateSteeringZoneOverrides(gameDirectory){
 const text=await readFile(join(gameDirectory,'common/zones/00_zones.txt'),'utf8');
 return {path:'common/zones/zz_cfsteer_research_weights.txt',content:Buffer.from(researchZoneOverrides(text),'utf8'),extraFiles:[{
  path:'common/scripted_triggers/zz_cfsteer_research_zone_trigger.txt',
  content:Buffer.from('has_any_research_zone = { OR = { has_any_unspecialized_research_zone = yes has_any_specialized_research_zone = yes '+
    names.map(name=>'has_zone = { zone = cfsteer_'+name+' }').join(' ')+' } }\n','utf8')
 }]};
}
