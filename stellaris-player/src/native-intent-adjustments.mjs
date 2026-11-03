import {surveyGameDay as gameDay} from './survey-idle-policy.mjs';
import {nativeEconomyFeedback,nativeEconomyMetric} from './native-economy-feedback.mjs';

/** Pure pre-application adjustment: preserves the owner's selected resource,
 * never turns unfilled jobs or an ordinary construction delay into a new focus. */
export function nativeIntentAdjustments({intent,state={},record,now=Date.now()}={}){
 const currentDay=gameDay(state.date),observed=state.economyObservedAt;
 const fresh=Number.isFinite(observed)&&observed<=now+5000&&now-observed<=30000;
 const same=record?.key===intent.key&&currentDay!==null&&Number.isFinite(record.lastDay)&&currentDay>=record.lastDay;
 const {feedback}=nativeEconomyFeedback(state,{targetResource:intent.targetResource,current:nativeEconomyMetric(state,intent.targetResource),
  previous:same?record.previousSample:null,currentDay,lastProgressDay:same?(record.lastProgressDay??record.reviewDay):currentDay,
  memory:same?record.feedbackMemory:{},fresh,now});
 const contract={...intent.contract};
 const repair=feedback.phase!=='unknown'&&!intent.emergency?feedback.recommendations.find(x=>x.kind==='housing'||x.kind==='resource_deficit'):null;
 if(repair&&contract.expansionStance!=='consolidate'){
  contract.expansionStance='consolidate';
  const detail=repair.kind==='housing'?`星球${repair.planetIds.join('、')}已确认负住房，先修复现有殖民地`:
   `已确认${repair.deficits.map(x=>x.resource).join('、')}实际赤字，先保供并消化维护`;
  contract.reason=`${contract.reason??''}；${detail}，保留当前主目标`.slice(0,300);
  feedback.adjustment={changed:true,fields:['expansionStance'],kind:repair.kind,reason:detail};
 }else feedback.adjustment={changed:false,fields:[],reason:null};
 const lockedDimensions=repair?{expansionStance:{value:'consolidate',by:'建设消化'}}:{};
 return {contract,feedback,lockedDimensions};
}
