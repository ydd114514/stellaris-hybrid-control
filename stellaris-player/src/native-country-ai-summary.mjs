import {confirmedCountryAIHandoff} from './country-ai-handoff.mjs';
export function nativeCountryAISummary(checkpoint,{actorActive=false}={}){
 const raw=checkpoint?.countryAIControl??checkpoint?.state?.countryAIControl;
 if(raw?.enabled!==true)return;
 const historical=checkpoint.stopped===true||!actorActive;
 const control=historical?checkpoint.cleanup?.countryAI:raw;
 const flags=control?.actualFlags;
 /** @type {'human'|'native'|'unconfirmed'} */
 let owner='unconfirmed';
 if(historical?confirmedCountryAIHandoff(control):control?.owner==='human'&&control.ordinaryOrdersBlocked===false&&
  control.paused===true&&flags?.human_ai===false&&flags?.force_human_ai===false&&['idle','stopped'].includes(control.nativePhase))owner='human';
 if(!historical&&control?.owner==='native'&&control.nativePhase==='running'&&control.ordinaryOrdersBlocked===true&&
  control.paused===false&&flags?.human_ai===true&&flags?.force_human_ai===true)owner='native';
 const domains=[...new Set((Array.isArray(raw.domains)?raw.domains:[]).filter(x=>['research','planet_construction'].includes(x)))];
 const message=historical?(owner==='human'?'上轮已确认收回国家 AI，游戏当时暂停。':'上轮国家 AI 交接未确认，需先核对游戏。'):
  owner==='native'?'原生国家 AI 正在经营，大肥鱼负责战略与关键干预。':
  owner==='human'?'国家 AI 已交回控制，关键干预后可由大肥鱼重新委派。':'国家 AI 控制权待核对，经营派单保持封口。';
 return {owner,historical,domains,message,reviewDue:!historical&&control?.reviewDue===true};
}
