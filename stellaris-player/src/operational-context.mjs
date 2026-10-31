// Allowlisted game facts only. A context instance belongs to one NativeGame session.
const text=(x,n=70)=>typeof x==='string'?x.replace(/[\r\n]+/g,' ').slice(0,n):'';
const number=x=>Number.isFinite(x)?Math.round(x*10)/10:undefined;
const id=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const title=x=>text(x?.name||x?.title||x?.key);
const limited=(a,n=4)=>Array.isArray(a)?a.slice(0,n):[];

export function executionCapabilities(actions=[]) {
  const availableActions=[...new Set(actions.filter(x=>typeof x==='string'))].sort();
  const unavailable=[['upgrade_building','首府及建筑升级'],['set_designation','星球专精切换'],['upgrade_starbase','星基升级及模块建设'],['reform_government','国民理念改革'],['assign_governor','总督派驻']];
  return {version:1,availableActions,limitations:unavailable.filter(([key])=>!availableActions.includes(key)).map(([,label])=>`${label}尚无执行接口；列为能力受限，不承诺已经操作`)};
}

export function summarizeOperationalFacts(topic,r) {
  if(!r||typeof r!=='object'||r.success===false)return '';
  if(topic==='planet') {
    const net=r.monthly_production?.net||{}, k=r.kpi||{};
    return [`星球${title(r)||r.planet_id}；专精${text(r.designation)||'未知'}`,
      `稳定度${number(k.stability_percent)??'未知'}；住房${number(k.housing)??'未知'}；失业${number(k.unemployed)??'未知'}`,
      `状态提示：${limited(r.status_alerts,3).map(title).join('、')||'未列出'}`,
      `月净产：${Object.entries(net).filter(([key])=>['consumer_goods','alloys','unity','physics_research','society_research','engineering_research'].includes(key)).slice(0,6).map(([key,value])=>`${key}=${number(value)??'未知'}`).join('，')}`,
      `施工队列${Array.isArray(r.construction_queue)?r.construction_queue.length:'未知'}项；详情中的空建筑数组不证明空槽，须核对buildings候选`].join('；');
  }
  if(topic==='buildings')return `星球${r.planet_id}建筑候选：`+limited(r.zones,4).map(z=>`${text(z.zone_name||z.zone)}(zone_id=${z.zone_id}) ${number(z.buildings)??'未知'}/${number(z.max_buildings)??'未知'}；可建${limited(z.buildable,3).map(title).join('、')||'未列出（不猜空槽或解锁条件）'}`).join('；');
  if(topic==='jobs')return `星球${r.planet_id}岗位：`+limited(r.strata,4).flatMap(s=>limited(s.jobs,6)).filter(j=>['artisan','physicist','biologist','engineer','foundry','bureaucrat'].includes(j.job_key)).slice(0,7).map(j=>`${text(j.job_key)} ${number(j.current_workforce)??'未知'}/${number(j.max_workforce)??'未知'}，${j.is_prioritized===true?'已优先':j.is_prioritized===false?'未优先':'优先状态未知'}`).join('；')+'；满员岗位再优先不会增加容量';
  if(topic==='government')return `政体${text(r.authority_name||r.authority)||'未知'}；国民理念${limited(r.civics,4).map(title).join('、')||'未知'}；内阁议程${title(r.agenda)||'未列出'}；可用候选${limited(r.available_agendas,3).map(title).join('、')||'未列出（不等于已证明无议程）'}`;
  if(topic==='research')return ['physics','society','engineering'].map(key=>`${key}：${title(r[key]?.current)||'当前项目未提供'}；候选${limited(r[key]?.candidates,3).map(title).join('、')||'未列出'}`).join('；');
  if(topic==='zones')return `星球${r.planet_id}特区：`+limited(r.districts,4).map(d=>`${text(d.district_name)}；`+limited(d.slots,4).map(s=>`${s.slot}：${text(s.zone_name||s.zone)||'空槽'}，可建${limited(s.buildable_zones,3).map(title).join('、')||'未列出'}`).join('；')).join('；');
  if(topic==='upgrades')return Array.isArray(r.candidates)?`星球${r.planet_id}建筑升级候选：`+(limited(r.candidates,6).map(c=>`${text(c.current_key||c.building_key)}→${text(c.upgrade_key)}，${c.can_upgrade===true?'当前可升级':'受限：'+(text(c.reason)||'条件未满足')}`).join('；')||'本次无合法候选，不能据此断定未来不能升级'):'';
  if(topic==='traditions'||topic==='ascension') {
    const trees=r.trees||r.tradition_trees||r.adopted_trees;
    const perks=r.ascension_perks?.adopted||r.ascension_perks||r.perks||r.adopted_perks;
    return `传统树${limited(trees,5).map(x=>typeof x==='string'?text(x):title(x)).join('、')||'本次接口未提供明细'}；飞升${limited(perks,5).map(x=>typeof x==='string'?text(x):title(x)).join('、')||'本次接口未提供明细'}；已解锁传统${number(r.summary?.unlocked_traditions_count??r.unlocked_traditions_count)??'未知'}；合法候选${limited(r.candidates,3).map(title).join('、')||'未列出'}`;
  }
  if(topic==='attack_options')return `国家${r.country_id}当前战争目标：${r.coverageKnown===true?'合法'+((r.legalGoals??r.options?.filter(o=>o.legal===true).map(o=>o.goal_key))?.join('、')||'未列出'):'覆盖未知'}；`+(r.options?.find(o=>o.goal_key==='wg_conquest')?.reason?`征服条件：${text(r.options.find(o=>o.goal_key==='wg_conquest').reason,300)}`:'宣称和战争条件需按引擎核对')+'；候选仅是观察，宣战执行仍重新检查';
  if(topic==='military')return `海军${number(r.empire_naval_capacity?.used)??'未知'}/${number(r.empire_naval_capacity?.capacity)??'未知'}；`+limited(r.fleets,3).map(f=>`${title(f)}：战力${number(f.military_power)??'未知'}，实际占用${number(f.capacity_check?.actual_naval_size)??'未知'}，增援占用${number(f.capacity_check?.reinforcement_naval_size)??'未知'}，指挥上限${number(f.command_limit)??'未知'}`).join('；');
  return '';
}

