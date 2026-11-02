import {NativeStrategyReview} from './native-strategy-review.mjs';
import {NativeColonyAudit} from './native-colony-audit.mjs';
import {AdviceExecution} from './advice-execution.mjs';
import {compileNativeIntent,NativeIntentExecution} from './native-intent.mjs';
import {ownerEconomicPolicyReview} from './owner-economic-policy.mjs';
import {validateStrategyContract,applySteering,applyDomesticAction,reservedOrder,reservedRPC,steeringRPC,RESERVED_ACTIONS} from './strategy-contract.mjs';
import {COUNTRY_AI_POLICIES,normalizeCountryAIProtection,assertProtectedShipyardRefs,nativeOwnerPolicy} from './native-country-ai-economic-policy.mjs';
import {constructionInspectionScope,buildingInspectionScope,inspectBuildingQuote,inspectConstruction} from './construction-inspection.mjs';
import {withConstructionCoverage} from './construction-coverage.mjs';
import {needsPlanetJobsSupplement,supplementPlanetJobs} from './planet-jobs-readback.mjs';
import {NativeCountryAI,nativeCountryScope} from './native-country-ai.mjs';
import {MonthlyTradeExecution,monthlyReservationRisks,monthlyQuoteCondition,MONTHLY_EXECUTION_BRIDGES} from './monthly-trade-execution.mjs';
import {ColonyRoutine} from './colony-routine.mjs';
import {ColonyUpgradeRoutine} from './colony-upgrade-routine.mjs';
import {validateMonthlyLifecyclePolicy,monthlyLifecycleActions,monthlyLifecycleDecision} from './monthly-trade-lifecycle.mjs';
import {checkActualSpending,readActualSpendingCost,hasSpendingReservations} from './shared-spending-guard.mjs';
import {checkQuotedTrade,tradeBudgetPreview} from './trade-spending-policy.mjs';
import {localWaitTarget,localQueueWaitProof} from './local-work-wait.mjs';
import {monthlyRecoveryCandidates,recoverMonthlyRecord,cleanupRecoveredMonthlyRecords,recoveryOwnsOrder} from './monthly-trade-recovery.mjs';
import {previewMonthlyChange,validateMonthlyChange} from './monthly-trade-changes.mjs';
import {monthlyTradeAccounting} from './monthly-trade-accounting.mjs';
import {candidateFeedback} from './candidate-feedback.mjs';
import {replaceCheckpoint} from './checkpoint-replace.mjs';
import {surveyWatchWindow} from './survey-watch-window.mjs';
import {surveyGameDay} from './survey-idle-policy.mjs';
import {open, readFile, appendFile, mkdir, stat, unlink, writeFile} from 'node:fs/promises';
import {NativeDirector} from './native-director.mjs';
import {loadDirectorSettings} from './director-settings.mjs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativePipe} from './native-pipe.mjs';
import {reachableSurveyCandidate} from './survey-candidates.mjs';
import {manualSurveyRoute,validateManualSurveyReason} from './survey-routing-policy.mjs';
import {assertSurveyPilotOrders} from './survey-pilot-scope.mjs';
import {rpcEvidenceCategory} from './control-evidence.mjs';
import {attentionReasons} from './model-view.mjs';
import {fleetCapacity,reinforcementAlloyCost} from './fleet-capacity.mjs';
import {militaryExpansionProblem} from './military-budget.mjs';
import {validateMarketInspectionScope,quoteMarketInspection} from './market-inspection.mjs';
import {inspectNativeProcess} from './native-process.mjs';
import {councilAgendaCandidates,councilAgendaProblem} from './council-agendas.mjs';
import {readStrategyAdvice} from './strategy-advice.mjs';
import {readOperatorStanding,writeControllerReceipt} from './operator-standing.mjs';
import {readGameplayPreferences} from './gameplay-preferences.mjs';
import {resolveStrategyDirection} from './strategy-direction.mjs';
import {routineSalePlan} from './market-maintenance.mjs';
import {empireRoute,strategicReview,colonyReview,expansionCandidates,createGrowthTracker} from './strategic-review.mjs';
import {OperationalContext,executionCapabilities} from './operational-context.mjs';
import {orderKey,stableJson,stationTarget,stationSignature,persistentStationRefusal,mergeProblem,queuedNavalBudget} from './operation-guards.mjs';
import {buildingCandidateProblem,readBuildingAdmission} from './building-candidates.mjs';
import {USER_ECONOMIC_COMMANDS,assertNativeEconomicOrders,checkEconomicExploration} from './user-economic-intervention.mjs';
import {hasProductionIdentity,publicGameExplanation} from './game-voice-boundary.mjs';
import {AudienceQueryBridge} from './audience-query-bridge.mjs';
import {OrderTracker,captureBaseline,TRACKED_ASYNC_COMMANDS} from './order-tracker.mjs';
import {ControllerContinuity} from './controller-continuity.mjs';
import {assertBridgeCapabilities} from './bridge-capabilities.mjs';
import {buildingUpgradeProblem,verifyBuildingUpgrade,captureUpgradeQueueWitness} from './building-upgrades.mjs';
import {ActionPresentation,presentationPlan,urgentAlert} from './action-presentation.mjs';
import {GestaltTasks} from './gestalt-tasks.mjs';
import {SurveyDelegation} from './survey-delegation.mjs';
import {delegationResourceRisks} from './delegation-budget.mjs';
import {STRATEGY_CARDS,createCampaign,reviewCampaign} from './gestalt-campaign.mjs';
import {WAR_COMMANDS,warActionProblem,warProof,attackOptionsView,campaignFleetRouting} from './war-actions.mjs';
import {configureFirstWar,advanceFirstWar,confirmedUncolonizedSystem,readFirstWarOutcome} from './first-war.mjs';

const fields = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const id = value => Number.isSafeInteger(value) && value >= 0 && value < 0xffffffff;
// These decisions do not touch a science ship. Pause for the model, but avoid
// cancelling useful survey work merely to choose research/traditions/agendas.
// Every unrecognized alert remains conservative and requires handback.
const SURVEY_RETAIN_ALERTS=new Set(['alert_physics_research','alert_society_research','alert_engineering_research','alert_unlock_tradition','alert_council_agenda_ready_for_activation','alert_available_council_agenda']);
const day = surveyGameDay;
const owns = (object, key) => Object.hasOwn(object, key);
const COLONY_ROUTINE_AUTHORITY=Symbol('local colony routine');
const CAMPAIGN_AUTHORITY=Symbol('campaign execution');
const COUNTRY_AI_AUTHORITY=Symbol('native country AI ownership');
// Only strategyControl can authorize one exact, validated ordinary setting RPC.
// No public RPC flag or apply_orders command can open this dispatch fence.
const strategyDomesticWrites=new WeakMap();
const authorizedDomesticRPC=(game,method,params)=>strategyDomesticWrites.get(game)?.method===method&&strategyDomesticWrites.get(game)?.params===params;
const strategyExecutionBinding=game=>game.nativeCountryAIEnabled&&game.boundNativeWorld&&Number.isSafeInteger(game.binding?.pid)&&typeof game.binding?.creationTime==='string'?stableJson([game.binding.pid,game.binding.creationTime,game.boundNativeWorld]):null;
const strategyExecutionError=message=>!message?null:/世界|代次|玩家|首都|身份|绑定/.test(message)?'本国世界或进程绑定未确认，已停止执行':/timeout|超时|尚未确认|pipe/i.test(message)?'执行结果尚未确认，先核查当前状态，不重发命令':/不可停用|未确认.*可启用|清单不完整/.test(message)?'法令状态或当前合法性未确认，未完成调整':'战略执行未完成，请核查当前状态和执行回执';
const publicStrategyExecution=(result,date)=>({requestId:result.requestId,status:result.status,date:typeof date==='string'?date:null,steeringConfirmed:result.steering?.confirmed===true,
 domesticActions:(result.domesticActions??[]).slice(0,4).map(row=>({type:row.type??'toggle_edict',...(typeof row.targetName==='string'?{targetName:row.targetName.slice(0,100)}:{}),...(row.taskId?{taskId:row.taskId}:{}),edictKey:row.arguments?.edict_key??null,...(row.arguments?.agenda_key?{agendaKey:row.arguments.agenda_key}:{}),enabled:row.arguments?.enabled??null,status:row.status??'checking',confirmed:row.confirmed===true,...(typeof row.changed==='boolean'?{changed:row.changed}:{}),error:strategyExecutionError(row.error)})),error:strategyExecutionError(result.error)});
const clearStrategyExecution=game=>{delete game.strategyExecutionRecord;if(game.lastState)game.lastState.strategyExecution=null;};
const NO_IMMEDIATE_RESOURCE_SPEND=new Set(['select_research','move_fleet','survey','set_fleet_stance','follow_fleet','set_speed','assign_scientist','set_job_priority','assign_councilor','set_council_agenda','open_alert','open_notification',
  // These commands use already-owned forces or edit plans. Recruitment,
  // reinforcement, claims and event choices can spend resources and stay gated.
  'embark_all_armies','declare_war','land_armies','offer_peace','merge_fleets','fleet_mia','increase_fleet_quota','decrease_fleet_quota','select_leader_trait','set_defender_war_goal','close_war_goals','open_war_goals']);

// [required fields, optional fields]. No console, direct resource editing or arbitrary native calls.
export const ORDER_FIELDS = {
  recruit_planet_army:[['planet_id','army_key'],['species_id']],embark_all_armies:[['planet_id'],[]],
  declare_war:[['country_id','goal_key'],[]],land_armies:[['fleet_id','planet_id'],['queue']],offer_peace:[['war_id','outcome'],[]],
  move_fleet: [['fleet_id', 'system_id'], ['queue']], survey: [['fleet_id', 'system_id'], ['queue']],
  build_outpost: [['fleet_id', 'system_id'], ['queue']], colonize: [['fleet_id', 'planet_id'], ['queue']],
  build_stations: [['fleet_id', 'system_id', 'station_type'], ['queue']],
  select_research: [['slot', 'tech_key'], []], hire_leader: [['candidate_id'], []],
  assign_scientist: [['leader_id', 'fleet_id'], []], build_district: [['planet_id', 'district_key'], []],
  select_leader_trait: [['leader_id', 'trait_key'], []],
  build_building: [['planet_id', 'building_key', 'district_type', 'slot_index'], []],
  upgrade_building: [['planet_id','building_id','upgrade_key'], []],
  set_district_zone: [['planet_id','district_id','zone_slot','zone_key'], []],
  set_job_priority: [['planet_id','job_key','prioritized'], []],
  build_ship: [['design_id', 'system_id'], ['count']],
  increase_fleet_quota: [['fleet_id', 'design_id', 'target_quota'], []],
  decrease_fleet_quota: [['fleet_id', 'design_id', 'target_quota'], []],
  reinforce_fleet: [['fleet_id'], []], upgrade_fleet: [['fleet_id'], []],
  merge_fleets: [['fleet_ids'], []],
  fleet_mia: [['fleet_ids'], ['type']],
  claim_system: [['system_id'], ['remove']],
  follow_fleet: [['fleet_id', 'target_fleet_id'], ['attack', 'queue']],
  set_fleet_stance: [['fleet_id', 'stance'], []], diplomacy: [['country_id', 'action'], []],
  respond_diplomacy: [['proposal', 'accept'], []],
  set_defender_war_goal: [['war_id','goal_key'], []], close_war_goals: [[], []],
  open_war_goals: [['war_id'], []],
  market_trade: [['resource', 'action', 'units'], []],
  adopt_ascension_perk: [['perk_key'], []], open_alert: [['alert_id'], []],
  open_notification: [['index'], []], assign_councilor: [['leader_id', 'seat_index'], []],
  adopt_tradition: [['tradition_key'], []], set_council_agenda: [['agenda_key'], []],
  launch_council_agenda: [['agenda_key'], []], resolve_event: [['window_id', 'option_index'], []],
  clear_blocker: [['planet_id', 'deposit_id'], []], set_speed: [['speed'], []],
};

export function validateOrder(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order) || !ORDER_FIELDS[order.command]) throw new Error('不支持的游戏指令');
  const params = order.arguments;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('arguments 必须是参数对象');
  const [required, optional] = ORDER_FIELDS[order.command], allowed = [...required, ...optional];
  for (const key of required) if (!owns(params, key)) throw new Error(`${order.command} 缺少 ${key}`);
  for (const [key, value] of Object.entries(params)) {
    if(key==='outcome'&&!['status_quo','surrender','demand_surrender'].includes(value))throw Error('议和方式无效');
    if (!allowed.includes(key)) throw new Error(`${order.command} 不接受 ${key}`);
    if (key.endsWith('_id') && !id(value)) throw new Error(`${key} 必须是有效整数 ID，0 是合法 ID`);
    if (key==='fleet_ids' && (!Array.isArray(value) || value.length<(order.command==='fleet_mia'?1:2) || value.length>4 || !value.every(id) || new Set(value).size!==value.length)) throw new Error('fleet_ids 需要合法且不同的完整舰队ID；合并2..4支，紧急返航1..4支');
    if(key==='type'&&order.command==='fleet_mia'&&!['return_home','emergency_ftl'].includes(value))throw Error('紧急返航类型无效');
    if (key === 'queue' && typeof value !== 'boolean') throw new Error('queue 必须是布尔值');
    if (key === 'remove' && typeof value !== 'boolean') throw new Error('remove 必须是布尔值');
    if (key === 'attack' && typeof value !== 'boolean') throw new Error('attack 必须是布尔值');
    if (key === 'accept' && typeof value !== 'boolean') throw new Error('accept 必须是布尔值');
    if (key === 'prioritized' && typeof value !== 'boolean') throw new Error('prioritized 必须是布尔值');
    if (key === 'proposal' && (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 0xffffffffffffffffn)) throw new Error('proposal 必须是原生查询返回的十进制字符串');
    if (key === 'target_quota' && (!Number.isInteger(value) || value < 1 || value > 80)) throw new Error('target_quota 需要 1..80');
    if (key === 'stance' && !['passive', 'aggressive', 'evasive'].includes(value)) throw new Error('stance 无效');
    if (key === 'action' && !(order.command === 'market_trade' ? ['buy','sell'] : ['improve_relations', 'establish_embassy', 'open_borders', 'close_borders', 'research_agreement', 'commercial_pact', 'non_aggression_pact']).includes(value)) throw new Error('action 无效');
    if (key === 'resource' && (typeof value !== 'string' || !/^[a-z_]{1,60}$/.test(value))) throw new Error('resource 无效');
    if (key === 'units' && (!Number.isSafeInteger(value) || value < 1 || value > 5000)) throw new Error('单次交易数量需要1..5000');
    if (['index','seat_index'].includes(key) && (!Number.isSafeInteger(value) || value<0 || value>128)) throw new Error(`${key} 无效`);
    if (key==='slot_index'&&(!Number.isSafeInteger(value)||value<0||value>0x7fffffff))throw new Error('slot_index 需要当前完整 zone_id（非顺位），0 有效');
    if (['option_index','zone_slot'].includes(key) && (!Number.isSafeInteger(value) || value < 0 || value > 128)) throw new Error(`${key} 无效`);
    if (key === 'speed' && (!Number.isInteger(value) || value < 0 || value > 4)) throw new Error('speed 需要 0..4');
    if (key === 'count' && (!Number.isInteger(value) || value < 1 || value > 3)) throw new Error('单次造船数量需要 1..3');
    if ((key.endsWith('_key') || key === 'district_type') && (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,100}$/.test(value))) throw new Error(`${key} 无效`);
    if (key === 'slot' && !['physics', 'society', 'engineering'].includes(value)) throw new Error('slot 需要 physics/society/engineering');
    if (key === 'station_type' && !['mining', 'research'].includes(value)) throw new Error('station_type 需要 mining/research');
  }
  return {command: order.command, arguments: {...params,...(params.fleet_ids?{fleet_ids:[...params.fleet_ids]}:{})}};
}

