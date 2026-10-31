const core=['energy','alloys','food','trade','unity'];

// Observation and admission checks only. This does not impose a native spending cap.
export function delegationResourceRisks(status,{commitments={},floors={},maintenanceMonths=1}={}){
 if(!Number.isFinite(maintenanceMonths)||maintenanceMonths<0||maintenanceMonths>12)
  return [{kind:'invalid_resource_policy'}];
 const risks=[];
 for(const key of new Set([...core,...Object.keys(commitments),...Object.keys(floors)])){
  const row=status?.resources?.[key],reserved=commitments[key]??0,floor=floors[key]??0;
  if(!Number.isFinite(reserved)||reserved<0||!Number.isFinite(floor)||floor<0){risks.push({kind:'invalid_resource_policy',resource:key});continue;}
  if(!Number.isFinite(row?.stockpile)||!Number.isFinite(row?.net)||row.stockpile_known===false||row.net_known===false){
   risks.push({kind:'resource_status_unknown',resource:key});continue;
  }
  const required=reserved+floor+Math.max(0,-row.net)*maintenanceMonths;
  if(row.stockpile<required)risks.push({kind:'resource_reserve_shortfall',resource:key,stockpile:row.stockpile,reserved,floor,maintenanceMonths,required});
 }
 return risks;
}
