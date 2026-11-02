import {mkdir,open,rename,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {AiEconomyFocus,AiOperatorStanding,AiOperatorJudgment,AiOperatorExecution,AiControllerReceipt,AiUnityProgress,AiNativeIntent} from '../../../packages/shared/src/ai'
import {OPERATOR_NOTE_LIMIT} from '../../../packages/shared/src/ai'
import {clip} from '../../../packages/core/src/ai-blackboard'
import {digestUnityProgress} from '../../../packages/core/src/ai-prompts'
import {guardOperatorProgress,confirmedAscensionCount} from '../../../packages/core/src/operator-progress'
import {controllerWorld,sameControllerWorld,type ControllerWorld} from '../../../packages/core/src/controller-world'
import {digestNativeIntent,nativeIntentJudgment} from '../../../packages/core/src/native-intent'

const focuses:AiEconomyFocus[]=['balanced','unity_traditions','consumer_stability','alloys_military','research']
const focus=(x:unknown):AiEconomyFocus|null=>focuses.includes(x as AiEconomyFocus)?x as AiEconomyFocus:null
export function operatorJudgment(x:any):AiOperatorJudgment|undefined {
 if(!x||typeof x!=='object'||!['on_track','blocked','done'].includes(x.status))return
 return {economyFocus:focus(x.economyFocus),until:{date:/^\d{4}\.\d{2}\.\d{2}$/.test(x.until?.date)?x.until.date:'',condition:clip(x.until?.condition,300)},status:x.status,evidence:clip(x.evidence,300)}
}
async function readBounded(path:string){
 let file
 try{file=await open(path,'r');if((await file.stat()).size>32768)return;const buffer=Buffer.alloc(32769),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>32768)return;return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'))}catch{return}finally{await file?.close()}
}
interface Options {disabled?:boolean;now():number;getProject():Promise<string|undefined>;readSnapshot():Promise<any>;state():{running:boolean;note:string};onSessionChange?():unknown;onSessionWaiting?():unknown;onSessionContinue?():unknown}
interface Review {note:string;gameSessionId?:string;operator:unknown;snapshot?:{date?:string;resourceNet?:Record<string,number>;unityProgress?:unknown}}
/** Local file heartbeat independent of model requests. All writes/deletions share one queue. */
export function createOperatorStandingBridge(options:Options){
 let queue=Promise.resolve(),standing:AiOperatorStanding|undefined,judgment:AiOperatorJudgment|undefined,receipt:AiControllerReceipt|undefined
 let session='',blocked=false,lastRoot='',message='尚未发送常驻要求。',directiveAt:number|undefined
 let trend:AiOperatorExecution['trend']=[],revision=0
 let publishedId='',pendingRearm=false,pendingReview:Review|undefined
 let unityProgress:AiUnityProgress|undefined
 let nativeIntent:AiNativeIntent|undefined
 let world:ControllerWorld|undefined,waiting=false
 async function remove(path:string){if((await readBounded(path))?.source==='cyberfish-ai-hub')await unlink(path).catch(()=>{})}
 let working=false,requested=false,lastIntent=''
 function refresh(input:{rearm?:boolean;review?:Review}={}){
  pendingRearm||=!!input.rearm;if(input.review)pendingReview=input.review
  const intent=JSON.stringify(options.state())
  const meaningful=!!input.rearm||!!input.review||intent!==lastIntent
  if(meaningful){lastIntent=intent;revision++}
  if(working&&!meaningful)return queue
  requested=true
  if(working)return queue
  working=true
  queue=queue.catch(()=>{}).then(async()=>{
   while(requested){requested=false;try{await refreshOnce(revision)}catch{receipt=undefined;message='常驻要求文件传输失败，请检查目录权限。'}}
  }).finally(()=>{working=false})
  return queue
 }
 async function refreshOnce(ticket:number){
   if(options.disabled)return
   const root=await options.getProject();if(!root)return
   if(lastRoot&&lastRoot!==root){await remove(join(lastRoot,'.local/commentary/operator-standing.json'));standing=undefined;judgment=undefined;session='';world=undefined;waiting=false;blocked=true;trend=[];receipt=undefined;await options.onSessionChange?.()}
   lastRoot=root
   const path=join(root,'.local/commentary/operator-standing.json'),snapshot=await options.readSnapshot().catch(()=>undefined)
   const state=options.state(),text=clip(state.note,OPERATOR_NOTE_LIMIT),current=typeof snapshot?.sessionId==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(snapshot.sessionId)&&snapshot?.state&&!snapshot.stopped?snapshot.sessionId:''
   if(ticket!==revision)return
   unityProgress=current?digestUnityProgress(snapshot.state.strategy?.unityProgress):undefined
   nativeIntent=undefined
   // A replacing checkpoint is not a new game. Keep the last delivery without renewing it.
   if(state.running&&text&&standing?.text===text&&!snapshot){message='暂时无法读取游戏快照，保留上次要求等待恢复。';return}
   const rearm=pendingRearm,review=pendingReview;pendingRearm=false;pendingReview=undefined
   const nextWorld=controllerWorld(snapshot)
   if(snapshot?.stopped&&state.running){
    // A normally stopped controller is a gap in control, not a new game. Keep
    // only a verified world anchor; revoke every old session's published work.
    if(!session&&typeof snapshot.sessionId==='string')session=snapshot.sessionId
    if(nextWorld&&(!world||sameControllerWorld(world,nextWorld)))world=nextWorld
    standing=undefined;judgment=undefined;receipt=undefined;publishedId='';directiveAt=undefined;trend=[];await remove(path)
    if(!waiting){waiting=true;await options.onSessionWaiting?.()}
    message='控制会话已结束，等待同一世界续接；旧交办已撤回。';return
   }
   const changedSession=!!session&&!!current&&current!==session
   const changedWorld=!!world&&!!current&&!sameControllerWorld(world,nextWorld)
   if(changedSession||changedWorld||waiting&&!!current){
    const continued=!blocked&&sameControllerWorld(world,nextWorld)
    standing=undefined;judgment=undefined;receipt=undefined;publishedId='';directiveAt=undefined;trend=[];await remove(path)
    if(continued||rearm&&!!nextWorld){
     blocked=false;if(state.running)await options.onSessionContinue?.()
    }else{
     blocked=true;if(state.running)await options.onSessionChange?.()
    }
    waiting=false
   }
   if(rearm&&(!session||!!nextWorld))blocked=false
   if(current){session=current;world=nextWorld}
   if(current&&!blocked)nativeIntent=digestNativeIntent(snapshot.state.nativeIntent??snapshot.state.strategy?.nativeIntent)
   if(!state.running||!text||!current||blocked){
    await remove(path);standing=undefined;publishedId='';receipt=undefined;judgment=undefined;directiveAt=undefined
    message=blocked?'游戏世界改变或身份未确认，请核对后保存要求。':!state.running?'场控未运行，常驻要求已撤销。':!text?'尚无主播要求。':'等待当前游戏局快照。'
    return
   }
   const changed=!standing||standing.text!==text||standing.gameSessionId!==current
   if(changed){standing={version:1,source:'cyberfish-ai-hub',kind:'operator-standing',id:'o-'+randomUUID(),gameSessionId:current,text,economyFocus:null,until:{date:'',condition:''},setAt:options.now(),refreshedAt:options.now()};judgment=undefined;receipt=undefined;trend=[]}
   const accepted=review&&clip(review.note,OPERATOR_NOTE_LIMIT)===text&&review.gameSessionId===current
   if(accepted){
    judgment=operatorJudgment(review.operator)
    // Reaching an exit condition asks for confirmation; it is not permission
    // for a model to replace the streamer's established focus.
    const explicitResearchStage=/凝聚/.test(text)&&/第?三(?:个|项|次)?\s*飞升/.test(text)&&/(?:后|再).*科研/.test(text)
    if(judgment?.status==='done'&&standing!.economyFocus&&!explicitResearchStage)judgment.economyFocus=standing!.economyFocus
    standing!.economyFocus=judgment?.economyFocus??null;standing!.until=judgment?.until??{date:'',condition:''}
    const resource=standing!.economyFocus==='alloys_military'?'alloys':standing!.economyFocus==='consumer_stability'?'consumer_goods':standing!.economyFocus==='research'?'research':standing!.economyFocus==='unity_traditions'?'unity':'energy'
    const r=snapshot.state.resources??{},nets=review.snapshot?.resourceNet??Object.fromEntries(Object.entries(r).map(([k,v]:[string,any])=>[k,v?.net]))
    const net=nets[resource]??(resource==='research'&&['physics_research','society_research','engineering_research'].every(k=>Number.isFinite(nets[k]))?['physics_research','society_research','engineering_research'].reduce((n,k)=>n+nets[k]!,0):undefined)
    if(Number.isFinite(net))trend=[...trend,{at:options.now(),date:clip(review.snapshot?.date??snapshot.state.date,20),resource,net:net!}].slice(-10)
   }
   unityProgress??=digestUnityProgress(accepted?review.snapshot?.unityProgress:undefined)
   judgment=guardOperatorProgress(judgment,{note:text,progress:unityProgress,ascensionPerkCount:confirmedAscensionCount(snapshot.state.ascensionPerks?.adopted),previousFocus:standing!.economyFocus})
   if(changed||accepted||rearm||publishedId!==standing!.id||options.now()-standing!.refreshedAt>=60000){
    const next={...standing!,refreshedAt:options.now()},temporary=path+'.'+randomUUID()+'.tmp'
    await mkdir(join(root,'.local/commentary'),{recursive:true});await writeFile(temporary,JSON.stringify(next)+'\n',{mode:0o600})
    if(ticket!==revision||!options.state().running||clip(options.state().note,OPERATOR_NOTE_LIMIT)!==text){await unlink(temporary).catch(()=>{});return}
    await rename(temporary,path);standing=next;publishedId=next.id
   }
   const raw=await readBounded(join(root,'.local/commentary/controller-receipt.json'))
   receipt=raw?.operatorStandingId===standing!.id&&(raw.appliedFocus===null||focus(raw.appliedFocus)!==null)&&Number.isFinite(raw.readAt)&&raw.readAt>=standing!.setAt&&raw.readAt<=options.now()+5000&&options.now()-raw.readAt<=120000&&typeof raw.steeringApplied==='boolean'?
    {operatorStandingId:standing!.id,readAt:raw.readAt,appliedFocus:focus(raw.appliedFocus),steeringApplied:raw.steeringApplied,reason:clip(raw.reason,300)}:undefined
   const directive=await readBounded(join(root,'.local/commentary/strategy-directive.json'))
   directiveAt=directive?.source==='cyberfish-ai-hub'&&directive.gameSessionId===current&&Number.isFinite(directive.at)&&directive.at<=options.now()+5000?directive.at:undefined
   message=receipt?(receipt.steeringApplied?'引导档位已切换':'控制器已读取，方针尚未确认'):standing!.economyFocus?'常驻要求已发送，等待控制器回执。':'原话已发送，等待参谋解析经济档位。'
 }
 function view():AiOperatorExecution{const assessed=nativeIntentJudgment(judgment,nativeIntent);return {text:clip(options.state().note,OPERATOR_NOTE_LIMIT),...(nativeIntent?{nativeIntent:structuredClone(nativeIntent)}:{}),...(unityProgress?{unityProgress:structuredClone(unityProgress)}:{}),economyFocus:judgment?.economyFocus??standing?.economyFocus??null,until:judgment?.until??standing?.until??{date:'',condition:''},status:assessed?.status??'blocked',evidence:assessed?.evidence??'等待参谋解释主播要求。',history:structuredClone(trend),standingRefreshedAt:standing&&publishedId===standing.id?standing.refreshedAt:undefined,directiveRefreshedAt:directiveAt,...(standing?{standing:structuredClone(standing)}:{}),...(assessed?{judgment:structuredClone(assessed)}:{}),...(receipt&&standing&&options.now()-receipt.readAt<=120000?{receipt:structuredClone(receipt)}:{}),directiveAt,
  standingDelivered:!!standing&&publishedId===standing.id&&options.state().running&&options.now()-standing.refreshedAt<=120000,directiveDelivered:directiveAt!==undefined&&options.state().running&&options.now()-directiveAt<=120000,message,trend:structuredClone(trend)}}
 return {refresh,view,flush:()=>queue}
}
