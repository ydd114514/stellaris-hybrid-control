const gameDay=x=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(x??'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):null;};
export class NativeStrategyReview {
 constructor(){this.lastDay=null;this.lastSignals=null;}
 signals(state){
  const critical=Object.entries(state.resources??{}).filter(([key,r])=>['energy','minerals','food','consumer_goods','alloys'].includes(key)&&Number.isFinite(r?.stockpile)&&r?.net<0&&r.stockpile/-r.net<=12).map(([key])=>key).sort();
  return JSON.stringify({wars:(state.wars??[]).map(w=>w.war_id??w.id).sort(),events:(state.pendingEvents??[]).map(e=>e.window_id??e.title),diplomacy:(state.pendingDiplomacy??[]).map(p=>p.proposal??p.id),critical,user:state.operatorMessages??[],direction:state.operationalGoal?.text??''});
 }
 due(state){const current=gameDay(state.date),signals=this.signals(state),reasons=[];
  if(this.lastDay===null)reasons.push('initial_strategy');
  else if(current!==null&&current-this.lastDay>=180)reasons.push('six_month_review');
  if(this.lastSignals!==null&&signals!==this.lastSignals)reasons.push('strategic_event');
  return reasons;
 }
 acknowledge(state){this.lastDay=gameDay(state.date);this.lastSignals=this.signals(state);}
}
