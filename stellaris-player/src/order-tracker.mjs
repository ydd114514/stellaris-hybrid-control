// Read-back ledger only. This module never submits or replays a game command.
import {createHash} from 'node:crypto';
import {captureUpgradeBaseline,captureUpgradeQueueWitness,verifyBuildingUpgrade} from './building-upgrades.mjs';

export const TRACKED_ASYNC_COMMANDS=Object.freeze(['recruit_planet_army','embark_all_armies','declare_war','land_armies','offer_peace','colonize','build_district','build_building','upgrade_building','clear_blocker','set_district_zone','build_ship','reinforce_fleet','move_fleet','survey','build_outpost','build_stations','upgrade_fleet','follow_fleet','diplomacy','respond_diplomacy','select_research']);
const tracked=new Set(TRACKED_ASYNC_COMMANDS),terminal=new Set(['completed','failed','expired_unknown']);
const statuses=new Set(['submitted','queued','executing',...terminal]);
const readMethods=new Set(['get_armies','get_planet_armies','get_wars','get_invasion_state','get_planet_details','get_colony_automation','get_buildable_buildings','get_available_district_zones','get_system','get_fleets','get_fleet_tactics','get_buildable_ships','get_contacts','get_pending_diplomacy']);
const text=(x,n=120)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n):'';
const id=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const finite=Number.isFinite;
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const clone=x=>JSON.parse(JSON.stringify(x));
const day=x=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(x||'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):null;};
const keyOf=x=>String(x?.key??x?.building_key??'');
const allBuildings=p=>(p?.districts||[]).flatMap(d=>(d.zones||[]).flatMap(z=>Array.isArray(z.buildings)?z.buildings:[]));
const ownPlanets=s=>(s?.colonies||[]).flatMap(x=>x.colonies_summary||[]);
const allFleets=r=>Array.isArray(r?.fleets)?r.fleets:[];
const countDesign=(r,design)=>allFleets(r).flatMap(f=>f.designs||[]).reduce((n,x)=>n+(x.design_id===design&&finite(x.actual_count)?x.actual_count:0),0);
const fleetFor=(r,fleetId)=>allFleets(r).find(f=>f.fleet_id===fleetId);
const queueMatch=(row,r)=>{
  const a=row.arguments,command=row.command;
  if(id(row.queueItemId)&&id(r.item_id))return r.item_id===row.queueItemId;
  if(command==='build_ship')return r.design_id===a.design_id||String(r.key)===String(a.design_id);
  if(command==='clear_blocker')return r.deposit_id===a.deposit_id;
  if(command==='upgrade_building')return r.building_id===a.building_id&&[a.upgrade_key].includes(r.upgrade_to_key||r.key);
  const target=a.district_key||a.building_key||a.zone_key;
  return !!target&&r.key===target;
};
const cleanArgs=(args={})=>Object.fromEntries(Object.entries(args).filter(([k,v])=>/^[a-z_]{1,40}$/.test(k)&&(typeof v==='boolean'||finite(v)||typeof v==='string')).slice(0,12).map(([k,v])=>[k,typeof v==='string'?text(v,100):v]));
const cleanBaseline=b=>({
  upgradeBaseline:b?.upgradeBaseline&&Array.isArray(b.upgradeBaseline.members)&&b.upgradeBaseline.members.length<=256?clone(b.upgradeBaseline):undefined,
  armyIds:(b?.armyIds||[]).filter(id).slice(0,256),embarkIds:(b?.embarkIds||[]).filter(id).slice(0,256),
  warIds:(b?.warIds||[]).filter(id).slice(0,128),warPresent:b?.warPresent===true,
  countryId:id(b?.countryId)?b.countryId:undefined,districtCount:finite(b?.districtCount)?b.districtCount:undefined,
  buildingCount:finite(b?.buildingCount)?b.buildingCount:undefined,buildingKnown:b?.buildingKnown===true,
  oldBuildingKey:text(b?.oldBuildingKey,100)||undefined,blockerPresent:typeof b?.blockerPresent==='boolean'?b.blockerPresent:undefined,
  stationIds:(b?.stationIds||[]).filter(id).slice(0,128),stationIdsKnown:b?.stationIdsKnown===true,
  designCount:finite(b?.designCount)?b.designCount:undefined,civilianClass:text(b?.civilianClass,30)||undefined,
  civilianCount:finite(b?.civilianCount)?b.civilianCount:undefined,
  fleetTargets:(b?.fleetTargets||[]).filter(x=>id(x.designId)&&finite(x.count)).slice(0,32).map(x=>({designId:x.designId,count:x.count})),
  treaties:Object.fromEntries(Object.entries(b?.treaties||{}).filter(([k,v])=>['commercial_pact','research_agreement','non_aggression_pact'].includes(k)&&typeof v==='boolean')),
  queueItemIds:(b?.queueItemIds||[]).filter(id).slice(0,128)
});
const civilKey=size=>({constructor:'construction_ships',science:'science_ships',colonizer:'colony_ships',colony:'colony_ships'})[size];

/** Produce only the baseline needed by this order, without storing raw replies. */
export function makeOrderBaseline(order,{state,planet,nativeColony,buildingCandidates,system,fleets,shipyard,contacts,armies}={}) {
  const a=order.arguments||{},c=order.command,building=allBuildings(planet).find(x=>x.id===a.building_id);
  const fleet=fleetFor(fleets,a.fleet_id),type=a.station_type==='research'?'research_station':'mining_station';
  const detailZones=(planet?.districts||[]).flatMap(d=>d.zones||[]);
  const buildingsComplete=Array.isArray(buildingCandidates?.zones)&&buildingCandidates.zones.length>0&&buildingCandidates.zones.every(z=>{
    const detail=detailZones.find(x=>(x.slot_index??x.zone_id)===z.zone_id);
    return finite(z.buildings)&&Array.isArray(detail?.buildings)&&detail.buildings.length===z.buildings;
  });
  const ship=shipyard?.buildable?.find(x=>x.design_id===a.design_id),ck=civilKey(ship?.ship_size);
  return cleanBaseline({countryId:state?.player?.country_id,
    upgradeBaseline:c==='upgrade_building'?captureUpgradeBaseline(planet,a,nativeColony):undefined,
    armyIds:[...(armies?.garrison_armies||[]),...(armies?.transport_armies||[])].map(a=>a.army_id),
    embarkIds:(armies?.garrison_armies||[]).filter(r=>r.planet_id===a.planet_id&&r.is_defense===false).map(r=>r.army_id),
    warIds:(state?.wars||[]).map(w=>w.war_id),warPresent:Array.isArray(state?.wars)&&state.wars.some(w=>w.war_id===a.war_id),
    districtCount:planet?.districts?.find(x=>x.type===a.district_key)?.built,
    buildingKnown:buildingsComplete,buildingCount:buildingsComplete?allBuildings(planet).filter(x=>keyOf(x)===a.building_key).length:undefined,
    oldBuildingKey:keyOf(building),blockerPresent:Array.isArray(planet?.blockers)?planet.blockers.some(x=>(x.id??x.deposit_id)===a.deposit_id):undefined,
    stationIdsKnown:Array.isArray(system?.fleets),stationIds:(system?.fleets||[]).filter(f=>f.own===true&&String(f.ship_class).includes(type)).map(f=>f.id),
    designCount:Array.isArray(fleets?.fleets)?countDesign(fleets,a.design_id):undefined,
    civilianClass:ck,civilianCount:ck&&Array.isArray(state?.civilian?.[ck])?state.civilian[ck].length:undefined,
    fleetTargets:(fleet?.designs||[]).filter(d=>finite(d.target_quota)&&d.target_quota>0).map(d=>({designId:d.design_id,count:d.target_quota})),
    treaties:contacts?.empires?.find(x=>x.country_id===a.country_id)?.treaties,
    queueItemIds:(shipyard?.queue||planet?.construction_queue||[]).map(x=>x.item_id)
  });
}

async function read(rpc,method,params) {
  if(!readMethods.has(method))throw new Error('订单追踪只允许已声明的只读查询');
  const result=await rpc(method,params);
  return result?.success===false?null:result;
}

/** At most two reads before submission; callers may reuse their existing reads via makeOrderBaseline. */
export async function captureBaseline(order,rpc,state,{maxQueries=2}={}) {
  const a=order.arguments||{},data={state};let remaining=Math.min(2,Math.max(0,Math.floor(maxQueries)));
  const get=async(name,method,params)=>{if(!remaining)return;remaining--;try{data[name]=await read(rpc,method,params);}catch{/* Missing baseline means unknown, never zero. */}};
  if(['recruit_planet_army','embark_all_armies'].includes(order.command))await get('armies','get_armies',{});
  else if(['build_district','build_building','upgrade_building','clear_blocker','set_district_zone'].includes(order.command)) {
    await get('planet','get_planet_details',{planet_id:a.planet_id});
    if(order.command==='build_building')await get('buildingCandidates','get_buildable_buildings',{planet_id:a.planet_id});
    if(order.command==='upgrade_building')await get('nativeColony','get_colony_automation',{planet_id:a.planet_id});
  } else if(['build_stations','build_outpost','survey','move_fleet'].includes(order.command))await get('system','get_system',{system_id:a.system_id});
  else if(order.command==='reinforce_fleet')await get('fleets','get_fleets',{fleet_id:a.fleet_id});
  else if(order.command==='build_ship') {await get('shipyard','get_buildable_ships',{system_id:a.system_id});await get('fleets','get_fleets',{});}
  else if(order.command==='diplomacy')await get('contacts','get_contacts',{mode:'empires'});
  return makeOrderBaseline(order,data);
}

function queryPlans(row) {
  const a=row.arguments;
  if(['recruit_planet_army','embark_all_armies'].includes(row.command))return [{method:'get_armies',params:{}}];
  if(row.command==='declare_war'||row.command==='offer_peace')return [{method:'get_wars',params:{}}];
  if(row.command==='land_armies')return [{method:'get_invasion_state',params:{planet_id:a.planet_id}}];
  if(row.command==='upgrade_building'&&row.baseline.upgradeBaseline)return [{method:'get_planet_details',params:{planet_id:a.planet_id}},{method:'get_colony_automation',params:{planet_id:a.planet_id}}];
  if(['build_district','build_building','upgrade_building','clear_blocker'].includes(row.command))return [{method:'get_planet_details',params:{planet_id:a.planet_id}}];
  if(row.command==='set_district_zone')return [{method:'get_available_district_zones',params:{planet_id:a.planet_id,district_type:'district_city'}}];
  if(['move_fleet','survey','build_outpost','build_stations'].includes(row.command))return [{method:'get_system',params:{system_id:a.system_id}}];
  if(row.command==='reinforce_fleet')return [{method:'get_fleets',params:{fleet_id:a.fleet_id}}];
  if(row.command==='build_ship')return [{method:'get_buildable_ships',params:{system_id:a.system_id}},{method:'get_fleets',params:{}}];
  if(row.command==='upgrade_fleet'||row.command==='follow_fleet')return [{method:'get_fleet_tactics',params:{details:true}}];
  if(row.command==='diplomacy')return [{method:'get_contacts',params:{mode:'empires'}}];
  if(row.command==='respond_diplomacy')return [{method:'get_pending_diplomacy',params:{}}];
  return [];
}

export class OrderTracker {
  constructor({sessionId,binding={},now=Date.now,maxEntries=80,maxPolls=18,ttlMs=1800000,pollIntervalMs=2500,maxPollIntervalMs=60000,globalIntervalMs=5000}={}) {
    if(typeof sessionId!=='string'||!sessionId)throw new Error('订单追踪需要本局会话标识');
    Object.assign(this,{sessionId,binding:stable(binding),now,maxEntries:Math.max(1,Math.min(100,maxEntries)),maxPolls:Math.max(1,Math.min(30,maxPolls)),ttlMs,pollIntervalMs,maxPollIntervalMs,globalIntervalMs});
    this.records=new Map();this.events=[];this.nextReadAt=0;this.lastGameDate=undefined;
  }
  transition(row,status,reason,proof={}) {
    if(terminal.has(row.status)||!statuses.has(status))return;
    const changed=row.status!==status||row.reason!==reason;
    row.status=status;row.reason=text(reason,180);row.lastEvidenceAt=this.now();row.proof={kind:text(proof.kind,60),...Object.fromEntries(Object.entries(proof).filter(([k,v])=>k!=='kind'&&(/Id$|Count$|^key$|^field$/.test(k))&&(finite(v)||typeof v==='string')).slice(0,4))};
    if(changed){row.updatedAt=this.now();this.events.push({type:'order_lifecycle',sessionId:this.sessionId,trackingId:row.id,requestId:row.requestId,command:row.command,status,reason:row.reason,proof:row.proof});if(this.events.length>160)this.events.shift();}
  }
  expire() {
    for(const row of this.records.values())if(!terminal.has(row.status)&&(this.now()>=row.expiresAt||row.polls>=this.maxPolls))this.transition(row,'expired_unknown','读取期限或次数已到；结果仍未知，禁止自动重放',{kind:'read_budget_exhausted'});
  }
  register({requestId,order,response={},verification={},beforeState,baseline={}}={}) {
    if(this.closed)return null;
    if(!tracked.has(order?.command))return null;
    const args=cleanArgs(order.arguments),idValue=createHash('sha256').update(stable([requestId,order.command,args])).digest('hex').slice(0,24);
    if(this.records.has(idValue))return clone(this.records.get(idValue));
    const b=cleanBaseline({...makeOrderBaseline(order,{state:beforeState}),...baseline}),now=this.now();
    // Shared count effects are reserved in submission order so one new unit
    // cannot simultaneously satisfy two outstanding build requests.
    const reserve=(base,field,match,amount)=>finite(base)?Math.max(base,...[...this.records.values()].filter(x=>!terminal.has(x.status)&&match(x)&&finite(x[field])).map(x=>x[field]))+amount:undefined;
    const countMatch=x=>x.command===order.command&&(order.command==='build_ship'?x.arguments.design_id===args.design_id:x.arguments.planet_id===args.planet_id&&(order.command==='build_district'?x.arguments.district_key===args.district_key:x.arguments.building_key===args.building_key));
    const countBaseline=order.command==='build_district'?b.districtCount:order.command==='build_building'&&b.buildingKnown?b.buildingCount:order.command==='build_ship'?b.designCount:undefined;
    const row={id:idValue,sessionId:this.sessionId,requestId:text(requestId,80),command:order.command,arguments:args,baseline:b,status:'submitted',submissionConfirmed:response.success===true,submittedAt:now,updatedAt:now,expiresAt:now+this.ttlMs,nextPollAt:now+this.pollIntervalMs,polls:0,readIndex:0,gameDate:beforeState?.date,
      upgradeWitness:verification.upgradeQueueWitness?.exclusive===true?clone(verification.upgradeQueueWitness):undefined,
      queueItemId:id(response.queue_item_id)?response.queue_item_id:id(verification.entry?.item_id)?verification.entry.item_id:undefined,
      expectedCount:reserve(countBaseline,'expectedCount',countMatch,order.command==='build_ship'?(args.count||1):1),
      expectedCivilianCount:order.command==='build_ship'?reserve(b.civilianCount,'expectedCivilianCount',x=>x.command==='build_ship'&&x.baseline.civilianClass===b.civilianClass,args.count||1):undefined,
      reason:response.success===true?'已收到接受回执；等待真实状态确认':'未获得明确接受回执，是否提交未知；仅回读、不重放'};
    this.records.set(row.id,row);
    if(response.success===false)this.transition(row,'failed','引擎明确拒绝本次操作',{kind:'engine_rejected'});
    else if(verification.verified&&['construction_queue','shipyard_queue','zone_pending'].includes(verification.phase))this.transition(row,'queued','已看到施工或造船队列，不等于完工',{kind:'queue_observed',itemId:row.queueItemId});
    else if(verification.verified&&verification.phase==='fleet_order')this.transition(row,'executing','已看到目标舰队任务，不等于任务完成',{kind:'fleet_order_observed'});
    else if(verification.phase==='proposal_pending_acceptance')this.transition(row,'queued','提议等待对方回应，未确认达成协议',{kind:'proposal_pending'});
    if(beforeState)this.updateState(beforeState);
    while(this.records.size>this.maxEntries) {
      const oldest=[...this.records.values()].find(x=>terminal.has(x.status))||this.records.values().next().value;
      if(!terminal.has(oldest.status))this.transition(oldest,'expired_unknown','追踪容量已满；保留未知，禁止自动重放',{kind:'ledger_capacity'});
      this.records.delete(oldest.id);
    }
    return clone(row);
  }
  updateState(state) {
    if(!state)return;
    const currentDay=day(state.date),lastDay=day(this.lastGameDate);
    if(currentDay!==null&&lastDay!==null&&currentDay<lastDay){for(const row of this.records.values())if(!terminal.has(row.status))this.transition(row,'expired_unknown','游戏日期回退，旧订单结果未知；需重新绑定',{kind:'game_date_rollback'});return;}
    if(currentDay!==null)this.lastGameDate=state.date;
    for(const row of this.records.values()) {
      if(terminal.has(row.status))continue;
      const a=row.arguments;
      if(id(row.baseline.countryId)&&id(state.player?.country_id)&&row.baseline.countryId!==state.player.country_id){this.transition(row,'expired_unknown','玩家帝国身份改变，旧订单结果未知；需重新绑定',{kind:'player_changed'});continue;}
      if(row.command==='colonize') {
        const colony=ownPlanets(state).find(p=>p.planet_id===a.planet_id);
        if(colony?.is_colonizing===true)this.transition(row,'executing','己方目标星球正在殖民',{kind:'colonizing',planetId:a.planet_id});
        else if(colony&&(colony.status==='established'||colony.is_colonizing===false&&finite(colony.pops)&&colony.pops>0))this.transition(row,'completed','己方目标殖民地已建立',{kind:'colony_established',planetId:a.planet_id});
      }
      if(row.command==='select_research') {
        const current=state.research?.[a.slot]?.current;
        if(current?.key===a.tech_key&&current.is_researching===true)this.transition(row,'completed','已确认选题并开始研究；不代表该科技研发完成',{kind:'research_selection',key:a.tech_key});
      }
      if(row.command==='build_ship'&&row.baseline.civilianClass&&finite(row.expectedCivilianCount)) {
        const fleets=state.civilian?.[row.baseline.civilianClass];
        if(Array.isArray(fleets)&&fleets.length>=row.expectedCivilianCount)this.transition(row,'completed','已观察到预期数量的新同类民船；完成状态以实际舰船为据',{kind:'civilian_count_increased',observedCount:fleets.length});
      }
    }
    this.expire();
  }
  applyRead(row,method,result) {
    if(!result||terminal.has(row.status))return;
    const a=row.arguments,b=row.baseline;
    if(method==='get_armies'&&Array.isArray(result.transport_armies)&&Array.isArray(result.garrison_armies)){
      if(row.command==='embark_all_armies'&&b.embarkIds.length&&b.embarkIds.every(id=>result.transport_armies.some(a=>a.army_id===id)))this.transition(row,'completed','原驻军完整实体已在运输军中回读',{kind:'armies_embarked'});
      if(row.command==='recruit_planet_army'&&result.garrison_armies.some(r=>!b.armyIds.includes(r.army_id)&&r.type_key===a.army_key&&r.planet_id===a.planet_id))this.transition(row,'completed','目标星球实际新增了目标类型陆军，不是仅进入招募队列',{kind:'army_recruited'});
    }
    if(method==='get_wars'&&Array.isArray(result.wars)){
      if(row.command==='declare_war'){
        const war=result.wars.find(w=>!b.warIds.includes(w.war_id)&&w.player_side==='attacker'&&w.primary_defender_id===a.country_id&&w.attacker_goal?.key===a.goal_key);
        if(war)this.transition(row,'completed','新战争与目标、战争目标匹配，确认宣战',{kind:'war_created',warId:war.war_id});
      }
      if(row.command==='offer_peace'&&b.warPresent&&!result.wars.some(w=>w.war_id===a.war_id))this.transition(row,'completed','此前存在的战争已结束；不据此虚报战果',{kind:'war_ended',warId:a.war_id});
    }
    if(method==='get_invasion_state'&&row.command==='land_armies'&&result.success===true&&result.planet_id===a.planet_id){
      if(result.occupied_by_player===true||result.owned_by_player===true)this.transition(row,'completed','目标真实控制权已属己方',{kind:'occupation_observed',planetId:a.planet_id});
      else if(result.ground_combat===true)this.transition(row,'executing','地面战正在进行，不等于已占领',{kind:'ground_combat',planetId:a.planet_id});
    }
    if(['get_planet_details','get_available_district_zones'].includes(method)&&result.planet_id!==a.planet_id)return;
    if(method==='get_system'&&result.id!==a.system_id)return;
    if(row.command==='upgrade_building'&&b.upgradeBaseline){
      if(method==='get_planet_details'){
        const zones=(result.districts||[]).flatMap(d=>d.zones||[]);
        if(zones.length<=64&&zones.reduce((n,z)=>n+(z.buildings?.length||0),0)<=256&&Array.isArray(result.construction_queue)&&result.construction_queue.length<=128)row.upgradePlanet={planet_id:result.planet_id,colony_id:result.colony_id,construction_queue:result.construction_queue.map(q=>({item_id:q.item_id,type:q.type,building_id:q.building_id,key:q.key})),districts:[{zones:zones.map(z=>({zone_id:z.zone_id,slot_index:z.slot_index,buildings_known:z.buildings_known,buildings:(z.buildings||[]).map(x=>({id:x.id,key:x.key,status:x.status,slot_index:x.slot_index}))}))}]};
      }
      if(method==='get_colony_automation'&&result.planet_id===a.planet_id&&result.queue?.items?.length<=128)row.upgradeNative={known:result.known,enabled:result.enabled,planet_id:result.planet_id,colony_id:result.colony_id,owner_id:result.owner_id,queue:{known:result.queue.known,queue_id:result.queue.queue_id,items:result.queue.items.map(x=>({item_id:x.item_id}))}};
      if(row.upgradePlanet&&row.upgradeNative){
        row.upgradeWitness??=captureUpgradeQueueWitness(b.upgradeBaseline,a,row.upgradePlanet,row.upgradeNative);
        const proof=verifyBuildingUpgrade(row.upgradePlanet,a,{},{baseline:b.upgradeBaseline,queueWitness:row.upgradeWitness,native:row.upgradeNative});
        if(proof.completed){this.transition(row,'completed','原升级队列与原特区槽位的替换实例已确认；不是仅凭同名建筑',{kind:'building_upgraded',buildingId:proof.building.id,originalBuildingId:a.building_id,key:a.upgrade_key});return;}
      }
    }
    const queue=method==='get_planet_details'?result.construction_queue:method==='get_buildable_ships'?result.queue:undefined;
    const entry=Array.isArray(queue)?queue.find(x=>queueMatch(row,x)):undefined;
    if(entry) {
      if(id(entry.item_id))row.queueItemId=entry.item_id;
      if(entry.status==='failed'||entry.status==='cancelled'||entry.cancelled===true)this.transition(row,'failed','匹配的队列项明确失败或取消',{kind:'queue_failed',itemId:entry.item_id});
      else this.transition(row,Number(entry.progress_percent??entry.progress)>0?'executing':'queued','匹配的队列项仍存在，不等于竣工',{kind:'queue_observed',itemId:entry.item_id});
      return;
    }
    if(method==='get_planet_details') {
      if(row.command==='build_district') {
        const n=result.districts?.find(x=>x.type===a.district_key)?.built;
        if(finite(row.expectedCount)&&finite(n)&&n>=row.expectedCount)this.transition(row,'completed','真实已建区划数量达到目标，非仅队列消失',{kind:'district_count_increased',observedCount:n});
      } else if(row.command==='build_building') {
        const n=allBuildings(result).filter(x=>keyOf(x)===a.building_key&&x.status!=='queued'&&x.status!=='building').length;
        if(b.buildingKnown&&finite(row.expectedCount)&&n>=row.expectedCount)this.transition(row,'completed','真实建筑清单中的目标建筑数量达到目标',{kind:'building_count_increased',observedCount:n});
      } else if(row.command==='upgrade_building') {
        const building=allBuildings(result).find(x=>x.id===a.building_id);
        if(building&&keyOf(building)===a.upgrade_key&&building.status!=='queued'&&building.status!=='building')this.transition(row,'completed','同一建筑实体的实际key已变为目标升级key',{kind:'building_upgraded',buildingId:a.building_id,key:a.upgrade_key});
      } else if(row.command==='clear_blocker'&&b.blockerPresent===true&&Array.isArray(result.blockers)&&!result.blockers.some(x=>(x.id??x.deposit_id)===a.deposit_id))this.transition(row,'completed','此前确认存在的目标障碍已从真实障碍清单移除',{kind:'blocker_removed',depositId:a.deposit_id});
    }
    if(method==='get_available_district_zones') {
      const slot=result.districts?.find(x=>x.district_id===a.district_id)?.slots?.find(x=>x.slot===a.zone_slot);
      if(slot?.zone===a.zone_key)this.transition(row,'completed','目标区划槽的实际特区已建立',{kind:'zone_installed',key:a.zone_key});
    }
    if(method==='get_system') {
      if(row.command==='move_fleet'&&result.fleets?.some(x=>x.id===a.fleet_id&&x.own===true))this.transition(row,'completed','目标舰队实际位于目标星系；不是因无指令判定成功',{kind:'fleet_at_destination',fleetId:a.fleet_id,systemId:a.system_id});
      if(row.command==='survey'&&result.surveyed===true)this.transition(row,'completed','目标星系整体surveyed已为true',{kind:'system_surveyed',systemId:a.system_id});
      if(row.command==='build_outpost'&&id(b.countryId)&&result.owner_id===b.countryId&&result.starbase&&typeof result.starbase==='object')this.transition(row,'completed','目标星系已属己方且存在真实星基',{kind:'outpost_exists',systemId:a.system_id});
      if(row.command==='build_stations'&&b.stationIdsKnown) {
        const type=a.station_type==='research'?'research_station':'mining_station';
        const added=(result.fleets||[]).filter(x=>x.own===true&&String(x.ship_class).includes(type)&&!b.stationIds.includes(x.id));
        if(added.length)this.transition(row,'executing','已看到新增资源站；尚无证据证明整批建站任务全部完工',{kind:'station_effect_observed',observedCount:added.length});
      }
    }
    if(method==='get_fleets'&&row.command==='reinforce_fleet') {
      const fleet=fleetFor(result,a.fleet_id),targets=b.fleetTargets;
      if(fleet&&targets.length&&targets.every(target=>fleet.designs?.some(d=>d.design_id===target.designId&&finite(d.actual_count)&&d.actual_count>=target.count)))this.transition(row,'completed','下单时确定的各设计增援目标已由实际舰船数量满足',{kind:'reinforcement_arrived',fleetId:a.fleet_id});
    }
    if(method==='get_fleets'&&row.command==='build_ship'&&finite(row.expectedCount)&&Array.isArray(result.fleets)) {
      const n=countDesign(result,a.design_id);if(n>=row.expectedCount)this.transition(row,'completed','真实舰队中的目标设计数量达到预期',{kind:'ship_design_count_increased',observedCount:n});
    }
    if(method==='get_fleet_tactics') {
      const fleet=allFleets(result).find(x=>x.fleet_id===a.fleet_id);
      if(fleet&&row.command==='upgrade_fleet'&&/升级|改装/.test(fleet.status||''))this.transition(row,'executing','目标舰队正在升级；无指令或升级文字消失不证明升级完成',{kind:'fleet_upgrade_active',fleetId:a.fleet_id});
      if(fleet&&row.command==='follow_fleet'&&/跟随|护航|攻击/.test(fleet.status||''))this.transition(row,'executing','目标舰队存在持续跟随任务；不将持续任务冒充已完成',{kind:'fleet_follow_active',fleetId:a.fleet_id});
    }
    if(method==='get_contacts'&&row.command==='diplomacy') {
      const contact=result.empires?.find(x=>x.country_id===a.country_id),action=a.action;
      if(['commercial_pact','research_agreement','non_aggression_pact'].includes(action)&&contact?.treaties?.[action]===true)this.transition(row,'completed','对方关系中的目标条约已实际生效',{kind:'treaty_active',field:action});
    }
    if(method==='get_pending_diplomacy'&&row.command==='respond_diplomacy'&&Array.isArray(result.pending)&&!result.pending.some(x=>x.proposal===a.proposal))this.transition(row,'completed','目标提议已被消费；只确认回应处理，不代表对方条约接受',{kind:'proposal_consumed'});
  }
  poll(options={}) {
    if(this.closed)return Promise.resolve({queries:0,pending:0});
    this.updateState(options.state);this.expire();
    if(this.pollInFlight)return this.pollInFlight;
    this.pollInFlight=this.pollRead(options).finally(()=>{this.pollInFlight=null;});
    return this.pollInFlight;
  }
  async pollRead({state,rpc,maxQueries=2}={}) {
    this.updateState(state);this.expire();
    if(typeof rpc!=='function'||this.now()<this.nextReadAt)return {queries:0,pending:this.pending().length};
    const budget=Math.max(0,Math.min(4,Math.floor(maxQueries))),cache=new Map();let queries=0;
    for(const row of [...this.records.values()].filter(x=>!terminal.has(x.status)&&x.nextPollAt<=this.now()).sort((a,b)=>a.nextPollAt-b.nextPollAt)) {
      if(this.closed)break;
      const plans=queryPlans(row),plan=plans.length?plans[row.readIndex%plans.length]:null;
      const key=plan&&stable(plan);
      if(plan&&!cache.has(key)&&queries>=budget)continue;
      row.polls++;row.readIndex++;row.nextPollAt=this.now()+Math.min(this.maxPollIntervalMs,this.pollIntervalMs*2**Math.min(row.polls,8));
      if(!plan)continue;
      if(!cache.has(key)) {queries++;try{cache.set(key,await read(rpc,plan.method,plan.params));}catch{cache.set(key,null);row.lastReadError='只读查询失败；结果保持未知';}}
      this.applyRead(row,plan.method,cache.get(key));
    }
    if(queries)this.nextReadAt=this.now()+this.globalIntervalMs;
    this.expire();return {queries,pending:this.pending().length};
  }
  pending(){return [...this.records.values()].filter(x=>!terminal.has(x.status));}
  close(reason='控制器停止') {
    this.closed=true;
    for(const row of this.records.values())if(!terminal.has(row.status))this.transition(row,'expired_unknown',`${text(reason,60)||'控制器停止'}；结束追踪不表示游戏已取消或操作失败，结果仍未知，禁止自动重放`,{kind:'tracking_stopped'});
    return {pending:0};
  }
  view(){this.expire();return [...this.records.values()].map(x=>clone(x));}
  drainEvents(){return this.events.splice(0);}
  serialize(){return {version:1,sessionId:this.sessionId,binding:this.binding,savedAt:this.now(),lastGameDate:this.lastGameDate,records:this.view()};}
  restore(snapshot,{state}={}) {
    if(this.closed)return {restored:0,reason:'追踪已停止，不能恢复旧订单'};
    if(snapshot?.version!==1||snapshot.sessionId!==this.sessionId||snapshot.binding!==this.binding||!Array.isArray(snapshot.records))return {restored:0,reason:'会话或绑定不一致，旧订单不恢复、不重放'};
    const current=day(state?.date),previous=day(snapshot.lastGameDate);
    if(current!==null&&previous!==null&&current<previous)return {restored:0,reason:'日期回退，旧订单不恢复、不重放'};
    this.records.clear();
    for(const raw of snapshot.records.slice(-this.maxEntries)) {
      if(!raw||!tracked.has(raw.command)||!statuses.has(raw.status)||raw.sessionId!==this.sessionId||typeof raw.id!=='string'||!finite(raw.submittedAt)||!finite(raw.expiresAt))continue;
      const row={id:text(raw.id,40),sessionId:this.sessionId,requestId:text(raw.requestId,80),command:raw.command,arguments:cleanArgs(raw.arguments),baseline:cleanBaseline(raw.baseline),status:raw.status,submissionConfirmed:raw.submissionConfirmed===true,
        submittedAt:raw.submittedAt,updatedAt:finite(raw.updatedAt)?raw.updatedAt:raw.submittedAt,expiresAt:Math.min(raw.expiresAt,raw.submittedAt+this.ttlMs),reason:text(raw.reason,180),
        polls:finite(raw.polls)?Math.max(0,raw.polls):0,readIndex:finite(raw.readIndex)?Math.max(0,raw.readIndex):0,nextPollAt:this.now()+this.pollIntervalMs,
        queueItemId:id(raw.queueItemId)?raw.queueItemId:undefined,expectedCount:finite(raw.expectedCount)?raw.expectedCount:undefined,
        upgradeWitness:raw.upgradeWitness?.exclusive===true&&id(raw.upgradeWitness.queueItemId)?clone(raw.upgradeWitness):undefined,
        expectedCivilianCount:finite(raw.expectedCivilianCount)?raw.expectedCivilianCount:undefined,gameDate:text(raw.gameDate,20)||undefined};
      this.records.set(row.id,row);
    }
    this.lastGameDate=snapshot.lastGameDate;this.updateState(state);this.expire();return {restored:this.records.size};
  }
}
