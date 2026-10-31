const id=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
export function fixedSurveyCohort(map,{centerSystemId,jumps,maxSystems=64}={}){
 if(!id(centerSystemId)||!Number.isInteger(jumps)||jumps<1||jumps>6)throw Error('固定统计范围无效');
 if(map?.center_system_id!==centerSystemId||map.jumps!==jumps||!Array.isArray(map.columns)||!Array.isArray(map.rows)||!map.rows.length||map.rows.length>maxSystems)throw Error('初始地图统计范围缺失或过大');
 const key=map.columns.indexOf('id'),distance=map.columns.indexOf('jumps');if(key<0||distance<0)throw Error('初始地图缺少完整ID或距离');
 const ids=[];for(const row of map.rows){if(!Array.isArray(row)||!id(row[key])||!Number.isInteger(row[distance])||row[distance]<0||row[distance]>jumps)throw Error('初始统计行无效');ids.push(row[key]);}
 if(new Set(ids).size!==ids.length||!ids.includes(centerSystemId))throw Error('统计范围重复或缺少中心');
 return ids.sort((a,b)=>a-b);
}
// Pinned bridge GetSystemJson includes every surveyed body even at low intel;
// only unknown, unsurveyed bodies are hidden. No hidden resource data is inferred.
export function surveyedBodyDelta(before,after){
 const collect=x=>{if(!Array.isArray(x?.planets))return null;const all=new Set(),done=new Set();for(const p of x.planets){if(!id(p?.id)||typeof p.surveyed!=='boolean'||all.has(p.id))return null;all.add(p.id);if(p.surveyed)done.add(p.id);}return done;};
 if(!id(before?.id)||before.id!==after?.id)return null;const a=collect(before),b=collect(after);if(!a||!b||[...a].some(x=>!b.has(x)))return null;
 return [...b].filter(x=>!a.has(x)).sort((a,b)=>a-b);
}
