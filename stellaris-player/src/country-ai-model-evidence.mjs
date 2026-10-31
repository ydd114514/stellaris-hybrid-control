const time=e=>Date.parse(e?.at);
export function assessCountryAIModelLinkage(checkpoint,events){
 const intent=events.find(e=>e.type==='intent'&&e.strategicResearchOverride===true&&e.orders?.length===1&&e.orders[0].command==='select_research');
 const order=intent?.orders[0],args=order?.arguments??{};
 const receipt=intent&&events.find(e=>e.type==='receipt'&&e.requestId===intent?.requestId&&e.command==='select_research'&&e.response?.success===true&&e.verification?.verified===true&&e.verification.technology?.key===args.tech_key);
 const delegates=events.filter(e=>e.type==='country_ai_delegate_confirmed'&&e.view?.owner==='native'&&e.view?.ordinaryOrdersBlocked===true);
 const first=intent&&delegates.find(e=>time(e)<time(intent));
 const takeover=first&&events.find(e=>e.type==='country_ai_takeover_confirmed'&&time(e)>time(first)&&time(e)<time(intent)&&
  e.state?.phase==='stopped'&&e.state.last_native_state?.paused===true&&e.state.last_native_state.global_flags?.human_ai===false&&
  e.state.last_native_state.global_flags?.force_human_ai===false&&e.state.observation?.commands_drained===true);
 const resumed=receipt&&delegates.find(e=>time(e)>time(receipt));
 const keyRetained=!!order&&checkpoint.state?.research?.[args.slot]?.current?.key===args.tech_key;
 let nativeOwned=false;const forbidden=[];
 for(const event of events){
  if(event.type==='country_ai_delegate_confirmed')nativeOwned=true;
  if(event.type==='country_ai_takeover_confirmed')nativeOwned=false;
  if(nativeOwned&&event.type==='rpc_write'&&event.category==='work')forbidden.push(event);
 }
 const linkageVerified=!!first&&!!takeover&&!!receipt&&!!resumed&&keyRetained&&forbidden.length===0&&!checkpoint.uncertain;
 return {linkageVerified,delegations:delegates.length,takeoverBeforeIntervention:!!takeover,modelInterventionVerified:!!receipt,
  returnAfterIntervention:!!resumed,resumedAt:resumed?time(resumed):null,selectedKey:order?.arguments?.tech_key??null,keyRetained,ordinaryWorkDuringNative:forbidden.length};
}
export function countryAIModelAcceptanceReady(checkpoint,events,now=Date.now()){
 const evidence=assessCountryAIModelLinkage(checkpoint,events),control=checkpoint.countryAIControl??checkpoint.state?.countryAIControl;
 return evidence.linkageVerified&&!checkpoint.stopped&&control?.owner==='native'&&control.nativePhase==='running'&&
  control.ordinaryOrdersBlocked===true&&control.paused===false&&control.actualFlags?.human_ai===true&&control.actualFlags?.force_human_ai===true&&
  Number.isFinite(checkpoint.observedAt)&&checkpoint.observedAt>=evidence.resumedAt+2000&&now>=checkpoint.observedAt;
}
