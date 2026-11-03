import {surveySummary} from './survey-summary.mjs';
import {executionStatus} from './execution-status.mjs';
import {strategyGoalLabel,strategyGoalStatus,strategyGoalValue} from './native-country-ai-summary.mjs';
// Audience-facing summaries only. Never consume DSH text/thinking messages.
const labels={observe:'看局势',inspect:'看局势',apply_orders:'正在操作',watch:'等待结果',survey_control:'分配调查工作',strategy_contract:'战略复查'};
const fallback={
  set_district_zone:'我先补上工业，军舰也得有稳定的后勤。',
  set_job_priority:'先把人手安排到最缺的岗位，别让关键生产断掉。',
  merge_fleets:'几支小舰队太散了，我先合起来，方便一起行动。',
  move_fleet:'我先把舰队调到需要的位置，到了再看下一步。',
  follow_fleet:'这次先集中力量，别一支一支地过去。',
  reinforce_fleet:'这支舰队有缺口，我先安排补员。',upgrade_fleet:'先把旧舰升级一下，再去应对接下来的战斗。',
  build_ship:'我先把这批舰船排进船坞，慢慢补上需要的力量。',
  increase_fleet_quota:'我给这支舰队补一份合适的编制，接着安排增援。',
  decrease_fleet_quota:'这份编制需要调整，我先让它符合当前的指挥能力。',
  select_research:'科研不能空着，我把下一项研究接上。',
  survey:'这边还没调查清楚，我让科研船继续探路。',
  build_stations:'这些星系还能产出资源，我把空间站补起来。',
  build_outpost:'这片地方值得拿下，我先安排建前哨站。',
  colonize:'殖民船准备好了，接下来发展新的家园。',
  build_district:'这里还需要发展，我先安排新的区划。',build_building:'我先把需要的建筑排进施工队列。',
  adopt_tradition:'凝聚力够了，我先点一项对眼前有帮助的传统。',
  adopt_ascension_perk:'飞升机会到了，我给帝国补一项长期优势。',
  open_war_goals:'对方宣战了，我先把这场战争的目标定下来。',
  set_defender_war_goal:'战争目标就按这个来，接下来守好自己的家。',
  resolve_event:'先处理眼前这件事，再接着经营。',
  diplomacy:'我先和对方谈一谈，看看这次外交能不能推进。',
  respond_diplomacy:'外交提议到了，我先回应这件事。',
  assign_councilor:'这个内阁席位需要有人负责，我先安排合适的领袖。',
  hire_leader:'先请一位合适的领袖，让需要负责的工作有人接手。',
  assign_scientist:'我给科研船安排科学官，接着继续调查。',
  set_council_agenda:'先安排一项适合当前局面的议程。',
};
export function publicSummary(value) {
  if(typeof value!=='string') return '';
  const text=value.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
  // Explanations are explicitly written for the audience. Reject accidental
  // credentials, paths, raw arguments and long/English model monologues.
  if(!text || text.length>100 || !/[\u3400-\u9fff]/.test(text) || /sk-[a-z0-9]{8,}|[A-Z]:[\\/]|[{}]|\b\w+_id\b|\d{7,}|snapshotId|requestId|tool_call|actual_naval_size|template_size|command_limit|capacity_check|chain.of.thought|思维链|内部推理/i.test(text)) return '';
  return text.slice(0,70);
}

const gameDate=value=>typeof value==='string'&&/^\d{4}\.\d{2}\.\d{2}$/.test(value)?value:null;

function strategyGoalsText(goals,previous){
  if(!Array.isArray(goals))return '';
  return goals.slice(0,3).flatMap(goal=>{
    const label=strategyGoalLabel(goal?.metric);
    if(!label||!Number.isFinite(goal.target))return [];
    const target=strategyGoalValue(goal.metric,goal.target),current=strategyGoalValue(goal.metric,goal.current);
    const deadline=gameDate(goal.byDate);
    return previous
      ?[label+current+'/'+target+'（'+strategyGoalStatus(Number.isFinite(goal.current)?goal.status:'unknown')+'）']
      :[label+target+'（当前'+current+(deadline?'，'+deadline+'前':'')+'）'];
  }).join('、');
}

