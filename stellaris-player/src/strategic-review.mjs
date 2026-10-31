import {conquestReview} from './gestalt-campaign.mjs';
import {MARKET_MAINTENANCE} from './market-maintenance.mjs';
const numeric=Number.isFinite;
const core=['energy','food','consumer_goods','minerals','alloys'];
const names={energy:'能量币',food:'食物',consumer_goods:'消费品',minerals:'矿物',alloys:'合金',unity:'凝聚力'};
const scienceKeys=['physics_research','society_research','engineering_research'];
const gameDay=date=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(date||'');return m?Number(m[1])*360+(Number(m[2])-1)*30+Number(m[3])-1:null;};
const scienceOutput=state=>scienceKeys.every(k=>numeric(state.resources?.[k]?.net))?scienceKeys.reduce((sum,k)=>sum+state.resources[k].net,0):null;

// Bounded, local observations only: no fixed wall-clock waiting and no model
// calls. Year buckets prevent a busy observe loop from evicting long-run facts.
export function createGrowthTracker() {
  let samples=[],lastDay=null,identity;
  return {
    serialize(){return {version:1,samples:samples.map(x=>({...x})),lastDay,identity};},
    restore(saved,state){
      const current=gameDay(state?.date),who=JSON.stringify([state?.player?.country_id,state?.player?.capital_system_id]);
      if(saved?.version!==1||saved.identity!==who||!Number.isFinite(saved.lastDay)||current===null||current<saved.lastDay||!Array.isArray(saved.samples))return false;
      const clean=saved.samples.filter(x=>Number.isFinite(x?.day)&&x.day<=current&&Number.isInteger(x.year)&&x.year===Math.floor(x.day/360)&&Number.isFinite(x.science)&&x.science>=0).sort((a,b)=>a.day-b.day).slice(-24);
      samples=clean;lastDay=saved.lastDay;identity=who;return true;
    },
    record(state) {
      const day=gameDay(state.date),science=scienceOutput(state);
      if(day===null)return;
      const currentIdentity=JSON.stringify([state.player?.country_id,state.player?.capital_system_id]);
      if(lastDay!==null&&(day<lastDay||identity!==currentIdentity))samples=[];
      lastDay=day;identity=currentIdentity;
      if(science===null)return;
      const sample={day,year:Math.floor(day/360),science};
      if(samples.at(-1)?.year===sample.year)samples[samples.length-1]=sample;
      else samples.push(sample);
      if(samples.length>24)samples.splice(0,samples.length-24);
    },
    review(state) {
      const day=gameDay(state.date),science=scienceOutput(state);
      if(day===null||science===null)return {known:false,reason:'科研月产或游戏日期不完整'};
      const previous=samples.find(x=>day-x.day>=3600&&day-x.day<=7200&&x.science>0);
      if(!previous)return {known:false,reason:'尚无同局10至20年的可比科研样本'};
      const years=(day-previous.day)/360,percent=(science/previous.science-1)*100;
      return {known:true,observedYears:Math.round(years*10)/10,scienceGrowthPercent:Math.round(percent*10)/10,
        stagnating:percent<=10,note:'本机增长诊断启发式：同局10至20年科研月产增长不超过10%，不是年份达标要求'};
    }
  };
}

export function empireRoute(government={}) {
  if(government.authority==='auth_hive_mind')return 'hive';
  if(government.authority==='auth_machine_intelligence')return 'machine';
  if(['auth_democratic','auth_oligarchic','auth_dictatorial','auth_imperial','auth_corporate'].includes(government.authority))return 'regular';
  return 'unknown';
}