export class OperationalContext {
  constructor({now=Date.now,ttlMs=60000,maxEntries=10,maxChars=3200}={}) {Object.assign(this,{now,ttlMs,maxEntries,maxChars});this.entries=new Map();}
  record(topic,result,{gameDate}={}) {
    const facts=summarizeOperationalFacts(topic,result);if(!facts)return;
    const entityId=id(result.planet_id)?result.planet_id:undefined,countryId=id(result.country_id)?result.country_id:undefined,key=`${topic}:${entityId??countryId??''}`;
    const basis=topic==='military'?{navalUsed:number(result.empire_naval_capacity?.used),navalCapacity:number(result.empire_naval_capacity?.capacity)}:undefined;
    this.entries.delete(key);this.entries.set(key,{topic,...(entityId===undefined?{}:{entityId}),...(countryId===undefined?{}:{countryId}),observedAt:this.now(),...(text(gameDate,20)?{gameDate:text(gameDate,20)}:{}),...(basis?{basis}:{}),facts:facts.slice(0,600)});
    while(this.entries.size>this.maxEntries)this.entries.delete(this.entries.keys().next().value);
  }
  view({ownedPlanetIds}={}) {
    const own=Array.isArray(ownedPlanetIds)?new Set(ownedPlanetIds):null, result=[];let chars=0;
    for(const [key,row]of [...this.entries].reverse()) {
      const age=this.now()-row.observedAt;
      if(age>this.ttlMs||age<0){this.entries.delete(key);continue;}
      if(own&&row.entityId!==undefined&&!own.has(row.entityId))continue;
      if(chars+row.facts.length>this.maxChars)continue;
      result.push({...row});chars+=row.facts.length;
    }
    return result;
  }
}
