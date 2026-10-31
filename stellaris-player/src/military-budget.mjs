// Peacetime expansion policy only; wartime still uses normal engine legality.
// Naval points come from current game data, never a fixed ship-size table.
export function militaryExpansionProblem(status,{inWar=false,alloySpend=0,navalIncrease=0}={}) {
  if(inWar)return null;
  const naval=status.stats?.naval_capacity,alloys=status.resources?.alloys;
  if(Number.isFinite(naval?.used)&&naval.capacity>0) {
    if(naval.used>=naval.capacity)return `和平时期海军已占用${naval.used}/${naval.capacity}点。海军容量是维护代价软限制；当前缺少超容量新增维护报价，尚不能核定这批扩军预算。先核实维护、库存支撑和战略收益，或发展容量/升级现役舰；不要用单独造船绕过缺失的维护评估。`;
    if(navalIncrease>0&&naval.used+navalIncrease>naval.capacity)return `这批军舰需新增${navalIncrease}点，当前海军${naval.used}/${naval.capacity}，超过维护代价软限制；当前缺少新增维护报价，尚不能核定扩军预算。可缩小批次，或核实维护、补充渠道和战略收益后再安排。`;
  }
  if(alloys?.net<0) {
    if(!Number.isFinite(alloySpend)||alloySpend<0||!Number.isFinite(alloys.stockpile)||alloys.stockpile<0||alloys.stockpile_known===false||alloys.net_known===false||!Number.isFinite(alloys.expense)||alloys.expense<0||alloys.expense_known===false)
      return '和平时期合金正在亏损，整批造价、库存或实际维护未知，先补齐当前费用信息再安排扩军。';
    const reserve=Math.max(alloys.expense,-alloys.net*3);
    if(alloys.stockpile-alloySpend<reserve)
      return '和平时期合金正在亏损，这批造价会占用真实维护储备；先安排补充渠道或缩小批次。';
  }
  return null;
}
