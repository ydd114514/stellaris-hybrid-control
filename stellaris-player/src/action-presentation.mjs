import {setTimeout as delay} from 'node:timers/promises';

const panels={select_research:'research',increase_fleet_quota:'fleets',decrease_fleet_quota:'fleets',reinforce_fleet:'fleets',upgrade_fleet:'fleets',build_ship:'fleets',merge_fleets:'fleets',market_trade:'market',adopt_tradition:'traditions',adopt_ascension_perk:'traditions',diplomacy:'contacts',respond_diplomacy:'contacts',assign_scientist:'leaders',hire_leader:'leaders',select_leader_trait:'leaders',set_council_agenda:'government',launch_council_agenda:'government',assign_councilor:'government'};
const modalCommands=new Set(['resolve_event','open_alert','open_notification','open_war_goals','set_defender_war_goal','close_war_goals','set_speed','fleet_mia']);
export const urgentAlert=alert=>/hostile|enemy|pirate|under_attack|combat/i.test(String(alert?.type||''));
export function presentationPlan(order,state={}){
 if(modalCommands.has(order.command))return {skip:true};
 const panel=panels[order.command]||'game';
 const fleetId=order.arguments.fleet_id??order.arguments.fleet_ids?.[0];
 const planetId=order.arguments.planet_id;
 const urgent=['move_fleet','follow_fleet','set_fleet_stance','merge_fleets'].includes(order.command)&&((state.wars||[]).length>0||(state.alerts||[]).some(urgentAlert));
 return {panel,fleetId,planetId,kind:panel!=='game'?'panel':fleetId!==undefined||planetId!==undefined?'camera':'none',urgent};
}

/** Monotonic wall-clock pacing on the JS side; never blocks the game thread. */
export class ActionPresentation {
 constructor({now=()=>performance.now(),wait=(ms,signal)=>delay(ms,undefined,{signal})}={}){Object.assign(this,{now,wait});}
 begin(metadata={}){
  this.cancel('展示已切换');
  this.controller=new AbortController();
  this.active={...metadata,started:this.now(),phase:'preview',durationMs:metadata.urgent?0:10000,previewMs:metadata.urgent?0:2000};
  return this.active;
 }
 cancel(reason='展示已停止'){if(this.active)this.active.interruption=reason;this.controller?.abort();}
 async until(offset,check=async()=>undefined){
  const current=this.active,controller=this.controller;
  if(!current)return {interrupted:false};
  for(;;){
   if(this.active!==current||controller.signal.aborted)return {interrupted:true,reason:current.interruption||'展示已停止'};
   const reason=await check();
   if(reason)return {interrupted:true,reason};
   if(this.active!==current||controller.signal.aborted)return {interrupted:true,reason:current.interruption||'展示已停止'};
   const left=current.started+offset-this.now();
   if(left<=0)return {interrupted:false};
   try{await this.wait(Math.min(500,left),controller.signal);}catch(error){if(controller.signal.aborted)return {interrupted:true,reason:current.interruption||'展示已停止'};throw error;}
  }
 }
 preview(check){return this.until(this.active?.previewMs||0,check);}
 hold(check){if(this.active)this.active.phase='holding';return this.until(this.active?.durationMs||0,check);}
 end(){const previous=this.active;this.cancel('展示已结束');this.active=undefined;return previous;}
}
