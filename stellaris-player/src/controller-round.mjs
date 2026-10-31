// Completion of a controller round is distinct from verified autonomous work.
import {confirmedCountryAIHandoff} from './country-ai-handoff.mjs';
export function countryAIHandoffUnconfirmed(checkpoint){
 const control=checkpoint?.state?.countryAIControl,cleanup=checkpoint?.cleanup?.countryAI;
 if(control?.enabled!==true&&cleanup===undefined)return false;
 return !confirmedCountryAIHandoff(cleanup)||control?.owner!=='human'||control?.ordinaryOrdersBlocked!==false;
}
export function controllerRoundComplete(checkpoint,{nativeCountryAI=false}={}){
 if(!nativeCountryAI)return checkpoint?.metrics?.orders>0;
 const clean=checkpoint?.cleanup,control=checkpoint?.state?.countryAIControl;
 return checkpoint?.stopped===true&&!checkpoint.uncertain&&control?.enabled===true&&
  !countryAIHandoffUnconfirmed(checkpoint)&&confirmedCountryAIHandoff(clean?.countryAI)&&
  clean?.bindingConfirmed===true&&clean?.pauseConfirmed===true&&clean?.pauseStateUnknown!==true&&!clean?.error;
}
