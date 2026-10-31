const candidateKey={type:'string',pattern:'^[a-zA-Z0-9_]{1,100}$',description:'逐字使用本次实际候选的key；不能用名称、已完成项目或凭记忆拼写。'};
export function orderInputSchema(fields){
 const typed={
  select_research:{slot:{type:'string',enum:['physics','society','engineering'],description:'科研槽位只用这三个英文值，不用中文、area或编号。'},tech_key:candidateKey},
  adopt_tradition:{tradition_key:candidateKey},adopt_ascension_perk:{perk_key:candidateKey},
  set_council_agenda:{agenda_key:candidateKey},launch_council_agenda:{agenda_key:{...candidateKey,description:'只使用当前active_agenda，且agenda_ready为true；可选议程不是当前议程。'}}
 };
 const names=Object.keys(fields),specific=Object.entries(typed).filter(([name])=>names.includes(name));
 const branches=specific.map(([command,properties])=>({properties:{command:{const:command},arguments:{type:'object',properties,required:fields[command][0],additionalProperties:false}}}));
 const other=names.filter(name=>!Object.hasOwn(typed,name));
 if(other.length)branches.push({properties:{command:{enum:other}}});
 return {type:'object',properties:{command:{type:'string',enum:names},arguments:{type:'object'}},required:['command','arguments'],additionalProperties:false,anyOf:branches};
}
