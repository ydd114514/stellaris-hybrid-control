import {surveyGameDay} from './survey-idle-policy.mjs';

// The bridge does not expose the save's configured midgame year.
export const STRATEGY_MIDGAME_START='2300.01.01';
const midgameDay=surveyGameDay(STRATEGY_MIDGAME_START);

export function strategyGamePhase(date){
 const day=surveyGameDay(date);
 return day===null?'unknown':day<midgameDay?'early':'middle_or_late';
}

export function earlyTerritorialLimit(state){
 const size=state?.capacities?.empire_size;
 return strategyGamePhase(state?.date)==='early'&&Number.isFinite(size)&&size>=100;
}
