// Presentation only. No work orders, game pauses, model calls or blocking holds.
export class NativeDirector {
 constructor({now=Date.now}={}){this.now=now;this.counts={};this.next=0;this.lastTopic='';this.pending=new Map();this.shown=new Map();this.targets=new Map();this.cursor=0;this.lastGalaxyAt=null;this.galaxyRetryAt=0;}
 async tick({rpc,control,state,status,mode='auto',stopped=false,emit=async()=>{}}){
  const now=this.now();
  // Schedule five seconds early to allow the game-thread calls/readback to
  // finish within the user's two-minute limit, rather than starting at it.
  const galaxyDue=this.lastGalaxyAt===null||now-this.lastGalaxyAt>=115000;
  const attemptGalaxy=galaxyDue&&now>=this.galaxyRetryAt;
  if(stopped||mode!=='auto'||control.owner!=='native'||control.paused!==false||now<this.next&&!attemptGalaxy)return;
  this.next=now+3000;
  // Never close a central choice or war-goal window to show routine work.
  const events=await rpc('get_active_events'),wars=await rpc('get_wars');
  if(!Array.isArray(events)||events.length||wars.warGoalsWindow){this.galaxyRetryAt=now+3000;return;}
  if(attemptGalaxy){
   this.galaxyRetryAt=now+10000;
   try{
    const shown=await rpc('show_galaxy_map');
    if(shown.success===true&&shown.full_galaxy===true){
     const readback=await rpc('get_camera_state');
     if(readback.success===true&&readback.full_galaxy===true){
      this.lastGalaxyAt=this.now();this.next=this.lastGalaxyAt+15000;this.lastTopic='galaxy';
      await emit({type:'director_scene',topic:'galaxy',text:'拉开完整银河星图，看看帝国在星海中的位置。',date:state.date,fullGalaxy:true,camera:readback});return;
     }
    }
   }catch{} // A failed attempt does not reset the two-minute deadline.
  }
  const counts=control.commandCounts??{},changed=[];
  for(const [name,row] of Object.entries(counts)){
   const n=Number(row.admitted)||0;if(n>(this.counts[name]??0))changed.push(name);this.counts[name]=n;
  }
  const rules=[['research',/research_technology/,'科研有了新安排，看看帝国目前研究的方向。'],
   ['planet',/add_buildable|colonize_planet/,'看看殖民地当前的发展。'],
   ['stations',/orbital_station/,'资源站建设正在推进，看看建造船的位置。'],
   ['exploration',/survey|research_anomaly/,'看看科研船当前的探索进展。'],
   ['market',/market_/,'原生AI正在调整资源交易，看看市场和财政。'],
   ['traditions',/tradition/,'帝国的传统有了进展，看看当前发展路线。'],
   ['government',/council_agenda/,'内阁议程有了新安排，看看目前的治理方向。'],
   ['leaders',/leader/,'领袖安排有了变化，看看当前的人才配置。']];
  // Retain every changed category, instead of consuming lower-priority changes
  // whenever research or exploration wins an if/else chain.
  for(const [key,pattern,text] of rules)if(changed.some(x=>pattern.test(x)))this.pending.set(key,{text,at:now});
  if(wars.wars?.length)this.pending.set('battle',{text:'战时看看主力舰队目前的位置。',at:now});
  for(const [key,event] of this.pending)if(now-event.at>120000)this.pending.delete(key);
  const eligible=key=>key!==this.lastTopic&&now-(this.shown.get(key)??-Infinity)>=(['exploration','stations'].includes(key)?90000:45000);
  let topic=[...(wars.wars?.length?['battle']:[]),...this.pending.keys()].find(eligible);
  let caption=topic?this.pending.get(topic)?.text:undefined;
  if(!topic){
   const overview=['research','planet','fleets','government','market','traditions'];
   for(let i=0;i<overview.length;i++){
    const key=overview[this.cursor++%overview.length];if(eligible(key)){topic=key;break;}
   }
   if(!topic)return;
   caption='看看帝国当前的'+({research:'科研方向',planet:'殖民地发展',fleets:'舰队配置',government:'内阁议程',market:'资源市场',traditions:'传统路线'}[topic])+'。';
  }
  const leastRecent=(items,key)=>items.filter(x=>Number.isInteger(x[key])).sort((a,b)=>(this.targets.get(key+':'+a[key])??-Infinity)-(this.targets.get(key+':'+b[key])??-Infinity));
  // Queue statistics identify a category, not an exact target. Fetch real targets
  // and describe the selected view without inventing a specific completed order.
  try{
   let target;
   if(topic==='planet'){
    const planets=(status.outliner?.sectors_summary?.sectors??[]).flatMap(s=>s.colonies_summary??[]);
    target=leastRecent(planets,'planet_id')[0];
    if(!target)return;
    const detail=await rpc('get_planet_details',{planet_id:target.planet_id});
    const queue=(detail.construction_queue??[]).slice(0,2).map(x=>x.item_name).filter(x=>typeof x==='string');
    caption=target.name+(queue.length?'当前建设队列：'+queue.join('、')+'。':'当前没有施工队列，看看现有发展。');
   }
   let fleet;
   if(['battle','exploration','stations'].includes(topic)){
    const raw=await rpc(topic==='battle'?'get_military_fleets':'get_civilian_fleets');
    const candidates=leastRecent(topic==='battle'?raw.fleets??[]:topic==='stations'?raw.construction_ships??[]:raw.science_ships??[],'fleet_id');
    fleet=candidates.find(f=>now-(this.targets.get('fleet_id:'+f.fleet_id)??-Infinity)>=180000);
    if(!fleet){
     this.pending.delete(topic);this.shown.set(topic,now);
     topic=this.lastTopic==='fleets'?'research':'fleets';
     caption=topic==='fleets'?'看看帝国当前的舰队配置。':'看看帝国当前的科研方向。';
    }
   }
   const close=await rpc('show_panel',{panel:'game'});if(close.success!==true)return;
   if(target){const r=await rpc('focus_planet',{planet_id:target.planet_id});if(!r.success)return;}
   else if(fleet){const r=await rpc('focus_fleet',{fleet_id:fleet.fleet_id});if(!r.success)return;}
   else {const r=await rpc('show_panel',{panel:topic});if(!r.success)return;}
   this.pending.delete(topic);this.shown.set(topic,now);
   if(target)this.targets.set('planet_id:'+target.planet_id,now);
   if(fleet)this.targets.set('fleet_id:'+fleet.fleet_id,now);
   this.lastTopic=topic;this.next=now+(topic==='battle'?30000:18000);
   await emit({type:'director_scene',topic,text:caption,date:state.date,...(fleet?{fleetId:fleet.fleet_id}:{}),...(target?{planetId:target.planet_id}:{})});
  }catch{/* A failed presentation never interrupts AI or its heartbeat. */}
 }
}
