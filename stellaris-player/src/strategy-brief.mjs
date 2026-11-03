import {empireRoute,strategicReview} from './strategic-review.mjs';
import {surveyGameDay} from './survey-idle-policy.mjs';

const UNKNOWN='未知';
const SCIENCE=['physics_research','society_research','engineering_research'];
const RESOURCES=['alloys','energy','minerals','unity'];
const MAX_NEIGHBORS=12;
export const STRATEGY_BRIEF_MAX_BYTES=3500;

const regular={
  economyFocus:{
    balanced:'沿用原版经济计划',
    unity_traditions:'提高凝聚力产出优先级，增加传统凝聚力预算和星球建设矿物预算',
    consumer_stability:'优先消费品与凝聚力，增加星球建设矿物预算',
    alloys_military:'优先合金产出，增加星球建设矿物预算',
    research:'优先三线科研，增加星球建设矿物预算',
  },
  expansionStance:{
    aggressive:'提高殖民计划的合金预算和前哨的影响力预算；无殖民计划时额外提高前哨合金预算',
    consolidate:'增加星球建设矿物预算',
  },
  militaryStance:{
    peaceful:'增加星球建设矿物预算',
    prepare_war:'提高造舰和舰船升级的合金预算权重',
  },
};
const gestalt={...regular,economyFocus:{...regular.economyFocus,
  consumer_stability:'实际效果：凝聚力优先（本帝国不用消费品），增加星球建设矿物预算'}};
export const STEERING_EFFECTS={
  regular,hive:gestalt,machine:gestalt,
  unknown:{...regular,economyFocus:{...regular.economyFocus,
    consumer_stability:'优先凝聚力，非格式塔额外优先消费品；增加星球建设矿物预算'}},
};

const number=value=>Number.isFinite(value)?value:null;
const count=value=>Number.isFinite(value)&&value>=0?value:null;
const net=resource=>resource?.net_known===false?null:number(resource?.net);
const stockpile=resource=>resource?.stockpile_known===false?null:count(resource?.stockpile);

export function extractStrategyMetrics(state={}){
  const science=SCIENCE.map(key=>net(state.resources?.[key]));
  const fleets=state.military?.fleets;
  const power=Array.isArray(fleets)&&fleets.every(fleet=>count(fleet?.military_power)!==null)
    ?number(fleets.reduce((sum,fleet)=>sum+fleet.military_power,0)):null;
  const naval=state.capacities?.naval_capacity;
  // The current bridge reports a default zero pair when its capacity read fails.
  const capacity=Number.isFinite(naval?.capacity)&&naval.capacity>0?naval.capacity:null;
  const used=capacity===null?null:count(naval.used);
  const metrics={
    pops:count(state.population),colonies:count(state.colonyCount),systems:count(state.player?.owned_systems),
    research_monthly:science.every(value=>value!==null)?number(science.reduce((sum,value)=>sum+value,0)):null,
    fleet_power:power,naval_used:used,naval_capacity:capacity,
    naval_used_ratio:used===null?null:number(used/capacity),
  };
  for(const key of RESOURCES){
    const resource=state.resources?.[key];
    const monthly=net(resource);
    const stock=stockpile(resource);
    metrics[key+'_monthly']=monthly;
    metrics[key+'_reserve_months']=stock!==null&&monthly<0?number(stock/-monthly):null;
  }
  return metrics;
}

export function evaluateStrategyGoals(goals,metrics,date){
  const today=surveyGameDay(date);
  return (goals??[]).map(({metric,target,byDate})=>{
    const current=number(metrics?.[metric]);
    const deadline=surveyGameDay(byDate);
    const progress=current===null?null:target>0?number(current/target):Number(current>=target);
    const status=current===null?'unknown':current>=target?'achieved':
      today!==null&&deadline!==null&&today>deadline?'overdue':progress>=.8?'near':'pending';
    return {metric,target,byDate,current,progress,status};
  });
}

const countryId=value=>Number.isSafeInteger(value)&&value>=0&&value<0xffffffff;
const cleanText=(value,max=24)=>typeof value==='string'&&value.trim()
  ?Array.from(value.replace(/\s+/gu,' ').trim()).slice(0,max).join(''):UNKNOWN;
const knownBool=value=>typeof value==='boolean'?value:UNKNOWN;
const knownText=value=>Number.isFinite(value)?value:cleanText(value);

function observedBorders(map,own){
  const border=new Set();
  if(!Array.isArray(map?.columns)||!Array.isArray(map.rows)||!Array.isArray(map.hyperlanes))return border;
  const idColumn=map.columns.indexOf('id'),ownerColumn=map.columns.indexOf('owner_id');
  if(idColumn<0||ownerColumn<0)return border;
  const owners=new Map(map.rows.filter(row=>Array.isArray(row)&&countryId(row[idColumn])&&countryId(row[ownerColumn]))
    .map(row=>[row[idColumn],row[ownerColumn]]));
  for(const edge of map.hyperlanes){
    if(!Array.isArray(edge))continue;
    const a=owners.get(edge[0]),b=owners.get(edge[1]);
    if(a===own&&countryId(b)&&b!==own)border.add(b);
    if(b===own&&countryId(a)&&a!==own)border.add(a);
  }
  return border;
}

