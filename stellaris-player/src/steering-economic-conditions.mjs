// Planet-scope syntax present in installed 4.5.2: buildings/07_amenity_buildings,
// 01_pop_assembly_buildings and scripted_triggers/01_scripted_triggers_jobs.
// These gate extra preferences, never the vanilla candidate or its real output.
export const productiveSupplyResources=['energy','minerals','food','consumer_goods','alloys'];
export function sustainableSupplyConditions(){
 return productiveSupplyResources.map(resource=>`NOT = { has_deficit = ${resource} } NOT = { resource_income_compare = { resource = ${resource} value < 0 } }`).join('\n');
}
// Installed 4.5.2 hive node adds 200 workforce. Maintenance drones explicitly
// count_as_available_for_ai, so occupied maintenance work is not unavailable
// labor. Keep another full batch staffed and a two-batch amenity margin using
// the largest unmodified conditional maintenance output (1100 per 100 labor).
// This opens a candidate only; it never moves workers or changes their output.
export const hiveMaintenanceRedeployment={workforce:200,retainedWorkforce:200,maxBaseAmenitiesPer100:1100,amenityBatches:2};
export function productiveCapacityConditions(jobs,{allowHiveMaintenance=false}={}){
 if(!Array.isArray(jobs)||!jobs.length||jobs.some(job=>!/^\w+$/.test(job)))throw Error('新增生产偏好缺少已核对的岗位类型');
 const redeploy=allowHiveMaintenance&&jobs.includes('coordinator')?`
 AND = {
  owner = { is_hive_empire = yes }
  num_assigned_jobs = { job = maintenance_drone value > ${hiveMaintenanceRedeployment.workforce+hiveMaintenanceRedeployment.retainedWorkforce} }
  free_amenities > ${hiveMaintenanceRedeployment.workforce/100*hiveMaintenanceRedeployment.maxBaseAmenitiesPer100*hiveMaintenanceRedeployment.amenityBatches}
 }`:'';
 return `free_housing >= 0
free_amenities >= 0
# Idle workforce and explicitly AI-available surplus maintenance both count.
# Virtual jobs are filled automatically; the installed zone job scripts use this tradition.
OR = { num_unemployed > 0 owner = { has_active_tradition = tr_virtuality_4 }${redeploy} }
${[...new Set(jobs)].map(job=>`NOT = { has_available_jobs = ${job} }
NOT = { has_forbidden_jobs = ${job} }`).join('\n')}`;
}
