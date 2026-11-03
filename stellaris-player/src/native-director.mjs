// Presentation only. No work orders, game pauses, model calls or blocking holds.
import {DIRECTOR_TIMING as T} from './director-settings.mjs';
import {directorPlanetTargets,loadDirectorStarbaseTargets} from './director-targets.mjs';

const rules=[
 ['research',/research_technology/,'科研有了新安排，看看帝国目前研究的方向。'],
 ['planet',/add_buildable|colonize_planet/,'看看殖民地当前的发展。'],
 ['starbases',/starbase.*(?:module|building|upgrade)|(?:module|building|upgrade).*starbase/,'看看恒星基地的建设和配置。'],
 ['stations',/orbital_station/,'资源站建设正在推进，看看建造船的位置。'],
 ['exploration',/survey|research_anomaly/,'看看科研船当前的探索进展。'],
 ['market',/market_/,'原生AI正在调整资源交易，看看市场和财政。'],
 ['traditions',/tradition/,'帝国的传统有了进展，看看当前发展路线。'],
 ['government',/council_agenda/,'内阁议程有了新安排，看看目前的治理方向。'],
 ['leaders',/leader/,'领袖安排有了变化，看看当前的人才配置。'],
];
const alertScenes={
 alert_fleet_combat:['fleets',95,'收到舰队交战告警，查看当前舰队态势。'],
 alert_army_combat:['fleets',95,'出现地面战斗告警，查看当前军力态势。'],
 alert_hostile_in_system:['fleets',90,'发现敌对舰队进入星系，查看防御兵力。'],
 alert_resource_shortage:['market',80,'资源出现短缺，看看当前的财政和资源情况。'],
 alert_set_war_goal:['fleets',75,'战争状态发生变化，查看军力部署。'],
 alert_no_research:['research',60,'科研出现待处理项目，看看研究页面。'],
 alert_physics_research:['research',60,'物理科研有新进展，看看研究页面。'],
 alert_society_research:['research',60,'社会科研有新进展，看看研究页面。'],
 alert_engineering_research:['research',60,'工程科研有新进展，看看研究页面。'],
 alert_unlock_ascension_perk:['traditions',65,'新的飞升选择已经出现，看看发展路线。'],
 alert_unlock_tradition:['traditions',55,'传统有了新进展，看看发展路线。'],
 alert_council_agenda_ready_for_activation:['government',55,'内阁议程已经就绪，看看治理页面。'],
 alert_available_council_agenda:['government',50,'内阁有新的议程安排。'],
};
const combat=f=>{
 for(const key of ['in_combat','in_battle','is_in_combat'])if(typeof f[key]==='boolean')return f[key];
 const text=String(f.status??'');
 return !/(?:没有|尚未|未在|不在|结束了|战斗计算机|战斗跃迁)|\b(?:not in|out of|no) combat\b/i.test(text)&&/战斗|交战|作战|\bin combat\b|\bfighting\b|\bunder attack\b/i.test(text);
};
const battleKey=f=>'battle:'+f.fleet_id+':'+(f.combat_id??f.system_id??'unknown');

