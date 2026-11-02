import type {AiNativeIntent,AiOperatorJudgment} from '../../shared/src/ai'
import {clip} from './ai-blackboard'

const statuses=new Set(['pending','applied','progressing','stalled','blocked','suspended'])
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}\.\d{2}\.\d{2}$/.test(value)?value:''

/** Controller facts only. Never pass arbitrary checkpoint fields into the UI. */
export function digestNativeIntent(value:any):AiNativeIntent|undefined{
 if(value?.version!==1||!statuses.has(value.status))return
 return {version:1,source:clip(value.source,80),objective:clip(value.objective,600),targetResource:clip(value.targetResource,60),requestedFocus:clip(value.requestedFocus,60),effectiveFocus:clip(value.effectiveFocus,60),
  controls:{steeringConfirmed:value.controls?.steeringConfirmed===true,ownerPolicyConfirmed:value.controls?.ownerPolicyConfirmed===true},status:value.status,reason:clip(value.reason,600),
  baseline:{date:date(value.baseline?.date),net:number(value.baseline?.net)},current:{date:date(value.current?.date),net:number(value.current?.net)},
  progress:{netDelta:number(value.progress?.netDelta),traditionsGained:Number.isSafeInteger(value.progress?.traditionsGained)&&value.progress.traditionsGained>=0?value.progress.traditionsGained:null},
  correctiveAction:clip(value.correctiveAction,600),unsupported:(Array.isArray(value.unsupported)?value.unsupported:[]).filter((x:unknown)=>typeof x==='string').slice(0,12).map((x:string)=>clip(x,200))}
}

/** Applied settings are a pending effect, and an ongoing objective has no done state. */
export function nativeIntentJudgment(judgment:AiOperatorJudgment|undefined,intent:AiNativeIntent|undefined):AiOperatorJudgment|undefined{
 if(!intent)return judgment
 return {economyFocus:judgment?.economyFocus??null,until:judgment?.until??{date:'',condition:''},status:intent.status==='progressing'?'on_track':'blocked',
  evidence:clip(intent.reason||(intent.status==='applied'?'方针设置已确认，实际经营效果仍待回读。':intent.status==='progressing'?'已有实际进展，持续目标尚需继续落实。':'尚未确认目标的实际经营效果。'),300)}
}
