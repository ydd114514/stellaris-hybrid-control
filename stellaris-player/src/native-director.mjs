// Presentation only. No work orders, game pauses, model calls or blocking holds.
export class NativeDirector {
 constructor({now=Date.now}={}){this.now=now;this.counts={};this.next=0;this.idle=0;this.lastTopic='';}
 async tick({rpc,control,state,status,mode='auto',stopped=false,emit=async()=>{}}){
  const now=this.now();
  if(stopped||mode!=='auto'||control.owner!=='native'||control.paused!==false||now<this.next)return;
  this.next=now+3000;
  // Never close a central choice or war-goal window to show routine work.
  const events=await rpc('get_active_events'),wars=await rpc('get_wars');
  if(!Array.isArray(events)||events.length||wars.warGoalsWindow)return;
  const counts=control.commandCounts??{},changed=[];
  for(const [name,row] of Object.entries(counts)){
   const n=Number(row.admitted)||0;if(n>(this.counts[name]??0))changed.push(name);this.counts[name]=n;
  }
  let topic,caption;
  if(wars.wars?.length){topic='battle';caption='看看主力舰队现在的位置和战况。';}
  else if(changed.some(x=>/research_technology/.test(x))){topic='research';caption='科研有了新安排，看看帝国目前研究的方向。';}
  else if(changed.some(x=>/add_buildable/.test(x))){topic='planet';caption='帝国新增了建设安排，看看殖民地的发展。';}
  else if(changed.some(x=>/survey|orbital_station/.test(x))){topic='exploration';caption='探索和资源站建设正在推进，看看外面的进展。';}
  else if(changed.some(x=>/market_/.test(x))){topic='market';caption='原生AI正在调整资源交易，看看市场和财政。';}
  else if(changed.some(x=>/tradition/.test(x))){topic='traditions';caption='帝国的传统有了进展，看看当前发展路线。';}
  else if(changed.some(x=>/council_agenda/.test(x))){topic='government';caption='内阁议程有了新安排，看看目前的治理方向。';}
  else if(changed.some(x=>/leader/.test(x))){topic='leaders';caption='领袖安排有了变化，看看当前的人才配置。';}
  else if(now>=this.idle){topic=['exploration','research','planet','fleets'][Math.floor(now/30000)%4];caption='看看帝国当前的'+({exploration:'探索进展',research:'科研方向',planet:'殖民地发展',fleets:'舰队配置'}[topic])+'。';}
  if(!topic)return;
  if(topic===this.lastTopic&&now<this.idle)return;
  // Queue statistics identify a category, not an exact target. Fetch real targets
  // and describe the selected view without inventing a specific completed order.
  try{
   let target;
   if(topic==='planet'){
    const planets=(status.outliner?.sectors_summary?.sectors??[]).flatMap(s=>s.colonies_summary??[]);
    target=planets.find(p=>p.has_construction)||planets[0];
    if(!target)return;
    const detail=await rpc('get_planet_details',{planet_id:target.planet_id});
    const queue=(detail.construction_queue??[]).slice(0,2).map(x=>x.item_name).filter(x=>typeof x==='string');
    caption=target.name+(queue.length?'当前建设队列：'+queue.join('、')+'。':'当前没有施工队列，看看现有发展。');
   }
   let fleet;
   if(['battle','exploration'].includes(topic)){
    const raw=await rpc(topic==='battle'?'get_military_fleets':'get_civilian_fleets');
    fleet=topic==='battle'?raw.fleets?.[0]:(raw.science_ships?.find(f=>f.status!=='无指令')||raw.construction_ships?.[0]||raw.science_ships?.[0]);
    if(!Number.isInteger(fleet?.fleet_id))return;
   }
   const close=await rpc('show_panel',{panel:'game'});if(close.success!==true)return;
   if(target){const r=await rpc('focus_planet',{planet_id:target.planet_id});if(!r.success)return;}
   else if(fleet){const r=await rpc('focus_fleet',{fleet_id:fleet.fleet_id});if(!r.success)return;}
   else {const r=await rpc('show_panel',{panel:topic});if(!r.success)return;}
   this.lastTopic=topic;this.next=now+(topic==='battle'?30000:18000);this.idle=now+45000;
   await emit({type:'director_scene',topic,text:caption,date:state.date});
  }catch{/* A failed presentation never interrupts AI or its heartbeat. */}
 }
}
