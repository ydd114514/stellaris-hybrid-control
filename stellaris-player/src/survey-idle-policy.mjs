// Supported vanilla defines: AUTOMATE_FLEET_SEARCH_COOLDOWN_DAYS=30.
// This is an adapter waiting policy, not proof of the engine's current search
// result or of modded cooldowns. Never infer idle failure from paused wall time.
export const SURVEY_IDLE_GAME_DAYS=31;
export function surveyGameDay(date){
 const match=typeof date==='string'&&/^(\d{4,7})\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|30)$/.exec(date);
 return match?Number(match[1])*360+(Number(match[2])-1)*30+Number(match[3])-1:null;
}
export function surveyIdleReason(record,{gameDate,now}){
 const day=surveyGameDay(gameDate);
 if(day===null||!Number.isFinite(now))return 'survey_state_unknown';
 if(record.idleGameDay===undefined&&record.idleLastGameDay===undefined){
  record.idleGameDay=day;record.idleLastGameDay=day;record.idleSince=now;
 }
 if(!Number.isSafeInteger(record.idleGameDay)||record.idleGameDay<0||!Number.isSafeInteger(record.idleLastGameDay)||record.idleLastGameDay<record.idleGameDay||!Number.isFinite(record.idleSince)||record.idleSince<0)return 'survey_state_unknown';
 if(day<record.idleLastGameDay||now<record.idleSince)return 'survey_state_unknown';
 record.idleLastGameDay=day;
 return now-record.idleSince>=15000&&day-record.idleGameDay>=SURVEY_IDLE_GAME_DAYS?'survey_no_work':null;
}
