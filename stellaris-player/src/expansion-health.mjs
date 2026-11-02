const finite=Number.isFinite;
const values={economyFocus:['balanced','unity_traditions','consumer_stability','alloys_military','research'],expansionStance:['aggressive','consolidate'],militaryStance:['peaceful','prepare_war']};

// Only a controller-confirmed contract describes settings already in force.
export function confirmedStrategy(state={}){
 const contract=state.strategyContract;
 return contract?.steeringConfirmed===true&&Object.entries(values).every(([key,allowed])=>allowed.includes(contract[key]))?contract:null;
}

// Owner instructions have priority over advisory goals. Keep interpretation
// narrow: "control expansion" is not an instruction to freeze all growth.
export function ownerConsolidation(state={}){
 const text=[state.operatorStanding?.text,...(state.operatorMessages??[])].filter(x=>typeof x==='string').join('；');
 return text.split(/[；;，,。！!\n]/).some(part=>{
  const clause=part.trim().replace(/^(?:请|现在|本轮|暂时|我要求|要求|先)\s*/, '');
  return /^(?:暂停|停止|暂缓|不再|禁止|不要|别再)(?:继续|新的|普通)?(?:扩张|殖民)/.test(clause)||/^(?:优先|先|继续)?(?:巩固|消化)(?:现有|已有|当前)?(?:殖民地|星球|疆域|领土)/.test(clause);
 });
}

/** Actual capacity deficits or sustained underperformance with expansion costs.
 * Unknown fields and absolute empire size never imply a need to consolidate. */
export function expansionHealth(state={}, {colonies=[],growth={}}={}){
 const rows=new Map();
 for(const row of colonies)if(row?.inhabited===true)rows.set(row.planetId,{...row});
 for(const row of state.colonyAudit?.colonies??[]){
  if(!finite(row?.ageDays)||row.ageDays<0||row.ageDays>360)continue;
  const inhabited=finite(row.popGroups)&&row.popGroups>0;
  rows.set(row.planetId,{...row,inhabited});
 }
 const distressed=[];
 for(const row of rows.values()){
  if(row.inhabited!==true)continue;
  const problems=[];
  if(finite(row.housing)&&row.housing<0)problems.push('住房不足');
  if(finite(row.amenities)&&row.amenities<0)problems.push('舒适度不足');
  if(finite(row.unemployed)&&row.unemployed>0)problems.push('存在失业人口');
  if(problems.length)distressed.push({planetId:row.planetId,name:typeof row.name==='string'?row.name.slice(0,40):String(row.planetId),problems});
 }
 const owned=(state.colonies??[]).flatMap(sector=>sector.colonies_summary??[]);
 const colonizing=owned.filter(row=>row.is_colonizing===true).length;
 const comparison=growth.expansion;
 const compared=comparison?.known===true&&finite(comparison.observedYears)&&comparison.observedYears>=3;
 const added=compared&&((finite(comparison.coloniesAdded)&&comparison.coloniesAdded>0)||(finite(comparison.systemsAdded)&&comparison.systemsAdded>0));
 const expansionBurden=colonizing>0||added;
 const unity=growth.unity;
 const unityBehind=unity?.focused===true&&finite(unity.baseline?.observedYears)&&unity.baseline.observedYears>=3&&(unity.scalingBehind===true||unity.stagnating===true);
 const scienceBehind=growth.known===true&&finite(growth.observedYears)&&growth.observedYears>=3&&growth.stagnating===true;
 const growthBehind=unityBehind||scienceBehind;
 const reasons=[];
 if(distressed.length)reasons.push(distressed.slice(0,3).map(row=>row.name+'：'+row.problems.join('、')).join('；'));
 if(growthBehind&&expansionBurden)reasons.push('同局持续增长落后，且有新增疆域、殖民地或正在殖民的负担，先消化现有投入');
 return {date:state.date,consolidate:distressed.length>0||growthBehind&&expansionBurden,distressedColonies:distressed.slice(0,8),colonizing,expansionBurden,growthBehind,reasons,
  resumeWhen:'已观察到的住房、舒适度与失业问题解除，且扩张负担不再伴随持续增长落后时，恢复原战略扩张意图'};
}