// Operational heuristics, not Stellaris rules: inspect the bottleneck before
// acquiring more obligations. No fixed empire-size cap or year-based build list.
export function strategicReview(state,{government={},colonies=[],growth={known:false}}={}) {
  const route=empireRoute(government),r=state.resources||{};
  const deficits=core.filter(k=>!(k==='consumer_goods'&&['hive','machine'].includes(route))).flatMap(key=>{
    const x=r[key];return numeric(x?.net)&&x.net<0&&numeric(x.stockpile)?[{resource:key,net:Math.round(x.net*10)/10,months:Math.round(Math.max(0,x.stockpile)/-x.net*10)/10}]:[];
  }).sort((a,b)=>a.months-b.months);
  const distressed=colonies.filter(x=>x.inhabited&&((numeric(x.stability)&&x.stability<50)||(numeric(x.amenities)&&x.amenities<0)||(numeric(x.housing)&&x.housing<0))).slice(0,3);
  const offensive=state.wars?.some(w=>w.player_side==='attacker')===true;
  const conquest=conquestReview(state,{route});
  const emergency=!!state.wars?.length||!!state.warGoalsWindow||!!state.pendingEvents?.length;
  const critical=deficits.some(x=>x.months<=12);
  // Multiple very long-reserve deficits alone are not an immediate crisis.
  const needsRepair=deficits.some(x=>x.months<=36)||distressed.length>0;
  const known=['energy','minerals','alloys'].every(k=>numeric(r[k]?.stockpile)&&numeric(r[k]?.net));
  const cappedSurpluses=core.filter(k=>!(k==='consumer_goods'&&['hive','machine'].includes(route))).filter(k=>{
    const x=r[k];return numeric(x?.net)&&x.net>0&&numeric(x.stockpile)&&(x.capped===true||numeric(x.max)&&x.max>0&&x.stockpile>=x.max*.95);
  });
  const growthBottleneck=known&&!emergency&&!critical&&!needsRepair&&(cappedSurpluses.length>=2||growth.known&&growth.stagnating);
  const mode=emergency?(offensive?'campaign':'defense'):critical?'stabilize':needsRepair?'consolidate':!known?'reconnaissance':growthBottleneck?'develop_capacity':'selective_growth';
  const priority=[];
  if(!emergency&&!critical&&known)priority.push(conquest.campaignPhase?'优先推进已保存的进攻战役；完成具体缺口后继续，不长期转回内政':'主动评估一个征服目标：inspect targets→核对收益/战力/合法战争条件→campaign select保存目标和备战；内政小赤字或普通扩张暂缓不取消本项');
  if(emergency)priority.push(offensive?'持续推进当前进攻战役：核对敌我战力、轨道控制、运输军、占领与议和；不因已宣战就回到长期内政':'处理当前事件与防务，核对敌我战力和撤退路线');
  const repairDeficits=deficits.filter(x=>x.months<=36);
  if(repairDeficits.length)priority.push(`先查${repairDeficits.slice(0,2).map(x=>`${names[x.resource]}约${x.months}月余量`).join('、')}：岗位填充→专精/特区→队列→新增产能`);
  if(distressed.length)priority.push(`复查${distressed.map(x=>x.name).join('、')}：舒适度、住房与稳定度，避免盲建执法岗位`);
  const naval=state.capacities?.naval_capacity;
  if(numeric(naval?.used)&&numeric(naval?.capacity)&&naval.capacity>0&&naval.used>naval.capacity)priority.push(`海军${naval.used}/${naval.capacity}，控制维护费并补后勤，不继续和平超编`);
  if(r.unity?.net<0)priority.push('查凝聚力岗位与维护，兼顾传统推进');
  const idle=['physics','society','engineering'].filter(k=>state.research?.[k]?.current?.is_researching===false);
  if(idle.length)priority.push(`补上空闲科研：${idle.join('/')}`);
  if(growthBottleneck)priority.push(`${cappedSurpluses.length>=2?'多项正收益资源接近满仓':'同局科研月产长期增长缓慢'}：先核验科研/凝聚力岗位容量、劳动力、特区与升级条件，说明新增产能和可执行动作，不为腾仓盲建`);
  const upgradeColonies=colonies.filter(x=>x.inhabited&&x.capitalUpgradeAvailable).slice(0,3);
  const upgradeSupported=state.capabilities?.availableActions?.includes('upgrade_building')===true;
  if(upgradeColonies.length)priority.push(`${upgradeColonies.map(x=>x.name).join('、')}有首府升级提示；${upgradeSupported?'inspect upgrades核验当前建筑、唯一升级路径、费用和合法性，预算允许再升级，回读队列及最终建筑确认':'当前未提供首府/建筑升级动作，标记能力受限'}，不反复加城市区划声称解锁`);
  if(!repairDeficits.length&&deficits.length)priority.push(`监测${deficits.slice(0,2).map(x=>`${names[x.resource]}约${x.months}月余量`).join('、')}，保留预算并规划修复；长期小赤字不自动压过产能增长`);
  if(!priority.length)priority.push(known?'保护三线科研与工业储备，比较边境收益后选择少量高价值目标':'先读取完整资源与政府路线，不能把未知当成经济健康');
  const ordinaryExpansionAllowed=mode==='selective_growth'||mode==='develop_capacity';
  const focus={campaign:'持续推进进攻、占领与战争结果',defense:'防务与事件优先',stabilize:'保住经济，暂停普通扩张',consolidate:'消化疆域，修复内政',develop_capacity:'解除产能瓶颈，把储备转成有效增长',selective_growth:'有预算地选择扩张',reconnaissance:'补齐关键情报'}[mode];
  return {version:3,route,mode,focus,conquest,ordinaryExpansionAllowed,deficits: deficits.slice(0,5),priorities:priority.slice(0,3),
    growth:{...growth,bottleneck:growthBottleneck,cappedSurpluses},
    marketPolicy:{mode:emergency?(offensive?'support_campaign':'support_defense'):critical?'rescue_shortage':known?'bounded_maintenance':'verify_first',sizing:MARKET_MAINTENANCE,
      note:'非紧急市场维护不能连续占用经营回合。完成一笔后轮巡一个实际可推进的非市场目标；库存余量超过36个月的赤字不反复补货。无合法动作则watch，不为凑轮巡强行下单。',
      reviewAcrossTurns:['research','traditions','ascension','government','fleets','expansion'],
      preserveGuards:'紧急资源、事件和防务优先，所有交易仍按实时整笔报价及储备/容量检查；不禁止必要交易。'},
    capabilityGaps:[...(!upgradeSupported?['首府/建筑升级']:[]),'已有特区或星球专精切换','星基升级与模块','国民理念改革'],
    resumeWhen:ordinaryExpansionAllowed?'经济与殖民地稳定，目标合法且有边境/资源/宜居收益才扩张':'关键赤字和殖民地问题改善后重评；已开工项目、修复和防守继续',
    empireSize:numeric(state.capacities?.empire_size)?state.capacities.empire_size:undefined,
    note:'本机启发式；规模不是硬上限。可执行能力以当前工具与引擎候选为准，缺失信息先查，不猜。'};
}

