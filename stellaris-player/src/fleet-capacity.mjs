export function fleetCapacity(fleet,tactics) {
  const actual=tactics?.actual_naval_size,limit=tactics?.command_limit??fleet?.command_limit;
  if(!Number.isFinite(actual)||!Number.isFinite(limit)||limit<=0)return {known:false};
  let missing=0,represented=0;
  for(const design of fleet.designs||[]){if(!(design.naval_size>0)){if(design.target_quota>design.actual_count)return {known:false};continue;}represented+=(design.actual_count||0)*design.naval_size;missing+=Math.max(0,(design.target_quota||0)-(design.actual_count||0))*design.naval_size;}
  return {known:true,actual_naval_size:actual,command_limit:limit,untemplated_naval_size:Math.max(0,actual-represented),
    reinforcement_naval_size:missing,projected_naval_size:actual+missing,fits_reinforcements:actual+missing<=limit+1e-6};
}

/** Conservative cost of the current missing template, from legal yard quotes.
 * Unknown designs/costs remain unknown; a stockpile alone is not a quote. */
export function reinforcementAlloyCost(fleet,yards){
 let total=0;
 if(!Array.isArray(fleet?.designs)||!yards.length)return null;
 for(const design of fleet.designs){
  if(!Number.isSafeInteger(design.target_quota)||!Number.isSafeInteger(design.actual_count))return null;
  const missing=Math.max(0,design.target_quota-design.actual_count);if(!missing)continue;
  const costs=yards.flatMap(y=>y.buildable||[]).filter(d=>d.design_id===design.design_id).map(d=>d.cost?.alloys);
  if(!costs.length||costs.some(c=>!Number.isFinite(c)||c<0))return null;
  total+=Math.max(...costs)*missing;
 }
 return total;
}