export class NativeGame {
  constructor({pipe = new NativePipe(), directory = '.local/native-bridge', minutes = 10, now = Date.now, processReader = inspectNativeProcess, requirePicture = true,maximumGameSpeed=5,presentationClock,presentationWait,hybridSurvey=false,presentOrders=true,surveyPilot=false,surveyWatchSeconds=60,colonyUpgradePilot=false,monthlyLifecyclePilot=false,localWaitPilot=false,nativeCountryAI=false,stopFile='.local/STOP',guidanceFile='.local/game-guidance.json'} = {}) {
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) throw new Error('运行时长需要 0..60 分钟');
    Object.assign(this, {pipe, directory: resolve(directory), minutes, now, processReader, requirePicture,surveyPilot,stopFile:resolve(stopFile),guidanceFile:resolve(guidanceFile)});
    this.evidencePending=new Set();this.evidenceIncomplete=false;this.writeSequence=0;
    if(pipe instanceof NativePipe)pipe.beforeWrite=(method,params,context)=>{
      this.assertRpcAllowed(method,params);
      if((this.stoppingRequested||this.stopped)&&['set_paused','set_survey_automation','set_monthly_trade','get_fleet_automation','get_market'].includes(method)&&context?.cleanupSessionId!==this.sessionId)throw Error('停止封口后的收权必须重新核对原会话，不沿用连接等待前的授权');
      const category=rpcEvidenceCategory(method,params);
      if(category!=='read'&&!(this.stoppingRequested||this.stopped)&&context?.commandSessionId!==this.sessionId)throw Error('普通写入缺少本轮进程与帝国核对');
      if(context?.connectionEpoch!==undefined&&context.connectionEpoch!==pipe.connectionEpoch)throw Error('桥连接已更换，不沿用旧连接的写入授权');
      if(category!=='read'&&!(this.stoppingRequested||this.stopped)&&this.now()>=this.ends)throw Error('本轮授权时长已到，不发送等待连接后的命令');
      if(category!=='read')this.queueEvidence({type:'rpc_write',sequence:++this.writeSequence,method,category,afterStop:!!(this.stoppingRequested||this.stopped)});
    };
    this.sessionId = randomUUID(); this.started = now(); this.ends = this.started + minutes * 60000;
    this.nativeDirector=new NativeDirector({now});
    this.controllerRunId=process.env.CYBERFISH_CONTROLLER_RUN;
    this.receipts = new Map(); this.cooldowns = new Map(); this.uncertain = false; this.revision = 0;
    this.trackedIntentKeys=new Map();
    this.presentationTimeline=new ActionPresentation({now:presentationClock,wait:presentationWait});
    this.failures = new Map();
    this.stationFailures = new Map();
    this.knownShipyards = new Set();
    this.operationalContext=new OperationalContext({now:this.now});
    this.growthTracker=createGrowthTracker();this.strategyReview=new NativeStrategyReview();
    this.adviceTasks=new AdviceExecution({now:this.now});
    this.audienceQueries=new AudienceQueryBridge({directory:resolve(this.directory,'../commentary'),now:this.now});
    this.continuity=new ControllerContinuity({directory:this.directory,now:this.now});
    this.gestalt=new GestaltTasks({directory:this.directory,now:this.now});
    this.hybridSurvey=hybridSurvey===true;
    this.surveyWatchSeconds=surveyWatchWindow(surveyWatchSeconds);
    this.presentOrders=presentOrders!==false;
    this.surveyDelegation=new SurveyDelegation({store:()=>this.gestalt.data.surveyControl??=( {revision:0,records:{}}),save:()=>this.gestalt.save(),rpc:(m,p)=>this.rpc(m,p),isStopped:()=>!!this.stopped||this.gestalt.paused,sessionId:this.sessionId,now:this.now});
    this.monthlyLifecyclePilot=monthlyLifecyclePilot===true&&!this.surveyPilot;
    this.localWaitPilot=localWaitPilot===true&&!this.surveyPilot;
    this.monthlyExecution=new MonthlyTradeExecution({store:()=>this.gestalt.data.monthlyTrades??=[],save:()=>this.gestalt.save(),snapshot:options=>this.monthlySnapshot(options),rpc:(m,p)=>this.rpc(m,p),sessionId:this.sessionId,allowLifecyclePolicies:this.monthlyLifecyclePilot,budgetOptions:options=>this.delegationBudgetOptions(options),assertActive:()=>{if(this.nativeRoutineSuppressed||this.stoppingRequested||this.stopped)throw Error('国家 AI 已接管日常经营或控制会话正在停止，禁止本地月度新增或调整');}});
    this.visibleFleets = new Map();
    this.colonyRoutine=new ColonyRoutine({store:()=>this.gestalt.data.colonyRoutines??=[],save:()=>this.gestalt.save(),snapshot:planetId=>this.colonySnapshot(planetId),sessionId:this.sessionId,budgetOptions:()=>this.delegationBudgetOptions(),assertActive:()=>{if(this.nativeRoutineSuppressed||this.stoppingRequested||this.stopped||this.gestalt.paused)throw Error('国家 AI 已接管日常经营或会话已停止，禁止本地住房建设');},now:this.now,execute:args=>this.executeColonyOrder(args)});
    this.colonyUpgradePilot=colonyUpgradePilot===true&&!this.surveyPilot;
    this.colonyUpgradeRoutine=new ColonyUpgradeRoutine({store:()=>this.gestalt.data.colonyUpgradeRoutines??=[],save:()=>this.gestalt.save(),snapshot:planetId=>this.colonySnapshot(planetId,{upgrades:true}),sessionId:this.sessionId,now:this.now,budgetOptions:()=>this.delegationBudgetOptions(),assertActive:()=>{if(this.nativeRoutineSuppressed||!this.colonyUpgradePilot||this.stoppingRequested||this.stopped||this.gestalt.paused)throw Error('国家 AI 已接管日常经营、升级托管未启用或会话已停止');},execute:args=>this.executeColonyOrder(args)});
    if(!Number.isInteger(maximumGameSpeed)||maximumGameSpeed<1||maximumGameSpeed>5)throw Error('maximumGameSpeed需要1..5整数');this.maximumGameSpeed=maximumGameSpeed;
    this.colonyReviews=new Map();
    this.metrics = {observations: 0, calls: 0, orders: 0, rejected: 0, verified: 0};
    this.nativeCountryAIEnabled=nativeCountryAI===true;
    this.nativeRoutineSuppressed=this.nativeCountryAIEnabled;
    if(this.nativeCountryAIEnabled){this.hybridSurvey=false;this.colonyUpgradePilot=false;this.monthlyLifecyclePilot=false;this.localWaitPilot=false;}
    this.countryAI=new NativeCountryAI({rpc:(m,p)=>this.rpc(m,p,{countryAIInternal:COUNTRY_AI_AUTHORITY}),
      assertBinding:()=>this.stoppingRequested||this.stopped?this.cleanupScope():this.commandScope(),
      setDispatchFence:active=>{this.nativeCountryAIFence=active;if(active)this.nativeRoutineSuppressed=true;},record:async event=>{
        await this.log(event);if(['country_ai_lease_acquired','country_ai_protection_updated'].includes(event.type))await this.checkpoint();
      }});
  }
  async start({keepPaused=false}={}) {
    await mkdir(this.directory, {recursive: true});
    this.lockPath = resolve(this.directory, 'controller.lock');
    let lock;
    try {lock = await open(this.lockPath, 'wx');} catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let old;
      try {old = JSON.parse(await readFile(this.lockPath, 'utf8')); process.kill(old.pid, 0);} catch (check) {
        if (check.code !== 'ESRCH') throw new Error('已有控制器或锁状态未知；拒绝第二个写入者');
        await unlink(this.lockPath); lock = await open(this.lockPath, 'wx');
      }
      if (!lock) throw new Error('已有控制器正在使用游戏');
    }
    await lock.writeFile(JSON.stringify({pid: process.pid, parentPid:process.ppid, sessionId: this.sessionId})); await lock.close();
    this.journal = resolve(this.directory, `session-${this.sessionId}.jsonl`);
    try {
      this.binding = await this.processReader({op: 'identity'});
      const capabilities=await this.rpc('ping');assertBridgeCapabilities(capabilities,{hybridSurvey:this.hybridSurvey,upgradePaths:this.colonyUpgradePilot,nativeCountryAI:this.nativeCountryAIEnabled});
      this.bridgeCapabilities=capabilities;
      if(this.nativeCountryAIEnabled){
        const state=await this.rpc('get_country_ai_state');
        if(state?.success!==true||state.single_local_human_guard!==true||state.world_generation_tracking!==true)throw Error('本国国家 AI 身份、全局作用范围或读档代次未核实');
        this.boundNativeWorld=nativeCountryScope(state);
        if(state.global_flags.human_ai||state.global_flags.force_human_ai)throw Error('国家 AI 已开启但本轮尚未拥有；先显式核对和收回原委派');
        const lease=await this.rpc('country_ai_lease',{action:'status'});
        if(lease?.success!==true||!['idle','stopped'].includes(lease.phase)||lease.routine_gate?.armed===true||lease.observation?.armed===true)
          throw Error('原生仍有委派或交接待核对，不覆盖旧国家 AI 会话');
        this.countryAI.last=lease;
      }
      await this.log({type:'session_meta',evidenceVersion:1,sessionId:this.sessionId,mode:this.nativeCountryAIEnabled?'native_country_ai':this.hybridSurvey?'hybrid':'baseline',watchMaximumSeconds:this.nativeCountryAIEnabled?900:this.hybridSurvey?this.surveyWatchSeconds:this.localWaitPilot?60:20,bridgeVersion:capabilities.bridge_version,featureFlags:{colonyUpgrade:this.colonyUpgradePilot,monthlyLifecycle:this.monthlyLifecyclePilot,localWait:this.localWaitPilot},writeBoundaryObserved:this.pipe instanceof NativePipe});
      this.orderTracker=new OrderTracker({sessionId:this.sessionId,binding:this.binding,now:this.now});
      await this.observe();
      await this.ensurePicture();
      if(Number.isFinite(this.lastState.speed)&&this.lastState.speed>this.maximumGameSpeed)await this.rpc('set_speed',{speed:this.maximumGameSpeed});
      if(this.lastState.terminal) throw new Error(this.lastState.terminal.message);
      await this.rpc('set_paused', {paused: keepPaused || !!(this.lastState.warGoalsWindow || this.lastState.pendingEvents.length)});
      return await this.observe();
    } catch (error) {this.stopReason=error.message;await this.stop();throw error;}
  }
  async rpc(method, params = {}, internal = {}) {
    this.assertRpcAllowed(method,params);
    if(method==='country_ai_lease'&&params.action!=='status'&&internal.countryAIInternal!==COUNTRY_AI_AUTHORITY)throw Error('国家 AI 控制只能通过已绑定的交接入口');
    let context;
    try{
    if((this.stoppingRequested||this.stopped)&&(['set_paused','set_survey_automation','set_monthly_trade','get_fleet_automation','get_market'].includes(method)||method==='country_ai_lease'&&params.action==='stop')){
      const scope=await this.cleanupScope();
      if(method!=='set_paused'&&!(method==='country_ai_lease'&&params.action==='stop')&&scope.status.is_paused!==true)throw Error('收权前未确认原会话暂停');
      this.assertRpcAllowed(method,params);
      context={cleanupSessionId:this.sessionId,connectionEpoch:scope.connectionEpoch};
    }else if(rpcEvidenceCategory(method,params)!=='read'){
      const scope=await this.commandScope();this.assertRpcAllowed(method,params);
      context={commandSessionId:this.sessionId,connectionEpoch:scope.connectionEpoch};
    }
    }catch(error){error.nativeWriteAttempted=false;this.runtimeStatus={sessionId:this.sessionId,observedAt:this.now(),paused:null,date:null,scopeUnknown:true};throw error;}
    const wireParams=this.nativeCountryAIEnabled&&rpcEvidenceCategory(method,params)!=='read'&&this.boundNativeWorld?{...params,_expected_world_generation:this.boundNativeWorld.world_generation,_expected_game_pid:this.binding.pid,_expected_game_creation:this.binding.creationTime}:params;
    this.metrics.calls++;const result=await this.pipe.request(method, wireParams,context);
    if(method==='get_status')this.runtimeStatus={sessionId:this.sessionId,observedAt:this.now(),paused:typeof result?.is_paused==='boolean'?result.is_paused:null,date:result?.date?.formatted??null};
    if(method==='get_status'&&this.journal&&(this.lastEvidenceSampleAt===undefined||this.now()-this.lastEvidenceSampleAt>=1000||this.lastEvidencePaused!==result?.is_paused)){
      this.lastEvidenceSampleAt=this.now();this.lastEvidencePaused=result?.is_paused;
      this.queueEvidence({type:'runtime_sample',paused:typeof result?.is_paused==='boolean'?result.is_paused:null,gameDate:result?.date?.formatted??null,afterStop:!!(this.stoppingRequested||this.stopped)});
    }
    if(method==='set_paused'&&result?.success===true){this.expectedPaused=params.paused;this.runtimeStatus={sessionId:this.sessionId,observedAt:this.now(),paused:null,date:this.runtimeStatus?.date??null};}
    return result;
  }
  assertRpcAllowed(method,params={}) {
    const countryRead=['country_ai_lease','country_ai_observation','country_ai_routine_gate'].includes(method)&&params.action==='status';
    if(this.nativeCountryAIFence&&!(this.countryAI?.view().owner==='native'&&(reservedRPC(method)||steeringRPC(method,params)||authorizedDomesticRPC(this,method,params)||rpcEvidenceCategory(method,params)==='presentation'))&&rpcEvidenceCategory(method,params)!=='read'&&!(method==='set_paused'&&params.paused===true)&&method!=='country_ai_lease')throw Error('原生国家 AI 持权或交接待确认；本地派单已封口，先接管并回读后再干预');
    if((this.stoppingRequested||this.stopped)&&!(/^(get_|find_)/.test(method)||method==='ping'||countryRead||method==='country_ai_lease'&&params.action==='stop'||method==='set_paused'&&params.paused===true||method==='set_survey_automation'&&params.enabled===false||method==='set_monthly_trade'&&params.cancel===true&&(this.monthlyExecution?.owns(params.order_id)||recoveryOwnsOrder(this.gestalt.data.monthlyTrades||[],this.sessionId,params.order_id))))
      throw Error('控制会话正在停止，只允许状态核对、暂停与收权');
  }
  async cleanupScope(){
    try{
      await this.assertNativeWorld();
      const player=this.lastState?.player,baseline=surveyGameDay(this.lastState?.date),latest=surveyGameDay(this.lastGameDate),minimum=baseline===null?null:Math.max(baseline,latest??baseline);
      if(!this.binding||!Number.isSafeInteger(this.binding.pid)||typeof this.binding.creationTime!=='string'||!player||!id(player.country_id)||!id(player.capital_system_id)||minimum===null)throw Error('缺少原会话完整绑定，不操作当前游戏');
      const status=await this.rpc('get_status'),connectionEpoch=this.pipe instanceof NativePipe?this.pipe.connectionEpoch:undefined;
      const identity=await this.processReader({op:'bound_identity',pid:this.binding.pid,creationTime:this.binding.creationTime});
      if(identity.pid!==this.binding.pid||identity.creationTime!==this.binding.creationTime)throw Error('清理前游戏进程绑定改变');
      const world=await this.rpc('get_galaxy_overview'),current=surveyGameDay(status.date?.formatted);
      if(connectionEpoch!==undefined&&connectionEpoch!==this.pipe.connectionEpoch)throw Error('清理核对期间桥连接更换');
      if(status.in_game!==true||world.player?.country_id!==player.country_id||world.player?.capital_system_id!==player.capital_system_id||current===null||current<minimum||this.cleanupLastDay!==undefined&&current<this.cleanupLastDay)throw Error('清理前帝国或日期改变，停止旧计划');
      this.cleanupLastDay=current;this.cleanupBindingUnknown=undefined;
      return {status,world,connectionEpoch};
    }catch(error){this.cleanupBindingUnknown=error.message;this.runtimeStatus={sessionId:this.sessionId,observedAt:this.now(),paused:null,date:null,scopeUnknown:true};throw error;}
  }
  async commandScope(){
    await this.assertNativeWorld();
    const player=this.lastState?.player??this.boundPlayer;
    if(!this.binding||!Number.isSafeInteger(this.binding.pid)||typeof this.binding.creationTime!=='string'||!player||!id(player.country_id)||!id(player.capital_system_id))throw Error('普通命令需要已绑定的原游戏进程和玩家');
    const status=await this.guard(),connectionEpoch=this.pipe instanceof NativePipe?this.pipe.connectionEpoch:undefined;
    const identity=await this.processReader({op:'bound_identity',pid:this.binding.pid,creationTime:this.binding.creationTime});
    if(identity.pid!==this.binding.pid||identity.creationTime!==this.binding.creationTime)throw Error('发送前游戏进程绑定改变，不执行旧命令');
    const world=await this.rpc('get_galaxy_overview');
    if(world.player?.country_id!==player.country_id||world.player?.capital_system_id!==player.capital_system_id)throw Error('发送前玩家或首都身份改变，不执行旧命令');
    if(connectionEpoch!==undefined&&connectionEpoch!==this.pipe.connectionEpoch)throw Error('普通命令核对期间桥连接更换');
    if(this.now()>=this.ends)throw Error('本轮授权时长已到，禁止新增写入');
    return {status,world,connectionEpoch};
  }
  async assertNativeWorld(){
    if(!this.nativeCountryAIEnabled||!this.boundNativeWorld)return;
    try{
      const current=await this.rpc('get_country_ai_state');
      if(current?.success!==true||current.world_loading===true||JSON.stringify(nativeCountryScope(current))!==JSON.stringify(this.boundNativeWorld))throw Error('国家 AI 世界代次或玩家身份改变，旧会话不能继续派单或恢复战略');
    }catch(error){clearStrategyExecution(this);this.adviceTasks?.invalidate();if(this.lastState)this.lastState.adviceExecution=null;throw error;}
  }
  strategyExecutionView(){
    const record=this.strategyExecutionRecord;
    if(!record)return null;
    if(!record.bindingKey||record.bindingKey!==strategyExecutionBinding(this)){clearStrategyExecution(this);this.strategyReceipts?.clear();return null;}
    return publicStrategyExecution(record.result,record.date);
  }
  async countryAIControl({operation='status',policy='full_with_reserved',maxGameDays=180,maxWallSeconds=3600,stopAtReview=false,protectedTargets,reason}={}){
    if(!this.nativeCountryAIEnabled)return {enabled:false,coreGoalComplete:false,reason:'国家 AI 持续托管需要统一验收后的桥与显式启用；局部调查和本地派单不代表国家 AI'};
    if(protectedTargets!==undefined&&!['delegate','protect'].includes(operation))throw Error('保护目标只能随首次委派或实际接管后的protect更新，不能被其他操作静默覆盖');
    if(protectedTargets!==undefined){normalizeCountryAIProtection(protectedTargets);}
    if(operation==='status'){await this.countryAI.state();return {enabled:true,...this.countryAI.view()};}
    if(!['delegate','resume','takeover','reclaim','stop','continue','protect'].includes(operation))throw Error('国家 AI 操作无效');
    if(operation==='protect'){
      if(this.uncertain||this.applyBusy)throw Error('先核对未确认的关键干预，再更新保护');
      if(!this.countryAI.active&&this.countryAI.saved&&this.countryAI.phase==='human'&&Number.isSafeInteger(this.countryAI.takeoverGeneration))await this.checkProtectedShipyards(protectedTargets);
      const control=await this.countryAI.protect({protectedTargets,reason});return {control:{enabled:true,...control},state:await this.observe()};
    }
    if(operation==='continue'){
      const intent=this.lastState?.nativeIntent;
      if(intent&&['stalled','blocked'].includes(intent.status))return {status:'attention',needsAttention:'目标尚未落实，不能仅续期同一方针；先处理受阻或给出具体纠偏，原生日常经营继续',nativeIntent:intent,
        control:{enabled:true,...this.countryAI.view()},state:this.lastState,nextCall:{name:'inspect',arguments:{topic:'strategy'}}};
      this.strategyReview.acknowledge(this.lastState??{});await this.countryAI.acknowledgeReview();this.nativeStrategicReviewDue=false;this.needsDecisionRefresh=false;return {control:{enabled:true,...this.countryAI.view()},state:await this.observe()};
    }
    if(['delegate','resume'].includes(operation)){
      if(this.countryAI.active)throw Error('当前已经委派或控制权未确认；先查询或接管后调整，不重复开启');
      if(this.ownerEconomicReturnPending){
        await this.observe();
        const hold=this.ownerEconomicExecution();
        if(hold.unfinished.length&&!hold.emergency){
          const blocked=hold.unfinished.find(t=>['failed','expired_unknown'].includes(t.status));
          const nextCall=blocked?{name:'inspect',arguments:blocked.command==='build_building'?{topic:'buildings',id:blocked.arguments.planet_id,building_key:blocked.arguments.building_key,zone_id:blocked.arguments.slot_index}:{topic:'military'}}:{name:'watch',arguments:{seconds:20}};
          return {status:'attention',delegationDeferred:true,needsAttention:'本人具体任务尚未确认完成，暂不交给会覆盖施工/移动的原生AI；保持human推进，受阻项先读回再调整',
            control:{enabled:true,...this.countryAI.view()},state:this.lastState,ownerEconomicExecution:hold,nextCall};
        }
      }
      if(operation==='resume'&&(!this.countryAI.saved||this.countryAI.phase!=='human'||!Number.isSafeInteger(this.countryAI.takeoverGeneration)))
        return {status:'attention',delegationDeferred:true,needsAttention:'本轮没有可恢复的已核验原生委派；先显式delegate建立本轮代次，不恢复或猜测旧AI记录',
          control:{enabled:true,...this.countryAI.view()},state:this.lastState,nextCall:{name:'country_ai_control',arguments:{operation:'delegate',policy:'full_with_reserved',maxGameDays,maxWallSeconds}}};
      if(!Number.isFinite(maxWallSeconds)||maxWallSeconds<1||maxWallSeconds>3600||!Number.isInteger(maxGameDays)||maxGameDays<1||maxGameDays>720||(!Object.hasOwn(COUNTRY_AI_POLICIES,policy)))throw Error('国家 AI 范围与复查参数无效');
      if(this.uncertain||this.applyBusy||this.colonyBusy||this.monthlyBusy||this.monthlyLifecycleBusy)throw Error('先核对未确认写入或等待当前本地操作结束，再交给国家 AI');
      if(this.orderTracker?.view().some(row=>row.status==='expired_unknown'||row.status==='submitted'&&row.submissionConfirmed!==true))throw Error('存在未确认的旧订单，不能直接交给国家 AI');
      await this.checkProtectedShipyards(operation==='resume'?this.countryAI.saved?.protectedTargets:protectedTargets);
      const pause=await this.rpc('set_paused',{paused:true});if(pause?.success!==true)throw Error('委派准备未能暂停');
      const decisionAttention=async()=>{
        const events=await this.rpc('get_active_events'),wars=await this.rpc('get_wars');
        if(!Array.isArray(events)||typeof wars?.warGoalsWindow!=='boolean')throw Error('中央事件或战争目标状态未知，暂不委派国家 AI');
        if(!events.length&&!wars.warGoalsWindow)return;
        const state=await this.observe();
        if(!state.pendingEvents?.length&&!state.warGoalsWindow)return;
        return {status:'attention',delegationDeferred:true,needsAttention:'先处理当前中央事件或战争目标，再交给原生国家 AI；不要反复请求委派',
          nextCall:{name:'inspect',arguments:{topic:state.warGoalsWindow?'wars':'events'}},control:{enabled:true,...this.countryAI.view()},state};
      };
      const blocked=await decisionAttention();if(blocked)return blocked;
      const maxWallMs=Math.min(Math.floor((this.ends-this.now())),Math.floor(maxWallSeconds*1000));
      if(maxWallMs<1000)throw Error('本轮剩余授权不足，不开始新的国家 AI 委派');
      try{
        const ownerPolicy=nativeOwnerPolicy(this.lastState,this.modelStrategyContract);
        if(operation==='resume')await this.countryAI.resume({maxWallMs,ownerPolicy});
        else await this.countryAI.delegate({policy,maxGameDays,maxWallMs,stopAtReview,protectedTargets,ownerPolicy});
      }catch(error){
        // A choice can appear between the preflight and native run. Only turn
        // this into attention after native cleanup has confirmed human control.
        const control=this.countryAI.view();
        if(error.message==='country_ai_run_scope_or_key_event_blocked'&&!this.countryAI.active&&control.owner==='human'&&control.paused===true&&control.actualFlags?.human_ai===false&&control.actualFlags?.force_human_ai===false){
          await this.assertNativeWorld();
          const attention=await decisionAttention();if(attention)return attention;
        }
        throw error;
      }
    }else if(operation==='takeover'&&!this.countryAI.active){
      // watch may have advanced accepted commands while the owner stayed human.
      // Pausing that same bound world is still required; never enable/replay AI.
      await this.commandScope();await this.countryAI.state();
      const before=this.countryAI.view();
      if(before.owner!=='human'||before.ordinaryOrdersBlocked!==false||!['idle','stopped'].includes(before.nativePhase)||before.actualFlags?.human_ai!==false||before.actualFlags?.force_human_ai!==false)
        throw Error('当前人类持权或AI关闭状态未确认，不能将未知交接当作已接管');
      const pause=await this.rpc('set_paused',{paused:true});if(pause?.success!==true)throw Error('人类持权接管的暂停请求未确认');
      const status=await this.guard();await this.countryAI.state();const control=this.countryAI.view();
      if(status.is_paused!==true||control.owner!=='human'||control.paused!==true||control.ordinaryOrdersBlocked!==false||control.actualFlags?.human_ai!==false||control.actualFlags?.force_human_ai!==false)
        throw Error('人类持权接管未完成暂停/AI关闭回读，保持未确认');
    }else await this.countryAI.takeover();
    this.nativeCountryAIUnknownSealed=false;this.nativeStrategicReviewDue=false;this.needsDecisionRefresh=false;this.decisionPause=undefined;
    return {control:{enabled:true,...this.countryAI.view()},state:await this.observe()};
  }
  ownerEconomicExecution(){
    const tasks=(this.orderTracker?.view()??[]).filter(t=>t.ownerEconomicTask),state=this.lastState??{};
    const emergency=Array.isArray(state.wars)&&state.wars.length>0||['energy','minerals','alloys','food','consumer_goods'].some(key=>{
      const r=state.resources?.[key];return r?.net_known!==false&&r?.stockpile_known!==false&&Number.isFinite(r?.stockpile)&&Number.isFinite(r.net)&&r.net<0&&Math.max(0,r.stockpile)/-r.net<=6;
    });
    const summary=tasks.map(t=>({id:t.id,command:t.command,status:t.status,reason:t.reason,arguments:t.arguments}));
    return {holding:!!this.ownerEconomicReturnPending&&!this.countryAI.active,tasks:summary,unfinished:summary.filter(t=>t.status!=='completed'),emergency};
  }
  async settleOwnerEconomicExecution(){
    if(!this.nativeCountryAIEnabled||this.countryAI.active||!this.ownerEconomicReturnPending)return;
    const hold=this.ownerEconomicExecution();this.lastState.ownerEconomicExecution=hold;
    if(hold.emergency||hold.tasks.length&&!hold.unfinished.length){
      if(!this.countryAI.saved)return {...this.lastState,needsAttention:'本人任务已结束或出现紧急情况；没有本轮原生委派记录，需显式delegate，不能猜测恢复旧AI',ownerEconomicExecution:hold};
      this.ownerEconomicReturnPending=false;
      const result=await this.countryAIControl({operation:'resume',maxWallSeconds:Math.max(1,Math.min(3600,Math.floor((this.ends-this.now())/1000)))});
      return {...result.state,...(result.needsAttention?{needsAttention:result.needsAttention,nextCall:result.nextCall}:{}),ownerEconomicExecution:{...hold,holding:false,returnedToNative:result.control?.owner==='native'}};
    }
    if(hold.unfinished.some(t=>['failed','expired_unknown'].includes(t.status))){
      await this.rpc('set_paused',{paused:true});await this.guard();
      return {...await this.observe(),needsAttention:'本人任务未完成：已失败项重新核对合法条件；未知项只读对账，禁止盲重放。保持human并暂停以便调整',ownerEconomicExecution:hold};
    }
    return {...this.lastState,needsAttention:'本人明确任务执行期：保持human正常推进，真实建筑完工或舰队抵达后再交还原生AI',ownerEconomicExecution:hold};
  }
  async checkProtectedShipyards(protectedTargets={}){
    const protection=normalizeCountryAIProtection(protectedTargets);
    if(!protection.shipyards.length)return;
    const yards=await this.rpc('get_shipyards');
    assertProtectedShipyardRefs(protection,yards,this.lastState?.player?.country_id);
  }
  async strategyControl({requestId,contract}={}) {
    if(!this.nativeCountryAIEnabled||this.countryAI.view().owner!=='native'||this.stoppingRequested||this.stopped)throw Error('战略合同需要本国原生AI正在运营');
    if(this.strategyBusy)throw Error('战略合同正在执行');
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))throw Error('战略requestId无效');
    const requested=validateStrategyContract(contract,validateOrder),fingerprint=stableJson(requested);
    await this.assertNativeWorld();this.strategyExecutionView();
    this.strategyReceipts??=new Map();const receiptBinding=strategyExecutionBinding(this);
    let old=this.strategyReceipts.get(requestId);
    if(old&&old.bindingKey!==receiptBinding){this.strategyReceipts.delete(requestId);old=undefined;}
    if(old){if(old.fingerprint!==fingerprint)throw Error('同一战略请求内容不能改变');return old.result;}
    const result={requestId,status:'applying',contract:requested,actions:[]};
    this.strategyReceipts.set(requestId,{fingerprint,result,bindingKey:receiptBinding});this.strategyBusy=true;
    try{
      await this.commandScope();await this.countryAI.heartbeat();
      const bindingKey=strategyExecutionBinding(this);
      if(bindingKey)this.strategyExecutionRecord={bindingKey,result,date:this.lastGameDate??this.lastState?.date??null};
      await this.refreshOperatorStanding(this.lastState);
      const taskIds=[...new Set([...(requested.taskIds??[]),...(requested.domesticActions??[]).map(a=>a.taskId).filter(Boolean)])];
      this.adviceTasks?.require([...taskIds,...(requested.taskUpdates??[]).map(x=>x.taskId)]);
      this.adviceTasks?.start(taskIds,this.lastState);
      this.adviceTasks?.update(requested.taskUpdates??[],this.lastState);
      result.taskIds=taskIds;
      this.modelStrategyContract=requested;
      const checked=resolveStrategyDirection({state:this.lastState,contract:requested}).contract;
      result.contract=checked;
      result.steering=await this.syncStrategyDirection(this.lastState,{force:true});
      if(!result.steering?.confirmed)throw Error('方针未确认，未执行保留决定');
      await this.checkpoint();
      for(const action of checked.domesticActions??[]){
        const receipt={};(result.domesticActions??=[]).push(receipt);
        await this.applyStrategyDomestic(action,receipt,this.lastState);
        await this.checkpoint();
      }
      for(const [index,action] of checked.oneOffActions.entries()){
        await this.countryAI.heartbeat();const state=await this.observe();
        result.actions.push(await this.apply({requestId:requestId.slice(0,70)+'-s'+index,snapshotId:state.snapshotId,explanation:checked.reason,
          orders:[{command:RESERVED_ACTIONS[action.type],arguments:action.arguments}]}));
      }
      result.status='applied';await this.countryAI.acknowledgeReview();this.strategyReview.acknowledge(this.lastState);this.nativeStrategicReviewDue=false;
    }catch(error){result.status='attention';result.error=error.message;}
    finally{
      if(this.strategyExecutionRecord?.result===result)this.strategyExecutionRecord.date=this.lastGameDate??this.lastState?.date??null;
      const explicitStopped=new Set((requested.taskUpdates??[]).filter(x=>['blocked','superseded'].includes(x.status)).map(x=>x.taskId));
      this.adviceTasks?.finish((result.taskIds??[]).filter(id=>!explicitStopped.has(id)),result,this.lastState??{});
      this.strategyBusy=false;await this.checkpoint();
    }
    return {...result,control:this.countryAI.view(),adviceExecution:this.adviceTasks?.view()};
  }
  queueEvidence(event) {
    if(!this.journal)return;
    try{
      const task=Promise.resolve(this.log(event)).catch(()=>{this.evidenceIncomplete=true;});
      this.evidencePending.add(task);void task.finally(()=>this.evidencePending.delete(task));
    }catch{this.evidenceIncomplete=true;}
  }
  async ensurePicture() {
    const picture = await this.rpc('get_picture_state');
    this.picture = picture;
    if (this.requirePicture && (picture.rendering !== true || picture.visible !== true)) {
      await this.rpc('set_paused', {paused: true});
      throw new Error('游戏画面不可见或已最小化，已暂停操作；恢复游戏画面后继续');
    }
    return picture;
  }
  async presentOrder(order) {
    if(!this.presentOrders)return {interrupted:false};
    const plan=presentationPlan(order,this.lastState),{panel,fleetId}=plan;
    if(plan.skip||plan.kind==='none')return {interrupted:false};
    const ownedPlanet=this.lastState.colonies?.some(sector=>sector.colonies_summary?.some(planet=>planet.planet_id===plan.planetId));
    if(panel==='game'&&fleetId===undefined&&!ownedPlanet){await this.log({type:'presentation_unavailable',command:order.command,reason:'当前没有可确认的对应面板或镜头目标'});return {interrupted:false,notShown:true};}
    const blocked=await this.checkPresentationInterruption();
    if(blocked)return {interrupted:true,reason:blocked};
    const targetKey=JSON.stringify({fleetId,planet:order.arguments.planet_id,panel});
    const closed=await this.rpc('show_panel',{panel:'game'});
    if(closed.success!==true) {const error=new Error('未能整理游戏可见面板，暂停这条操作');error.rejected=true;throw error;}
    if (fleetId!==undefined) {
      const presentation = await this.rpc('focus_fleet', {fleet_id: fleetId});
      await this.log({type: 'presentation', command: order.command, presentation});
      if (presentation.success !== true || presentation.camera_target_id !== fleetId) {
        const error = new Error('未能把游戏镜头定位到目标舰队，暂不下达这条操作'); error.rejected = true; throw error;
      }
    } else if(order.arguments.planet_id!==undefined && this.lastState.colonies?.some(sector=>sector.colonies_summary?.some(planet=>planet.planet_id===order.arguments.planet_id))) {
      const presentation=await this.rpc('focus_planet',{planet_id:order.arguments.planet_id});
      await this.log({type:'presentation',command:order.command,presentation});
      if(!presentation.success||presentation.camera_target_id!==order.arguments.planet_id) {const error=new Error('无法展示目标殖民地，暂停这条操作');error.rejected=true;throw error;}
    }
    if(panel!=='game') {const shown=await this.rpc('show_panel',{panel});await this.log({type:'presentation_panel',command:order.command,presentation:shown});if(!shown.success) {const error=new Error('目标游戏面板未显示，暂停这条操作');error.rejected=true;throw error;}}
    this.presentationKey=targetKey; this.presentationPanel=panel; this.presentedAt = this.now();
    this.presentationTimeline.begin({...plan,command:order.command});
    await this.log({type:'presentation_open',command:order.command,panel,kind:plan.kind,previewMs:plan.urgent?0:2000,durationMs:plan.urgent?0:10000});
    return this.presentationTimeline.preview(()=>this.checkPresentationInterruption());
  }
  cancelPresentation(reason='控制会话正在停止'){this.gestalt.pause();this.presentationStopRequested=true;this.presentationBlocked=reason;this.presentationTimeline.cancel(reason);}
  async checkPresentationInterruption(){
    if(this.stopped||this.presentationStopRequested)return this.presentationBlocked='控制会话正在停止';
    try{
      await this.guard();await this.ensurePicture();
      const events=await this.rpc('get_active_events'),wars=await this.rpc('get_wars'),alerts=await this.rpc('get_alerts');
      if(this.stopped||this.presentationStopRequested)return this.presentationBlocked||'控制会话正在停止';
      if(!Array.isArray(events)||!Array.isArray(wars?.wars)||!Array.isArray(alerts))throw Error('展示安全检查未返回完整状态');
      const previous=new Set((this.lastState?.alerts||[]).map(x=>x.type));
      const knownWars=new Set((this.lastState?.wars||[]).map(x=>x.war_id));
      const newWar=wars.wars.some(x=>!knownWars.has(x.war_id));
      if(events.length||wars.warGoalsWindow||newWar||alerts.some(x=>urgentAlert(x)&&!previous.has(x.type))){
        await this.rpc('set_paused',{paused:true});
        return this.presentationBlocked=events.length||wars.warGoalsWindow?'中央事件或战争目标窗口需要处理':'新战争或敌情需要立即检查';
      }
    }catch{this.presentationStopRequested=true;try{await this.rpc('set_paused',{paused:true});}catch{}return this.presentationBlocked='停止、画面隐藏或状态检查不可用，已中断展示';}
  }
  async finishPresentation() {
    if(!this.presentationTimeline.active&&!this.presentationKey)return;
    const held=await this.presentationTimeline.hold(()=>this.checkPresentationInterruption());
    const blocked=held.reason||await this.checkPresentationInterruption();
    if(held.interrupted||blocked){this.presentationTimeline.end();await this.log({type:'presentation_interrupted',panel:this.presentationPanel,reason:blocked||'展示已停止'});return;}
    if(this.presentationPanel==='game'){const shown=this.presentationTimeline.end();await this.log({type:'presentation_complete',kind:'camera',durationMs:shown?this.presentationTimeline.now()-shown.started:0});this.presentationKey=undefined;return;}
    const response=await this.rpc('show_panel',{panel:'game'});
    const shown=this.presentationTimeline.end();
    if(response.success!==true){this.presentationBlocked='真实面板未能关闭，需要重新观察';await this.log({type:'presentation_close_failed',panel:this.presentationPanel,response});return;}
    await this.presentationTimeline.wait(350);
    if(this.presentationStopRequested||this.stopped)return;
    await this.log({type:'presentation_complete',panel:this.presentationPanel,response,durationMs:shown?this.presentationTimeline.now()-shown.started:0});
    if(response.success===true){this.presentationPanel='game';this.presentationKey=undefined;}
  }
  async log(event) {await appendFile(this.journal, JSON.stringify({at: new Date(this.now()).toISOString(), ...event}) + '\n');}
  async guard() {
    if(this.stoppingRequested)throw new Error(this.stopReason||'控制会话正在停止');
    if(this.stopped)throw new Error(this.stopReason||'当前控制会话已停止，不能继续使用旧会话');
    if(this.now()>=this.ends)throw new Error('测试时长已到，结束本轮');
    if(this.lastState?.terminal) throw new Error(this.lastState.terminal.message);
    try {if ((await stat(this.stopFile)).mtimeMs >= this.started) throw new Error('已收到停止指令');} catch (error) {if (error.code !== 'ENOENT') throw error;}
    const status = await this.rpc('get_status');
    if(this.binding&&this.pipe instanceof NativePipe&&this.boundReadEpoch!==this.pipe.connectionEpoch){
      try{
        const epoch=this.pipe.connectionEpoch,identity=await this.processReader({op:'bound_identity',pid:this.binding.pid,creationTime:this.binding.creationTime});
        if(identity.pid!==this.binding.pid||identity.creationTime!==this.binding.creationTime||epoch!==this.pipe.connectionEpoch)throw Error('桥重连后的进程身份不匹配，需要重新绑定');
        this.boundReadEpoch=epoch;
      }catch(error){this.runtimeStatus={sessionId:this.sessionId,observedAt:this.now(),paused:null,date:null,scopeUnknown:true};throw error;}
    }
    if(status.is_paused===true&&this.expectedPaused===false)this.externalPauseObserved=true;
    if(status.is_paused===false)this.externalPauseObserved=false;
    if (!status.in_game) throw new Error('当前没有载入单人测试局');
    const current = day(status.date?.formatted);
    if (current === null || this.lastDay !== undefined && current < this.lastDay) throw new Error('游戏日期回退或未知，会话需要重新绑定');
    const capital = status.outliner?.sectors_summary?.capital_system;
    if (this.capital !== undefined && this.capital !== capital) throw new Error('帝国身份发生变化，停止旧计划');
    this.lastDay = current; this.capital = capital;this.lastGameDate=status.date?.formatted;
    return status;
  }
  async observe() {
    await this.assertNativeWorld();
    const status = await this.guard();
    const economyObservedAt=this.now();
    // Initial observation can open a pending choice or pause before lastState
    // exists. Bind its read-only world identity before those command writes.
    const world = await this.rpc('get_galaxy_overview');
    if (!id(world.player?.country_id)||!id(world.player?.capital_system_id)) throw new Error('无法确认本地玩家或首都 ID');
    if (this.boundPlayer && (this.boundPlayer.country_id!==world.player.country_id||this.boundPlayer.capital_system_id!==world.player.capital_system_id)) throw new Error('本地玩家或首都身份改变');
    if (this.countryId !== undefined && this.countryId !== world.player.country_id) throw new Error('本地玩家身份改变');
    this.boundPlayer??={country_id:world.player.country_id,capital_system_id:world.player.capital_system_id};
    this.countryId=world.player.country_id;
    if(!this.government||this.now()-(this.governmentAt||0)>180000){this.government=await this.rpc('get_government');this.governmentAt=this.now();}
    const civilian = await this.rpc('get_civilian_fleets');
    const research = await this.rpc('get_research_state');
    const military = await this.rpc('get_military_fleets');
    const diplomacy = await this.rpc('get_pending_diplomacy');
    const alerts = await this.rpc('get_alerts');
    let events = await this.rpc('get_active_events');
    const warState = await this.rpc('get_wars');
    const ascensionPerks=this.nativeCountryAIEnabled?(await this.rpc('get_traditions')).ascension_perks:undefined;
    // First-contact stage decisions live behind a HUD alert, not the ordinary
    // central event queue. Surface the actual pending choice before planning.
    const contactAlert=Array.isArray(alerts)&&alerts.find(row=>row.type==='alert_first_contact_stage_done');
    const contactAlertKey=contactAlert&&JSON.stringify(fields(contactAlert,['alert_id','title','description']));
    if(!this.countryAI.active && contactAlert && contactAlertKey!==this.lastOpenedContactAlert && Array.isArray(events) && !events.length && !warState.warGoalsWindow) {
      // An informational first-contact panel can leave the same HUD alert up.
      // Reopening it on every observe prevents the game from ever resuming.
      this.lastOpenedContactAlert=contactAlertKey;
      const opened=await this.rpc('open_alert',{alert_id:contactAlert.alert_id});
      if(opened.success) events=await this.rpc('get_active_events');
    }
    if(!this.countryAI.active && (warState.warGoalsWindow || Array.isArray(events) && events.length)) {
      await this.rpc('set_paused',{paused:true});status.is_paused=true;
    }
    const leaderState = await this.rpc('get_leaders');
    const scienceIds = (civilian.science_ships || []).map(row => row.fleet_id);
    const mapping = await this.processReader({op: 'ships', ...this.binding, fleetIds: scienceIds});
    for (const row of civilian.science_ships || []) {
      const ships = mapping.fleets.find(entry => entry.fleetId === row.fleet_id)?.shipIds;
      if (ships?.length !== 1) continue;
      row.ship_id = ships[0];
      const leader = leaderState.hired_leaders?.find(entry => entry.assignment_type === 'fleet' && entry.target_id === row.ship_id);
      if (leader) Object.assign(row, {leader_id: leader.id, leader_name: leader.name, leader_level: leader.level});
    }
    if (this.countryId !== undefined && this.countryId !== world.player?.country_id) throw new Error('本地玩家身份改变');
    this.countryId = world.player?.country_id;
    if (!id(this.countryId)) throw new Error('无法确认本地玩家 ID');
    this.snapshotId = `${this.sessionId}:${++this.revision}`; this.snapshotAt = this.now();
    const state = {
      snapshotId: this.snapshotId, remainingSeconds: Math.max(0, Math.round((this.ends - this.now()) / 1000)),
      date: status.date.formatted, paused: status.is_paused, speed: status.speed,
      ...(status.resources&&typeof status.resources==='object'&&!Array.isArray(status.resources)&&Object.keys(status.resources).length?{economyObservedAt}:{}),
      controlCapabilities:{surveyDelegationAvailable:this.hybridSurvey,colonyHousingAvailable:!this.nativeRoutineSuppressed&&!this.surveyPilot,colonyUpgradeAvailable:this.colonyUpgradePilot,monthlyConditionsAvailable:this.monthlyLifecyclePilot,trustedWaitMaximumSeconds:this.nativeCountryAIEnabled?900:this.hybridSurvey?this.surveyWatchSeconds:this.localWaitPilot?60:20,note:'可用能力不是已启用的对象控制权；委派须显式申请并核对实际条件。'},
      player: world.player, resources: Object.fromEntries(Object.entries(status.resources || {}).filter(([key]) => ['energy', 'minerals', 'alloys', 'consumer_goods', 'food', 'influence', 'unity', 'trade', 'physics_research', 'society_research', 'engineering_research', 'volatile_motes', 'exotic_gases', 'rare_crystals', 'living_metal', 'zro', 'dark_matter', 'nanites', 'astral_threads'].includes(key)).map(([key, value]) => [key, fields(value, ['stockpile', 'net', 'capped','max','income','expense','net_known','income_known','expense_known'])])),
      civilian, military, research, colonies: status.outliner?.sectors_summary?.sectors,
      capacities: status.stats, picture: this.picture,
      pendingDiplomacy: diplomacy.pending,
      wars: warState.wars, warGoalsWindow: warState.warGoalsWindow,
      alerts: Array.isArray(alerts) ? alerts.map(row=>fields(row,['alert_id','type','title','description'])) : [],
      council: status.council, traditions: status.society?{...status.society,
        next_tradition_cost_known:status.society.next_tradition_cost_known===true,
        edict_fund:status.society.edict_fund_known===true?status.society.edict_fund:null,
        edict_fund_known:status.society.edict_fund_known===true}:status.society,
      ...(this.nativeCountryAIEnabled?{ascensionPerks:ascensionPerks??null}:{}),
      leaders: {...status.leaders, leader_capacity: Number.isInteger(status.leaders?.leader_capacity) && status.leaders.leader_capacity >= 0 && status.leaders.leader_capacity < 1000 ? status.leaders.leader_capacity : null},
      pendingEvents: Array.isArray(events) ? events.map(row => fields(row, ['window_id', 'title', 'event_key','kind','first_contact_id'])) : [],
      note: '来自当前游戏原生接口。指令返回 posted 仅表示提交；后续状态、订单或队列才是效果证据。'
    };
    // The current adapter supports settled empires. A destroyed empire is a
    // terminal recovery case, not another empty economy for the supervisor.
    if(state.player?.owned_systems===0 && state.capacities?.colonies===0) {
      state.terminal={kind:'no_playable_empire',message:'玩家已失去全部星系和殖民地，已停止操作以检查战败状态'};
      await this.rpc('set_paused',{paused:true});state.paused=true;
    }
    await this.refreshOperatorStanding(state);
    state.operationalFacts=this.operationalContext.view({ownedPlanetIds:(state.colonies||[]).flatMap(s=>(s.colonies_summary||[]).map(p=>p.planet_id))});
    state.capabilities=executionCapabilities(Object.keys(ORDER_FIELDS));
    if(this.nativeCountryAIEnabled){state.strategyContract=this.strategyContract??null;state.strategyExecution=this.strategyExecutionView();state.nativeWorldGeneration=this.boundNativeWorld?.world_generation;state.countryAIControl={enabled:true,...this.countryAI.view()};}
    if(!this.continuityLoaded){
      this.continuityLoaded=true;
      const saved=await this.continuity.load(this.binding,state);
      if(saved){this.growthTracker.restore(saved.growth,state);this.stationFailures=new Map(saved.stationFailures||[]);this.orderTracker?.restore(saved.orderTracking,{state});this.adviceTasks?.restore(saved.adviceExecution,state);this.nativeIntentExecution??=new NativeIntentExecution();this.nativeIntentExecution.restore(saved.nativeIntent,strategyExecutionBinding(this));this.unknownDomesticCommands=new Set((saved.domesticUnknown??[]).filter(x=>typeof x==='string'&&x.length<=2000).slice(-128));}
    }
    this.growthTracker.record(state);
    if(this.nativeCountryAIEnabled)await this.refreshNativeColonyAudit(state);
    await this.refreshOrderTracking(state);
    await this.gestalt.bind(this.binding,state);
    await this.gestalt.update(state,this.orderTracker?.view()||[]);
    state.colonyControl=this.colonyRoutine.view();
    state.colonyUpgradeControl={...this.colonyUpgradeRoutine.view(),enabled:this.colonyUpgradePilot};
    state.monthlyControl=this.monthlyControlView();
    if(!this.gestalt.data.campaign?.execution)reviewCampaign(this.gestalt.data.campaign,state);
    await this.gestalt.save();
    state.strategyCards=this.nativeCountryAIEnabled?[]:STRATEGY_CARDS;
    state.gestalt=this.gestalt.view();
    if(this.hybridSurvey||Object.keys(this.surveyDelegation.view().records||{}).length)state.surveyControl=this.surveyDelegation.view();
    state.strategy=this.reviewStrategy(state);
    // Direction must see this round's growth and colony audit, rather than the
    // preceding observation. Only the existing verified steering path writes.
    await this.syncStrategyDirection(state);
    state.strategy=this.reviewStrategy(state);
    if(this.nativeCountryAIEnabled){this.adviceTasks?.observe(state);state.adviceExecution=this.adviceTasks?.view();state.strategy.adviceExecution=state.adviceExecution;}
    if(this.decisionPause)state.decisionAttention={...this.decisionPause,requiresRefresh:false};
    this.needsDecisionRefresh=false;
    this.lastState = state; this.metrics.observations++;
    if(this.localWaitPilot)state.localWorkWait={enabled:true,...await this.confirmedLocalWork(status)};
    await this.log({type: 'state', state}); await this.checkpoint();
    return state;
  }
  async refreshNativeColonyAudit(state){
    this.nativeColonyAudit??=new NativeColonyAudit();
    state.colonyAudit=await this.nativeColonyAudit.review(state,{rpc:(m,p)=>this.rpc(m,p),onPlanet:raw=>{
      this.colonyReviews.delete(raw.planet_id);this.colonyReviews.set(raw.planet_id,{...colonyReview(raw),at:this.now()});
      if(this.colonyReviews.size>32)this.colonyReviews.delete(this.colonyReviews.keys().next().value);
      this.operationalContext.record('planet',fields(raw,['planet_id','name','designation','designation_key','kpi','workforce_summary','construction_queue','monthly_production']),{gameDate:state.date});
    }});
    state.operationalFacts=this.operationalContext.view({ownedPlanetIds:(state.colonies||[]).flatMap(s=>(s.colonies_summary||[]).map(p=>p.planet_id))});
  }
  async applyStrategyDomestic(action,receipt={},policyState=this.lastState){
    const unknownKey=stableJson([strategyExecutionBinding(this),action.type,action.arguments]);
    this.unknownDomesticCommands??=new Set();
    try{
      await applyDomesticAction({action,receipt,policyState,rpc:(m,p)=>this.rpc(m,p),
        checkScope:async()=>{
          if(this.countryAI.view().owner!=='native'||this.stoppingRequested||this.stopped)throw Error('原生经营控制权已改变，停止国内战略设置');
          await this.commandScope();
        },heartbeat:()=>this.countryAI.heartbeat(),write:async(method,params)=>{
          if(this.unknownDomesticCommands.has(unknownKey))throw Object.assign(Error('相同国内设置仍有未确认命令，不能更换请求编号重发'),{nativeWriteAttempted:false});
          strategyDomesticWrites.set(this,{method,params});
          try{return await this.rpc(method,params);}finally{strategyDomesticWrites.delete(this);}
        }});
      if(receipt.confirmed===true)this.unknownDomesticCommands.delete(unknownKey);
      return receipt;
    }catch(error){if(receipt.status==='unknown')this.unknownDomesticCommands.add(unknownKey);throw error;}
  }
  async correctNativeIntent(state){
    if(state.userEconomicPolicy?.edictPolicy!=='unity_net_gain'||this.countryAI.view().owner!=='native'||this.stoppingRequested||this.stopped)return this.nativeIntentCorrection??null;
    const currentDay=day(state.date),key=stableJson([state.userEconomicPolicy.updatedAt,this.countryAI.view().generation]);
    if(currentDay===null||this.nativeIntentCorrectionKey===key&&Number.isFinite(this.nativeIntentCorrectionDay)&&currentDay>=this.nativeIntentCorrectionDay&&currentDay-this.nativeIntentCorrectionDay<180)return this.nativeIntentCorrection??null;
    this.nativeIntentCorrectionDay=currentDay;this.nativeIntentCorrectionKey=key;
    const correction=this.nativeIntentCorrection={date:state.date,actions:[],deferred:[]};
    try{
      await this.commandScope();await this.countryAI.heartbeat();
      const edicts=await this.rpc('get_edicts'),status=await this.rpc('get_status'),wars=await this.rpc('get_wars');
      const fresh={...state,resources:status.resources,wars:wars.wars,warGoalsWindow:wars.warGoalsWindow};
      const review=ownerEconomicPolicyReview(fresh,{edicts});
      correction.deferred=review.deferred;
      for(const action of review.domesticActions){
        const receipt={};correction.actions.push(receipt);
        await this.applyStrategyDomestic(action,receipt,fresh);
      }
    }catch(error){correction.error=error.message;}
    return correction;
  }
  async refreshOperatorStanding(state){
    state.operatorMessages=[];
    try{
      const guidance=JSON.parse(await readFile(this.guidanceFile,'utf8'));
      if(guidance.pid===this.binding.pid&&Number.isFinite(guidance.expiresAt)&&guidance.expiresAt>this.now())
        state.operatorMessages=Array.isArray(guidance.messages)?guidance.messages.filter(x=>typeof x==='string'&&!hasProductionIdentity(x)).slice(0,4).map(x=>x.slice(0,300)):[];
    }catch{}
    const advice=await readStrategyAdvice(resolve(this.directory,'../commentary/strategy-directive.json'),this.sessionId,this.now());
    if(this.nativeCountryAIEnabled){
      this.adviceTasks??=new AdviceExecution({now:this.now});
      this.adviceTasks.bind(this.sessionId,strategyExecutionBinding(this),state);
      if(advice)this.adviceTasks.ingest(advice.executionTasks,state);
      state.adviceExecution=this.adviceTasks.view();
    }
    if(advice)state.operationalGoal=advice.goal;else delete state.operationalGoal;
    if(advice&&this.lastAdviceId!==advice.id){this.lastAdviceId=advice.id;await this.log({type:'strategy_advice_read',adviceId:advice.id,sessionId:this.sessionId,snapshotId:state.snapshotId,executed:false});}
    const standing=await readOperatorStanding(resolve(this.directory,'../commentary/operator-standing.json'),this.sessionId,this.now());
    this.operatorStanding=standing;
    if(standing){state.operatorMessages.push(standing.text);state.operatorStanding=standing;}else delete state.operatorStanding;
    const preferences=await readGameplayPreferences(resolve(this.directory,'../gameplay-preferences.json'),{standing,now:this.now()});
    if(preferences){state.userEconomicPolicy=preferences;state.operatorMessages.unshift(preferences.note);}else delete state.userEconomicPolicy;
  }
  async syncStrategyDirection(state,{force=false}={}){
    const standing=state.operatorStanding,active=this.nativeCountryAIEnabled&&this.countryAI.view().owner==='native'&&!this.stoppingRequested&&!this.stopped;
    if(!standing&&!state.userEconomicPolicy&&!this.directionManaged&&!force&&!state.operationalGoal?.targetResource)return;
    const intent=compileNativeIntent(state,this.modelStrategyContract),direction={contract:intent.contract,reason:intent.contract.reason},effective={...direction.contract,oneOffActions:[]};
    const previousIntent=state.nativeIntent??this.lastState?.nativeIntent;
    if(previousIntent?.status==='stalled'&&previousIntent.targetResource===intent.targetResource&&this.nativeIntentExecution?.record?.key===intent.key&&!intent.emergency){effective.expansionStance='consolidate';effective.reason=(effective.reason+'；实际目标停滞，先消化现有负担并纠偏').slice(0,300);}
    const ownerPolicy=intent.ownerPolicy;
    const key=stableJson([effective.economyFocus,effective.expansionStance,effective.militaryStance,ownerPolicy,this.countryAI.view().generation]);
    let confirmed=false,reason=direction.reason;
    const hasDirection=!!standing?.economyFocus||!!state.userEconomicPolicy||!!state.operationalGoal?.targetResource||!!this.modelStrategyContract||this.directionManaged||force;
    if(active&&hasDirection&&!this.directionApplying){
      this.directionManaged=true;
      if(this.directionAttempt?.key!==key||force&&this.directionAttempt?.confirmed===true){
        this.directionApplying=true;this.directionAttempt={key,confirmed:false};
        try{
          await this.commandScope();await this.countryAI.heartbeat();
          await applySteering({contract:effective,rpc:(m,p)=>this.rpc(m,p),heartbeat:async()=>{
            if(this.stoppingRequested||this.stopped)throw Error('会话已停止');
            await this.countryAI.heartbeat();if(this.countryAI.view().owner!=='native')throw Error('原生持权已结束');
          }});
          if(typeof this.countryAI.setOwnerPolicy==='function')await this.countryAI.setOwnerPolicy(ownerPolicy);
          else if(Object.values(ownerPolicy).some(Boolean))throw Error('当前桥未提供本人经营约束，不能把引导开关当作已落实');
          this.directionAttempt.confirmed=true;
          this.strategyContract={...effective,at:this.now(),date:state.date,steeringConfirmed:true};
        }catch(error){this.directionAttempt.confirmed=false;this.directionAttempt.error=error.message;}
        finally{this.directionApplying=false;}
      }
      confirmed=this.directionAttempt?.key===key&&this.directionAttempt.confirmed===true;
      if(confirmed&&this.strategyContract?.reason!==direction.reason)this.strategyContract={...this.strategyContract,reason:direction.reason,at:this.now(),date:state.date};
      if(!confirmed)reason=this.directionAttempt?.error??'引导方针未确认；未重放未确认命令';
    }else reason=!active?'原生AI未持权，常驻要求已读取，尚未切换方针':!hasDirection?'尚未解析出经济档位，要求原文已转交战略决策':'方针切换正在进行';
    if(standing||this.lastStandingId){
      const receipt={operatorStandingId:standing?.id??this.lastStandingId,readAt:this.now(),appliedFocus:this.strategyContract?.economyFocus??null,
        steeringApplied:!!standing?.economyFocus&&confirmed,reason:standing?reason:confirmed?'常驻要求已撤销或心跳失联，已恢复参谋目标或模型方针':'常驻要求已撤销；恢复方针尚未确认'};
      try{await writeControllerReceipt(resolve(this.directory,'../commentary/controller-receipt.json'),receipt);this.controllerReceipt=receipt;}catch{this.receiptWriteFailed=true;}
    }
    this.lastStandingId=standing?.id??null;
    state.strategyContract=this.strategyContract??null;state.controllerReceipt=this.controllerReceipt??null;
    this.nativeIntentExecution??=new NativeIntentExecution();
    const actualPolicy=this.countryAI.view().ownerPolicy??{};
    const ownerPolicyConfirmed=Object.entries(ownerPolicy).every(([key,value])=>actualPolicy[key]===value||value===false&&actualPolicy[key]===undefined);
    const correction=active&&confirmed?await this.correctNativeIntent(state):this.nativeIntentCorrection;
    state.nativeIntent=this.nativeIntentExecution.observe(intent,state,{binding:strategyExecutionBinding(this),steeringConfirmed:active&&confirmed,ownerPolicyConfirmed,correction,controlError:this.directionAttempt?.key===key?this.directionAttempt.error:null,now:this.now()});
    return {confirmed};
  }
  reviewStrategy(state=this.lastState) {
    const owned=(state.colonies||[]).flatMap(x=>x.colonies_summary||[]),own=new Set(owned.map(x=>x.planet_id));
    const colonies=[...this.colonyReviews.values()].filter(x=>this.now()-x.at<180000&&own.has(x.planetId));
    const review=strategicReview(state,{government:this.government,colonies,growth:this.growthTracker.review(state)});
    const recent=new Set(colonies.map(x=>x.planetId));
    review.reviewTargets=owned.filter(x=>!x.is_colonizing&&!recent.has(x.planet_id)).sort((a,b)=>(b.status_alerts_count||0)-(a.status_alerts_count||0)).slice(0,3).map(x=>({planetId:x.planet_id,name:x.name,alerts:x.status_alerts_count}));
    if(this.nativeCountryAIEnabled)return {...review,nativeIntent:state.nativeIntent??null,adviceExecution:this.adviceTasks?.view()??state.adviceExecution??null,mode:'native_strategy',diagnosisMode:review.mode,currentContract:this.strategyContract??null,reviewEveryGameDays:180,
      note:review.note+' 原生AI继续承担日常运营；这些诊断用于调整StrategyContract、保留决定和必要的只读检查，不开放普通经营派单。'};
    return review;
  }
  async inspect({topic, id: entityId, fleet_id, purpose, system_id,district_type,jumps=4,resource,action,units,sections,goal_key,building_key,zone_id} = {}) {
    if(goal_key!==undefined&&(topic!=='attack_options'||typeof goal_key!=='string'||!/^wg_[a-zA-Z0-9_]{1,100}$/.test(goal_key)))throw Error('goal_key仅用于attack_options的当前战争目标');
    const constructionScope=constructionInspectionScope({topic,sections,district_type,building_key,zone_id});
    const buildingTarget=buildingInspectionScope({topic,sections,building_key,zone_id});
    const marketScope=validateMarketInspectionScope({topic,resource,action,units});
    const status=await this.guard();
    if (entityId !== undefined && !id(entityId) || fleet_id !== undefined && !id(fleet_id) || system_id !== undefined && !id(system_id)) throw new Error('无效实体 ID');
    if (['system', 'planet', 'districts', 'buildings','zones','jobs','upgrades','construction'].includes(topic) && entityId === undefined) throw new Error(`${topic} 需要 id`);
    if(buildingTarget){
      const fresh=status.outliner?.sectors_summary?.sectors;
      const owned=Array.isArray(fresh)?fresh:this.lastState?.date===status.date?.formatted?this.lastState.colonies:[];
      if(!owned?.some(s=>s.colonies_summary?.some(p=>p.planet_id===entityId)))throw Error('定向建筑核验只支持已确认的当前己方殖民地');
    }
    let result;
    if(topic==='war_fleets')return this.rpc('get_war_fleets');
    if(topic==='armies')return entityId===undefined?this.rpc('get_armies'):this.rpc('get_planet_armies',{planet_id:entityId});
    if(['attack_options','peace_options','landing','invasion'].includes(topic)){
      if(entityId===undefined)throw Error('战争查询需要 id');
      if(topic==='landing'&&fleet_id===undefined)throw Error('登陆查询需要 fleet_id');
      const method={attack_options:'get_attack_options',peace_options:'get_peace_options',landing:'get_landing_options',invasion:'get_invasion_state'}[topic];
      const data=await this.rpc(method,topic==='attack_options'?{country_id:entityId}:topic==='peace_options'?{war_id:entityId}:{planet_id:entityId,...(fleet_id===undefined?{}:{fleet_id})});
      if(topic!=='attack_options')return data;
      const view=attackOptionsView(data,entityId,{goalKey:goal_key});
      this.operationalContext.record(topic,view,{gameDate:this.lastState.date});await this.log({type:'inspect',topic,result:view});return view;
    }
    if (topic === 'leaders') {
      const raw = await this.rpc('get_leaders');
      result = {hired: raw.hired_leaders?.map(x => fields(x, ['id', 'name', 'class', 'level', 'assignment_type', 'target_id', 'title', 'has_unspent_trait_points', 'trait_options', 'trait_upgrade_options'])), candidates: raw.pool_candidates?.map(x => fields(x, ['id', 'name', 'class', 'level', 'hire_cost'])), summary: raw.summary};
    } else if (topic === 'system') {if (entityId === undefined) throw new Error('system 需要 id'); result = await this.rpc('get_system', {system_id: entityId});}
    else if(topic==='construction') {
      if(!this.lastState.colonies?.some(s=>s.colonies_summary?.some(p=>p.planet_id===entityId)))throw Error('建设合并查询只支持当前己方殖民地');
      result=await inspectConstruction({planetId:entityId,scope:constructionScope,rpc:(m,p)=>this.rpc(m,p)});
      this.colonyReviews.delete(entityId);this.colonyReviews.set(entityId,{...colonyReview(result.planet),at:this.now()});
      if(this.colonyReviews.size>32)this.colonyReviews.delete(this.colonyReviews.keys().next().value);
      result.strategicDiagnosis=this.reviewStrategy();
      this.operationalContext.record('planet',result.planet,{gameDate:this.lastState?.date});
      for(const [section,row]of Object.entries(result.sections))this.operationalContext.record(section,row.known?row.data:{planet_id:entityId,coverageKnown:false,coverageReason:row.reason},{gameDate:this.lastState?.date});
    }
    else if(topic==='zones') {
      if(district_type!==undefined&&(typeof district_type!=='string'||!/^district_[a-z_]{1,60}$/.test(district_type)))throw new Error('district_type 需要当前真实区划key');
      result=await this.rpc('get_available_district_zones',{planet_id:entityId,district_type:district_type||'district_city'});
      for(const district of result.districts||[])for(const slot of district.slots||[])if(slot.zone!==null)delete slot.buildable_zones;
      result.note='只为当前空特区槽创建合法特区，不能替换或拆除已有特区。zone_slot是槽位序号，后续建建筑使用新zone_id。';
    }
    else if(topic==='jobs'){
      const audit=this.lastState?.colonyAudit?.colonies?.find(p=>p.planetId===entityId&&p.ageDays<=180);
      const planet=audit?{workforce_summary:{active_jobs_count:audit.activeJobsCount,total_employed_workforce:audit.employedWorkforce}}:{};
      const raw=await this.rpc('get_planet_jobs',{planet_id:entityId});
      result=withConstructionCoverage('jobs',raw,planet);
      if(this.nativeCountryAIEnabled&&needsPlanetJobsSupplement(raw,planet))result=await supplementPlanetJobs({data:result,planetId:entityId,binding:this.binding,worldScope:this.boundNativeWorld,
        ownedColonies:(this.lastState.colonies??[]).flatMap(sector=>sector.colonies_summary??[]),processReader:this.processReader,now:this.now,
        assertScope:async()=>{
          if(this.stoppingRequested||this.stopped)throw Error('会话已停止');
          await this.assertNativeWorld();
          return {binding:{pid:this.binding?.pid,creationTime:this.binding?.creationTime},worldScope:structuredClone(this.boundNativeWorld)};
        }});
    }
    else if (topic === 'planet') {
      if (entityId === undefined) throw new Error('planet 需要 id');
      const raw = await this.rpc('get_planet_details', {planet_id: entityId});
      result = fields(raw, ['planet_id', 'colony_id', 'name', 'designation', 'designation_key', 'governor', 'overview', 'kpi', 'districts', 'construction_queue', 'status_alerts', 'monthly_production', 'workforce_summary']);
      for(const key of ['planetary_features','blockers'])if(Array.isArray(raw[key]))result[key]=raw[key].slice(0,8);
      this.colonyReviews.delete(entityId);this.colonyReviews.set(entityId,{...colonyReview(raw),at:this.now()});
      if(this.colonyReviews.size>32)this.colonyReviews.delete(this.colonyReviews.keys().next().value);
      result.strategicDiagnosis=this.reviewStrategy();
    } else if (topic === 'districts') result = await this.rpc('get_buildable_districts', {planet_id: entityId});
    else if (topic === 'buildings') result = buildingTarget?await inspectBuildingQuote({planetId:entityId,buildingTarget,rpc:(m,p)=>this.rpc(m,p)}):withConstructionCoverage('buildings',await this.rpc('get_buildable_buildings', {planet_id: entityId}));
    else if(topic==='upgrades') {
      if(!this.lastState.colonies?.some(s=>s.colonies_summary?.some(p=>p.planet_id===entityId)))throw new Error('只能查询当前己方殖民地的建筑升级候选');
      result=await this.rpc('get_building_upgrade_candidates',{planet_id:entityId});
    }
    else if (topic === 'ships') {
      result=await this.rpc('get_buildable_ships',{system_id:system_id??this.lastState?.player?.capital_system_id});
      if(Array.isArray(result.queue))this.knownShipyards.add(system_id??this.lastState?.player?.capital_system_id);
      const budget=this.delegationBudgetOptions();
      result.spending_preview_scope={quantity:1,advisoryOnly:true,finalRecheckRequired:true,covers:'current_resource_cost_only',additionalShipUpkeepQuoted:false};
      for(const design of result.buildable||[]){
        try{
          if(result.success!==true||design.can_build!==true||result.buildable.filter(d=>d.design_id===design.design_id).length!==1)throw Error('唯一合法造船候选未确认');
          const admission=checkActualSpending({cost:design.cost,status,...budget,expenseCycle:true});
          design.spending_preview={resourceAdmitted:true,spendable:Object.fromEntries(admission.rows.map(r=>[r.resource,r.available])),maintenance:Object.fromEntries(admission.rows.map(r=>[r.resource,r.maintenance]))};
        }catch(error){design.spending_preview={resourceAdmitted:false,reason:error.message};}
      }
      // No batch has been chosen here. Unknown batch cost is a request for a
      // per-design assessment, not evidence that every military candidate fails.
      const problem=militaryExpansionProblem(status,{inWar:!!this.lastState?.wars?.length,alloySpend:0});
      result.military_expansion_policy={requiresPerDesignAssessment:true,...(problem?{currentConstraint:problem}:{}),civilian_ships_affected:false,note:'单舰资源预览只核对当前费用和维护，整批数量、船坞在建舰容与新增维护仍需最终检查。'};
    }
    else if (topic === 'expansion') {
      if (!['unsurveyed', 'outpost', 'colonizable', 'deposit'].includes(purpose)) throw new Error('需要 purpose=unsurveyed/outpost/colonizable/deposit');
      let center = system_id ?? this.lastState?.player?.capital_system_id;
      if (system_id === undefined && fleet_id !== undefined) {
        const path = await this.rpc('find_path', {fleet_id, to_system_id: center});
        if (id(path.from_system_id)) center = path.from_system_id;
      }
      result = await this.rpc('find_systems', {purpose, fleet_id, from_system_id: center, limit: 50});
      if (Array.isArray(result.systems)) {
        if (purpose === 'deposit') result.systems = result.systems.filter(row => row.owner_id === this.countryId);
        if (purpose === 'outpost') result.systems.sort((a, b) => Number(!!b.can_build && !!b.borders_own_space) - Number(!!a.can_build && !!a.borders_own_space));
        if(purpose!=='outpost')result.systems = result.systems.slice(0, 8);
      }
      if (Array.isArray(result.planets)&&purpose!=='colonizable') result.planets = result.planets.slice(0, 8);
      if(purpose==='outpost'||purpose==='colonizable')result=expansionCandidates(result,this.reviewStrategy({...this.lastState,resources:status.resources,capacities:status.stats}));
      if(!(result.systems?.length||result.planets?.length))result.nextReview||='本次无可执行目标。先处理strategy里的内政、防务和科研；边界、任务或资源有变化再查，不因船闲着就反复请求相同候选。';
      if(purpose==='deposit') {
        result.stationLegality='矿藏存在不等于可建站，须由引擎执行门槛确认；失败目标在相关状态变化前不重试';
        for(const system of result.systems||[])system.stationRefusals=['mining','research'].filter(type=>this.stationFailures.has(stationTarget({system_id:system.id,station_type:type})));
      }
    } else if (topic === 'traditions') result = {...await this.rpc('get_traditions'),...await this.rpc('get_tradition_candidates')};
    else if (topic === 'ascension') result = {...await this.rpc('get_traditions'),...await this.rpc('get_ascension_candidates')};
    else if (topic === 'market') {
      result={...await this.rpc('get_market'),market_fee_percent:null,price_basis:'resource_definition_base_estimate',automatic_trading_available:false,price_note:'必须按本次resource/action/units查询整笔报价；单批均价不能直接乘以其他数量。手续费已含在引擎整笔金额内。'};
      result.monthlyAccounting=monthlyTradeAccounting(status,result,{countryId:this.lastState.player.country_id,...this.delegationBudgetOptions()});
      const quotation=await quoteMarketInspection(result,marketScope,(m,p)=>this.rpc(m,p));
      const quotedResources=quotation.resources;result.quoteScope=quotation.quoteScope;
      const budget=this.delegationBudgetOptions();
      result.native_spending_policy={bridgeVersion:this.bridgeCapabilities?.bridge_version??null,dynamicUpkeepVerified:this.bridgeCapabilities?.features?.includes('actual_market_upkeep_budget')===true,note:this.bridgeCapabilities?.features?.includes('actual_market_upkeep_budget')?'原生末次检查按实际维护和真实容量执行；控制器另保护任务承诺与战略底线。':'当前桥未确认动态维护保护，可能仍因固定库存门槛拒绝；不要换requestId重复尝试同一被拒交易。'};
      result.settlement_spending_budget=tradeBudgetPreview(status.resources?.[result.settlement_currency],{commitments:budget.commitments[result.settlement_currency]??0,floor:budget.floors[result.settlement_currency]??0});
      result.resources=quotedResources.map(entry=>({...entry,spending_budget:tradeBudgetPreview(status.resources?.[entry.key],{commitments:budget.commitments[entry.key]??0,floor:budget.floors[entry.key]??0}),maintenance_plan:routineSalePlan(status.resources?.[entry.key],{batchSize:entry.batch_size,settlement:status.resources?.[result.settlement_currency],commitments:budget.commitments[entry.key]??0,floor:budget.floors[entry.key]??0})}));
      result.price_note+=' 交易保留实际支出周期与3个月负净流量缓冲中的较大值，再保护其他承诺及战略底线；spending_budget只是扣除全部承诺后的建议额度，不是成交或任务授权。';
      if(result.resources.length&&result.resources.every(x=>x.price_basis==='engine_transaction_total')){result.price_basis='engine_transaction_total';result.automatic_trading_available=true;}
    }
    else if (topic === 'alerts') result = await this.rpc('get_alerts');
    else if (topic === 'notifications') result = await this.rpc('get_notifications');
    else if (topic === 'edicts') {
      const raw=await this.rpc('get_edicts');
      if(!Array.isArray(raw?.active_edicts))throw Error('当前法令清单不可读，不能当作没有开启法令');
      const summary=raw.summary??{},fundKnown=summary.edict_fund_known===true&&Number.isFinite(summary.edict_fund)&&summary.edict_fund>=0,listComplete=Number.isSafeInteger(summary.active_edicts_count)&&summary.active_edicts_count===raw.active_edicts.length;
      result={summary:{active_edicts_count:Number.isSafeInteger(summary.active_edicts_count)&&summary.active_edicts_count>=0?summary.active_edicts_count:raw.active_edicts.length,
        edict_fund:fundKnown?summary.edict_fund:null,edict_fund_known:fundKnown},
        active_edicts:raw.active_edicts.map(row=>{const upkeepKnown=row.upkeep_known===true&&row.upkeep!==undefined&&row.upkeep!==null;return {...fields(row,['key','name']),upkeep:upkeepKnown?row.upkeep:null,upkeep_known:upkeepKnown};}),
        active_edicts_complete:listComplete,maintenance_details_known:listComplete&&raw.active_edicts.every(row=>row.upkeep_known===true&&row.upkeep!==undefined&&row.upkeep!==null),
        note:'这是当前启用法令的只读清单。未由原生接口确认的法令经费和逐项维护均标未知，不能把旧桥默认0当实际免费；凝聚力总支出仍看资源结算。普通法令经strategy_contract.domesticActions的受限入口调整；只有实际回读确认才能称已关闭，系统和角色维护法令不可修改。'};
    }
    else if (topic === 'government') {
      const government=await this.rpc('get_government'),council=(await this.rpc('get_status')).council;
      this.government=government;this.governmentAt=this.now();
      // The detailed agenda query can disagree with its own summary. The HUD
      // query is also what the normal finish-agenda command uses for its gate.
      if(typeof council?.active_agenda==='string')government.agenda={key:council.active_agenda,name:council.active_agenda_name,
        progress:council.agenda_progress,cost:council.agenda_cost,is_ready:council.agenda_ready};
      result={...government,available_agendas:councilAgendaCandidates(government),agenda_candidate_policy:'仅列已核验的当前思潮议程；其他脚本前提尚未接通，不把原生命令候选冒充合法界面候选',appointments:await this.rpc('get_council_candidates')};
    }
    else if (topic === 'events') result = await this.rpc('get_active_events');
    else if (topic === 'threats') result = await this.rpc('get_defense_scan');
    else if (topic === 'wars') result = await this.rpc('get_wars');
    else if (topic === 'war_goals') {
      if(entityId===undefined) throw new Error('war_goals 需要战争 id');
      result=await this.rpc('get_war_goal_candidates',{war_id:entityId});
    }
    else if (topic === 'research') result = await this.rpc('get_research_state');
    else if(topic==='strategy')result=this.reviewStrategy({...this.lastState,resources:status.resources,capacities:status.stats});
    else if (topic === 'map') {
      if(!Number.isSafeInteger(jumps)||jumps<1||jumps>12)throw Error('地图查询范围需要1..12跳');
      result=await this.rpc('get_galaxy_map',{center_system_id:system_id??this.lastState.player.capital_system_id,jumps});
    }
    else if(topic==='claim_quote'){
      if(entityId===undefined)throw Error('claim_quote需要目标星系id');
      result=await this.rpc('get_claim_quote',{system_id:entityId});
      result.advisoryOnly=true;result.next='新增一次宣称用claim_system(system_id)，执行会重新读取费用并保护共享预算；tasks add的budget须覆盖cost，空预算不能支出。无殖民地征服可配置campaign start planets:[]，合法战争目标由引擎核对。';
    }
    else if(topic==='targets'){
      const contacts=await this.rpc('get_contacts',{mode:'empires'});
      const known=new Map((contacts.empires||[]).filter(c=>c.country_type==='default'&&c.has_communications===true&&c.country_id!==this.lastState.player.country_id).map(c=>[c.country_id,c]));
      const map=await this.rpc('get_galaxy_map',{center_system_id:system_id??this.lastState.player.capital_system_id,jumps:12});
      const columns=['id','name','owner_id','intel','jumps','flags'];if(!Array.isArray(map.columns)||!Array.isArray(map.rows)||columns.some(k=>!map.columns.includes(k)))throw Error('征服候选地图字段覆盖未知');
      const column=Object.fromEntries(columns.map(k=>[k,map.columns.indexOf(k)]));
      result={source:'current_known_contacts_and_map',scope:'within_12_hyperlane_jumps',center_system_id:system_id??this.lastState.player.capital_system_id,automaticWarAuthorized:false,candidates:map.rows.filter(r=>Array.isArray(r)&&id(r[column.id])&&known.has(r[column.owner_id])&&r[column.intel]>=1&&Number.isInteger(r[column.jumps])&&r[column.jumps]>=0&&/[CB]/.test(String(r[column.flags]))).sort((a,b)=>a[column.jumps]-b[column.jumps]).slice(0,8).map(r=>({country_id:r[column.owner_id],country:known.get(r[column.owner_id]).name,system_id:r[column.id],system:r[column.name],jumps:r[column.jumps],intel:r[column.intel],flags:r[column.flags],detailsKnown:false})),next:'主动比较可核实征服收益与备战缺口，选定后campaign select；条件具备就start推进。没有合适目标时可从已知边境system_id继续查询；再inspect system/attack_options/route；殖民地仅用known_colonies登陆；已确认无殖民地星系可用planets:[]，无需运输军；未知不能当空'};
      for(const candidate of result.candidates.slice(0,3)){
        const system=await this.rpc('get_system',{system_id:candidate.system_id});
        candidate.detailsKnown=system.id===candidate.system_id&&system.owner_id===candidate.country_id&&Array.isArray(system.planets);
        candidate.systemOnlyConfirmed=candidate.detailsKnown&&confirmedUncolonizedSystem(system,candidate.country_id);
        candidate.player_claims=Number.isSafeInteger(system.player_claims)&&system.player_claims>=0?system.player_claims:null;
        candidate.claim_required=candidate.player_claims===null?null:candidate.player_claims===0;
        candidate.campaignExecutionHint=candidate.systemOnlyConfirmed?{target:candidate.country_id,targetSystem:candidate.system_id,planets:[],transportRequired:false}:null;
        candidate.nextChecks=[{topic:'claim_quote',id:candidate.system_id},{topic:'attack_options',id:candidate.country_id}];
        candidate.objectiveType=candidate.systemOnlyConfirmed?'uncolonized_system':candidate.detailsKnown&&system.planets.some(p=>id(p.colony_id)&&p.owner_id===candidate.country_id)?'colony':'reconnaissance_required';
        candidate.known_colonies=(system.planets||[]).filter(p=>id(p.id)&&id(p.colony_id)&&p.owner_id===candidate.country_id).map(p=>({planet_id:p.id,colony_id:p.colony_id,name:p.name,class:p.class}));
        const defenders=Array.isArray(system.fleets)?system.fleets.filter(f=>f.owner_id===candidate.country_id&&['shipclass_military','shipclass_starbase','shipclass_military_station'].includes(f.ship_class)):null;
        candidate.visible_orbital_power=system.intel>=3&&defenders&&defenders.every(f=>Number.isFinite(f.military_power)&&f.military_power>=0)?defenders.reduce((n,f)=>n+f.military_power,0):null;
        candidate.total_enemy_and_ally_power_known=false;
        candidate.required_checks=['当前合法战争目标','己方实际战力与对方参战关系',candidate.systemOnlyConfirmed?'主力进攻路线':'主力与搭载陆军的运输舰路线','维护及宣称预算'];
        if(!candidate.known_colonies.length&&!candidate.systemOnlyConfirmed)candidate.blockedReason='当前尚无可确认的殖民地；先补情报，不能拿恒星或星系ID当登陆目标';
      }
    }
    else if(topic==='route') {
      if(fleet_id===undefined||system_id===undefined)throw new Error('route 需要 fleet_id 和目标 system_id');
      result=await this.rpc('find_path',{fleet_id,to_system_id:system_id});
    }
    else if (topic === 'military') {
      result={...await this.rpc('get_fleets',fleet_id===undefined?{}:{fleet_id}),tactics:await this.rpc('get_fleet_tactics')};
      for(const fleet of result.fleets||[])fleet.capacity_check=fleetCapacity(fleet,result.tactics.fleets?.find(x=>x.fleet_id===fleet.fleet_id));
      result.empire_naval_capacity=status.stats?.naval_capacity;
      const yards=await this.rpc('get_shipyards');
      const budget=yards.success===true&&yards.coverage_complete===true&&yards.coverage_scope==='owned_system_starbase_shipyards'&&Array.isArray(yards.shipyards)?yards.shipyards.map(yard=>queuedNavalBudget(yard,result)):[];
      const known=yards.coverage_complete===true&&yards.success===true&&yards.coverage_scope==='owned_system_starbase_shipyards'&&Array.isArray(yards.shipyards)&&yards.shipyards.every(yard=>yard.queue_complete===true&&yard.naval_costs_complete===true)&&budget.every(x=>x.known);
      result.shipyard_budget={coverage_scope:'owned_system_starbase_shipyards',known,points:known?budget.reduce((n,x)=>n+x.points,0):null,note:'仅覆盖当前执行接口支持的己方星系星基船坞；不含未接入的移动船坞'};
      result.naval_cost_review={limitKind:'upkeep_soft_limit',projectedShipUpkeepKnown:false,reason:'当前接口只有真实舰容、在建队列和即时造价；没有新增舰队及超容量的实际维护报价。不能按容量比例猜成本或把扩军预览当授权。',resourceAdmission:'普通造船最终逐笔核对整批真实造价、实际支出周期、净亏损缓冲及共享预留；当前维护不等于新增舰队维护。'};
      result.expansion_policy=militaryExpansionProblem(status,{inWar:!!this.lastState?.wars?.length,alloySpend:null})||'按当前容量和经济预算安排扩军；船坞排队仍会消耗未来容量。';
    }
    else if (topic === 'designs') result = await this.rpc('get_ship_designs');
    else if (topic === 'contacts') result = await this.rpc('get_contacts', {mode: 'all'});
    else if (topic === 'diplomacy') {
      if (entityId === undefined) throw new Error('diplomacy 需要已知国家 id');
      result = await this.rpc('get_diplomacy_options', {country_id: entityId});
    }
    else throw new Error('未知查询主题');
    if(topic==='system') for(const row of result.fleets||[]) this.visibleFleets.set(row.id,{systemId:entityId,at:this.now(),own:row.own});
    if(topic==='threats') for(const system of result.systems||[]) for(const row of system.foreign_fleets||[]) this.visibleFleets.set(row.id,{systemId:system.system_id,at:this.now(),own:false});
    this.operationalContext.record(topic,result,{gameDate:this.lastState?.date});
    await this.log({type: 'inspect', topic, result});
    return result;
  }
  async task({operation,task,id,manualSurveyReason}={}) {
    if(this.nativeCountryAIFence&&operation==='run')throw Error('原生国家 AI 持权，本地任务不得同时派单；先接管');
    if(manualSurveyReason!==undefined&&operation!=='run')throw Error('manualSurveyReason仅用于tasks run');
    validateManualSurveyReason(manualSurveyReason);
    await this.guard();
    if(this.gestalt.paused&&operation!=='view')throw Error('任务调度已暂停，拒绝迟到操作');
    if(operation==='add'){if(!Array.isArray(task?.orders))throw Error('tasks add需要orders数组且只有一个动作；priority为0..100数值，budget使用真实费用');task={...task,orders:task.orders.map(validateOrder)};await this.gestalt.add(task,this.lastState);}
    else if(operation==='cancel')await this.gestalt.cancel(id);
    else if(operation==='run'){
      const next=this.gestalt.next(id);
      if(next){
        if(this.colonyRoutine.ownsTask(next.id)||this.colonyUpgradeRoutine.ownsTask(next.id))throw Error('星球托管的内部任务不能经tasks run重复派发，请先查询或收回托管');
        await this.observe();
        const reserved=this.gestalt.commitments();
        for(const [key,n]of Object.entries(reserved))if(!Number.isFinite(this.lastState.resources?.[key]?.stockpile)||this.lastState.resources[key].stockpile<n)throw Error('最新库存不足以兑现任务承诺：'+key);
        return this.apply({requestId:randomUUID(),snapshotId:this.snapshotId,orders:next.orders,explanation:next.goal,taskId:next.id,manualSurveyReason});
      }
    }else if(operation!=='view')throw Error('未知任务操作');
    return this.gestalt.view();
  }
  async campaign({operation,...input}={}) {
    await this.guard();
    if(this.gestalt.paused&&operation!=='view')throw Error('任务调度已暂停');
    if(operation==='select'||operation==='start'){
      const current=this.gestalt.data.campaign;
      const canRevise=current&&((current.phase==='prepare'&&current.warId===undefined)||(current.warId!==undefined&&!current.execution&&this.lastState.wars?.some(w=>w.war_id===current.warId)))&&!Object.keys(current.actions||{}).length;
      if(operation==='start'&&canRevise){
        input={...(current.execution||{}),...input,target:input.target??current.target,reason:input.reason??current.reason,reviewDate:input.reviewDate??current.reviewDate};
      }
      const upgrading=operation==='start'&&canRevise&&current.target===input.target;
      if(current&&!['completed','terminated'].includes(current.phase)&&!upgrading)throw Error('已有持续战役，请先明确终止或继续推进');
      const candidate=upgrading?structuredClone(current):createCampaign(input,this.lastState);
      if(operation==='start'){
        const government=await this.rpc('get_government');this.government=government;this.governmentAt=this.now();
        if(empireRoute({authority:government.authority||government.authority_key})==='unknown')throw Error('尚未确认支持的当前帝国政体，请 inspect government；不再限定格式塔');
        if(candidate.warId!==undefined){
         const bound=this.lastState.wars?.find(w=>w.war_id===candidate.warId),actualGoal=bound?.player_side==='attacker'?bound.attacker_goal?.key:bound?.player_side==='defender'?bound.defender_goal?.key:null;
         if(!actualGoal||input.goalKey!==actualGoal)throw Error('绑定战争的goalKey必须匹配当前己方真实战争目标；不能改写已开战的目标');
        }
        configureFirstWar(candidate,input,this.lastState);
        if(!candidate.execution.preparationTasks.every(id=>this.gestalt.data.tasks.some(t=>t.id===id)))throw Error('preparationTasks只接受tasks add返回的真实任务id，不能填文字清单；准备已完成时传空数组');
        const forces=await this.rpc('get_fleet_tactics',{details:false});
        const primary=forces.fleets?.find(f=>f.fleet_id===candidate.execution.fleetId);
        if(primary&&candidate.execution.preparationTasks.length===0&&candidate.execution.minShips>primary.total_ships)throw Error(`minShips是本支主力的撤退底线；该舰队当前只有${primary.total_ships}艘，不能填整个帝国的军舰总数`);
        const target=await this.rpc('get_system',{system_id:candidate.execution.targetSystem});
        if(target.owner_id!==candidate.target||!Array.isArray(target.planets)||(!candidate.execution.planets.length&&!confirmedUncolonizedSystem(target,candidate.target)))throw Error('目标归属或完整无殖民地情报未确认');
        if(!candidate.execution.planets.every(pid=>target.planets?.some(p=>p.id===pid&&id(p.colony_id)&&p.owner_id===candidate.target)))throw Error('登陆目标不是当前已确认的敌方殖民地。先inspect targets读取known_colonies，不能选择恒星或无殖民地星球');
        if(Number.isFinite(primary?.total_ships)){candidate.baseline.ships=primary.total_ships;candidate.baseline.initialShips=primary.total_ships;candidate.baseline.initialFleetId=candidate.execution.fleetId;candidate.baseline.shipCountOrigin=candidate.warId!==undefined?'bound_war_configuration':'prewar_configuration';}
        candidate.baseline.systems=[{systemId:candidate.execution.targetSystem,ownerId:target.owner_id,observedDate:this.lastState.date}];
        candidate.baseline.objectives=target.planets.filter(p=>candidate.execution.planets.includes(p.id)).map(p=>({planetId:p.id,ownerId:p.owner_id,systemId:candidate.execution.targetSystem,observedDate:this.lastState.date}));
        candidate.environment={bridge:(await this.rpc('ping')).bridge_version,authority:government.authority||government.authority_key,dlc:'未单独枚举，按当前引擎合法性判断',mods:'未单独枚举，按当前引擎合法性判断'};
      }
      if(current&&['completed','terminated'].includes(current.phase))this.gestalt.data.campaignHistory=[...(this.gestalt.data.campaignHistory||[]),structuredClone(current)].slice(-32);
      this.gestalt.data.campaign=candidate;
    }else if(operation==='revise'){
      const c=this.gestalt.data.campaign;
      if(!c?.enabled||!['combat','peace','recover'].includes(c.phase)||!input.reason)throw Error('战役修订需要交战、议和或恢复阶段及明确原因');
      if(Object.keys(input).some(k=>!['reason','fleetId','transportId','finishDate','targetSystem','planets'].includes(k)))throw Error('战役修订只更换己方部队、同一敌国占领目标或退出日期，不能替换敌国与战争目标');
      await this.observe();
      if(c.phase==='recover'){if(!Array.isArray(this.lastState.wars)||this.lastState.wars.some(w=>w.war_id===c.warId))throw Error('战后修订需要确认原战争已结束');}
      else if(!this.lastState.wars?.some(w=>w.war_id===c.warId&&w.primary_attacker_id===c.participants?.attacker&&w.primary_defender_id===c.participants?.defender))throw Error('原战争或参战方已改变，拒绝沿用');
      const next={...c.execution,...fields(input,['fleetId','transportId','finishDate','targetSystem','planets'])};
      const forces=await this.rpc('get_war_fleets'),tactics=await this.rpc('get_fleet_tactics',{details:true});
      const fleet=tactics.fleets?.find(f=>f.fleet_id===next.fleetId),transport=forces.fleets?.find(f=>f.fleet_id===next.transportId&&f.ship_class==='shipclass_transport'&&f.embarked_armies>0);
      if(!fleet||c.phase!=='recover'&&next.planets.length>0&&!transport||!id(fleet.system_id)||fleet.total_ships<next.minShips)throw Error('替换部队未从当前己方可用舰队与运输军确认');
      if((c.phase!=='recover'||input.finishDate!==undefined)&&(!/^\d{4}\.\d{2}\.\d{2}$/.test(next.finishDate)||next.finishDate<=this.lastState.date))throw Error('战时退出日期必须在未来');
      const retarget=input.targetSystem!==undefined||input.planets!==undefined;
      if(retarget){
        if(c.phase==='recover'||!id(next.targetSystem)||!Array.isArray(next.planets)||next.planets.length>8||!next.planets.every(id)||new Set(next.planets).size!==next.planets.length)throw Error('新占领目标需要同一战争内完整星系和0..8颗不重复殖民地；空数组需完整无殖民地情报');
        const target=await this.rpc('get_system',{system_id:next.targetSystem});
        if(target.owner_id!==c.target||(!next.planets.length&&!confirmedUncolonizedSystem(target,c.target))||!next.planets.every(pid=>target.planets?.some(p=>p.id===pid&&id(p.colony_id)&&p.owner_id===c.target)))throw Error('修订目标不属于原敌国的真实殖民地');
        c.baseline.systems??=[];if(!c.baseline.systems.some(b=>b.systemId===next.targetSystem)){if(c.baseline.systems.length>=64)throw Error('累计星系目标超过64项');c.baseline.systems.push({systemId:next.targetSystem,ownerId:c.target,observedDate:this.lastState.date});}
        c.baseline.objectives??=[];if(c.baseline.objectives.length+next.planets.filter(pid=>!c.baseline.objectives.some(p=>p.planetId===pid)).length>64)throw Error('战役累计占领目标超过64项，先核对战果并收束');for(const pid of next.planets)if(!c.baseline.objectives.some(p=>p.planetId===pid))c.baseline.objectives.push({planetId:pid,ownerId:c.target,systemId:next.targetSystem,observedDate:this.lastState.date});
      }
      c.revisions=[...(c.revisions||[]),{date:this.lastState.date,reason:String(input.reason).slice(0,300),execution:structuredClone(c.execution),actions:structuredClone(c.actions),baseline:structuredClone(c.baseline)}].slice(-8);
      if(next.fleetId!==c.execution.fleetId||next.targetSystem!==c.execution.targetSystem){delete c.actions.attack;delete c.actions['attack-stance'];if(next.fleetId!==c.execution.fleetId)c.baseline.ships=fleet.total_ships;}
      if(next.transportId!==c.execution.transportId)for(const key of Object.keys(c.actions))if(key.startsWith('land-'))delete c.actions[key];
      if(retarget&&c.phase==='peace'){c.phase='combat';c.outcome=undefined;delete c.exitReason;}
      delete c.decisionRequired;c.execution=next;c.status='active';c.gaps=[];c.nextCheck='战役修订已保存，旧部队与旧目标的在途动作保留在日志中，不重放';
    }else if(operation==='advance'){
      await this.observe();
      if(this.lastState.paused||this.lastState.pendingEvents?.length||this.lastState.warGoalsWindow)return {needsAttention:'游戏已暂停或有中央事件，战役不发新动作',...this.gestalt.view()};
      this.gestalt.reconcileCampaignOutbox();
      await advanceFirstWar(this.gestalt.data.campaign,{state:this.lastState,rpc:(m,p)=>this.rpc(m,p),save:()=>this.gestalt.save(),tasks:this.gestalt.data.tasks,records:this.orderTracker?.serialize().records||[],isStopped:()=>this.gestalt.paused||this.presentationStopRequested||this.stopped,
        send:order=>this.apply({requestId:randomUUID(),snapshotId:this.snapshotId,orders:[order],explanation:'我按当前战役目标推进，随后核对实际结果。'},CAMPAIGN_AUTHORITY)});
    }else if(operation==='bind-war'){
      const c=this.gestalt.data.campaign;
      if(!c||!this.lastState.wars?.some(w=>w.war_id===input.warId))throw Error('必须绑定当前实际战争，不能虚构宣战成功');
      if(['completed','terminated'].includes(c.phase)||c.warId!==undefined&&c.warId!==input.warId)throw Error('旧战役不能绑定另一场战争，先select保存新目标');
      const war=this.lastState.wars.find(w=>w.war_id===input.warId);
      const enemy=war.player_side==='attacker'?war.primary_defender_id:war.player_side==='defender'?war.primary_attacker_id:null;
      if(enemy!==c.target)throw Error('实际战争的敌方主参战国与战役目标不符，不能借bind-war切换敌国');
      c.warId=input.warId;c.participants={attacker:war.primary_attacker_id,defender:war.primary_defender_id};reviewCampaign(c,this.lastState);
      if(!c.execution){c.status='blocked';c.nextCheck='战争已绑定；campaign start补齐同一目标的实际主力、运输军、占领目标和预算，不再宣战';}

    }else if(operation==='terminate'){
      const c=this.gestalt.data.campaign;if(!c||!input.reason)throw Error('终止需要原因');
      if(c.execution&&c.warId!==undefined){
       await this.observe();
       if(Array.isArray(this.lastState.wars)&&!this.lastState.wars.some(w=>w.war_id===c.warId)){
        try{const tactics=await this.rpc('get_fleet_tactics',{details:true});c.result=await readFirstWarOutcome(c,{state:this.lastState,rpc:(m,p)=>this.rpc(m,p),fleet:tactics.fleets?.find(f=>f.fleet_id===c.execution.fleetId)});}
        catch(error){c.result={success:null,verificationPending:true,warEnded:true,error:error.message};}
        c.nextCampaignReview={required:true,recoveryRequired:true,afterDate:this.lastState.date,reason:'已终止自动执行，战后恢复尚需明确核对'};
       }
      }
      c.enabled=false;c.phase='terminated';c.status='terminated';c.history.push({date:this.lastState.date,phase:'terminated',reason:String(input.reason).slice(0,300)});
    }else if(operation!=='view')throw Error('未知战役操作');
    await this.gestalt.save();await this.log({type:'campaign_decision',operation,sessionId:this.sessionId,campaignId:this.gestalt.data.campaign?.id,target:this.gestalt.data.campaign?.target,phase:this.gestalt.data.campaign?.phase,gameDate:this.lastState?.date,executionConfigured:!!this.gestalt.data.campaign?.execution});await this.observe();return this.gestalt.view();
  }
  async monthlySnapshot({cleanup=false,allowRunning=false}={}){
    // Verify the already bound process without opening a competing connection
    // to the bridge's single-client pipe.
    const identity=await this.processReader({op:'bound_identity',pid:this.binding?.pid,creationTime:this.binding?.creationTime});
    if(identity.pid!==this.binding?.pid||identity.creationTime!==this.binding?.creationTime)throw Error('月度操作游戏进程已变化');
    const status=cleanup?await this.rpc('get_status'):await this.guard();
    const runningCleanupRead=cleanup&&allowRunning&&this.monthlyLifecyclePilot&&!this.stoppingRequested&&!this.stopped;
    if(!status.in_game||status.is_paused!==true&&!runningCleanupRead)throw Error('月度写入或核对要求游戏已暂停');
    const player=(await this.rpc('get_galaxy_overview')).player;
    if(player?.country_id!==this.lastState.player.country_id||player?.capital_system_id!==this.lastState.player.capital_system_id)throw Error('月度订单玩家身份已变化');
    return {status,market:await this.rpc('get_market'),countryId:player.country_id,scope:{sessionId:this.sessionId,pid:identity.pid,creationTime:identity.creationTime,gameDate:status.date?.formatted}};
  }
  async monthlyTrade({operation='inspect',change,requestId,snapshotId,policy,previousSessionId}={}){
    if(!['inspect','preview','execute','reconcile','recover'].includes(operation))throw Error('未知月度贸易操作');
    if(this.surveyPilot&&['execute','recover'].includes(operation))throw Error('调查对照仅查询月度订单，不执行贸易写入');
    if(policy!==undefined&&!['execute','preview'].includes(operation))throw Error('持续条件仅随执行或预览提供');
    if(policy!==undefined){if(!this.monthlyLifecyclePilot)throw Error('月度库存/期限条件尚待统一验收，默认关闭');validateMonthlyLifecyclePolicy(policy,change);}
    if(['execute','reconcile','recover'].includes(operation)){
      if(this.monthlyBusy)throw Error('另一个月度变更正在执行');
      if(['execute','recover'].includes(operation)){
        if(operation==='execute')validateMonthlyChange(change);
        if(snapshotId!==this.snapshotId||this.now()-this.snapshotAt>60000)throw Error('观察已过期，请先observe');
      }
      const work=(async()=>{
        await this.guard();
        await this.rpc('set_paused',{paused:true});
        const result=operation==='recover'?await recoverMonthlyRecord({records:this.gestalt.data.monthlyTrades??=[],previousSessionId,requestId,sessionId:this.sessionId,snapshot:options=>this.monthlySnapshot(options),rpc:(m,p)=>this.rpc(m,p),save:()=>this.gestalt.save(),assertActive:()=>{if(this.stoppingRequested||this.stopped)throw Error('停止后不新增旧订单恢复范围');}}):operation==='execute'?await this.monthlyExecution.execute({requestId,change,policy}):await this.monthlyExecution.reconcile(requestId);
        this.lastState.monthlyControl=this.monthlyControlView();await this.checkpoint();
        await this.log({type:'monthly_trade_execution',operation,...result});return result;
      })();
      this.monthlyBusy=work;
      try{return await work;}finally{this.monthlyBusy=null;}
    }
    if(operation==='preview'||change!==undefined)validateMonthlyChange(change);
    const status=await this.guard(),market=await this.rpc('get_market');
    const countryId=this.lastState.player.country_id;
    const result={operation,readOnly:true,observedAt:this.now(),gameDate:status.date?.formatted,
      accounting:monthlyTradeAccounting(status,market,{countryId,...this.delegationBudgetOptions()})};
    const ping=await this.rpc('ping');
    result.execution={bridgeEligible:MONTHLY_EXECUTION_BRIDGES.includes(ping?.bridge_version)&&ping.features?.includes('monthly_trade_read_coverage_candidate')===true,monthlyQuoteAvailable:ping.features?.includes('engine_monthly_trade_quotes')===true,snapshotId:this.snapshotId,resources:(market.resources||[]).map(r=>r.key),operations:['set','replace','cancel'],requires:['requestId','snapshotId','change'],registrationIsSettlement:false};
    result.recovery=monthlyRecoveryCandidates(this.gestalt.data.monthlyTrades||[],this.sessionId);
    result.control=this.monthlyControlView();
    if(change&&change.operation!=='cancel'&&result.execution.monthlyQuoteAvailable){
      try{result.quote={known:true,...monthlyQuoteCondition(await this.rpc('get_monthly_trade_quote',{resource:change.resource,action:change.action,units:change.amount}),change)};}catch(error){result.quote={known:false,reason:error.message};}
    }
    if(operation==='preview')result.preview=previewMonthlyChange(market,change,{countryId,scope:{sessionId:this.sessionId,pid:this.binding?.pid,creationTime:this.binding?.creationTime,gameDate:status.date?.formatted}});
    if(policy!==undefined)result.policyPreview={readOnly:true,registrationConfirmed:false,...monthlyLifecycleDecision(status,{policy,change,before:{scope:{gameDate:status.date?.formatted}}})};
    await this.log({type:'monthly_trade_review',operation,ordersKnown:result.accounting.ordersKnown,previewStatus:result.preview?.status,writesEnabled:false});
    return result;
  }
  monthlyControlView(){return {...this.monthlyExecution.view(),recovery:monthlyRecoveryCandidates(this.gestalt.data.monthlyTrades||[],this.sessionId)};}
  delegationBudgetOptions({excludeMonthlyRecord}={}){
    const campaign=this.gestalt.data.campaign;
    const commitments=this.gestalt.commitments();
    if(excludeMonthlyRecord){
      if(!(this.gestalt.data.monthlyTrades||[]).includes(excludeMonthlyRecord)||excludeMonthlyRecord.sessionId!==this.sessionId||excludeMonthlyRecord.released)throw Error('不能排除其他会话或非持久月度记录的预留');
      for(const [key,n]of Object.entries(excludeMonthlyRecord.reservation||{})){if(!Number.isFinite(n)||n<0||!Number.isFinite(commitments[key])||commitments[key]<n)throw Error('本次月度预留与共享账本不一致');commitments[key]-=n;}
    }
    return {commitments,floors:campaign?.execution&&!['completed','terminated','failed'].includes(campaign.phase)?campaign.execution.resourceFloors||{}:{}};
  }
  async surveyControl({operation='inspect',fleetId,snapshotId}={}) {
    if(!this.hybridSurvey&&operation==='delegate')throw Error('原生自动调查试点尚未启用；当前只允许查询或收权');
    if(!id(fleetId))throw Error('科研舰队ID无效');
    const status=await this.guard();
    const ping=await this.rpc('ping');
    if(!ping?.features?.includes('native_survey_automation_candidate'))throw Error('当前桥没有经过核对的自动调查接口');
    if(operation==='inspect')return this.surveyDelegation.inspect(fleetId);
    if(!['delegate','reclaim','reconcile','recover'].includes(operation))throw Error('未知科研船委派操作');
    if(snapshotId!==this.snapshotId||this.now()-this.snapshotAt>60000)throw Error('观察已过期，请先observe');
    const inFlight=this.gestalt.data.actions.some(a=>['issued','submitted','unknown'].includes(a.status)&&
      (a.order.arguments?.fleet_id===fleetId||a.order.arguments?.fleet_ids?.includes(fleetId)));
    if(inFlight)throw Error('科研船仍有在途命令，先核对结果再交接');
    if(operation==='delegate'){
      await reachableSurveyCandidate((m,p)=>this.rpc(m,p),fleetId,{referenceSystemId:this.lastState?.player?.capital_system_id});
      if(delegationResourceRisks(status,this.delegationBudgetOptions()).length)
        throw Error('储备或维护数据不足，先处理资源风险再委派');
      const events=await this.rpc('get_active_events'),wars=await this.rpc('get_wars');
      if(!Array.isArray(events)||typeof wars?.warGoalsWindow!=='boolean')throw Error('关键事件状态未知，暂不新增委派');
      if(events.length||wars.warGoalsWindow)throw Error('中央事件或战争决策尚未处理，暂不新增委派');
    }
    const control=operation==='recover'?await this.surveyDelegation.recover(fleetId):operation==='reconcile'?await this.surveyDelegation.reconcile(fleetId):await this.surveyDelegation.change(fleetId,operation==='delegate');
    await this.log({type:'survey_control',operation,fleetId,control});
    return {control,state:await this.observe()};
  }
  async colonySnapshot(planetId,{upgrades=false}={}){
    const identity=await this.processReader({op:'bound_identity',pid:this.binding?.pid,creationTime:this.binding?.creationTime});
    if(identity.pid!==this.binding?.pid||identity.creationTime!==this.binding?.creationTime)throw Error('殖民地操作进程身份发生变化');
    const status=await this.guard(),native=await this.rpc('get_colony_automation',{planet_id:planetId});
    if(native.owner_id!==this.lastState.player.country_id)throw Error('目标不是当前玩家拥有的殖民地');
    return {status,date:status.date?.formatted,native,planet:await this.rpc('get_planet_details',{planet_id:planetId}),...(upgrades?{upgrades:await this.rpc('get_building_upgrade_candidates',{planet_id:planetId})}:{districts:await this.rpc('get_buildable_districts',{planet_id:planetId})})};
  }
  async colonyControl({operation='inspect',planetId,snapshotId,policy}={}){
    if(!['inspect','delegate','advance','pause','resume','reclaim'].includes(operation))throw Error('未知单星球委派操作');
    if(this.surveyPilot&&operation!=='inspect')throw Error('调查对照不派发或更改星球托管');
    await this.guard();
    if(operation==='inspect')return {control:this.colonyRoutine.view(),upgradeControl:this.colonyUpgradeRoutine.view(),...(planetId!==undefined?{current:await this.colonySnapshot(planetId)}:{})};
    if(snapshotId!==this.snapshotId||this.now()-this.snapshotAt>60000)throw Error('观察已过期，请先observe');
    await this.withColonyWork(async()=>{
      if(operation==='delegate'){if(this.colonyUpgradeRoutine.hasControl())throw Error('已有建筑升级托管持有控制权，先收回');await this.colonyRoutine.delegate(policy);}
      else if(operation==='reclaim'){if(!id(planetId))throw Error('收回需要完整星球ID');await this.colonyRoutine.reclaim(planetId);await this.colonyUpgradeRoutine.reclaim(planetId);await this.cancelUnissuedColonyTasks();}
      else if(operation==='pause'||operation==='resume'){if(!id(planetId))throw Error('暂停/恢复需要完整星球ID');await this.colonyRoutine[operation](planetId);}
      else await this.colonyRoutine.advance({force:true});
    });
    return {control:this.colonyRoutine.view(),state:await this.observe()};
  }
  async withColonyWork(work){
    if(this.colonyBusy)throw Error('单星球调度正在执行，不接受并行变更');
    const pending=work();this.colonyBusy=pending;
    try{return await pending;}finally{this.colonyBusy=null;}
  }
  async colonyUpgradeControl({operation='inspect',planetId,snapshotId,policy}={}){
    if(!['inspect','delegate','advance','pause','resume','reclaim'].includes(operation))throw Error('未知建筑升级托管操作');
    if(this.surveyPilot&&operation!=='inspect')throw Error('调查对照不派发或更改升级托管');
    if(!this.colonyUpgradePilot&&!['inspect','reclaim'].includes(operation))throw Error('建筑升级自动调度尚待统一验收，默认关闭');
    await this.guard();
    if(operation==='inspect')return {control:this.colonyUpgradeRoutine.view(),enabled:this.colonyUpgradePilot,...(planetId!==undefined?{current:await this.colonySnapshot(planetId,{upgrades:true})}:{})};
    if(snapshotId!==this.snapshotId||this.now()-this.snapshotAt>60000)throw Error('观察已过期，请先observe');
    await this.withColonyWork(async()=>{
      if(operation==='delegate'){if((this.gestalt.data.colonyRoutines||[]).some(r=>['active','waiting','blocked','paused'].includes(r.status)))throw Error('已有住房托管持有控制权，先收回');await this.colonyUpgradeRoutine.delegate(policy);}
      else if(operation==='reclaim'){if(!id(planetId))throw Error('收回需要星球ID');await this.colonyUpgradeRoutine.reclaim(planetId);await this.cancelUnissuedColonyTasks();}
      else if(operation==='pause'||operation==='resume'){if(!id(planetId))throw Error('暂停/恢复需要星球ID');await this.colonyUpgradeRoutine[operation](planetId);}
      else await this.colonyUpgradeRoutine.advance({force:true});
    });return {control:this.colonyUpgradeRoutine.view(),state:await this.observe()};
  }
  async executeColonyOrder({record,action,order}){
    try{
      if(order.command==='upgrade_building'&&!this.colonyUpgradePilot)throw Error('建筑升级自动派发尚待统一验收');
      await this.observe();
      const task=await this.gestalt.add({goal:record.goal,orders:[order],budget:action.cost},this.lastState);
      action.taskId=task.id;await this.gestalt.save();
      const result=await this.apply({requestId:action.requestId,snapshotId:this.snapshotId,orders:[order],explanation:record.goal,taskId:task.id},COLONY_ROUTINE_AUTHORITY);
      const receipt=result.orders?.[0];
      if(!receipt)throw Error('建设执行未返回明确回执，需按持久意图核对');
      const rows=this.gestalt.data.actions.filter(row=>row.taskId===action.taskId);
      if(['rejected','deferred','rejected_cached','duplicate_skipped','pending_confirmation','unconfirmed_not_replayed'].includes(receipt.status)&&receipt.nativeWriteAttempted!==true&&(!rows.length||rows.every(row=>row.status==='failed'&&row.nativeWriteAttempted===false)))receipt.nativeWriteAttempted=false;
      if(receipt.nativeWriteAttempted===false)await this.releaseUnsentColonyTask(action);
      return receipt;
    }catch(error){
      const rows=action.taskId?this.gestalt.data.actions.filter(row=>row.taskId===action.taskId):[];
      const unsent=!rows.length||rows.every(row=>row.status==='failed'&&row.nativeWriteAttempted===false);
      if(unsent)await this.releaseUnsentColonyTask(action);
      return {status:unsent?'deferred':'unknown',...(unsent?{nativeWriteAttempted:false}:{}),reason:error.message,automaticRetryAllowed:false};
    }
  }
  async releaseUnsentColonyTask(action){
    const task=this.gestalt.data.tasks.find(t=>t.id===action.taskId);
    const rows=this.gestalt.data.actions.filter(row=>row.taskId===action.taskId);
    if(task&&['ready','waiting'].includes(task.status)&&rows.every(row=>row.status==='failed'&&row.nativeWriteAttempted===false)){
      task.status='cancelled';task.reason='本次建设明确未进入原生发送，不保留空任务预算；托管需核对后重新授权';await this.gestalt.save();
    }
  }
  async cancelUnissuedColonyTasks(){
    for(const r of [...(this.gestalt.data.colonyRoutines||[]),...(this.gestalt.data.colonyUpgradeRoutines||[])])if(['reclaimed','stopped'].includes(r.status))for(const a of r.actions){
      const task=this.gestalt.data.tasks.find(t=>t.id===a.taskId);
      if(task&&!this.gestalt.data.actions.some(row=>row.taskId===task.id)&&['ready','waiting'].includes(task.status)){task.status='cancelled';task.reason='托管已收回，未提交的本地任务不自动续跑';}
    }
    await this.gestalt.save();
  }
  async confirmManualBuildingControl(){
    const status=await this.guard();
    if(status.is_paused!==true)throw Object.assign(Error('本人经营干预须先确认暂停，不能与原生经营并行'),{rejected:true});
    if(this.nativeCountryAIEnabled){
      await this.countryAI.state();const control=this.countryAI.view();
      if(control.owner!=='human'||!['idle','stopped'].includes(control.nativePhase)||control.ordinaryOrdersBlocked!==false||control.paused!==true||control.actualFlags?.human_ai!==false||control.actualFlags?.force_human_ai!==false)
        throw Object.assign(Error('建筑干预前须实际收回本国AI、确认人类持权且全局AI已关闭'),{rejected:true});
    }
    return status;
  }
  async apply(input={},authority) {
    if(this.nativeCountryAIFence&&!(this.countryAI.view().owner==='native'&&Array.isArray(input.orders)&&input.orders.length&&input.orders.every(o=>reservedOrder(o.command))))throw Error('原生国家 AI 负责日常操作；仅允许战略合同和保留决定，异常时紧急收权');
    if(this.applyBusy)throw Error('普通命令正在执行，不接受并行提交');
    const work=this.performApply(input,authority);this.applyBusy=work;
    try{return await work;}finally{this.applyBusy=null;}
  }
  async performApply({requestId, snapshotId, explanation, orders,taskId,manualSurveyReason,strategicResearchOverride=false} = {},authority) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) throw new Error('requestId 无效');
    if (!Array.isArray(orders) || !orders.length || orders.length > 6) throw new Error('每批需要 1..6 条命令');
    const checked = orders.map(validateOrder),manualReason=validateManualSurveyReason(manualSurveyReason);
    if(this.nativeCountryAIEnabled){
      assertNativeEconomicOrders(checked,this.lastState);
      if(checked.some(o=>USER_ECONOMIC_COMMANDS.includes(o.command)))await this.confirmManualBuildingControl();
    }
    if(manualReason!==undefined&&!checked.some(o=>o.command==='survey'))throw Error('manualSurveyReason仅用于包含survey的动作');
    if(typeof strategicResearchOverride!=='boolean')throw Error('strategicResearchOverride 必须为布尔值');
    if(strategicResearchOverride&&(!this.nativeCountryAIEnabled||taskId!==undefined||checked.length!==1||checked[0].command!=='select_research'||typeof explanation!=='string'||explanation.trim().length<5||explanation.length>300))
      throw Error('战略科研替换仅用于国家 AI 接管后的单项科研干预，需明确说明理由');
    const fingerprint=strategicResearchOverride?stableJson({orders:checked,strategicResearchOverride:true}):manualReason===undefined?stableJson(checked):stableJson({orders:checked,manualSurveyReason:manualReason});
    if(checked.some(o=>o.command==='set_speed'&&o.arguments.speed>this.maximumGameSpeed))throw Error('本轮游戏速度上限为'+this.maximumGameSpeed+'，不能靠加速缩短验收');
    const spendingTask=taskId===undefined?undefined:this.gestalt.data.tasks.find(t=>t.id===taskId);
    if(this.surveyPilot)assertSurveyPilotOrders(checked,{hybridSurvey:this.hybridSurvey});
    for(const order of checked)this.surveyDelegation.assertManual(order);
    for(const order of checked)this.colonyRoutine.assertManual(order,authority===COLONY_ROUTINE_AUTHORITY);
    for(const order of checked)this.colonyUpgradeRoutine.assertManual(order,authority===COLONY_ROUTINE_AUTHORITY);
    const reservations=this.gestalt.commitments();
    if(!taskId&&Object.values(reservations).some(n=>n>0)&&checked.some(o=>!NO_IMMEDIATE_RESOURCE_SPEND.has(o.command)&&o.command!=='claim_system'))throw Error('存在共享资源预留，支出动作请经 tasks run 执行或先取消预留；科研及无即时资源支出的操作可继续');
    const cached = this.receipts.get(requestId);
    if (cached) {if (cached.fingerprint !== fingerprint) throw new Error('同一 requestId 的内容不能改变'); return cached.result;}
    if(taskId!==undefined&&(!spendingTask||!['ready','executing'].includes(spendingTask.status)||stableJson(spendingTask.orders)!==stableJson(checked)))throw Error('taskId必须对应当前可执行任务的完整原动作，不能借用其他任务或伪造ID绕过预算');
    if (this.uncertain) throw new Error('此前命令结果未知，本轮暂停写入，需诊断后重新绑定');
    if(this.presentationStopRequested)throw new Error('展示已因停止或检查异常中断，请重新绑定控制会话');
    if(this.needsDecisionRefresh)throw new Error('本地监测已暂停游戏：先 observe 核对最新局势，不能沿用暂停前的计划');
    if (snapshotId !== this.snapshotId || this.now() - this.snapshotAt > 60000) throw new Error('观察已过期，请先 observe');
    await this.guard();
    await this.ensurePicture();
    if(strategicResearchOverride){
      if(!this.countryAI.saved)throw Error('尚无本轮国家 AI 委派与接管，不允许替换在研科技');
      await this.countryAI.state();const control=this.countryAI.view();
      if(control.owner!=='human'||control.nativePhase!=='stopped'||control.paused!==true||control.ordinaryOrdersBlocked!==false||control.actualFlags?.human_ai!==false||control.actualFlags?.force_human_ai!==false)
        throw Error('战略科研替换前必须实际接管、暂停并关闭国家 AI');
    }
    const result = {requestId, explanation: publicGameExplanation(explanation), orders: []};
    if(hasProductionIdentity(explanation))await this.log({type:'public_text_blocked',scope:'explanation',blocked:true});
    this.receipts.set(requestId, {fingerprint, result});
    await this.log({type: 'intent', requestId, orders: checked, explanation: result.explanation,...(strategicResearchOverride?{strategicResearchOverride:true}:{}),...(manualReason===undefined?{}:{manualSurveyReason:manualReason})});
    this.presentationBlocked=undefined;
    for (const [orderIndex,order] of checked.entries()) {
      await this.guard();
      await this.ensurePicture();
      const eventScope=order.command==='resolve_event'&&order.arguments.window_id===0xFFFF0003?
        this.lastState.pendingEvents?.find(row=>row.window_id===0xFFFF0003):undefined;
      const campaignRoute=authority===CAMPAIGN_AUTHORITY?undefined:campaignFleetRouting(order,this.gestalt.data.campaign);
      if(campaignRoute){result.orders.push({command:order.command,status:'deferred',nativeWriteAttempted:false,reason:campaignRoute.instruction,candidateFeedback:campaignRoute});await this.log({type:'campaign_routing_feedback',requestId,command:order.command,campaignId:campaignRoute.campaignId,nativeWriteAttempted:false});continue;}
      const key = orderKey(order,eventScope?[eventScope.first_contact_id,eventScope.title,eventScope.kind]:undefined);
      const pending=this.orderTracker?.view().find(row=>['submitted','queued','executing','expired_unknown'].includes(row.status)&&row.command===order.command&&stableJson(row.arguments)===stableJson(order.arguments));
      if(pending&&order.command!=='follow_fleet'){result.orders.push({command:order.command,status:pending.status==='expired_unknown'?'unconfirmed_not_replayed':'pending_confirmation',trackingId:pending.id,note:'相同订单仍未确认结果，不重复提交；超时未知也不会解除防重'});continue;}
      if (this.now() - (this.cooldowns.get(key) ?? 0) < 30000) {result.orders.push({command: order.command, status: 'duplicate_skipped'}); continue;}
      const failure = this.failures.get(key);
      if (failure && this.now() - failure.at < 60000) {result.orders.push({command: order.command, status: 'rejected_cached', error: failure.error, note: '同样参数刚被引擎拒绝；查当前状态或换合法候选，不盲重试。'}); continue;}
      let method = order.command, params = order.arguments,stationState,baseline,marketContext,surveyRoute,writeAttempted=false,durableAction,buildingQuoteRequired=false;
      if (method === 'assign_scientist') {
        const ship = this.lastState.civilian.science_ships.find(row => row.fleet_id === params.fleet_id);
        if (!id(ship?.ship_id)) throw new Error('无法确认该己方科研船的实体 ID，请重新 observe');
        method = 'assign_leader'; params = {leader_id: params.leader_id, assignment_type: 2, target_id: ship.ship_id};
      }
      if (method === 'select_research') params = {area: params.slot, tech_key: params.tech_key};
      if(method==='set_district_zone')params={planet_id:params.planet_id,district_id:params.district_id,slot:params.zone_slot,zone_key:params.zone_key};
      if(method==='set_job_priority')params={planet_id:params.planet_id,job_key:params.job_key};
      if(method==='upgrade_building')params={planet_id:params.planet_id,building_id:params.building_id,upgrade_to_key:params.upgrade_key};
      if (['increase_fleet_quota','decrease_fleet_quota'].includes(method)) method = 'set_fleet_template_quota';
      if (method === 'diplomacy') method = 'diplomacy_action';
      try {
        if(['recruit_planet_army','embark_all_armies'].includes(order.command)){
          const own=(this.lastState.colonies||[]).flatMap(s=>s.colonies_summary||[]).some(p=>p.planet_id===params.planet_id);
          const army=own?await this.rpc('get_planet_armies',{planet_id:params.planet_id}):null;
          const legal=army?.success===true&&(order.command==='recruit_planet_army'?army.recruitable_armies?.some(a=>a.key===params.army_key):army.stationed_armies?.some(a=>a.is_defense===false));
          if(!legal){const error=new Error('己方陆军候选已改变，请 inspect armies 核对；防御军不能登舰');error.rejected=true;throw error;}
        }
        if(WAR_COMMANDS.includes(order.command)){
          const problem=await warActionProblem(order,(m,p)=>this.rpc(m,p));
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
        }
        // Recheck before each order: an event can appear after the observation
        // or after an earlier command in the same batch. Do not cover it with
        // presentation panels while silently carrying on underneath.
        const modals=await this.rpc('get_active_events');
        const warUi=await this.rpc('get_wars');
        const warAction=['open_war_goals','set_defender_war_goal','close_war_goals'].includes(method);
        if(warUi.warGoalsWindow && !warAction || Array.isArray(modals) && modals.length && method!=='resolve_event' && !warAction) {
          await this.rpc('set_paused',{paused:true});
          result.orders.push({command:order.command,status:'deferred',reason:'先处理当前中央事件或战争目标窗口，再继续经营'});
          await this.log({type:'modal_deferred',requestId,command:order.command});
          break;
        }
        if(method==='survey'&&this.hybridSurvey&&!this.surveyPilot){
          const route=await manualSurveyRoute({fleetId:params.fleet_id,referenceSystemId:this.lastState.player.capital_system_id,status:await this.guard(),budget:this.delegationBudgetOptions(),manualSurveyReason:manualReason,rpc:(m,p)=>this.rpc(m,p)});
          surveyRoute=route;
          await this.log({type:'survey_routing_review',requestId,fleetId:params.fleet_id,route});
          if(route.decision!=='manual'){const error=new Error(route.reason);error.candidateFeedback={kind:'survey_routing',...route};throw error;}
        }
        if(method==='set_defender_war_goal') {
          const choices=await this.rpc('get_war_goal_candidates',{war_id:params.war_id});
          if(!choices.candidates?.some(row=>row.key===params.goal_key && row.legal)) {
            const error=new Error('这项战争目标当前不可选，请 inspect war_goals 使用当前战争和候选');error.rejected=true;throw error;
          }
        }
        if(method==='build_outpost'||method==='colonize'){
          const status=await this.rpc('get_status'),current={...this.lastState,resources:status.resources,capacities:status.stats,wars:warUi.wars,pendingEvents:modals};
          const review=this.reviewStrategy(current);
          if(!review.ordinaryExpansionAllowed){const error=new Error(`${review.focus}：${review.priorities.join('；')}。${review.resumeWhen}`);error.rejected=true;throw error;}
          const center=method==='build_outpost'?params.system_id:(await this.rpc('get_planet_details',{planet_id:params.planet_id})).system_id;
          const candidates=await this.rpc('find_systems',{purpose:method==='build_outpost'?'outpost':'colonizable',fleet_id:params.fleet_id,from_system_id:center,limit:50});
          let problem;
          if(method==='build_outpost'){
            const target=candidates.systems?.find(x=>x.id===params.system_id);
            if(!target||target.can_build!==true||target.surveyed!==true||target.borders_own_space!==true)problem='只选当前合法、已调查、与己方接壤的目标；先查system/map，不跳过中间星系铺地';
            const influence=status.resources?.influence;
            if(!Number.isFinite(influence?.stockpile)||!Number.isFinite(influence?.net)||influence.stockpile<=Math.max(0,influence.net)*12)problem='影响力需要保留约一年净收入作为计划余量；当前未有可用预算，先经营已有疆域';
          }else{
            const target=candidates.planets?.find(x=>x.planet_id===params.planet_id);
            if(!target||target.can_colonize!==true||target.system_owned!==true||!Number.isFinite(target.habitability_percent)||target.habitability_percent<40)problem='殖民需当前可殖民、己方星系且宜居度非红色的真实候选；未知或红色宜居不能贸然殖民';
          }
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
        }
        if(method==='build_building'){
          const choices=await this.rpc('get_buildable_buildings',{planet_id:params.planet_id});
          const problem=buildingCandidateProblem(choices,params);
          if(problem||this.nativeCountryAIEnabled){
            await this.confirmManualBuildingControl();
            if(!this.lastState.colonies?.some(s=>s.colonies_summary?.some(p=>p.planet_id===params.planet_id)))throw Object.assign(Error('目标不是已确认的当前己方殖民地'),{rejected:true});
            if(problem||this.nativeCountryAIEnabled)buildingQuoteRequired=(await readBuildingAdmission(params,(m,p)=>this.rpc(m,p),{choices,forceTarget:this.nativeCountryAIEnabled})).basis==='targeted_engine_quote';
          }
        }
        if(method==='upgrade_building') {
          if(!this.lastState.colonies?.some(s=>s.colonies_summary?.some(p=>p.planet_id===params.planet_id))){const error=new Error('只能升级当前己方殖民地中的建筑');error.rejected=true;throw error;}
          const candidates=await this.rpc('get_building_upgrade_candidates',{planet_id:params.planet_id});
          const problem=buildingUpgradeProblem(candidates,order.arguments);
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
        }
        if(method==='build_stations') {
          const system=await this.rpc('get_system',{system_id:params.system_id});
          stationState=stationSignature(system,this.lastState.research);
          const refused=this.stationFailures.get(stationTarget(params));
          if(refused?.signature===stationState) {
            result.orders.push({command:order.command,status:'rejected_cached',error:refused.error,note:'此系统和站点类型已被引擎拒绝；换工程船、队列或请求ID不会改变合法性，等相关状态变化再评估'});
            await this.log({type:'station_refusal_cached',requestId,system_id:params.system_id,station_type:params.station_type});continue;
          }
          if(system.owner_id!==undefined&&system.owner_id!==this.countryId){const error=new Error('资源站只能建于当前己方星系');error.rejected=true;throw error;}
        }
        if(['move_fleet','survey','build_outpost','build_stations'].includes(method)) {
          const route=await this.rpc('find_path',{fleet_id:params.fleet_id,to_system_id:params.system_id});
          if(route.reachable===false&&route.from_system_id!==params.system_id) {
            const error=new Error('游戏引擎确认这支舰队当前没有可用路径；可能受边界、航道或舰队状态限制，请 inspect route/map 后换可达目标，不把 posted 当成开始移动');error.rejected=true;throw error;
          }
        }
        if(method==='set_council_agenda') {
          const council=(await this.rpc('get_status')).council;
          if(council?.active_agenda===params.agenda_key) {
            result.orders.push({command:order.command,status:'already_active',agenda:council.active_agenda,progress:council.agenda_progress,note:'当前议程已选好，继续积累进度，不重复设置'});
            await this.log({type:'already_active',requestId,command:order.command,agenda:council.active_agenda});continue;
          }
          const problem=councilAgendaProblem(params.agenda_key,await this.rpc('get_government'));
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
        }
        if(method==='launch_council_agenda') {
          const council=(await this.rpc('get_status')).council;
          if(council?.active_agenda!==params.agenda_key||council?.agenda_ready!==true) {
            const error=new Error('当前议程与请求不匹配或尚未就绪，请重新 inspect government；不执行过期议程');error.rejected=true;throw error;
          }
        }
        if(['set_district_zone','set_job_priority','build_building'].includes(method)) {
          const colonies=this.lastState.colonies;
          if(Array.isArray(colonies)&&!colonies.some(sector=>sector.colonies_summary?.some(colony=>colony.planet_id===params.planet_id))) {
            const error=new Error('目标不是当前己方殖民地');error.rejected=true;throw error;
          }
        }
        if(method==='set_district_zone') {
          const choices=await this.rpc('get_available_district_zones',{planet_id:params.planet_id});
          const slot=choices.districts?.find(x=>x.district_id===params.district_id)?.slots?.find(x=>x.slot===params.slot);
          if(slot?.zone===params.zone_key){result.orders.push({command:order.command,status:'already_active'});continue;}
          if(!slot||slot.zone!==null||!slot.buildable_zones?.some(x=>x.zone===params.zone_key)) {
            const error=new Error('只能在 inspect zones 当前返回的空槽创建合法特区；不替换已有特区，也不猜区划ID/槽位');error.rejected=true;throw error;
          }
        }
        if(method==='set_job_priority') {
          const current=await this.rpc('get_planet_jobs',{planet_id:params.planet_id});
          const canonical=key=>String(key||'').replace(/^job_/,'');
          const job=current.strata?.flatMap(x=>x.jobs||[]).find(x=>canonical(x.job_key)===canonical(params.job_key));
          if(!job){const error=new Error('使用 inspect jobs 返回的当前合法岗位');error.rejected=true;throw error;}
          if(typeof job.is_prioritized!=='boolean'){const error=new Error('当前岗位优先状态未知，不能盲目切换；请重新 inspect jobs');error.rejected=true;throw error;}
          if(job.is_prioritized===order.arguments.prioritized){result.orders.push({command:order.command,status:'already_configured',note:'优先状态已满足；优先级不会扩大岗位上限',job:fields(job,['job_key','current_workforce','max_workforce','is_prioritized'])});continue;}
          if(order.arguments.prioritized&&!job.can_prioritize){const error=new Error('当前岗位不能优先，请重新 inspect jobs');error.rejected=true;throw error;}
        }
        if (order.command==='assign_councilor') {
          const available=await this.rpc('get_council_candidates');
          if(!available.candidates?.some(row=>row.leader_id===order.arguments.leader_id && row.seat_index===order.arguments.seat_index)) {
            const error=new Error('当前没有这个合法内阁任命候选，请 inspect government');error.rejected=true;throw error;
          }
        }
        if (method==='adopt_tradition' || method==='adopt_ascension_perk') {
          const available=await this.rpc(method==='adopt_tradition'?'get_tradition_candidates':'get_ascension_candidates');
          if(!available.candidates?.some(row=>row.key===(params.tradition_key || params.perk_key))) {
            const error=new Error('当前不能选择这项传统/飞升；刚回读的候选随candidateFeedback返回，不猜key或重试原参数');error.rejected=true;error.candidateFeedback=candidateFeedback(method,available,{observedAt:this.now()});throw error;
          }
        }
        if (method==='open_alert' || method==='open_notification') {
          const current=await this.rpc(method==='open_alert'?'get_alerts':'get_notifications');
          if(!Array.isArray(current) || !current.some(row=>method==='open_alert'?row.alert_id===params.alert_id:row.index===params.index)) {
            const error=new Error('这条提示已不在当前列表，请重新 inspect alerts/notifications');error.rejected=true;throw error;
          }
        }
        if (method==='market_trade') {
          await this.rpc('set_paused',{paused:true});
          const market=await this.rpc('get_market'),status=await this.rpc('get_status');
          const resource=status.resources?.[params.resource],currency=status.resources?.[market.settlement_currency];
          const quote=await this.rpc('get_market_quote',params);
          try{
            checkQuotedTrade({params,market,quote,status,...this.delegationBudgetOptions(),task:spendingTask});
            if(status.is_paused!==true)throw Error('交易前尚未确认游戏暂停');
          }catch(error){error.rejected=true;throw error;}
          marketContext={market,quote,quotedAt:this.now()};
          this.marketBefore={resource:resource.stockpile,currency:currency.stockpile,settlement:market.settlement_currency,quote};
        }
        if(method==='build_ship') {
          const yard=await this.rpc('get_buildable_ships',{system_id:params.system_id});
          const design=yard.buildable?.find(x=>x.design_id===params.design_id);
          if(!design){const error=new Error('当前船坞没有这个合法造船候选，请重新 inspect ships；不能猜设计编号或绕过船坞条件');error.rejected=true;throw error;}
          const confirmedCivilian=design.naval_size===0&&(['science','constructor','colony'].includes(design.ship_size)||design.colony_ship===true);
          if(!confirmedCivilian) {
            const status=await this.rpc('get_status');
            const fleets=await this.rpc('get_fleets');
            const reported=design.naval_size;
            const points=Number.isFinite(reported)&&reported>0?reported:fleets.fleets?.flatMap(x=>x.designs||[]).find(x=>x.design_id===params.design_id)?.naval_size||0;
            const problem=militaryExpansionProblem(status,{inWar:!!warUi.wars?.length,alloySpend:(design.cost?.alloys||0)*(params.count||1),navalIncrease:points*(params.count||1)});
            if(problem){const error=new Error(problem);error.rejected=true;throw error;}
            await this.checkQueuedNavalBudget(status,fleets,{yards:[[params.system_id,yard]],navalIncrease:points*(params.count||1),inWar:!!warUi.wars?.length,requirePoints:points>0});
          }
        }
        if(method==='merge_fleets') {
          const problem=mergeProblem(params.fleet_ids,await this.rpc('get_fleet_tactics'));
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
        }
        if(method==='set_fleet_stance'){
          const civilian=Object.values(this.lastState.civilian||{}).filter(Array.isArray).flat();
          if(![...(this.lastState.military?.fleets||[]),...civilian].some(row=>row.fleet_id===params.fleet_id)){
            const error=new Error('该编号不是当前已核对的己方舰队，请先observe');error.rejected=true;throw error;
          }
          // The native command's ownership and IsValid gates decide which
          // civilian classes actually support stances; do not guess from class.
        }
        if (['set_fleet_template_quota', 'reinforce_fleet', 'upgrade_fleet', 'follow_fleet'].includes(method)) {
          if (!this.lastState.military?.fleets?.some(row => row.fleet_id === params.fleet_id)) {
            const error = new Error('该编号不是当前己方军用舰队，请 inspect military'); error.rejected = true; throw error;
          }
        }
        if (method === 'set_fleet_template_quota') {
          const current = await this.rpc('get_fleets', {fleet_id: params.fleet_id});
          const fleet = current.fleets?.find(row => row.fleet_id === params.fleet_id);
          const design = fleet?.designs?.find(row => row.design_id === params.design_id);
          const delta=design?params.target_quota-design.target_quota:0;
          if (!design || order.command==='increase_fleet_quota' && !(delta>=1 && delta<=20) || order.command==='decrease_fleet_quota' && !(delta<=-1 && delta>=-20) || params.target_quota<design.actual_count) {
            const error = new Error('使用当前舰队编制 design_id，按增加/减少方向调整1..20，且不低于现有舰船数；请重新 inspect military'); error.rejected=true; throw error;
          }
          if(delta>0 && fleet.command_limit>0 && design.naval_size>0 && fleet.template_size+delta*design.naval_size>fleet.command_limit) {
            const error=new Error('目标编制超过这支舰队的指挥上限，请减少编制或建立另一支舰队');error.rejected=true;throw error;
          }
        }
        if(method==='reinforce_fleet') {
          const current=await this.rpc('get_fleets',{fleet_id:params.fleet_id});
          const fleet=current.fleets?.find(x=>x.fleet_id===params.fleet_id);
          const tactics=await this.rpc('get_fleet_tactics');
          const capacity=fleetCapacity(fleet||{},tactics.fleets?.find(x=>x.fleet_id===params.fleet_id));
          if(capacity.known&&!capacity.fits_reinforcements) {
            const error=new Error(`这支舰队现役占用${capacity.actual_naval_size}点，补齐还需${capacity.reinforcement_naval_size}点，会超过${capacity.command_limit}点指挥上限；有未计入当前模板的现役设计时先升级/调整编制，或发展另一支舰队`);error.rejected=true;throw error;
          }
          const status=await this.rpc('get_status');
          if(capacity.known&&capacity.reinforcement_naval_size===0){result.orders.push({command:order.command,status:'already_full',note:'当前编制没有缺舰，无需重复增援'});continue;}
          let alloySpend=null;
          if(!warUi.wars?.length&&status.resources?.alloys?.net<0){
            const yards=await this.rpc('get_shipyards');
            if(yards.success===true&&yards.coverage_complete===true&&Array.isArray(yards.shipyards)&&yards.shipyards.length<=8){
              const quotes=[];for(const yard of yards.shipyards)quotes.push(await this.rpc('get_buildable_ships',{system_id:yard.system_id}));
              alloySpend=reinforcementAlloyCost(fleet,quotes);
            }
          }
          const problem=militaryExpansionProblem(status,{inWar:!!warUi.wars?.length,alloySpend,navalIncrease:capacity.reinforcement_naval_size||0});
          if(problem){const error=new Error(problem);error.rejected=true;throw error;}
          await this.checkQueuedNavalBudget(status,await this.rpc('get_fleets'),{navalIncrease:capacity.reinforcement_naval_size||0,inWar:!!warUi.wars?.length,requirePoints:capacity.known});
        }
        if(method==='follow_fleet' && !this.lastState.military?.fleets?.some(row=>row.fleet_id===params.target_fleet_id)) {
          const seen=this.visibleFleets.get(params.target_fleet_id);
          let visible=false;
          if(seen) {
            const system=await this.rpc('get_system',{system_id:seen.systemId});
            visible=system.fleets?.some(row=>row.id===params.target_fleet_id)===true;
            // Model latency must not invalidate a still-visible known target.
            // A moved target must be found again within normal visible intel.
            if(!visible) {
              const scan=await this.rpc('get_defense_scan');
              for(const location of scan.systems||[]) if(location.foreign_fleets?.some(row=>row.id===params.target_fleet_id)) {
                visible=true;this.visibleFleets.set(params.target_fleet_id,{systemId:location.system_id,at:this.now(),own:false});break;
              }
            }
          }
          if(!visible) {const error=new Error('目标舰队未在当前可见情报中确认，请先 inspect threats/system，不能猜编号');error.rejected=true;throw error;}
        }
        if (method === 'diplomacy_action') {
          const options = await this.rpc('get_diplomacy_options', {country_id: params.country_id});
          const candidate = options.options?.find(row => row.action === params.action);
          if (!candidate?.legal) {const error = new Error(candidate?.reason || options.error || '当前外交条件不满足'); error.rejected = true; throw error;}
        }
        if (method === 'respond_diplomacy') {
          const pending = await this.rpc('get_pending_diplomacy');
          const proposal = pending.pending?.find(row => row.proposal === params.proposal);
          if (!proposal || !(params.accept ? proposal.can_accept : proposal.can_reject)) {
            const error = new Error('当前没有这条可回应的己方外交提议，请重新 observe'); error.rejected = true; throw error;
          }
        }
        if (method === 'hire_leader') {
          const pool = await this.rpc('get_leaders');
          if (!pool.pool_candidates?.some(row => row.id === params.candidate_id)) {
            const error = new Error('招募池已刷新，旧候选失效；请重新 inspect leaders 选择当前候选'); error.rejected = true; throw error;
          }
        }
        if (method === 'select_research') {
          const state = await this.rpc('get_research_state');
          if (state[params.area]?.current?.is_researching&&(!strategicResearchOverride||state[params.area].current.key===params.tech_key)) {
            result.orders.push({command: order.command, status: 'already_researching', current: state[params.area].current});
            continue;
          }
          const area=state[params.area],feedback=candidateFeedback(method,area,{slot:params.area,observedAt:this.now()});
          if(!feedback.known||!area.candidates.some(row=>row.key===params.tech_key)){
            const error=new Error(feedback.known?'科技key不在本次该槽位候选池；请从candidateFeedback重新选择':'科研候选池未知，先核对，不能猜key');
            error.rejected=true;error.candidateFeedback=feedback;throw error;
          }
        }
        const presentation=this.countryAI?.active||authority===COLONY_ROUTINE_AUTHORITY?{interrupted:false}:await this.presentOrder(order);
        if(presentation.interrupted){this.presentationBlocked=presentation.reason;result.orders.push({command:order.command,status:'deferred',reason:presentation.reason});break;}
        baseline=TRACKED_ASYNC_COMMANDS.includes(order.command)?await captureBaseline(order,(m,p)=>this.rpc(m,p),this.lastState,{maxQueries:2}):undefined;
        const reason=this.presentationStopRequested?'控制会话正在停止':this.presentationTimeline.active?await this.checkPresentationInterruption():undefined;
        if(reason||this.presentationStopRequested||this.stopped){result.orders.push({command:order.command,status:'deferred',reason:reason||'控制会话正在停止'});break;}
        await this.guard();
        const durableScope=order.command==='reinforce_fleet'&&baseline?.fleetTargets?.length?['reinforcement_template',[...baseline.fleetTargets].sort((a,b)=>a.designId-b.designId)]:eventScope?[eventScope.first_contact_id,eventScope.title,eventScope.kind]:undefined;
        durableAction=await this.gestalt.prepare(order,this.lastState,taskId,durableScope);
        await this.guard();
        this.surveyDelegation.assertManual(order);
        this.colonyRoutine.assertManual(order,authority===COLONY_ROUTINE_AUTHORITY);
        this.colonyUpgradeRoutine.assertManual(order,authority===COLONY_ROUTINE_AUTHORITY);
        if(authority===COLONY_ROUTINE_AUTHORITY){
          const upgrading=order.command==='upgrade_building';
          const current=await this.colonySnapshot(order.arguments.planet_id,{upgrades:upgrading});
          const allocation=this.gestalt.data.tasks.find(t=>t.id===taskId)?.budget;
          const candidate=upgrading?current.upgrades?.candidates?.find(c=>c.building_id===order.arguments.building_id&&c.upgrade_key===order.arguments.upgrade_key&&c.can_upgrade===true):current.districts?.buildable?.find(c=>c.key===order.arguments.district_key&&c.can_build===true);
          if(upgrading){const problem=buildingUpgradeProblem(current.upgrades,order.arguments);if(problem)throw Error(problem);}
          if(current.native.known!==true||current.native.enabled!==false||current.native.queue?.known!==true||!Array.isArray(current.native.queue.items)||!Array.isArray(current.planet.construction_queue)||current.native.queue.items.length||current.planet.construction_queue.length||!candidate?.cost||!Object.keys(candidate.cost).length||Object.entries(candidate.cost).some(([k,n])=>!Number.isFinite(n)||n<0||!Number.isFinite(allocation?.[k])||n>allocation[k]))throw Error('托管建设的实时费用、队列或原生控制权已改变');
          const {commitments,floors}=this.delegationBudgetOptions();
          for(const k of Object.keys(candidate.cost)){const row=current.status.resources?.[k];if(!Number.isFinite(row?.stockpile)||!Number.isFinite(row.net)||row.stockpile+Math.min(0,row.net)*3-(commitments[k]??0)-(floors[k]??0)<0)throw Error('托管建设的当前库存不足以兑现共享预留与维护底线');}
        }
        if(method==='claim_system'||method==='market_trade'||method==='build_ship'||method==='build_building'&&(buildingQuoteRequired||this.nativeCountryAIEnabled)||!NO_IMMEDIATE_RESOURCE_SPEND.has(order.command)&&(spendingTask||hasSpendingReservations(this.delegationBudgetOptions()))){
          let cost,evidence;
          if(method==='market_trade'){
            if(this.now()<marketContext.quotedAt||this.now()-marketContext.quotedAt>=5000){
              marketContext={market:await this.rpc('get_market'),quote:await this.rpc('get_market_quote',params),quotedAt:this.now()};
            }
            const status=await this.guard();if(status.is_paused!==true)throw Error('最终交易预算核对时游戏不再暂停，禁止使用旧报价');
            evidence=checkQuotedTrade({params,...marketContext,status,...this.delegationBudgetOptions(),task:spendingTask});cost=evidence.cost;
            this.marketBefore={resource:status.resources[params.resource].stockpile,currency:status.resources[marketContext.market.settlement_currency].stockpile,settlement:marketContext.market.settlement_currency,quote:marketContext.quote};
          }else{
            cost=await readActualSpendingCost(order,(m,p)=>this.rpc(m,p),{forceTargetBuilding:this.nativeCountryAIEnabled&&method==='build_building'});
            const status=method==='build_building'&&(buildingQuoteRequired||this.nativeCountryAIEnabled)?await this.confirmManualBuildingControl():await this.guard();
            evidence=checkActualSpending({cost,status,...this.delegationBudgetOptions(),task:spendingTask,expenseCycle:method==='build_ship'});
          }
          if(method==='claim_system'&&!params.remove)params={...params,max_influence_cost_fixed:Math.round(cost.influence*100000)};
          durableAction.spendingAdmission={...evidence,...(method==='claim_system'&&!params.remove?{hardNativeBudget:true,nativeCostCap:{resource:'influence',maximumFixed:params.max_influence_cost_fixed}}:{}),gameDate:this.lastGameDate,cost};await this.gestalt.save();
          await this.guard();
        }
        if(this.nativeCountryAIEnabled&&USER_ECONOMIC_COMMANDS.includes(order.command)){
          await this.confirmManualBuildingControl();assertNativeEconomicOrders([order],this.lastState);
          if(order.command!=='build_building')await checkEconomicExploration(order,this.lastState,(m,p)=>this.rpc(m,p));
        }
        writeAttempted=true;
        const response = await this.rpc(method, params);
        const accepted = response?.success === true;
        const receipt = {command: order.command, status: accepted ? 'posted' : 'rejected', response,nativeWriteAttempted:true,...(surveyRoute?{surveyRouting:surveyRoute}:{})};
        result.orders.push(receipt);
        accepted ? this.metrics.orders++ : this.metrics.rejected++;
        if (accepted) {
          this.cooldowns.set(key, this.now());
          try {receipt.verification = await this.verifyOrder(order, params, response,baseline);} catch (error) {receipt.verification = {verified: false, error: error.message};}
          if (receipt.verification.verified) this.metrics.verified++;
          receipt.tracking=this.orderTracker?.register({requestId,order,response,verification:receipt.verification,beforeState:this.lastState,baseline});
          if(this.nativeCountryAIEnabled&&receipt.tracking?.ownerEconomicTask)this.ownerEconomicReturnPending=true;
          if(receipt.tracking)this.trackedIntentKeys.set(receipt.tracking.id,key);
        } else {
          this.failures.set(key, {at: this.now(), error: response?.error || '引擎拒绝'});
          if(method==='build_stations'&&persistentStationRefusal(response?.error)) {
            this.stationFailures.set(stationTarget(params),{signature:stationState,error:response.error});
            if(this.stationFailures.size>256)this.stationFailures.delete(this.stationFailures.keys().next().value);
          }
        }
        durableAction.nativeWriteAttempted=true;
        await this.gestalt.receipt(durableAction,!accepted?'failed':receipt.tracking?'submitted':receipt.verification?.verified?'confirmed':'unknown',receipt.tracking?.id,{movementVerified:accepted&&receipt.verification?.verified===true});
        await this.log({type: 'receipt', requestId, command: order.command, response, verification: receipt.verification});
      } catch (error) {
        const definitelyUnsent=!writeAttempted||error.nativeWriteAttempted===false;
        if (error.rejected) {if(durableAction){durableAction.nativeWriteAttempted=!definitelyUnsent;await this.gestalt.receipt(durableAction,'failed');}this.metrics.rejected++; this.failures.set(key, {at: this.now(), error: error.message}); result.orders.push({command: order.command, status: 'rejected',nativeWriteAttempted:!definitelyUnsent, error: error.message,...(error.candidateFeedback?{candidateFeedback:error.candidateFeedback}:{})}); await this.log({type: 'rejected', requestId, command: order.command, error: error.message,nativeWriteAttempted:!definitelyUnsent}); continue;}
        if(definitelyUnsent){
          if(durableAction){durableAction.nativeWriteAttempted=false;await this.gestalt.receipt(durableAction,'failed');}
          result.orders.push({command:order.command,status:'deferred',reason:error.message,nativeWriteAttempted:false,...(error.candidateFeedback?{candidateFeedback:error.candidateFeedback}:{})});
          await this.log({type:'deferred',requestId,command:order.command,error:error.message,nativeWriteAttempted:false});break;
        }
        // Conservatively classify native/transport errors as unknown. Never automatically replay.
        this.uncertain = true;
        const tracking=writeAttempted?this.orderTracker?.register({requestId,order,response:{},beforeState:this.lastState,baseline}):undefined;
        if(tracking)this.trackedIntentKeys.set(tracking.id,key);
        if(durableAction){durableAction.nativeWriteAttempted=true;await this.gestalt.receipt(durableAction,'unknown',tracking?.id);}
        result.orders.push({command: order.command, status: 'unknown', error: error.message,tracking});
        this.lastUnknown = {requestId, order, params, method,key};
        await this.log({type: 'unknown', requestId, command: order.command, error: error.message}); break;
      } finally {
        if(this.presentationTimeline.active)try{await this.finishPresentation();}catch{this.presentationTimeline.end();this.presentationBlocked='展示检查或关闭失败，需要重新观察';}
      }
      if(this.presentationBlocked){for(const pending of checked.slice(orderIndex+1))result.orders.push({command:pending.command,status:'deferred',reason:this.presentationBlocked});break;}
    }
    result.state = this.presentationStopRequested?{...this.lastState,needsAttention:this.presentationBlocked}:await this.observe();
    if(!this.stoppingRequested&&!this.stopped)for(const receipt of result.orders){const feedback=receipt.candidateFeedback;if(feedback?.kind==='survey_routing'&&feedback.nextCall?.needsSnapshotId&&result.state?.snapshotId)feedback.nextCall.arguments.snapshotId=result.state.snapshotId;}
    if (this.metrics.orders > 0 && this.now() - (this.lastFrameAt || 0) > 90000) {
      try {const frame = await this.rpc('capture_game_frame'); await this.log({type:'picture_evidence',frame}); this.lastFrameAt=this.now();} catch (error) {await this.log({type:'picture_evidence_error',error:error.message});}
    }
    await this.checkpoint(); return result;
  }
  async checkQueuedNavalBudget(status,fleets,{yards=[],navalIncrease,inWar,requirePoints}) {
    if(inWar)return;
    const naval=status.stats?.naval_capacity;
    if(!Number.isFinite(naval?.used)||!Number.isFinite(naval?.capacity)||naval.capacity<=0){const error=new Error('当前海军占用或容量未知，请重新 observe/inspect military 后安排扩军');error.rejected=true;throw error;}
    if(!requirePoints){const error=new Error('新增军舰的真实舰容尚未确认，请 inspect military/ships，不能以0点占用下单');error.rejected=true;throw error;}
    const all=await this.rpc('get_shipyards');
    if(all.success!==true||all.coverage_complete!==true||all.coverage_scope!=='owned_system_starbase_shipyards'||!Array.isArray(all.shipyards)){const error=new Error('全帝国星基船坞队列覆盖不完整，不能把未读取的在建舰容当0');error.rejected=true;throw error;}
    if(yards.some(([system])=>!all.shipyards.some(yard=>yard.system_id===system))){const error=new Error('当前造船候选与全帝国船坞清单不一致，请重新 inspect ships/military');error.rejected=true;throw error;}
    let queued=0;
    const seen=new Set();
    for(const yard of all.shipyards) {
      if(yard.queue_complete!==true||yard.naval_costs_complete!==true||!id(yard.queue_id)){const error=new Error('全帝国船坞有未确认的队列身份、内容或真实舰容，暂停扩军预算');error.rejected=true;throw error;}
      if(seen.has(yard.queue_id))continue;seen.add(yard.queue_id);
      const budget=queuedNavalBudget(yard,fleets);
      if(!budget.known){const error=new Error(`${budget.reason}，先核对船坞在建队列，不能把未知占用当0`);error.rejected=true;throw error;}
      queued+=budget.points;
    }
    const problem=militaryExpansionProblem(status,{navalIncrease:navalIncrease+queued,alloySpend:0});
    if(problem){const error=new Error(`${problem}（含已核验船坞在建${queued}点）`);error.rejected=true;throw error;}
  }
  async verifyOrder(order, params, response,baseline={}) {
    const command = order.command;
    if(command==='set_fleet_stance'){
      const tactics=await this.rpc('get_fleet_tactics',{details:false}),fleet=tactics.fleets?.find(f=>f.fleet_id===params.fleet_id);
      if(!id(fleet?.system_id))return {verified:false,phase:'fleet_stance_position_unknown'};
      const system=await this.rpc('get_system',{system_id:fleet.system_id}),observed=system.fleets?.find(f=>f.id===params.fleet_id&&(f.own===true||f.owner_id===this.lastState.player?.country_id));
      return {verified:observed?.stance===params.stance,phase:'fleet_stance_readback',stance:observed?.stance??null};
    }
    if(command==='claim_system'){
      const r=await this.rpc('get_system',{system_id:params.system_id}),before=response.player_claims_before;
      return {verified:Number.isFinite(before)&&Number.isFinite(r.player_claims)&&(params.remove?r.player_claims===Math.max(0,before-response.count):r.player_claims>=before+response.count),phase:'claim_readback',player_claims:r.player_claims};
    }
    if(command==='fleet_mia'){
      const r=await this.rpc('get_fleet_tactics',{details:true});
      return {verified:params.fleet_ids.every(id=>r.fleets?.some(f=>f.fleet_id===id&&(/失踪|missing|MIA/i.test(f.status||'')||f.system_id===this.lastState.player?.capital_system_id))),phase:'emergency_return_readback'};
    }
    if(command==='recruit_planet_army'){
      const p=await this.rpc('get_planet_armies',{planet_id:params.planet_id});
      return {verified:p.construction_queue?.some(r=>r.army_key===params.army_key||r.key===params.army_key)===true,completed:false,phase:'army_queue'};
    }
    if(command==='embark_all_armies')return {verified:false,completed:false,phase:'army_embark_pending'};
    if(WAR_COMMANDS.includes(command)){
      const wars=await this.rpc('get_wars');
      const detail=command==='land_armies'?await this.rpc('get_invasion_state',{planet_id:params.planet_id}):undefined;
      return warProof(order,{wars:wars.wars},detail);
    }
    if(command==='upgrade_building'){
      const planet=await this.rpc('get_planet_details',{planet_id:params.planet_id}),native=await this.rpc('get_colony_automation',{planet_id:params.planet_id});
      return {...verifyBuildingUpgrade(planet,order.arguments,response),upgradeQueueWitness:captureUpgradeQueueWitness(baseline?.upgradeBaseline,order.arguments,planet,native)};
    }
    if(command==='set_council_agenda') {
      const council=(await this.rpc('get_status')).council;
      return {verified:council?.active_agenda===params.agenda_key,phase:'council_agenda_readback',agenda:council?.active_agenda,progress:council?.agenda_progress};
    }
    if(command==='set_job_priority') {
      const current=await this.rpc('get_planet_jobs',{planet_id:params.planet_id});
      const job=current.strata?.flatMap(x=>x.jobs||[]).find(x=>String(x.job_key).replace(/^job_/,'')===String(params.job_key).replace(/^job_/,''));
      return {verified:job?.is_prioritized===order.arguments.prioritized,phase:'job_priority_readback',job};
    }
    if(command==='set_district_zone') {
      const current=await this.rpc('get_available_district_zones',{planet_id:params.planet_id});
      const slot=current.districts?.find(x=>x.district_id===params.district_id)?.slots?.find(x=>x.slot===params.slot);
      if(slot?.zone===params.zone_key)return {verified:true,phase:'zone_created',slot};
      const planet=await this.rpc('get_planet_details',{planet_id:params.planet_id});
      const entry=planet.construction_queue?.find(x=>x.key===params.zone_key || response.zone_name&&x.item_name===response.zone_name);
      return {verified:!!entry,phase:entry?'construction_queue':'zone_pending',entry};
    }
    if(command==='merge_fleets') {
      const current=await this.rpc('get_fleet_tactics',{details:true});
      const before=response.before_ship_ids;
      const fleet=Array.isArray(before)&&before.length?current.fleets?.find(row=>before.every(ship=>row.ship_ids?.includes(ship))):null;
      return {verified:!!fleet,phase:fleet?'fleet_merged':'merge_pending',fleet_id:fleet?.fleet_id,total_ships:fleet?.total_ships};
    }
    if(command==='open_war_goals') {
      const current=await this.rpc('get_wars');
      return {verified:current.warGoalsWindow===true,phase:'war_goal_window_shown'};
    }
    if(command==='set_defender_war_goal' || command==='close_war_goals') {
      const current=await this.rpc('get_wars');
      const war=current.wars?.find(row=>row.war_id===params.war_id);
      return {verified:command==='close_war_goals'?current.warGoalsWindow===false:war?.have_defender_war_goal===true && war.defender_goal?.key===params.goal_key,phase:'war_goal_readback'};
    }
    if(command==='resolve_event') {
      const events=await this.rpc('get_active_events');
      if(params.window_id===0xFFFF0003) {
        const closed=Array.isArray(events)&&!events.some(row=>row.window_id===params.window_id);
        if(response.phase!=='first_contact_choice_posted')
          return {verified:false,phase:'first_contact_information_closed',panelClosed:closed,note:'仅关闭接触信息面板，不代表接触事件已经处理'};
        let alerts=await this.rpc('get_alerts');
        for(let n=0;n<4 && Array.isArray(alerts)&&alerts.some(row=>row.type==='alert_first_contact_stage_done');++n) {
          await delay(120);alerts=await this.rpc('get_alerts');
        }
        const pending=Array.isArray(alerts)&&alerts.some(row=>row.type==='alert_first_contact_stage_done');
        return {verified:Array.isArray(alerts)&&!pending,phase:pending?'first_contact_choice_pending':'first_contact_stage_advanced',panelClosed:closed};
      }
      return {verified:Array.isArray(events) && !events.some(row=>row.window_id===params.window_id),phase:'event_closed'};
    }
    if(command==='market_trade') {
      const state=await this.rpc('get_status');const before=this.marketBefore;
      const resource=state.resources?.[params.resource]?.stockpile,currency=state.resources?.[before?.settlement]?.stockpile;
      const sign=params.action==='buy'?1:-1;
      const resourceDelta=Number.isFinite(resource)&&Number.isFinite(before?.resource)?resource-before.resource:null,currencyDelta=Number.isFinite(currency)&&Number.isFinite(before?.currency)?currency-before.currency:null;
      const quoteMatches=before?.quote?.success===true&&Number.isFinite(currencyDelta)&&Math.abs(Math.abs(currencyDelta)-before.quote.total)<.03;
      return {verified:!!before&&quoteMatches&&Math.abs(resourceDelta-sign*params.units)<.02&&sign*currencyDelta<0,phase:'market_balance_readback',before,after:{resource,currency},observedResourceDelta:resourceDelta,observedSettlementDelta:currencyDelta,quoteMatches,costNote:'本笔完整引擎报价与实际结算核对；余额显示到0.01，允许0.03显示精度差。每笔须重新报价。'};
    }
    if(command==='adopt_tradition' || command==='adopt_ascension_perk') {
      const state=await this.rpc('get_traditions');
      return {verified:command==='adopt_tradition'?state.unlocked_traditions?.some(row=>row.key===params.tradition_key)===true:state.ascension_perks?.adopted?.some(row=>row.key===params.perk_key)===true,phase:'society_readback'};
    }
    if(command==='assign_councilor') {
      const state=await this.rpc('get_government');
      return {verified:state.council_seats?.some(row=>row.seat_index===order.arguments.seat_index && row.leader?.id===params.leader_id)===true,phase:'council_seat'};
    }
    if (['increase_fleet_quota','decrease_fleet_quota'].includes(command)) {
      const state = await this.rpc('get_fleets', {fleet_id: params.fleet_id});
      const entry = state.fleets?.find(row => row.fleet_id === params.fleet_id)?.designs?.find(row => row.design_id === params.design_id);
      return {verified: entry?.target_quota === params.target_quota, phase: 'fleet_template', entry};
    }
    if (command === 'diplomacy') {
      const state = await this.rpc('get_contacts', {mode: 'empires'});
      const contact = state.empires?.find(row => row.country_id === params.country_id);
      return {verified: false, phase: 'proposal_pending_acceptance', contact};
    }
    if (command === 'respond_diplomacy') {
      const state = await this.rpc('get_pending_diplomacy');
      return {verified: Array.isArray(state.pending) && !state.pending.some(row => row.proposal === params.proposal), phase: 'proposal_consumed'};
    }
    if (['upgrade_fleet', 'follow_fleet'].includes(command)) {
      const state = await this.rpc('get_military_fleets');
      const fleet = state.fleets?.find(row => row.fleet_id === params.fleet_id);
      return {verified: command === 'upgrade_fleet' && /升级|改装/.test(fleet?.status || ''), phase: 'fleet_order', fleet};
    }
    if (command === 'select_research') {
      const state = await this.rpc('get_research_state');
      return {verified: state[order.arguments.slot]?.current?.key === params.tech_key && state[order.arguments.slot]?.current?.is_researching === true, phase: 'research_queue', technology: state[order.arguments.slot]?.current};
    }
    if (['build_district', 'build_building', 'clear_blocker'].includes(command)) {
      const state = await this.rpc('get_planet_details', {planet_id: params.planet_id});
      const key = params.district_key || params.building_key;
      const entry = state.construction_queue?.find(row => key && row.key === key || command === 'clear_blocker' && row.deposit_id === params.deposit_id);
      return {verified: !!entry, phase: 'construction_queue', entry};
    }
    if (command === 'build_ship') {
      const state = await this.rpc('get_buildable_ships', {system_id: params.system_id});
      const entry = state.queue?.find(row => row.design_id === params.design_id || row.name === response.name || row.item_name === response.name);
      return {verified: !!entry, phase: 'shipyard_queue', entry};
    }
    if (['hire_leader', 'assign_scientist'].includes(command)) {
      const state = await this.rpc('get_leaders');
      const leader = state.hired_leaders?.find(row => row.id === (params.candidate_id ?? params.leader_id));
      return {verified: !!leader && (command === 'hire_leader' || leader.assignment_type === 'fleet' && leader.target_id === params.target_id), phase: 'leader_assignment', leader: fields(leader, ['id', 'name', 'assignment_type', 'target_id'])};
    }
    if (['move_fleet', 'survey', 'build_outpost', 'build_stations'].includes(command)) {
      const civilian = await this.rpc('get_civilian_fleets'), military = await this.rpc('get_military_fleets');
      const fleets = [...Object.values(civilian).filter(Array.isArray).flat(), ...(military.fleets || [])];
      const fleet = fleets.find(row => row.fleet_id === params.fleet_id);
      const system = await this.rpc('get_system', {system_id: params.system_id});
      const status = String(fleet?.status || '');
      const target = status.includes(system.name) || system.planets?.some(row => status.includes(row.name));
      const kind = command === 'survey' ? /调查/.test(status) : ['build_outpost', 'build_stations'].includes(command) ? /建造/.test(status) : /前往|移动/.test(status);
      return {verified: !!target && kind, phase: 'fleet_order', status, target_system_id: params.system_id};
    }
    if (command === 'set_speed') {const state = await this.rpc('get_status'); return {verified: state.speed === params.speed, phase: 'simulation_speed', speed: state.speed};}
    return {verified: false, phase: 'posted_pending_observation'};
  }
  async monitorDecision(idleMs=0) {
    if(this.stopped)return;
    if(this.now()>=this.ends)return this.stop();
    const status=await this.guard();
    const economyObservedAt=this.now();
    if(this.nativeCountryAIEnabled&&this.countryAI.active){
      try{
        const control=await this.countryAI.heartbeat();
        const economyKnown=status.resources&&typeof status.resources==='object'&&!Array.isArray(status.resources)&&Object.keys(status.resources).length>0;
        const colonies=status.outliner?.sectors_summary?.sectors;
        this.lastState={...this.lastState,paused:control.paused,date:status.date?.formatted,
          ...(economyKnown?{resources:status.resources,economyObservedAt}:{}),
          ...(status.stats?{capacities:status.stats}:{}),...(Array.isArray(colonies)?{colonies}:{}),
          ...(status.council?{council:status.council}:{}),
          ...(status.society?{traditions:{...status.society,next_tradition_cost_known:status.society.next_tradition_cost_known===true,
            edict_fund:status.society.edict_fund_known===true?status.society.edict_fund:null,edict_fund_known:status.society.edict_fund_known===true}}:{}),
          countryAIControl:{enabled:true,...control}};
        if(control.owner==='native'){
          if(!this.lastStrategyEventPoll||this.now()-this.lastStrategyEventPoll>=10000){
            this.lastStrategyEventPoll=this.now();
            const wars=await this.rpc('get_wars'),events=await this.rpc('get_active_events'),diplomacy=await this.rpc('get_pending_diplomacy'),society=await this.rpc('get_traditions');
            this.lastState={...this.lastState,wars:wars.wars??[],warGoalsWindow:wars.warGoalsWindow,pendingEvents:Array.isArray(events)?events:[],pendingDiplomacy:diplomacy.pending??[],ascensionPerks:society.ascension_perks??null};
            // Native ownership must not freeze the read-only lifecycle ledger
            // for the owner's earlier accepted movement/construction commands.
            const orderChanges=await this.refreshOrderTracking(this.lastState);
            if(orderChanges){await this.gestalt.update(this.lastState,this.orderTracker?.view()??[]);await this.gestalt.save();}
          }
          await this.refreshOperatorStanding(this.lastState);
          this.lastState.strategyContract=this.strategyContract??null;
          if(economyKnown)this.growthTracker.record(this.lastState);
          await this.refreshNativeColonyAudit(this.lastState);
          this.lastState.strategy=this.reviewStrategy(this.lastState);
          await this.syncStrategyDirection(this.lastState);
          this.lastState.strategy=this.reviewStrategy(this.lastState);
          this.adviceTasks?.observe(this.lastState);this.lastState.adviceExecution=this.adviceTasks?.view();
          this.lastState.strategy.adviceExecution=this.lastState.adviceExecution;
          const due=this.strategyReview.due(this.lastState);
          if(control.reviewDue||due.length){this.nativeStrategicReviewDue=true;this.lastState.strategyWakeReasons=due;}
          try{
            const path=resolve(this.directory,'director-settings.json'),settings=await loadDirectorSettings(path);
            await this.nativeDirector.tick({rpc:async(m,p)=>{
              await this.countryAI.heartbeat();
              const actual=this.countryAI.view();
              if(this.stoppingRequested||this.stopped||actual.owner!=='native'||actual.paused!==false||(await loadDirectorSettings(path)).mode!=='auto')throw Error('导播控制权或展示模式已改变');
              return this.rpc(m,p);
            },control,state:this.lastState,status,mode:settings.mode,stopped:this.stoppingRequested||this.stopped,
             shouldContinue:async()=>!this.stoppingRequested&&!this.stopped&&(await loadDirectorSettings(path)).mode==='auto',emit:e=>this.log(e)});
            if(!settings.configurationKnown)this.nativeDirector.blocked='configuration_invalid';
            this.lastState.director=this.nativeDirector.view();
          }catch{} // Presentation cannot fail the native control loop.
          await this.publishRuntimeHeartbeat();
          return;
        }
        this.needsDecisionRefresh=true;this.decisionPause={at:this.now(),reasons:['native_country_ai_review'],control};
      }catch(error){
        if(!this.nativeCountryAIUnknownSealed){
          this.nativeCountryAIUnknownSealed=true;
          try{await this.countryAI.takeover();}catch(cleanup){this.nativeCountryAICleanupError=cleanup.message;}
          await this.log({type:'country_ai_supervision_attention',message:error.message,control:this.countryAI.view()});
        }
        this.needsDecisionRefresh=true;this.decisionPause={at:this.now(),reasons:['native_country_ai_unconfirmed'],message:error.message};
      }
      await this.publishRuntimeHeartbeat();return;
    }
    if(!this.nativeRoutineSuppressed){if(await this.monitorMonthlyTrade(status))return;await this.monitorLocalCompletion(status);}
    if(status.is_paused===true){
      const rows=this.hybridSurvey?Object.values(this.surveyDelegation.view().records||{}).filter(r=>r.sessionId===this.sessionId&&r.owner!=='manual'):[];
      if(!rows.length){await this.publishRuntimeHeartbeat();return;}
      const events=await this.rpc('get_active_events'),wars=await this.rpc('get_wars');
      if(!(Array.isArray(events)&&events.length||wars.warGoalsWindow)){await this.publishRuntimeHeartbeat();return;}
      const revision=JSON.stringify(rows.map(r=>[r.fleetId,r.revision]).sort((a,b)=>a[0]-b[0]));
      if(this.pausedSurveyRevision===revision)return; // unknown revoke is not retried every tick
      this.pausedSurveyRevision=revision;
      this.needsDecisionRefresh=true;this.decisionPause={at:this.now(),reasons:['central_event'],pauseAlreadyPresent:true};
      try{this.decisionPause.surveyCleanup=await this.surveyDelegation.cleanup();}catch(error){this.decisionPause.surveyCleanupError=error.message;}
      this.lastState={...this.lastState,paused:true,surveyControl:this.surveyDelegation.view(),decisionAttention:{...this.decisionPause,requiresRefresh:true}};
      await this.log({type:'decision_guard_pause',reasons:['central_event'],pauseAlreadyPresent:true,idleMs,gameDate:status.date?.formatted,modelCalls:0});await this.checkpoint();return;
    }
    const events=await this.rpc('get_active_events'),wars=await this.rpc('get_wars'),alerts=await this.rpc('get_alerts');
    const reasons=[];
    if(wars.warGoalsWindow||Array.isArray(events)&&events.length)reasons.push('central_event');
    const identities=rows=>(Array.isArray(rows)?rows:[]).map(x=>[x.war_id,x.have_defender_war_goal]);
    if(JSON.stringify(identities(wars.wars))!==JSON.stringify(identities(this.lastState.wars)))reasons.push('war_changed');
    const known=new Set((this.lastState.alerts||[]).map(x=>x.type));
    const newAlerts=Array.isArray(alerts)?alerts.filter(x=>!known.has(x.type)):[];
    if(newAlerts.length)reasons.push('new_alert');
    const alertRequiresReclaim=newAlerts.some(x=>!SURVEY_RETAIN_ALERTS.has(x.type));
    const delegated=this.hybridSurvey?await this.surveyDelegation.monitor({gameDate:status.date?.formatted}):{trusted:false,reasons:[]};
    reasons.push(...delegated.reasons);
    const controlled=this.hybridSurvey&&Object.values(this.surveyDelegation.view().records||{}).some(r=>r.sessionId===this.sessionId&&r.owner!=='manual');
    const resourceRisks=controlled?delegationResourceRisks(status,this.delegationBudgetOptions()):[];
    if(resourceRisks.length)reasons.push('survey_resource_risk');
    const local=idleMs>=8000?await this.confirmedLocalWork(status):{trusted:false};
    if(idleMs>=8000&&!delegated.trusted&&!local.trusted)reasons.push('model_response_slow');
    if(idleMs>=60000)reasons.push('model_response_timeout');
    if(!reasons.length){
      if(this.lastState){
        if(this.hybridSurvey)this.lastState.surveyControl=this.surveyDelegation.view();
        await this.publishRuntimeHeartbeat();
      }
      return;
    }
    const response=await this.rpc('set_paused',{paused:true});if(response.success!==true)throw new Error('本地监测未能暂停游戏');
    this.needsDecisionRefresh=true;this.decisionPause={at:this.now(),reasons,...(resourceRisks.length?{resourceRisks}:{})};
    if(controlled&&reasons.some(r=>['central_event','war_changed','survey_state_unknown','survey_resource_risk','survey_no_work','model_response_timeout'].includes(r)||r==='new_alert'&&alertRequiresReclaim)){
      try{this.decisionPause.surveyCleanup=await this.surveyDelegation.cleanup();}
      catch(error){this.decisionPause.surveyCleanupError=error.message;}
    }
    this.lastState={...this.lastState,paused:true,decisionAttention:{...this.decisionPause,requiresRefresh:true}};
    this.lastState.monthlyControl=this.monthlyControlView();
    if(this.hybridSurvey)this.lastState.surveyControl=this.surveyDelegation.view();
    await this.log({type:'decision_guard_pause',reasons,idleMs,gameDate:status.date?.formatted,modelCalls:0});await this.checkpoint();
  }
  async publishRuntimeHeartbeat(){
    if(this.lastState&&(this.lastSurveyHeartbeat===undefined||this.now()-this.lastSurveyHeartbeat>=5000)){this.lastSurveyHeartbeat=this.now();await this.checkpoint();}
  }
  localWorkCompleted(proof){
    return [...(this.gestalt.data.colonyRoutines||[]),...(this.colonyUpgradePilot?this.gestalt.data.colonyUpgradeRoutines||[]:[])].some(r=>r.sessionId===this.sessionId&&r.planetId===proof.planetId&&!['blocked','paused','stopped','reclaimed'].includes(r.status)&&r.actions.some(a=>a.queueItemId===proof.queueItemId&&a.status==='completed'));
  }
  async monitorLocalCompletion(status){
    if(this.colonyBusy||this.stoppingRequested||this.stopped||this.gestalt.paused||this.uncertain)return false;
    const records=[...(this.gestalt.data.colonyRoutines||[]),...(this.colonyUpgradePilot?this.gestalt.data.colonyUpgradeRoutines||[]:[])];
    const target=localWaitTarget(records,this.sessionId);if(!target)return false;
    const proof=await this.confirmedLocalWork(status,{forReconcile:true});if(proof.reason!=='local_queue_changed')return false;
    const actor=(this.gestalt.data.colonyUpgradeRoutines||[]).includes(target.record)?this.colonyUpgradeRoutine:this.colonyRoutine;
    // Read and reconcile the original action before ordinary alert handback.
    // This pass cannot dispatch the next approved build, even if allowance remains.
    await this.withColonyWork(()=>actor.advance({force:true,reconcileOnly:true}));
    this.localWaitCache=null;
    if(this.lastState){this.lastState.colonyControl=this.colonyRoutine.view();this.lastState.colonyUpgradeControl=this.colonyUpgradeRoutine.view();await this.checkpoint();}
    return target.action.status==='completed'&&!['blocked','paused'].includes(target.record.status);
  }
  async confirmedLocalWork(status,{forReconcile=false}={}){
    if(this.nativeRoutineSuppressed)return {trusted:false,reason:'native_country_ai_owns_routine'};
    if(!this.localWaitPilot&&!forReconcile||this.stoppingRequested||this.stopped||this.gestalt.paused||this.uncertain)return {trusted:false,reason:'local_wait_disabled'};
    const records=[...(this.gestalt.data.colonyRoutines||[]),...(this.colonyUpgradePilot?this.gestalt.data.colonyUpgradeRoutines||[]:[])];
    if(records.some(r=>r.sessionId===this.sessionId&&(r.status==='blocked'||r.reviewRequired)&&!['stopped','reclaimed','completed'].includes(r.status))){this.localWaitCache=null;return {trusted:false,reason:'local_control_unconfirmed'};}
    const target=localWaitTarget(records,this.sessionId);
    if(!target){this.localWaitCache=null;return {trusted:false,reason:'no_confirmed_local_queue'};}
    const {record,action}=target,key=stableJson([record,action]),cache=this.localWaitCache;
    const day=surveyGameDay(status.date?.formatted);
    if(cache&&cache.key===key&&this.now()>=cache.at&&this.now()-cache.at<5000&&day!==null&&day>=cache.day)return {...localQueueWaitProof({...target,...cache.reads,status,sessionId:this.sessionId,...this.delegationBudgetOptions()}),sessionId:this.sessionId,observedAt:cache.at};
    try{
      const identity=await this.processReader({op:'bound_identity',pid:this.binding?.pid,creationTime:this.binding?.creationTime});
      if(identity.pid!==this.binding?.pid||identity.creationTime!==this.binding?.creationTime)throw Error('进程身份改变');
      const native=await this.rpc('get_colony_automation',{planet_id:record.planetId}),planet=await this.rpc('get_planet_details',{planet_id:record.planetId});
      if(native.owner_id!==this.lastState.player.country_id)throw Error('殖民地不再归属当前玩家');
      const reads={native,planet},proof=localQueueWaitProof({...target,...reads,status,sessionId:this.sessionId,...this.delegationBudgetOptions()});
      const at=this.now();this.localWaitCache=proof.trusted?{key,reads,at,day}:null;return {...proof,sessionId:this.sessionId,observedAt:at};
    }catch(error){this.localWaitCache=null;return {trusted:false,reason:'local_queue_read_unknown',detail:error.message};}
  }
  async monitorMonthlyTrade(status){
    if(this.nativeRoutineSuppressed)return false;
    const risks=monthlyReservationRisks(status,this.gestalt.data.monthlyTrades||[],{sessionId:this.sessionId,...this.delegationBudgetOptions()});
    if(!risks.length){this.monthlyRiskPaused=false;return this.monitorMonthlyLifecycle(status);}
    if(this.monthlyRiskPaused&&status.is_paused===true)return true;
    const paused=await this.rpc('set_paused',{paused:true});if(paused.success!==true)throw Error('月度贸易风险监测未能确认暂停');
    this.monthlyRiskPaused=true;this.needsDecisionRefresh=true;
    const cleanup=await this.monthlyExecution.cleanup();
    this.decisionPause={at:this.now(),reasons:['monthly_trade_resource_risk'],resourceRisks:risks,monthlyTradeCleanup:cleanup};
    this.lastState={...this.lastState,paused:true,decisionAttention:{...this.decisionPause,requiresRefresh:true}};
    await this.log({type:'monthly_trade_risk_handback',risks,cleanup,gameDate:status.date?.formatted,modelCalls:0});await this.checkpoint();return true;
  }
  async monitorMonthlyLifecycle(status){
    if(!this.monthlyLifecyclePilot||this.stoppingRequested||this.stopped)return false;
    const actions=monthlyLifecycleActions(status,this.gestalt.data.monthlyTrades||[],{sessionId:this.sessionId});
    if(!actions.completed.length&&!actions.unknown.length){this.monthlyLifecyclePaused=false;return false;}
    if(this.monthlyLifecyclePaused&&status.is_paused===true)return true;
    if(this.monthlyLifecycleBusy)return this.monthlyLifecycleBusy;
    const work=this.reviewMonthlyLifecycle(status,actions);this.monthlyLifecycleBusy=work;
    try{return await work;}finally{this.monthlyLifecycleBusy=null;}
  }
  async reviewMonthlyLifecycle(status,actions){
    let cleanup;
    if(!actions.unknown.length){
      cleanup=await this.monthlyExecution.cleanup({requestIds:actions.completed.map(r=>r.requestId),allowRunning:status.is_paused!==true,reason:'policy_complete'});
      this.lastState.monthlyControl=this.monthlyControlView();
      await this.log({type:'monthly_lifecycle_review',completed:actions.completed,cleanup,gameDate:status.date?.formatted,modelCalls:0});
      if(cleanup.confirmed){await this.checkpoint();return false;}
    }
    const pause=await this.rpc('set_paused',{paused:true});if(pause.success!==true)throw Error('月度条件未知，未能确认暂停');
    this.monthlyLifecyclePaused=true;this.needsDecisionRefresh=true;
    this.decisionPause={at:this.now(),reasons:['monthly_lifecycle_state_unknown'],policyActions:actions,monthlyTradeCleanup:cleanup};
    this.lastState={...this.lastState,paused:true,monthlyControl:this.monthlyControlView(),decisionAttention:{...this.decisionPause,requiresRefresh:true}};
    await this.log({type:'monthly_lifecycle_handback',actions,cleanup,gameDate:status.date?.formatted,modelCalls:0});await this.checkpoint();return true;
  }
  async serviceAudienceQueries() {
    if(this.stopped||!this.lastState)return [];
    const results=await this.audienceQueries.poll({gameSessionId:this.sessionId,state:this.lastState,inspect:args=>this.inspect(args),isStopped:()=>!!this.stopped,maxQueries:1});
    for(const result of results)await this.log({type:'audience_query_result',id:result.id,taskId:result.taskId,status:result.status,reason:result.reason});
    return results;
  }
  async refreshOrderTracking(state=this.lastState) {
    if(!this.orderTracker||!state)return;
    if(!this.stopped){
      await this.gestalt.reconcileMoves((method,params)=>this.rpc(method,params));
      const ownerBuilding=this.orderTracker.view().some(r=>r.ownerEconomicTask&&r.command==='build_building'&&r.buildingQueueSeen&&!['completed','failed','expired_unknown'].includes(r.status));
      await this.orderTracker.poll({state,rpc:(method,params)=>this.rpc(method,params),maxQueries:ownerBuilding?3:2,assertScope:this.nativeCountryAIEnabled?()=>this.assertNativeWorld():undefined});
    }
    const events=this.orderTracker.drainEvents();
    for(const event of events){
      const key=this.trackedIntentKeys.get(event.trackingId);
      if(key&&event.status==='expired_unknown')this.cooldowns.set(key,Infinity);
      if(['completed','failed','expired_unknown'].includes(event.status))this.trackedIntentKeys.delete(event.trackingId);
    }
    const entries=this.orderTracker.view();
    const pending=entries.filter(r=>['submitted','queued','executing'].includes(r.status));
    const recent=[...pending.slice(0,8),...entries.filter(r=>!['submitted','queued','executing'].includes(r.status)).slice(-(8-Math.min(8,pending.length)))].slice(0,8);
    state.orderTracking={counts:entries.reduce((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a;},{}),recent:recent.map(r=>fields(r,['id','requestId','command','status','reason','updatedAt','proof','submissionConfirmed']))};
    for(const event of events)await this.log(event);
    return events.length>0;
  }
  async watch(seconds = 15) {
    if(this.nativeCountryAIEnabled&&this.countryAI.active){
      if(!Number.isFinite(seconds)||seconds<0||seconds>900)throw Error('国家 AI 监督等待需要 0..900 秒');
      // A pending strategy review returns promptly, but a live caller must still
      // renew supervision before returning instead of starving the native lease.
      await this.monitorDecision(0);
      const until=Date.now()+seconds*1000;
      while(Date.now()<until&&this.countryAI.active&&!this.decisionPause&&!this.nativeStrategicReviewDue){
        if(this.now()>=this.ends){await this.stop();break;}
        await this.monitorDecision(0);
        if(this.countryAI.active&&!this.decisionPause)await delay(Math.min(1000,Math.max(0,until-Date.now())));
      }
      const state=this.stopped?this.lastState:await this.observe();
      return {...state,countryAIControl:{enabled:true,...this.countryAI.view()},waitPolicy:{requestedSeconds:seconds,source:'native_country_ai_supervision',modelRoutineOrders:0},...(this.decisionPause?{needsAttention:'原生国家 AI 已到收权节点',wakeReasons:this.decisionPause.reasons}:this.nativeStrategicReviewDue?{needsAttention:'已到战略复查点，原生日常运营继续；保持方向用 continue，方向和保留决定用strategy_contract，takeover仅紧急收权',wakeReasons:['native_country_ai_review_due']}:{})};
    }
    const maximum=this.hybridSurvey?this.surveyWatchSeconds:this.localWaitPilot?60:20,requestedSeconds=seconds;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > maximum) throw new Error(`等待时长需要 0..${maximum} 秒`);
    if(this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:0,nativeWorkConfirmed:false,localWorkConfirmed:false});
    const startStatus=await this.guard();
    if(await this.monitorMonthlyTrade(startStatus))return {...await this.observe(),needsAttention:'月度订单条件或储备需要重新评估，已保持暂停；先核对最新状态和未确认交接',wakeReasons:this.decisionPause?.reasons||['monthly_trade_resource_risk']};
    if(await this.monitorLocalCompletion(startStatus)){
      await this.rpc('set_paused',{paused:true});
      return {...await this.observe(),wakeReasons:['local_work_completed'],waitPolicy:{requestedSeconds,effectiveSeconds:0,localWorkConfirmed:false,nativeWorkConfirmed:false}};
    }
    if (this.uncertain) return this.recover();
    if(this.externalPauseObserved)return {...await this.observe(),needsAttention:'游戏在控制器外暂停，等待人工恢复或处理当前事件；不会自动恢复人工暂停'};
    if(this.needsDecisionRefresh)return {...await this.observe(),needsAttention:'本地监测已暂停，先检查更新后的事件和局势，再用 watch 继续推进'};
    let nativeWorkConfirmed=false;
    if(this.hybridSurvey||Object.keys(this.surveyDelegation.view().records||{}).length){
      const delegated=await this.surveyDelegation.monitor({gameDate:startStatus.date?.formatted});
      if(delegated.reasons.some(r=>['survey_state_unknown','survey_recovery_required','survey_monitor_stopped'].includes(r))){
        await this.rpc('set_paused',{paused:true});
        return {...await this.observe(),needsAttention:'科研船控制权待核对，先reconcile或recover；保持暂停，不自动恢复未知控制权',wakeReasons:delegated.reasons};
      }
      if(delegated.reasons.includes('survey_no_work')){
        await this.rpc('set_paused',{paused:true});const cleanup=await this.surveyDelegation.cleanup();
        this.decisionPause={at:this.now(),reasons:['survey_no_work'],surveyCleanup:cleanup};
        await this.log({type:'decision_guard_pause',reasons:['survey_no_work'],beforeResume:true,gameDate:startStatus.date?.formatted,modelCalls:0});
        return {...await this.observe(),needsAttention:'已跨过无工作观察期，暂停并收回调查；先选择下一处探索方向，不反复空转',wakeReasons:['survey_no_work']};
      }
      nativeWorkConfirmed=delegated.trusted===true;
      const controlled=Object.values(this.surveyDelegation.view().records||{}).some(r=>r.sessionId===this.sessionId&&r.owner==='native');
      const risks=controlled?delegationResourceRisks(startStatus,this.delegationBudgetOptions()):[];
      if(risks.length){
        await this.rpc('set_paused',{paused:true});
        const cleanup=await this.surveyDelegation.cleanup();
        this.decisionPause={at:this.now(),reasons:['survey_resource_risk'],resourceRisks:risks,surveyCleanup:cleanup};
        await this.log({type:'decision_guard_pause',reasons:['survey_resource_risk'],beforeResume:true,gameDate:startStatus.date?.formatted,modelCalls:0});
        return {...await this.observe(),needsAttention:'调查储备不足，已保持暂停并核对收权',wakeReasons:['survey_resource_risk']};
      }
    }
    const localWork=await this.confirmedLocalWork(startStatus),localWorkConfirmed=localWork.trusted===true;
    seconds=Math.min(seconds,nativeWorkConfirmed?this.surveyWatchSeconds:localWorkConfirmed?60:20);
    await this.ensurePicture();
    const events=await this.rpc('get_active_events'),warUi=await this.rpc('get_wars');
    if(warUi.warGoalsWindow || Array.isArray(events) && events.length) {
      await this.rpc('set_paused',{paused:true});
      return {...await this.observe(),needsAttention:'中央窗口尚未处理，先选择战争目标/确认通知或处理事件，再继续运行'};
    }
    await this.finishPresentation();
    if(this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:0,nativeWorkConfirmed,localWorkConfirmed,localWork});
    await this.guard();
    seconds=Math.min(seconds,Math.max(0,(this.ends-this.now())/1000));
    if(seconds===0&&this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:0,nativeWorkConfirmed,localWorkConfirmed,localWork});
    const response = await this.rpc('set_paused', {paused: false});
    if (!response?.success) throw new Error('无法恢复游戏');
    this.decisionPause=undefined;
    const until=Date.now()+seconds*1000,baseline=this.lastState;
    let wakeReasons=[];
    while(Date.now()<until) {
      await delay(Math.min(1000,until-Date.now()));
      if(this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:seconds,nativeWorkConfirmed,localWorkConfirmed,localWork});
      await this.ensurePicture();
      if(this.hybridSurvey||this.localWaitPilot){
        await this.monitorDecision(0);
        if(this.stopped)return {...this.lastState,stopped:true,runtimeComplete:this.now()>=this.ends,waitPolicy:{requestedSeconds,effectiveSeconds:seconds,nativeWorkConfirmed,localWorkConfirmed,localWork},wakeReasons:[this.now()>=this.ends?'runtime_complete':'controller_stopped']};
        if(this.externalPauseObserved){wakeReasons=['external_pause'];break;}
        if(this.decisionPause){wakeReasons=this.decisionPause.reasons;break;}
        if(localWorkConfirmed&&this.localWorkCompleted(localWork)){wakeReasons=['local_work_completed'];break;}
      }
      const pendingEvents=await this.rpc('get_active_events'),wars=await this.rpc('get_wars');
      if(wars.warGoalsWindow || pendingEvents?.length) {
        await this.rpc('set_paused',{paused:true});wakeReasons=['central_event'];break;
      }
      let current;
      try{current=await this.guard();}catch(error){if(this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:seconds,nativeWorkConfirmed,localWorkConfirmed,localWork});throw error;}
      if(current.is_paused===true){this.externalPauseObserved=true;wakeReasons=['external_pause'];break;}
      if(await this.monitorMonthlyTrade(current)){wakeReasons=this.decisionPause?.reasons||['monthly_trade_resource_risk'];break;}
      // Persist execution facts during either mode's wait; decision facts keep their original timestamp.
      await this.publishRuntimeHeartbeat();
      const light={resources:current.resources,colonies:current.outliner?.sectors_summary?.sectors,
        pendingEvents,wars:wars.wars,warGoalsWindow:wars.warGoalsWindow,
        alerts:await this.rpc('get_alerts'),military:await this.rpc('get_military_fleets'),
        civilian:await this.rpc('get_civilian_fleets'),research:await this.rpc('get_research_state'),
        pendingDiplomacy:(await this.rpc('get_pending_diplomacy')).pending};
      wakeReasons=attentionReasons(baseline,light);
      // Execute the saved war plan during travel instead of requiring another
      // model response for every stage. This shares the tool's serial executor,
      // fresh observations, pause gates and durable outbox; never a second writer.
      if(this.gestalt.data.campaign?.enabled&&!current.is_paused&&!this.presentationStopRequested){
        await this.campaign({operation:'advance'});
        if(this.lastState.paused||this.lastState.pendingEvents?.length||this.lastState.warGoalsWindow){wakeReasons=['central_event'];break;}
        if(['completed','terminated'].includes(this.gestalt.data.campaign?.phase)){wakeReasons=['campaign_finished'];break;}
      }
      if(wakeReasons.length || current.in_game===false)break;
      if(!current.is_paused&&this.gestalt.data.colonyRoutines?.some(r=>r.sessionId===this.sessionId&&['active','waiting','blocked'].includes(r.status)))await this.withColonyWork(()=>this.colonyRoutine.advance());
      if(this.colonyUpgradePilot&&!current.is_paused&&this.gestalt.data.colonyUpgradeRoutines?.some(r=>r.sessionId===this.sessionId&&['active','waiting','blocked'].includes(r.status)))await this.withColonyWork(()=>this.colonyUpgradeRoutine.advance());
      if(localWorkConfirmed){
        const proof=await this.confirmedLocalWork(current);
        if(!proof.trusted){
          wakeReasons=['local_work_review'];
          if(proof.reason!=='no_confirmed_local_queue')await this.rpc('set_paused',{paused:true});
          break;
        }
      }
    }
    if(this.now()>=this.ends)return this.finishRuntimeWatch({requestedSeconds,effectiveSeconds:seconds,nativeWorkConfirmed,localWorkConfirmed,localWork});
    const state=await this.observe();
    const ownerExecution=await this.settleOwnerEconomicExecution();if(ownerExecution)return ownerExecution;
    if(this.gestalt.data.campaign?.enabled&&!state.paused&&!this.presentationStopRequested)await this.campaign({operation:'advance'});
    return {...this.lastState,waitPolicy:{requestedSeconds,effectiveSeconds:seconds,nativeWorkConfirmed,localWorkConfirmed,localWork},wakeReasons:wakeReasons.length?wakeReasons:['scheduled_review']};
  }
  async finishRuntimeWatch(waitPolicy){
    this.stopReason??='测试时长已到，结束本轮';await this.stop();
    return {...this.lastState,stopped:true,remainingSeconds:0,runtimeComplete:true,waitPolicy,wakeReasons:['runtime_complete'],cleanup:this.cleanup};
  }
  async recover() {
    // Read/pause/read crosses multiple game-thread queue drains. No old intent
    // is replayed, including when its postcondition cannot be proved.
    const unknown = this.lastUnknown;
    await delay(500);
    await this.guard();
    await this.rpc('set_paused', {paused: true});
    const paused = await this.rpc('get_status');
    if (paused.is_paused !== true) throw new Error('未知结果恢复尚未确认暂停，继续保持写入关闭');
    let verification = {verified: false};
    if (unknown) {
      try {verification = await this.verifyOrder(unknown.order, unknown.params, {});} catch {}
      // Block this exact uncertain command for this session; a new decision
      // can manage other tasks from the refreshed state, never blind-replay it.
      this.cooldowns.set(unknown.key||orderKey(unknown.order), this.now() + 24 * 60 * 60 * 1000);
      const receipt = this.receipts.get(unknown.requestId);
      if (receipt) receipt.result.recovery = {status: verification.verified ? 'effect_observed' : 'abandoned_without_replay', verification};
    }
    this.uncertain = false;
    await this.log({type: 'recovery', requestId: unknown?.requestId, verification, replayed: false});
    return {...await this.observe(), recovery: {verified: verification.verified, replayed: false, note: '已回读状态并恢复其他任务；旧的不确定指令不会重放。'}};
  }
  async checkpoint() {
    const checkpoint=resolve(this.directory,'latest-session.json');
    const strategyExecution=this.nativeCountryAIEnabled?this.strategyExecutionView():null;
    if(this.nativeCountryAIEnabled&&this.lastState)this.lastState.strategyExecution=strategyExecution;
    if(this.nativeCountryAIEnabled&&this.lastState)this.lastState.adviceExecution=this.adviceTasks?.view();
    if(this.lastState&&this.ownerEconomicReturnPending)this.lastState.ownerEconomicExecution=this.ownerEconomicExecution();
    await writeFile(checkpoint+'.tmp', JSON.stringify({sessionId: this.sessionId,controllerRunId:this.controllerRunId,binding:this.binding,
      ...(this.nativeCountryAIEnabled?{strategyContract:this.strategyContract??null,strategyExecution,countryAIControl:{enabled:true,...this.countryAI.view(),worldScope:this.countryAI.saved?.scope??this.boundNativeWorld}}:{}),
      taskStateFile:this.gestalt.file,started: this.started, ends: this.ends, observedAt:this.snapshotAt, runtimeStatus:this.runtimeStatus, stopped: !!this.stopped, stopReason:this.stopReason, uncertain: this.uncertain, cleanup: this.cleanup, metrics: this.metrics, state: this.lastState}, null, 2) + '\n');
    await replaceCheckpoint(checkpoint+'.tmp',checkpoint);
    if(this.orderTracker)await writeFile(resolve(this.directory,`orders-${this.sessionId}.json`),JSON.stringify(this.orderTracker.serialize()));
    await this.continuity.save(this.binding,this.lastState,{growth:this.growthTracker.serialize(),stationFailures:[...this.stationFailures],orderTracking:this.orderTracker?.serialize(),adviceExecution:this.adviceTasks?.serialize(),nativeIntent:this.nativeIntentExecution?.serialize(),domesticUnknown:[...(this.unknownDomesticCommands??[])]});
  }
  async stop() {
    if(this.stopPromise)return this.stopPromise;
    const work=this.performStop();this.stopPromise=work;return work;
  }
  async performStop() {
    try{await this.requestStop(this.stopReason||'控制会话停止');}catch{this.stopRequestLogError='停止请求日志写入失败';}
    this.surveyDelegation.close();
    this.gestalt.pause();
    if (this.stopped) return; this.stopped = true;
    this.cancelPresentation();
    this.orderTracker?.close(this.stopReason||'控制会话停止；游戏中的订单结果尚未确认');
    if(this.monthlyBusy)await this.monthlyBusy.catch(()=>{});
    if(this.monthlyLifecycleBusy)await this.monthlyLifecycleBusy.catch(()=>{});
    if(this.colonyBusy)await this.colonyBusy.catch(()=>{});
    if(this.applyBusy)await this.applyBusy.catch(()=>{});
    let countryAICleanup;
    if(this.nativeCountryAIEnabled){
      try{
        if(this.countryAI.active)await this.countryAI.takeover();else await this.countryAI.state();
        const view=this.countryAI.view();
        countryAICleanup={...view,confirmed:view.owner==='human'&&view.ordinaryOrdersBlocked===false&&view.paused===true&&
          view.actualFlags?.human_ai===false&&view.actualFlags?.force_human_ai===false&&['idle','stopped'].includes(view.nativePhase)};
      }
      catch(error){countryAICleanup={confirmed:false,error:error.message,...this.countryAI.view()};}
    }
    try {const response=await this.rpc('set_paused', {paused: true});this.cleanup=response&&typeof response==='object'&&!Array.isArray(response)?{...response}:{error:'暂停未返回可核对回执'};} catch (error) {this.cleanup = {error: error.message};}
    if(countryAICleanup)this.cleanup.countryAI=countryAICleanup;
    if(!this.cleanup.error){
      try{for(let attempt=0;attempt<3;attempt++){const scope=await this.cleanupScope();if(scope.status.is_paused===true){this.cleanup.pauseConfirmed=true;break;}if(attempt<2)await delay(50);}}catch(error){this.cleanup.bindingError=error.message;}
    }
    try{this.cleanup.colonyControl=await this.colonyRoutine.reclaim(undefined,{stop:true});await this.cancelUnissuedColonyTasks();}catch(error){this.cleanup.colonyControlError=error.message;}
    try{this.cleanup.colonyUpgrades=await this.colonyUpgradeRoutine.reclaim(undefined,{stop:true});await this.cancelUnissuedColonyTasks();}catch(error){this.cleanup.colonyUpgradeCleanupError=error.message;}
    try{
      const records=Object.values(this.surveyDelegation.view().records||{});
      if(records.some(r=>r.sessionId===this.sessionId&&r.owner!=='manual')){
        this.cleanup.survey=await this.surveyDelegation.cleanup();
      }
    }catch(error){this.cleanup={...this.cleanup,surveyCleanupError:error.message};}
    try{this.cleanup.monthlyTrade=await this.monthlyExecution.cleanup();}catch(error){this.cleanup.monthlyTrade={confirmed:false,error:error.message};}
    try{this.cleanup.monthlyTrade.recovered=await cleanupRecoveredMonthlyRecords({records:this.gestalt.data.monthlyTrades||[],sessionId:this.sessionId,snapshot:options=>this.monthlySnapshot(options),rpc:(m,p)=>this.rpc(m,p),save:()=>this.gestalt.save()});if(!this.cleanup.monthlyTrade.recovered.confirmed)this.cleanup.monthlyTrade.confirmed=false;}catch(error){this.cleanup.monthlyTrade.confirmed=false;this.cleanup.monthlyTrade.recoveryError=error.message;}
    try{const {status:actual}=await this.cleanupScope();this.cleanup.pauseConfirmed=actual.is_paused===true;this.cleanup.paused=this.cleanup.pauseConfirmed;this.cleanup.pauseStateUnknown=typeof actual.is_paused!=='boolean';this.cleanup.bindingConfirmed=true;}catch(error){this.cleanup.pauseConfirmed=false;this.cleanup.paused=false;this.cleanup.bindingConfirmed=false;this.cleanup.pauseStateUnknown=true;this.cleanup.bindingError=error.message;}
    if(this.lastState&&(this.hybridSurvey||this.lastState.surveyControl))this.lastState.surveyControl=this.surveyDelegation.view();
    if(this.lastState){this.lastState.colonyControl=this.colonyRoutine.view();this.lastState.colonyUpgradeControl={...this.colonyUpgradeRoutine.view(),enabled:this.colonyUpgradePilot};this.lastState.monthlyControl=this.monthlyControlView();if(this.nativeCountryAIEnabled)this.lastState.countryAIControl={enabled:true,...this.countryAI.view()};}
    if(this.lastState)await this.syncStrategyDirection(this.lastState);
    try{this.pipe.close();}catch{this.cleanup={...this.cleanup,pipeError:'原生管道清理失败'};}
    if (this.lockPath) {
      try {const lock = JSON.parse(await readFile(this.lockPath, 'utf8')); if (lock.sessionId === this.sessionId) await unlink(this.lockPath);} catch {}
    }
    if (this.journal) {
      try{await this.refreshOrderTracking();await Promise.allSettled([...this.evidencePending]);await this.log({type: 'stop', cleanup: this.cleanup, metrics: this.metrics,controlEvidence:{incomplete:this.evidenceIncomplete||!!this.stopRequestLogError,lastWriteSequence:this.writeSequence}});}catch{this.cleanup={...this.cleanup,diagnosticError:'停止日志写入失败'};}
      try{await this.checkpoint();}catch{this.cleanup={...this.cleanup,checkpointError:'停止快照写入失败'};}
    }
  }
  async requestStop(reason='控制会话正在停止') {
    if(this.stoppingRequested)return Promise.resolve();
    this.stoppingRequested=true;this.stopReason=reason;this.stopRequestedAt=this.now();
    this.cancelPresentation();this.surveyDelegation.close();this.gestalt.pause();
    return this.journal?this.log({type:'stop_requested',reason,lastWriteSequence:this.writeSequence}):Promise.resolve();
  }
}
