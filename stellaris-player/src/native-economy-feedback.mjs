import {surveyGameDay as gameDay} from './survey-idle-policy.mjs';

export const NATIVE_ECONOMY_REVIEW_DAYS=180;
const constructionGrace=NATIVE_ECONOMY_REVIEW_DAYS*2;
const staffingGrace=NATIVE_ECONOMY_REVIEW_DAYS;
const resourceKeys=resource=>resource==='research'?['physics_research','society_research','engineering_research']:[resource];
const round=x=>Number.isFinite(x)?Math.round(x*100)/100:null;
const validId=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;

/** Unknown components are never zero-filled, including combined research. */
export function nativeEconomyMetric(state,resource){
 const keys=resourceKeys(resource);
 const sum=field=>resource&&keys.every(key=>state.resources?.[key]?.[field+'_known']!==false&&Number.isFinite(state.resources?.[key]?.[field]))?
  keys.reduce((total,key)=>total+state.resources[key][field],0):null;
 return {net:sum('net'),income:sum('income'),expense:sum('expense')};
}

/** Read-only diagnosis. Recommendations are inputs to the existing controlled
 * native strategy path, never authority to issue daily construction/job orders. */
export function nativeEconomyFeedback(state,{targetResource,current,previous,currentDay=gameDay(state.date),lastProgressDay=currentDay,memory={},fresh=false,now=Date.now()}={}){
 const audit=state.colonyAudit??state.nativeColonyAudit;
 const auditDate=gameDay(audit?.date),ownedRows=(state.colonies??[]).flatMap(x=>x.colonies_summary??[]);
 const own=ownedRows.length?new Set(ownedRows.map(x=>x.planet_id)):null;
 const auditFresh=audit?.known===true&&currentDay!==null&&auditDate!==null&&auditDate<=currentDay&&currentDay-auditDate<=NATIVE_ECONOMY_REVIEW_DAYS;
 const colonies=auditFresh?(audit.colonies??[]).filter(x=>validId(x.planetId)&&(!own||own.has(x.planetId))&&
  Number.isFinite(x.ageDays)&&x.ageDays>=0&&x.ageDays<=NATIVE_ECONOMY_REVIEW_DAYS):[];
 const jobs=(state.operationalFacts??[]).filter(x=>x.topic==='jobs'&&validId(x.entityId)&&(!own||own.has(x.entityId))&&x.economy?.workforceKnown===true&&
  Number.isFinite(x.observedAt)&&x.observedAt<=now&&now-x.observedAt<=60000&&gameDay(x.gameDate)!==null&&currentDay!==null&&
  gameDay(x.gameDate)<=currentDay&&currentDay-gameDay(x.gameDate)<=NATIVE_ECONOMY_REVIEW_DAYS&&
  Number.isFinite(x.economy.capacityWorkforce)&&Number.isFinite(x.economy.employedWorkforce)&&x.economy.employedWorkforce>=0&&x.economy.capacityWorkforce>=x.economy.employedWorkforce);
 const vacancies=jobs.filter(x=>x.economy.capacityWorkforce>x.economy.employedWorkforce).map(x=>({planetId:x.entityId,
  amount:round(x.economy.capacityWorkforce-x.economy.employedWorkforce),unemployed:colonies.find(c=>c.planetId===x.entityId)?.unemployed??null}));
 const construction=colonies.filter(x=>Number.isFinite(x.constructionCount)&&x.constructionCount>0);
 const housing=colonies.filter(x=>Number.isFinite(x.housing)&&x.housing<0);
 const amenities=colonies.filter(x=>Number.isFinite(x.amenities)&&x.amenities<0);
 const unemployed=colonies.filter(x=>Number.isFinite(x.unemployed)&&x.unemployed>0);
 const staffing=vacancies.filter(x=>x.unemployed===0);
 const incomeDelta=fresh&&Number.isFinite(current?.income)&&Number.isFinite(previous?.income)?round(current.income-previous.income):null;
 const expenseDelta=fresh&&Number.isFinite(current?.expense)&&Number.isFinite(previous?.expense)?round(current.expense-previous.expense):null;
 const netDelta=fresh&&Number.isFinite(current?.net)&&Number.isFinite(previous?.net)?round(current.net-previous.net):null;
 const maintenanceDrag=fresh&&incomeDelta!==null&&incomeDelta>0&&expenseDelta!==null&&expenseDelta>=incomeDelta&&netDelta!==null&&netDelta<=0;
 const maintenancePressure=fresh&&current?.income>0&&Number.isFinite(current?.expense)&&current.expense/current.income>=.5;
 const deficits=fresh?Object.entries(state.resources??{}).filter(([key,x])=>['energy','minerals','food','consumer_goods','alloys',targetResource].includes(key)&&
  x?.net_known!==false&&Number.isFinite(x?.net)&&x.net<0).map(([resource,x])=>({resource,net:round(x.net),
   monthsToEmpty:x.stockpile_known!==false&&Number.isFinite(x.stockpile)?round(Math.max(0,x.stockpile)/-x.net):null})):[];
 const bottlenecks=[],recommendations=[];
 const add=(kind,rows,action,reason,extra={})=>{
  const planetIds=[...new Set(rows.map(x=>x.planetId).filter(validId))];
  bottlenecks.push({kind,planetIds,...extra});
  recommendations.push({kind,targetResource,planetIds,action,reason,scope:'support_primary_objective',...extra});
 };
 if(!fresh||!Number.isFinite(current?.net))add('unknown',[],'refresh_economy','先读取本轮完整目标收支；未知净产不能证明改善');
 if(housing.length)add('housing',housing,'repair_housing','先由原生建设修复已确认的负住房，核验合法住房候选与维护，再增加目标岗位');
 if(amenities.length)add('amenities',amenities,'repair_amenities','先核对舒适岗位填充与真实缺口，由原生修复舒适度，避免重复增加空岗位');
 if(vacancies.length)add('vacancies',vacancies,'fill_existing_jobs','已有已核实的空岗容量；先查目标岗位的劳动力、限额与优先状态，由原生优先填现有岗位，暂不盲加同类容量',
  {vacantWorkforce:round(vacancies.reduce((n,x)=>n+x.amount,0))});
 if(staffing.length)add('workforce',staffing,'wait_for_workforce','空岗所在殖民地已确认无失业人口；先等待人口与劳动力到岗，并核查增长、迁入和岗位资格');
 else if(unemployed.length&&!vacancies.length)add('workforce',unemployed,'inspect_jobs','存在失业但岗位容量尚未核实；先读取完整岗位，不能据岗位类别数推算空岗');
 if(maintenanceDrag||maintenancePressure)add('maintenance',[],'review_maintenance',maintenanceDrag?
  '总收入增加但新增维护吞掉收益；复查目标资源的法令、领袖与殖民地维护，只在真实停用投影和保供检查通过后减支':
  '维护占目标资源总收入较高；核查维护构成及实际净收益，未知停用影响时保留保供措施',
  {incomeDelta,expenseDelta,confirmedDrag:maintenanceDrag});
 if(deficits.length)add('resource_deficit',[],'repair_resource_deficit','只为已确认的实际赤字保供并预留维护，保留当前主目标；不增加其他资源的任意盈余目标',{deficits});
 if(construction.length)add('construction',construction,'verify_target_construction','已观察到施工；核对是否服务当前目标、队列是否推进及完工后的真实岗位与净贡献，不能把入队当产出');
 if(!colonies.length)add('unknown',[],'inspect_colonies','本轮缺少有效殖民地审计；只读检查目标殖民地施工、住房与劳动力，不能把缺数据当没有瓶颈');
 else if(!construction.length&&!vacancies.length&&!housing.length&&!amenities.length&&!unemployed.length)
  add('capacity',colonies,'verify_target_capacity','先核验目标岗位是否满员及真实合法的特区、建筑或升级候选；确有容量瓶颈才由原生增加目标产能');

 // Evidence counts/category lists are not stable construction identities. Do
 // not restart a grace period when a queue count or audit timestamp changes.
 const priorSince=value=>Number.isFinite(value)&&currentDay!==null&&value<=currentDay?value:null;
 // Missing/partial audit is not a proof that a project disappeared. Keep the
 // clock until real goal progress, so cache expiry/repeated plans cannot renew it.
 const tracking={constructionSince:priorSince(memory.constructionSince),workforceSince:priorSince(memory.workforceSince)};
 if(fresh&&construction.length)tracking.constructionSince??=currentDay;
 // New capacity may only need staff after construction finishes; do not spend
 // its staffing grace during the preceding construction phase.
 if(fresh&&staffing.length&&!construction.length)tracking.workforceSince??=currentDay;
 const maxWaitDay=Number.isFinite(lastProgressDay)?lastProgressDay+constructionGrace+staffingGrace:null;
 let wait=null;
 const canWait=fresh&&Number.isFinite(current?.net)&&!housing.length&&!amenities.length&&!maintenanceDrag;
 const boundedWait=(kind,since,grace)=>{
  if(!canWait||!Number.isFinite(since)||currentDay===null||!Number.isFinite(maxWaitDay))return null;
  const untilDay=Math.min(since+grace,maxWaitDay);
  return currentDay<untilDay?{kind,untilDay,remainingDays:untilDay-currentDay,bounded:true,requiresTargetVerification:true}:null;
 };
 if(construction.length)wait=boundedWait('construction',tracking.constructionSince,constructionGrace);
 else if(staffing.length)wait=boundedWait('workforce',tracking.workforceSince,staffingGrace);
 const phase=!fresh||!Number.isFinite(current?.net)?'unknown':housing.length||amenities.length||maintenanceDrag?'repair':wait?.kind==='construction'?'building':
  wait?.kind==='workforce'?'staffing':vacancies.length||deficits.length||maintenancePressure?'repair':'review';
 return {feedback:{version:1,targetResource,phase,bottlenecks,recommendations,wait,
  evidence:{auditFresh,coloniesChecked:colonies.length,jobCapacityKnown:jobs.length>0,constructionPlanets:construction.map(x=>x.planetId),
   incomeDelta,expenseDelta,maintenanceDrag},
  completionRule:'施工、岗位容量、设置回执和等待均不代表主目标完成；继续核对实际净产与目标进度'},memory:tracking};
}
