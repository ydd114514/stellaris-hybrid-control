export function confirmedCountryAIHandoff(control){
 return control?.confirmed===true&&control.owner==='human'&&control.ordinaryOrdersBlocked===false&&
  control.paused===true&&control.actualFlags?.human_ai===false&&control.actualFlags?.force_human_ai===false&&
  ['idle','stopped'].includes(control.nativePhase);
}