export function expansionProblem(state,options={}) {
  const review=strategicReview(state,options);
  return review.ordinaryExpansionAllowed?null:`${review.focus}：${review.priorities.join('；')}。${review.resumeWhen}`;
}

export function colonyReview(planet) {
  const k=planet?.kpi||{};
  return {planetId:planet.planet_id,name:typeof planet.name==='string'?planet.name.slice(0,40):String(planet.planet_id),inhabited:k.pop_groups>0,
    stability:numeric(k.stability_percent)?k.stability_percent:undefined,amenities:numeric(k.amenities)?k.amenities:undefined,housing:numeric(k.housing)?k.housing:undefined,
    capitalUpgradeAvailable:Array.isArray(planet.status_alerts)&&planet.status_alerts.some(x=>x.id==='upgrade_available'&&/首府/.test(x.desc||x.name||''))};
}

export function expansionCandidates(result,review) {
  const out={...result,strategy:{mode:review.mode,focus:review.focus,ordinaryExpansionAllowed:review.ordinaryExpansionAllowed,resumeWhen:review.resumeWhen}};
  if(result.purpose==='outpost')out.systems=(result.systems||[]).filter(x=>x.can_build===true&&x.surveyed===true&&x.borders_own_space===true).sort((a,b)=>(a.jumps??Infinity)-(b.jumps??Infinity)).slice(0,8);
  if(result.purpose==='colonizable')out.planets=(result.planets||[]).filter(x=>x.can_colonize===true&&x.system_owned===true&&numeric(x.habitability_percent)&&x.habitability_percent>=40).sort((a,b)=>b.habitability_percent-a.habitability_percent||(a.jumps??Infinity)-(b.jumps??Infinity)).slice(0,8);
  if(!review.ordinaryExpansionAllowed&&['outpost','colonizable'].includes(result.purpose)){out.deferredCount=out.systems?.length??out.planets?.length??0;if(out.systems)out.systems=[];if(out.planets)out.planets=[];}
  out.strategy.targetRule='相邻合法只是门槛；先查system/map确认瓶颈、资源或宜居收益，预算与防守可承受才选。红色宜居不殖民，黄色须比较维护与人口成本。';
  if(['outpost','colonizable'].includes(result.purpose)&&!(out.systems?.length||out.planets?.length))out.nextReview='本次无可执行目标，不等于整张地图没有目标；先区分所有权、可达性、宜居度、科技与候选覆盖。相关边界、路线、科技、所有权或目标条件变化后再查，否则转做有效内政、科研和防务；不能以船闲置为由反复查同一清单。';
  return out;
}
