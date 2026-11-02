// Requirements checked against local Stellaris 4.5
// common/council_agendas/00_council_agendas_ethics.txt. The native command's
// IsValid alone does not enforce the script's allow trigger; invalid agendas
// can appear selected briefly and be removed on the next monthly update.
const requiredEthic={agenda_we_come_in_peace:'pacifist',agenda_display_of_power:'militarist',
  agenda_open_arms:'xenophile',agenda_strong_on_our_own:'xenophobe',agenda_give_and_take:'egalitarian',
  agenda_preserve_the_order:'authoritarian',agenda_a_higher_purpose:'spiritualist',agenda_progressive_growth:'materialist'};
export function councilAgendaProblem(key,government) {
  if(!government.available_agendas?.some(x=>x.key===key))return '当前原生候选中没有这项议程，请重新查看内阁';
  // Local 4.5.2 00_council_agendas.txt: these two base agendas have
  // allow={always=yes}; their only potential is the empire's gestalt status.
  if(['agenda_infinite_opportunities','agenda_infinite_opportunities_gestalt'].includes(key)){
    const ethics=government.ethics?.map(x=>x.key);
    const known=Array.isArray(ethics)&&ethics.length>0||typeof government.authority==='string'&&government.authority.startsWith('auth_');
    if(!known)return '当前帝国的格式塔身份未知，不能选择基础议程';
    const gestalt=ethics?.includes('ethic_gestalt_consciousness')||['auth_hive_mind','auth_machine_intelligence'].includes(government.authority);
    return gestalt===key.endsWith('_gestalt')?null:'这项基础议程与当前帝国的格式塔身份不符';
  }
  const needed=requiredEthic[key];
  if(!needed)return '这项议程的脚本前提尚未核验，暂不选择；请使用已核验的基础或思潮议程';
  const ethics=(government.ethics||[]).map(x=>x.key?.replace(/^ethic_(?:fanatic_)?/,''));
  return ethics.includes(needed)?null:`这项议程需要 ${needed} 思潮，当前帝国不符合条件；不能重复选择会在月度检查中被取消的议程`;
}
export function councilAgendaCandidates(government) {
  return (government.available_agendas||[]).filter(x=>!councilAgendaProblem(x.key,government));
}
