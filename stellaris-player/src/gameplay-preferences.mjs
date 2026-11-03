import {open} from 'node:fs/promises';

/** Explicit owner preference; a later AI-hub owner edit can supersede it. */
export async function readGameplayPreferences(path,{standing,worldBinding,now=Date.now()}={}){
 let file;
 try{
  file=await open(path,'r');if((await file.stat()).size>8192)return;
  const buffer=Buffer.alloc(8193),{bytesRead}=await file.read(buffer,0,buffer.length,0);
  if(bytesRead>8192)return;
  const x=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  if(x?.version!==1||x.source!=='user-current-chat'||x.priority!=='unity_first'||x.economyFocus!=='unity_traditions'||x.resourcePolicy!=='deficit_only'||
    !Number.isFinite(x.updatedAt)||x.updatedAt>now+5000||typeof x.note!=='string'||!x.note.trim())return;
  // Rebinding an unchanged UI note creates a new standing timestamp. That is
  // not a newer owner edit and must not erase later instructions from this chat.
  const baseline=typeof x.replacesStandingText==='string'?x.replacesStandingText.trim().slice(0,600):null;
  const standingText=typeof standing?.text==='string'?standing.text.trim().slice(0,600):null;
  const savedNote=x.note.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,600);
  const repeatedStanding=!!standingText&&(standingText===baseline||standingText===savedNote);
  if(Number.isFinite(standing?.setAt)&&standing.setAt>=x.updatedAt&&!repeatedStanding)return;
  // A matching process alone does not identify a save. A new or loaded game
  // may reuse player, planet and fleet IDs. Missing scope never authorizes tasks.
  const worldTaskAuthorized=typeof worldBinding==='string'&&worldBinding.length>0&&x.worldBinding===worldBinding;
  const edictPolicy=x.edictPolicy==='unity_net_gain';
  return {version:1,source:x.source,updatedAt:x.updatedAt,priority:'unity_first',economyFocus:'unity_traditions',resourcePolicy:'deficit_only',
   worldTaskAuthorized,discardStandingText:!worldTaskAuthorized&&repeatedStanding,
   ...(worldTaskAuthorized&&x.militaryPolicy==='exploration_until_threat'?{militaryPolicy:x.militaryPolicy}:{}),
   ...(worldTaskAuthorized&&x.civilianFleetPolicy==='use_existing_explorers'?{civilianFleetPolicy:x.civilianFleetPolicy}:{}),
   ...(edictPolicy?{edictPolicy:x.edictPolicy}:{}),
   preferredUnityBuildings:worldTaskAuthorized&&Array.isArray(x.preferredUnityBuildings)?x.preferredUnityBuildings.filter(k=>k==='building_hive_node').slice(0,1):[],
   note:worldTaskAuthorized?savedNote:
    '长期方针：优先提高凝聚力净产，其他资源只补实际缺口。'+(edictPolicy?'法令以实际净收益为准。':'')};
 }catch{return;}finally{await file?.close();}
}