function publicEmpireName(value){
  if(typeof value!=='string')return '';
  const name=value.replace(/\s+/gu,' ').trim();
  return name!=='未知'&&/^[\p{L}\p{N} ·'’().-]{1,32}$/u.test(name)&&!/sk-[a-z0-9]{8,}|\d{7,}/i.test(name)?name:'';
}

const relativePower={
  pathetic:'ahead',inferior:'ahead',equivalent:'equal',superior:'behind',overwhelming:'behind',
  '不堪一击':'ahead','低于我方':'ahead','势均力敌':'equal','高于我方':'behind','压倒性':'behind',
};

function strategyReviewText(row){
  const previous=strategyGoalsText(row.previousGoals,true),goals=strategyGoalsText(row.goals,false);
  const neighbors=Array.isArray(row.neighbors)?row.neighbors.slice(0,12).filter(Array.isArray):[];
  const names={};
  for(const [,label,power,,border] of neighbors){
    if(typeof power!=='string')continue;
    const key=power.trim().toLowerCase().replace(/^(?:relative_)?power_/,'');
    const result=Object.hasOwn(relativePower,key)?relativePower[key]:null;
    const name=publicEmpireName(label);
    if(result&&name&&(!names[result]||border===true))names[result]=name;
  }
  const comparison=[names.ahead&&'强于'+names.ahead,names.behind&&'弱于'+names.behind,names.equal&&'与'+names.equal+'相当'].filter(Boolean).join('，');
  const direction=publicEmpireName(neighbors.find(([id])=>id===row.expansionDirection?.towardCountryId)?.[1]);
  const target=publicEmpireName(neighbors.find(([id])=>id===row.warTarget?.countryId)?.[1]);
  const reason=publicSummary(row.reason);
  return [previous?'上次目标 '+previous:'上次目标尚无可比较记录',
    comparison?'已知帝国实力对比，'+comparison:'已知帝国实力暂时无法比较',
    goals?'当前目标 '+goals:'当前尚未设定目标',
    row.expansionDirection?(direction?'向'+direction+'方向扩张':'扩张方向的帝国名称未知'):'',
    row.warTarget?(target?'备战对象是'+target:'备战对象的帝国名称未知'):'',
    reason&&!/https?:\/\/|www\.|[<>]/i.test(reason)?reason:'',
  ].filter(Boolean).join('。')+'。';
}

export function planCaption(row) {
  if(row.type==='strategy_review')return {kind:'plan',phase:'战略复查',text:strategyReviewText(row),priority:1};
  const orders=row.orders||[];
  const command=orders.find(o=>!['set_speed','open_alert','open_notification','close_war_goals','set_fleet_stance'].includes(o.command));
  if(!command) return null;
  let text=publicSummary(row.explanation)||fallback[command.command];
  if(command.command==='market_trade') text=publicSummary(row.explanation)||(command.arguments.action==='buy'?'我先买一点紧缺物资，让建设和造舰继续。':'这份资源有富余，我卖出一些，给其他事情腾预算。');
  return text?{kind:'plan',phase:'正在操作',text,priority:['open_war_goals','set_defender_war_goal'].includes(command.command)?2:1}:null;
}
// Only the short, audience-facing intent summary enters the on-screen history.
export function planHistoryItem(row,date) {
  const message=planCaption(row),at=Date.parse(row.at);
  if(!message||!Number.isFinite(at))return null;
  return {id:`plan:${row.at}:${message.text}`,at,kind:'plan',text:message.text,
    date:gameDate(row.type==='strategy_review'?row.date:date)};
}
export function receiptCaption(row) {
  if(row.type==='survey_control'){
    const control=row.control;
    if(control?.pending||control?.owner==='unknown')return {kind:'result',phase:'核对控制权',text:'调查任务的控制权还没确认，我先核对清楚。',priority:1,speak:false};
    if(control?.owner==='native')return {kind:'result',phase:'自动调查已委派',text:'例行调查已经交给自动执行，我继续处理其他事情。',priority:0,speak:false};
    if(control?.owner==='manual')return {kind:'result',phase:'已收回调查控制',text:'科研船的控制权已收回，接下来由我安排。',priority:0,speak:false};
    return null;
  }
  if(row.type==='rejected' || row.type==='unknown' || row.response?.success===false)
    return {kind:'result',phase:row.type==='unknown'?'核对结果':'重新确认',text:row.type==='unknown'?'这次操作的结果还不明确，我先核对一下，再继续。':'这一步暂时没能执行，我重新确认条件。',priority:1,speak:false};
  if(row.type!=='receipt' || row.response?.success!==true) return null;
  const phase=row.verification?.phase;
  const result=row.verification?.verified===true;
  const queued=result && ['shipyard_queue','construction_queue','fleet_order','research_queue'].includes(phase);
  const text=queued?'指令已经安排，接下来等游戏里的实际进展。':result?
    row.command==='merge_fleets'?'舰船已经合并到同一支舰队。':row.command==='resolve_event'?'眼前的事件已经处理好了。':row.command==='set_defender_war_goal'?'战争目标已经确认。':row.command==='adopt_ascension_perk'?'这项飞升已经生效。':'这一步已经确认生效，继续下一件事。':
    '指令已经提交，我会继续看实际结果。';
  return {kind:'result',phase:'等待结果',text,priority:0,speak:false};
}
export function dshPhase(row) {
  // Intentionally ignore type=text/final and all reasoning content.
  if(row.type==='status' && row.phase==='step_start') return '安排下一步';
  if(row.type==='tool_call') return labels[String(row.tool||'').split('__').at(-1)]||null;
  return null;
}
export class SurveyCaptionTracker {
  constructor(){this.states=new Map();}
  consume(row){
    const caption=receiptCaption(row),id=row?.fleetId??row?.control?.fleetId;
    if(row?.type!=='survey_control'||!caption||!Number.isSafeInteger(id)||id<0||id>=0xffffffff)return null;
    const key=JSON.stringify([row.control?.sessionId,row.control?.owner,!!row.control?.pending]);
    if(this.states.get(id)===key)return null;
    this.states.set(id,key);if(this.states.size>256)this.states.delete(this.states.keys().next().value);
    return caption;
  }
}
export function audienceState(checkpoint,now=Date.now(),{updatedAt=now}={}) {
  const s=checkpoint?.state;if(!s) return null;
  const ships=(s.military?.fleets||[]).reduce((n,f)=>n+(f.total_ships||0),0),execution=executionStatus(checkpoint,now);
  return {date:execution.date||'—',paused:execution.paused===true,executionKnown:execution.known,stopped:!!checkpoint.stopped,ended:!!s.terminal,
    surveyDelegation:surveySummary(checkpoint,now),
    inWar:!!s.wars?.length,fleets:s.military?.fleets?.length||0,ships,
    worlds:s.player?.owned_systems??0,colonies:s.capacities?.colonies??0,
    alloys:Math.round(s.resources?.alloys?.stockpile||0),
    urgent:!!s.alerts?.some(a=>['alert_hostile_in_system','alert_fleet_combat'].includes(a.type)),
    updatedAt};
}
