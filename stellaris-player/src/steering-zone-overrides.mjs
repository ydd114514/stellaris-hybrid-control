import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

// Generate derived candidates only in the user's mod, never in the game files
// or repository. Costs, jobs and building sets remain those of the base zone.
const names=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
const unityNames=['zone_unity','zone_unity_spiritualist','zone_unity_bio_trophy','zone_research_unity'];
const unityTechs=['tech_cultural_heritage','tech_heritage_site','tech_hypercomms_forum','tech_autocurating_vault','tech_holographic_rituals','tech_consecration_fields'];
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
function rootFields(text){
 const result=[];let i=0;
 const space=()=>{while(i<text.length){if(/\s/.test(text[i])){i++;continue;}if(text[i]==='#'){while(i<text.length&&text[i]!=='\n')i++;continue;}break;}};
 while(i<text.length){
  space();if(i>=text.length)break;
  const start=i,match=/^[a-zA-Z_$][\w.$?]*/.exec(text.slice(i));if(!match){i++;continue;}
  const key=match[0];i+=key.length;space();if(text[i]!=='='){continue;}i++;space();const valueStart=i;
  if(text[i]==='{')i=closingBrace(text,i)+1;
  else if(text[i]==='"'){i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}}
  else while(i<text.length&&!/[\s#]/.test(text[i]))i++;
  result.push({key,start,valueStart,end:i,value:text.slice(valueStart,i)});
 }
 return result;
}
function inlineCall(field){
 const scalar=value=>value?.startsWith('"')?value.slice(1,-1):value;
 if(!field.value.startsWith('{'))return {path:scalar(field.value),parameters:{}};
 const args=rootFields(field.value.slice(1,-1)),script=args.find(row=>row.key==='script');
 if(!script)throw Error('区域inline_script缺少真实script路径');
 return {path:scalar(script.value),parameters:Object.fromEntries(args.filter(row=>row.key!=='script').map(row=>[row.key,scalar(row.value)]))};
}
const inlineGet=(sources,path)=>sources instanceof Map?sources.get(path):sources?.[path];
function expandZoneInlines(body,sources,stack=[]){
 const fields=rootFields(body).filter(row=>row.key==='inline_script');let result='',offset=0;
 for(const field of fields){
  const {path,parameters}=inlineCall(field);
  if(!path?.startsWith('zones/'))continue;
  if(stack.includes(path)||stack.length>=16)throw Error('区域inline脚本循环或层级过深：'+path);
  const source=inlineGet(sources,path);
  if(typeof source!=='string')throw Error('区域inline资格定义未读取：'+path);
  const resolved=source.replace(/\$([A-Z][A-Z0-9_]*)(?:\|([^$]*))?\$/g,(token,key,fallback)=>{
   if(Object.hasOwn(parameters,key))return parameters[key];if(fallback!==undefined)return fallback;
   throw Error('区域inline缺少真实参数：'+path+' '+key);
  });
  result+=body.slice(offset,field.start)+'\n# Expanded '+path+'; original eligibility, costs and job calls retained.\n'+expandZoneInlines(resolved,sources,[...stack,path]);offset=field.end;
 }
 return result+body.slice(offset);
}
export async function loadZoneInlineScripts(gameDirectory,text,{modDirectories=[],onSource=()=>{}}={}){
 const result=new Map(),roots=[...modDirectories].reverse().concat(gameDirectory);
 const collect=async body=>{
  for(const field of rootFields(body).filter(row=>row.key==='inline_script')){
   const {path}=inlineCall(field);if(!path?.startsWith('zones/')||result.has(path))continue;
   if(!/^zones\/[a-zA-Z0-9_/-]+$/.test(path)||path.includes('..'))throw Error('区域inline路径无效');
   let content,sourcePath;
   for(const root of roots){try{sourcePath=join(root,'common/inline_scripts',path+'.txt');content=await readFile(sourcePath,'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}}
   if(content===undefined)throw Error('实际区域inline文件缺失：'+path);
   result.set(path,content);onSource({path:'common/inline_scripts/'+path+'.txt',sourcePath,content});
   if(result.size>128)throw Error('区域inline依赖过多，未生成');
   await collect(content);
  }
 };
 for(const name of [...names,...unityNames])await collect(definition(text,name).slice(definition(text,name).indexOf('{')+1,-1));
 return result;
}
export function researchZoneOverrides(text,{inlineScripts}={}){
 return zoneOverrides(text,names,'research',inlineScripts);
}
export function unityZoneOverrides(text,{inlineScripts}={}){return zoneOverrides(text,unityNames,'unity_traditions',inlineScripts);}
function definition(text,name){
 const match=new RegExp('^'+name+'\\s*=\\s*\\{','m').exec(text);
 if(!match)throw Error('4.5.2定义缺失：'+name);
 const open=text.indexOf('{',match.index),close=closingBrace(text,open);
 return text.slice(match.index,close+1);
}
function zoneOverrides(text,zoneNames,focus,inlineScripts){
 if(typeof text!=='string'||text.length>4_000_000)throw Error('区域脚本过大或无效');
 const condition='\n\t\towner = { has_edict = cfsteer_economy_'+focus+' is_wilderness_empire = no }\n';
 const entries=zoneNames.map(name=>{
  const match=new RegExp('^'+name+'\\s*=\\s*\\{','m').exec(text);
  if(!match)throw Error('4.5.2区域定义缺失：'+name);
  const open=text.indexOf('{',match.index),close=closingBrace(text,open);
  let body=expandZoneInlines(text.slice(open+1,close),inlineScripts);
  const potentials=rootFields(body).filter(row=>row.key==='potential');
  const original=potentials.map(row=>row.value.slice(1,-1));
  // Inline expansion and the visible entry can both define eligibility. Keep
  // their conjunction in one database potential instead of adding a duplicate.
  for(const field of [...potentials].reverse())body=body.slice(0,field.start)+body.slice(field.end);
  body+='\n\tpotential = {'+condition+original.map(value=>'\n\t\tAND = {'+value+'\n\t\t}').join('')+'\n\t}\n';
  let entry='cfsteer_'+name+' = {'+body+'}';
  // The actual 4.5.2 parser requires a scalar additional_ai_weight. A separate
  // candidate's potential supplies the edict condition without altering NPCs.
  const weights=rootFields(body).filter(row=>row.key==='additional_ai_weight');
  if(weights.some(row=>!/^[-+0-9.eE]+$/.test(row.value)))throw Error('4.5.2 additional_ai_weight必须是数值');
  if(weights.length>1)throw Error('实际区域有重复additional_ai_weight，未生成');
  if(weights.length){const field=weights[0];body=body.slice(0,field.valueStart)+'250'+body.slice(field.end);entry='cfsteer_'+name+' = {'+body+'}';}
  else entry=entry.slice(0,-1)+'\n\tadditional_ai_weight = 250\n}';
  // Keep conversion among the same weighted candidates; their original
  // eligibility and inline job definitions still decide empire variants.
  if(focus==='unity_traditions')entry=entry.replace(/\bconvert_to\s*=\s*\{[^}]*\}/g,block=>block.replace(/\bzone_unity(?:_spiritualist|_bio_trophy)?\b/g,key=>'cfsteer_'+key));
  return entry;
 });
 const variables=text.match(/^\s*@\w+\s*=\s*[^\r\n#]+/gm)??[];
 return '# Generated locally from installed 4.5.2; player-edict candidates retain vanilla costs and jobs.\n'+variables.join('\n')+'\n'+entries.join('\n\n')+'\n';
}
export function unityTechnologyOverrides(text){
 if(typeof text!=='string'||text.length>4_000_000)throw Error('科技脚本过大或无效');
 const variables=text.match(/^\s*@\w+\s*=\s*[^\r\n#]+/gm)??[];
 return '# Generated locally; only these technology AI preferences are overridden.\n'+variables.join('\n')+'\n'+unityTechs.map(name=>{
  let entry=definition(text,name);
  const weight=/\bai_weight\s*=\s*\{/.exec(entry);
  if(!weight)throw Error('4.5.2科技缺少ai_weight：'+name);
  const at=entry.indexOf('{',weight.index)+1;
  return entry.slice(0,at)+'\n modifier = { factor = 3 has_edict = cfsteer_economy_unity_traditions }\n'+entry.slice(at);
 }).join('\n\n')+'\n';
}
export function unityZoneTrigger(text){
 const entry=definition(text,'has_any_unity_zone');
 const at=entry.indexOf('{')+1;
 // Wrap the original trigger to preserve every vanilla habitat/arcology variant.
 return 'has_any_unity_zone = { OR = {\n'+unityNames.map(name=>'has_zone = { zone = cfsteer_'+name+' }').join('\n')+'\nAND = {'+entry.slice(at,-1)+'}\n} }\n';
}
export function traditionPriorityOverrides(sources){
 const preferred=['prosperity','statecraft','domination'];
 const order=[...preferred,...Object.keys(sources).filter(k=>!preferred.includes(k)).sort()];
 const rows=order.flatMap(key=>{
  const text=sources[key];if(typeof text!=='string'||text.length>1_000_000)throw Error('传统定义缺失或过大：'+key);
  const entry=definition(text,'tradition_'+key),adopt=entry.match(/\badoption_bonus\s*=\s*"?([a-zA-Z0-9_]+)/)?.[1],finish=entry.match(/\bfinish_bonus\s*=\s*"?([a-zA-Z0-9_]+)/)?.[1];
  if(!adopt||!finish){if(preferred.includes(key))throw Error('传统缺少采纳/完成标记：'+key);return [];}
  return [{key,entry,adopt,finish}];
 });
 const scope='OR = { '+['balanced','unity_traditions','consumer_stability','alloys_military','research'].map(k=>'has_edict = cfsteer_economy_'+k).join(' ')+' }';
 const unfinished=row=>'AND = { has_tradition = '+row.adopt+' NOT = { has_tradition = '+row.finish+' } }';
 const any='OR = { '+rows.map(unfinished).join(' ')+' }',none='NOT = { '+any+' }';
 const wants=['NOT = { has_tradition = tr_prosperity_finish }',
  'has_tradition = tr_prosperity_finish has_paragon_dlc = yes NOT = { has_tradition = tr_statecraft_finish }',
  'has_tradition = tr_prosperity_finish OR = { has_tradition = tr_statecraft_finish has_paragon_dlc = no } NOT = { has_tradition = tr_domination_finish }'];
 return '# Generated locally; finish one tree before opening another.\n'+rows.map((row,index)=>{
  let entry=row.entry;const weight=/\bai_weight\s*=\s*\{/.exec(entry);if(!weight)throw Error('传统缺少ai_weight：'+row.key);
  const at=entry.indexOf('{',weight.index)+1;
  const prior=rows.slice(0,index).map(unfinished).join(' ');
  // If a legacy save has several unfinished trees, finish one deterministic
  // tree first. New tree weights remain zero until every active tree is closed.
  const rules=['modifier = { factor = 0 '+scope+' '+any+' NOT = { '+unfinished(row)+' } }'];
  if(prior)rules.push('modifier = { factor = 0 '+scope+' OR = { '+prior+' } }');
  for(let i=0;i<preferred.length;i++)if(row.key!==preferred[i])rules.push('modifier = { factor = 0 '+scope+' '+none+' '+wants[i]+' }');
  if(preferred.includes(row.key))rules.push('modifier = { factor = 1000000 '+scope+' OR = { '+unfinished(row)+' AND = { '+none+' '+wants[preferred.indexOf(row.key)]+' } } }');
  return entry.slice(0,at)+'\n'+rules.join('\n')+'\n'+entry.slice(at);
 }).join('\n\n')+'\n';
}
export async function generateSteeringZoneOverrides(gameDirectory){
 const text=await readFile(join(gameDirectory,'common/zones/00_zones.txt'),'utf8');
 const inlineScripts=await loadZoneInlineScripts(gameDirectory,text);
 const tech=await readFile(join(gameDirectory,'common/technology/00_soc_tech.txt'),'utf8');
 const triggers=await readFile(join(gameDirectory,'common/scripted_triggers/01_scripted_triggers_buildings.txt'),'utf8');
 const traditionSources={},categoryDirectory=join(gameDirectory,'common/tradition_categories');
 for(const file of await readdir(categoryDirectory))if(file.endsWith('.txt')){
  const source=await readFile(join(categoryDirectory,file),'utf8');
  for(const match of source.matchAll(/^tradition_([a-zA-Z0-9_]+)\s*=\s*\{/gm))traditionSources[match[1]]=source;
 }
 return {path:'common/zones/zz_cfsteer_research_weights.txt',content:Buffer.from(researchZoneOverrides(text,{inlineScripts}),'utf8'),extraFiles:[{
  path:'common/scripted_triggers/zz_cfsteer_research_zone_trigger.txt',
  content:Buffer.from('has_any_research_zone = { OR = { has_any_unspecialized_research_zone = yes has_any_specialized_research_zone = yes '+
    names.map(name=>'has_zone = { zone = cfsteer_'+name+' }').join(' ')+' } }\n','utf8')
 },{path:'common/zones/zz_cfsteer_unity_weights.txt',content:Buffer.from(unityZoneOverrides(text,{inlineScripts}),'utf8')},
 {path:'common/technology/zz_cfsteer_unity_weights.txt',content:Buffer.from(unityTechnologyOverrides(tech),'utf8')},
 {path:'common/scripted_triggers/zz_cfsteer_unity_zone_trigger.txt',content:Buffer.from(unityZoneTrigger(triggers),'utf8')},
 {path:'common/tradition_categories/zz_cfsteer_tradition_priority.txt',content:Buffer.from(traditionPriorityOverrides(traditionSources),'utf8')}]};
}
