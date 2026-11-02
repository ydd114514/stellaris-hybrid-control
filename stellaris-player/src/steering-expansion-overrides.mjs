import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// These are the installed 4.5.2 colony-ship budget variants, not new budgets.
// Reusing their keys replaces their definitions instead of adding a second
// share of spending. All original eligibility, weights and reserves survive.
const budgets={
 '00_energy_budget.txt':{energy_expenditure_colonies_infernal_hive:'energy',energy_expenditure_colonies_machine:'energy'},
 '00_minerals_budget.txt':{minerals_expenditure_colonies_lithoid_expand:'minerals'},
 '00_food_budget.txt':{food_expenditure_colonies_expand:'food',food_expenditure_colonies_expand_rock_tree:'food'},
 '01_alloys_budget.txt':{alloys_expenditure_colonies_infernal_expand:'alloys',alloys_expenditure_colonies_expand:'alloys'},
 '01_consumer_goods_budget.txt':{consumer_goods_expenditure_colonies_expand:'consumer_goods'},
 '01_trade_budget.txt':{trade_expenditure_colonies_sponsored:'trade'},
 '04_influence_budget.txt':{influence_expenditure_stations:'influence'}
};
const restriction='\n\t\tNOT = { has_edict = cfsteer_expansion_consolidate }';

function closingBrace(text,start){
 let depth=0,quoted=false,escaped=false,comment=false;
 for(let i=start;i<text.length;i++){
  const ch=text[i];
  if(comment){if(ch==='\n')comment=false;continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='#'){comment=true;continue;}if(ch==='"'){quoted=true;continue;}
  if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return i;
 }
 throw Error('扩张预算脚本括号不完整，未生成覆盖');
}

export function expansionBudgetOverrides(sources){
 const entries=[],variables=new Map();
 for(const [file,definitions] of Object.entries(budgets)){
  const source=sources[file];
  if(typeof source!=='string'||source.length>4_000_000)throw Error('4.5.2扩张预算文件缺失或过大：'+file);
  for(const match of source.matchAll(/^\s*(@\w+)\s*=\s*([^\r\n#]+)/gm)){
   const value=match[2].trim();
   if(variables.has(match[1])&&variables.get(match[1])!==value)throw Error('扩张预算局部变量冲突：'+match[1]);
   variables.set(match[1],value);
  }
  for(const [name,resource] of Object.entries(definitions)){
   const match=new RegExp('^'+name+'\\s*=\\s*\\{','m').exec(source);
   if(!match)throw Error('4.5.2扩张预算定义缺失：'+name);
   const open=source.indexOf('{',match.index),close=closingBrace(source,open);
   let entry=source.slice(match.index,close+1);
   const category=resource==='influence'?'stations':'colonies';
   for(const [field,value] of Object.entries({resource,type:'expenditure',category})){
    if(!new RegExp('\\b'+field+'\\s*=\\s*'+value+'\\b').test(entry))throw Error('4.5.2扩张预算类型不符：'+name);
   }
   const potential=/\bpotential\s*=\s*\{/.exec(entry);
   if(!potential)throw Error('4.5.2扩张预算缺少potential：'+name);
   const at=entry.indexOf('{',potential.index)+1;
   entry=entry.slice(0,at)+restriction+entry.slice(at);
   entries.push(entry);
  }
 }
 return '# Generated from installed 4.5.2. Tighten new colony/outpost budgets only while the country has consolidate.\n'+
  '# Existing orders and saved budget balances are not cancelled; other countries and stances retain vanilla rules.\n'+
  [...variables].map(([key,value])=>key+' = '+value).join('\n')+'\n'+entries.join('\n\n')+'\n';
}

export async function generateSteeringExpansionOverrides(gameDirectory){
 const sources={};
 for(const file of Object.keys(budgets))sources[file]=await readFile(join(gameDirectory,'common/ai_budget',file),'utf8');
 return {path:'common/ai_budget/zz_cfsteer_expansion_budget.txt',content:Buffer.from(expansionBudgetOverrides(sources),'utf8')};
}