export class NativeDirector {
 constructor({now=Date.now}={}){
  this.now=now;this.counts={};this.next=0;this.lastTopic='';this.pending=new Map();this.shown=new Map();this.targets=new Map();this.cursor=0;
  this.lastGalaxyAt=null;this.galaxyRetryAt=0;this.nextEventPoll=0;this.urgent=new Map();this.battleShown=new Set();this.seenAlerts=new Set();
  this.battles=[];this.snapshot=null;this.periodic=new Map();this.unavailable=new Map();this.starbaseCache={at:-Infinity,rows:[]};
 }
 view(){return {mode:this.mode??'auto',topic:this.lastTopic,lastGalaxyAt:this.lastGalaxyAt,blocked:this.blocked??'',nextSceneAt:this.next};}
 async tick(context){
  if(this.busy)return;
  this.busy=true;
  try{return await this.advance(context);}catch{this.blocked='presentation_failed';this.next=this.now()+10000;}
  finally{this.busy=false;}
 }
 observe({events,wars,alerts,military},now){
  this.snapshot={events,wars,alerts,military};
  this.battles=(military?.fleets??[]).filter(f=>Number.isInteger(f.fleet_id)&&combat(f));
  const active=new Set(this.battles.map(battleKey));
  for(const key of this.battleShown)if(!active.has(key))this.battleShown.delete(key);
  for(const [key] of this.urgent)if(key.startsWith('battle:')&&!active.has(key))this.urgent.delete(key);
  for(const fleet of this.battles){
   const key=battleKey(fleet);
   if(!this.battleShown.has(key)&&!this.urgent.has(key))this.urgent.set(key,{key,topic:'battle',fleet,at:now,priority:100,text:(fleet.name||'己方舰队')+'正在交战，切到战斗现场。',reason:'battle_started'});
  }
  const currentAlerts=new Set();
  for(const alert of Array.isArray(alerts)?alerts:[]){
   const spec=alertScenes[alert.type];if(!spec)continue;
   const key='alert:'+alert.type+':'+(alert.fleet_id??alert.planet_id??alert.system_id??'')+':'+(alert.count??'');currentAlerts.add(key);
   if(!this.seenAlerts.has(key)){
    if(alert.type==='alert_fleet_combat'&&this.battles.length)continue;
    this.urgent.set(key,{key,topic:spec[0],priority:spec[1],text:spec[2],at:now,reason:alert.type});
   }
  }
  for(const [key] of this.urgent)if(key.startsWith('alert:')&&!currentAlerts.has(key))this.urgent.delete(key);
  this.seenAlerts=currentAlerts;
  const warIds=new Set((wars?.wars??[]).map(w=>w.war_id).filter(Number.isInteger));
  if(this.warIds)for(const id of warIds)if(!this.warIds.has(id)){
   const key='war:'+id;this.urgent.set(key,{key,topic:'fleets',priority:70,text:'新的战争已经开始，看看当前的舰队部署。',at:now,reason:'war_started'});
  }
  for(const [key] of this.urgent)if(key.startsWith('war:')&&!warIds.has(Number(key.slice(4))))this.urgent.delete(key);
  this.warIds=warIds;
 }
 async advance({rpc:send,control,state={},status={},mode='auto',stopped=false,shouldContinue=async()=>true,emit=async()=>{}}){
  this.mode=mode;this.blocked='';
  if(stopped||control.owner!=='native'||control.paused!==false){this.blocked='control_unavailable';return;}
  if(mode!=='auto')return;
  if(Number.isSafeInteger(control.generation)&&control.generation!==this.generation){
   this.generation=control.generation;this.counts={};this.pending.clear();this.urgent.clear();this.battleShown.clear();this.seenAlerts.clear();this.nextEventPoll=0;this.snapshot=null;
   this.targets.clear();this.periodic.clear();this.unavailable.clear();this.starbaseCache={at:-Infinity,rows:[]};this.warIds=undefined;this.battles=[];
  }
  const rpc=async(m,p)=>{if(!await shouldContinue())throw Error('Presentation cancelled');return send(m,p);};
  const now=this.now();
  // Critical signals are polled independently of the current scene hold.
  if(!this.snapshot||now>=this.nextEventPoll){
   this.nextEventPoll=now+T.eventPoll;
   const events=await rpc('get_active_events'),wars=await rpc('get_wars');
   this.eventWindowBlocked=!Array.isArray(events)||!Array.isArray(wars?.wars)||events.length>0||!!wars.warGoalsWindow;
   if(this.eventWindowBlocked){this.blocked='event_window';this.galaxyRetryAt=now+3000;return;}
   const alerts=await rpc('get_alerts'),military=await rpc('get_military_fleets');
   this.observe({events,wars,alerts,military},now);
  }
  if(this.eventWindowBlocked){this.blocked='event_window';return;}
  const changed=[];
  for(const [name,row] of Object.entries(control.commandCounts??{})){
   const n=Number(row.admitted)||0;if(n>(this.counts[name]??0))changed.push(name);this.counts[name]=n;
  }
  for(const [key,pattern,text] of rules)if(changed.some(x=>pattern.test(x)))this.pending.set(key,{text,at:now});
  for(const map of [this.pending,this.urgent])for(const [key,event] of map)if(now-event.at>T.pendingExpiry)map.delete(key);
  const currentBattle=this.lastTopic==='battle'&&this.battles.some(f=>f.fleet_id===this.lastFleetId);
  const urgent=[...this.urgent.values()].filter(e=>now>=(e.retryAt??0)&&(!currentBattle||now>=this.next||e.priority>=100&&now-(this.lastUrgentAt??-Infinity)>=T.emergencyHold)).sort((a,b)=>b.priority-a.priority||b.at-a.at)[0];
  const galaxyDue=this.lastGalaxyAt===null||now-this.lastGalaxyAt>=T.galaxyDeadline-T.galaxyLead;
  const attemptGalaxy=galaxyDue&&now>=this.galaxyRetryAt;
  const battleEnded=this.lastTopic==='battle'&&!currentBattle;
  if(now<this.next&&!attemptGalaxy&&!urgent&&!battleEnded)return;
  this.next=now+3000;
  if(attemptGalaxy){
   this.galaxyRetryAt=now+10000;
   try{
    const shown=await rpc('show_galaxy_map');
    if(shown.success===true&&shown.full_galaxy===true){
     const readback=await rpc('get_camera_state');
     if(readback.success===true&&readback.full_galaxy===true){
      this.galaxyFailures=0;this.lastGalaxyAt=this.now();this.next=this.lastGalaxyAt+T.galaxyHold;this.lastTopic='galaxy';this.lastFleetId=undefined;
      await emit({type:'director_scene',topic:'galaxy',text:'拉开完整银河星图，看看帝国在星海中的位置。',date:state.date,fullGalaxy:true,camera:readback});return;
     }
    }
   }catch{}
   this.galaxyFailures=Math.min(4,(this.galaxyFailures??0)+1);
   this.galaxyRetryAt=now+Math.min(120000,10000*2**(this.galaxyFailures-1));this.blocked='presentation_failed';
  }
  const eligible=key=>!(['planet','starbases'].includes(key)&&control.directorObjectViewsSupported===false)&&key!==this.lastTopic&&now-(this.unavailable.get(key)??-Infinity)>=T.targetRefresh&&now-(this.shown.get(key)??-Infinity)>=(['exploration','stations'].includes(key)?T.explorationCooldown:T.topicCooldown);
  const scenes=[];
  if(urgent)scenes.push(urgent);
  if(!urgent&&this.battles.length&&eligible('battle'))scenes.push({topic:'battle',fleet:this.battles[0],text:'交战仍在继续，回到舰队现场。',reason:'battle_ongoing'});
  for(const [topic,interval] of [['planet',T.planetInterval],['starbases',T.starbaseInterval]]){
   if(eligible(topic)&&now-(this.periodic.get(topic)??-Infinity)>=interval)scenes.push({topic,periodic:true});
  }
  for(const [topic,event] of this.pending)if(eligible(topic))scenes.push({topic,text:event.text});
  const overview=['research','planet','starbases','fleets','government','market','traditions'];
  for(let i=0;i<overview.length;i++){const topic=overview[(this.cursor+i)%overview.length];if(eligible(topic))scenes.push({topic});}
  const attempted=new Set();
  for(const scene of scenes){
   if(attempted.has(scene.topic))continue;attempted.add(scene.topic);
   if(await this.present(scene,{rpc,state,status,now,emit})){
    this.cursor=(overview.indexOf(scene.topic)+1+overview.length)%overview.length;return;
   }
   if(scene.key)break;
  }
 }
 leastRecent(items,key){
  return items.filter(x=>Number.isInteger(x[key])).sort((a,b)=>{
   const x=this.targets.get(key+':'+a[key]),y=this.targets.get(key+':'+b[key]);
   if(x===undefined&&y!==undefined)return -1;if(y===undefined&&x!==undefined)return 1;
   const active=row=>row.has_construction===true||(row.construction_queue?.length??row.queue_length??0)>0;
   if(x===undefined&&y===undefined)return Number(active(b))-Number(active(a));
   return (x-(active(a)?30000:0))-(y-(active(b)?30000:0));
  });
 }
 async present(scene,{rpc,state,status,now,emit}){
  const topic=scene.topic;let planet,starbase,fleet=scene.fleet,caption=scene.text;
  try{
   if(topic==='planet'){
    planet=this.leastRecent(directorPlanetTargets(status,state),'planet_id')[0];
    if(!planet){this.periodic.set(topic,now);return false;}
    const detail=await rpc('get_planet_details',{planet_id:planet.planet_id});
    const queue=(detail.construction_queue??[]).slice(0,2).map(x=>x.item_name).filter(x=>typeof x==='string');
    caption=(planet.name||'殖民地')+(!Array.isArray(detail.construction_queue)?'：看看星球的建设和区域安排。':queue.length?'当前建设队列：'+queue.join('、')+'。':'当前没有施工队列，看看现有发展。');
   }else if(topic==='starbases'){
    if(now-this.starbaseCache.at>=T.targetRefresh){this.starbaseCache={at:now,rows:await loadDirectorStarbaseTargets({status,state,rpc})};}
    starbase=this.leastRecent(this.starbaseCache.rows,'system_id')[0];
    if(!starbase){this.periodic.set(topic,now);return false;}
    caption=(starbase.name||'恒星基地')+'：看看基地建设、模块和船坞配置。';
   }else if(['exploration','stations'].includes(topic)){
    const raw=await rpc('get_civilian_fleets');
    fleet=this.leastRecent(topic==='stations'?raw.construction_ships??[]:raw.science_ships??[],'fleet_id').find(f=>now-(this.targets.get('fleet_id:'+f.fleet_id)??-Infinity)>=T.targetCooldown);
    if(!fleet){this.pending.delete(topic);this.shown.set(topic,now);return false;}
   }
   const close=await rpc('show_panel',{panel:'game'});if(close.success!==true)throw Error('Panel unavailable');
   if(planet){
    const focused=await rpc('focus_planet',{planet_id:planet.planet_id});if(focused.success!==true)throw Error('Planet focus unavailable');
    const shown=await rpc('show_planet_view',{planet_id:planet.planet_id,tab:'construction'});if(shown.success!==true||shown.shown!==true)throw Error('Planet construction page unavailable');
   }else if(starbase){
    const shown=await rpc('show_starbase_view',{system_id:starbase.system_id,...(Number.isInteger(starbase.starbase_id)?{starbase_id:starbase.starbase_id}:{})});if(shown.success!==true||shown.shown!==true)throw Error('Starbase page unavailable');
   }else if(fleet){
    const focused=await rpc('focus_fleet',{fleet_id:fleet.fleet_id});if(focused.success!==true)throw Error('Fleet view unavailable');
   }else{
    const shown=await rpc('show_panel',{panel:topic});if(shown.success!==true)throw Error('Panel unavailable');
   }
   const shownAt=this.now();
   this.pending.delete(topic);this.shown.set(topic,shownAt);this.unavailable.delete(topic);
   if(planet){this.targets.set('planet_id:'+planet.planet_id,shownAt);this.periodic.set(topic,shownAt);}
   if(starbase){this.targets.set('system_id:'+starbase.system_id,shownAt);this.periodic.set(topic,shownAt);}
   if(fleet)this.targets.set('fleet_id:'+fleet.fleet_id,shownAt);
   if(scene.key){this.urgent.delete(scene.key);this.lastUrgentAt=shownAt;if(scene.key.startsWith('battle:'))this.battleShown.add(scene.key);}
   this.lastFleetId=fleet?.fleet_id;this.lastTopic=topic;this.next=shownAt+(topic==='battle'?T.battleHold:T.sceneHold);this.blocked='';
   caption??='看看帝国当前的'+({research:'科研方向',fleets:'舰队配置',government:'内阁议程',market:'资源市场',traditions:'传统路线'}[topic]??'发展情况')+'。';
   await emit({type:'director_scene',topic,text:caption,date:state.date,urgent:!!scene.key,...(scene.reason?{reason:scene.reason}:{}),...(fleet?{fleetId:fleet.fleet_id}:{}),...(planet?{planetId:planet.planet_id,constructionPage:true}:{}),...(starbase?{starbaseId:starbase.starbase_id,systemId:starbase.system_id}:{})});
   return true;
  }catch{
   this.blocked='presentation_failed';this.next=now+3000;
   if(scene.key)scene.retryAt=now+3000;
   if(!scene.key){this.pending.delete(topic);this.unavailable.set(topic,now);}
   return false;
  }
 }
}