function primaryEnemies(state){
  const own=state.player?.country_id;
  const opponents=new Set();
  for(const war of Array.isArray(state.wars)?state.wars:[]){
    if(war.primary_attacker_id===own&&countryId(war.primary_defender_id))opponents.add(war.primary_defender_id);
    if(war.primary_defender_id===own&&countryId(war.primary_attacker_id))opponents.add(war.primary_attacker_id);
  }
  return opponents;
}

function declarationStatus(data,id){
  if(data?.country_id!==id||!Array.isArray(data.options)||!data.options.length)return UNKNOWN;
  if(data.options.some(option=>option?.legal===true))return true;
  return data.options.every(option=>option?.legal===false)?false:UNKNOWN;
}

export async function readStrategyNeighbors(state,read){
  const contacts=await read('get_contacts',{mode:'empires'});
  if(!Array.isArray(contacts?.empires))return null;
  const own=state.player?.country_id;
  const known=[...new Map(contacts.empires.filter(row=>row?.has_communications===true&&countryId(row.country_id)&&row.country_id!==own)
    .map(row=>[row.country_id,row])).values()];
  if(!known.length)return {rows:[],omitted:0};
  const map=await read('get_galaxy_map',{center_system_id:state.player?.capital_system_id,jumps:12});
  const borders=observedBorders(map,own);
  const enemies=primaryEnemies(state);
  const contract=state.strategyContract;
  const priority=id=>Number(enemies.has(id))*4+Number(id===contract?.warTarget?.countryId||id===contract?.expansionDirection?.towardCountryId)*2+Number(borders.has(id));
  known.sort((a,b)=>priority(b.country_id)-priority(a.country_id)||a.country_id-b.country_id);
  const rows=[];
  for(const contact of known.slice(0,MAX_NEIGHBORS)){
    const id=contact.country_id;
    const options=await read('get_attack_options',{country_id:id});
    // The local map and primary-war list can confirm positives only.
    rows.push([id,cleanText(contact.name,32),knownText(contact.relative_power),knownText(contact.attitude),
      borders.has(id)?true:knownBool(contact.borders_own_space),
      enemies.has(id)?true:knownBool(contact.at_war),declarationStatus(options,id)]);
  }
  return {rows,omitted:known.length-rows.length};
}

const showNumber=value=>Number.isFinite(value)?Number(value.toPrecision(6)):UNKNOWN;
const governmentNames=rows=>Array.isArray(rows)?rows.slice(0,4).map(row=>cleanText(row?.name||row?.key)):UNKNOWN;

export function strategyBrief(state,{government,previousMetrics,neighbors,phase}={}){
  const resources=Object.fromEntries(Object.entries(state.resources??{}).map(([key,resource])=>
    [key,{...resource,net:net(resource),stockpile:stockpile(resource)}]));
  const type=empireRoute(government);
  const metrics=extractStrategyMetrics(state);
  const brief={
    empire:{type:{regular:'普通',hive:'蜂巢',machine:'机械',unknown:UNKNOWN}[type],
      ethics:governmentNames(government?.ethics),civics:governmentNames(government?.civics),
      phase:phase??strategicReview({...state,resources},{government}).focus},
    metrics:Object.fromEntries(Object.entries(metrics).map(([key,value])=>{
      const previous=number(previousMetrics?.[key]);
      const resource=key.endsWith('_reserve_months')?key.split('_')[0]:null;
      const monthly=resource&&metrics[resource+'_monthly'];
      const noDrain=resource&&monthly!==null&&monthly>=0&&stockpile(state.resources?.[resource])!==null;
      return [key,{current:noDrain?'无净消耗':showNumber(value),
        change:value===null||previous===null?UNKNOWN:showNumber(value-previous)}];
    })),
    previousGoals:evaluateStrategyGoals(state.strategyContract?.goals,metrics,state.date).slice(0,3)
      .map(goal=>({...goal,current:showNumber(goal.current),progress:showNumber(goal.progress)})),
    ...(state.strategyContract?.expansionDirection?{expansionDirection:state.strategyContract.expansionDirection}:{}),
    ...(state.strategyContract?.warTarget?{warTarget:state.strategyContract.warTarget}:{}),
    neighborColumns:['国家ID','帝国','相对实力','态度','接壤','交战','可宣战'],
    neighbors:neighbors?.rows.slice()??UNKNOWN,
    omittedNeighbors:neighbors?.omitted??UNKNOWN,
    steeringEffects:STEERING_EFFECTS[type],
  };
  if(Array.isArray(brief.neighbors)){
    while(brief.neighbors.length&&Buffer.byteLength(JSON.stringify(brief))>STRATEGY_BRIEF_MAX_BYTES){
      brief.neighbors.pop();
      brief.omittedNeighbors++;
    }
  }
  return brief;
}
