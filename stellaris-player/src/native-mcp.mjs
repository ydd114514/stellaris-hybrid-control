import {strategyContractSchema} from './strategy-contract.mjs';
import {buildingInspectionProperties} from './construction-inspection.mjs';
import {nativeToolErrorText} from './candidate-feedback.mjs';
import {countryAIControlTool} from './native-country-ai-tool.mjs';
import {monthlyLifecycleSchema} from './monthly-trade-lifecycle.mjs';
import {monthlyChangeSchema} from './monthly-trade-changes.mjs';
import {colonyRoutineSchema} from './colony-routine.mjs';
import {colonyUpgradePolicySchema} from './colony-upgrade-routine.mjs';
import {orderInputSchema} from './order-input-schema.mjs';
import {decisionReview} from './decision-review.mjs';
import {StringDecoder} from 'node:string_decoder';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ModelView} from "./model-view.mjs";
import {NativeGame, ORDER_FIELDS} from './native-game.mjs';
import {SerialWork} from './serial-work.mjs';
import {BroadcastQualityMonitor} from './broadcast-quality.mjs';
import {loadHybridSettings} from './hybrid-settings.mjs';
import {executionStatus} from './execution-status.mjs';
import {readStopRequest,writeStopCompletion} from './cooperative-stop.mjs';
import {readStrategyReviewDeferral} from './strategy-turn-recovery.mjs';

const hybridSettings=await loadHybridSettings();
const nativeCountryAI=hybridSettings.nativeCountryAI===true;
const game = new NativeGame({maximumGameSpeed:Number(process.env.CYBERFISH_MAX_GAME_SPEED??5),directory:process.env.CYBERFISH_NATIVE_DIRECTORY||'.local/native-bridge',minutes: Number(process.env.CYBERFISH_TEST_MINUTES || 10),hybridSurvey:!nativeCountryAI&&hybridSettings.survey,presentOrders:process.env.CYBERFISH_NATIVE_PRESENTATION!=='0',surveyPilot:!nativeCountryAI&&process.env.CYBERFISH_SURVEY_PILOT==='1',surveyWatchSeconds:Number(process.env.CYBERFISH_SURVEY_WATCH_SECONDS??60),colonyUpgradePilot:!nativeCountryAI&&process.env.CYBERFISH_COLONY_UPGRADE_PILOT==='1',monthlyLifecyclePilot:!nativeCountryAI&&process.env.CYBERFISH_MONTHLY_LIFECYCLE_PILOT==='1',localWaitPilot:!nativeCountryAI&&process.env.CYBERFISH_LOCAL_WAIT_PILOT==='1',nativeCountryAI});
const quality=new BroadcastQualityMonitor({directory:game.directory,sessionId:game.sessionId});
const modelView=new ModelView();
const projectState=(state,options)=>modelView.project({...state,decisionReview:game.nativeCountryAIEnabled
  ?{mode:'native_strategy',reviewEveryGameDays:180,wakeReasons:state.strategyWakeReasons??[],
    instruction:'复查先读strategyBrief与decisionOptions，日常经营交原生AI，方针与保留决定用strategy_contract。'+(state.userEconomicPolicy?.worldTaskAuthorized===true?'当前世界获授权的本人任务可按ownerEconomicExecution推进。':'具体建造与探索无本世界授权，保持原生运营。')}
  :decisionReview(state,{sessionId:game.sessionId,observedAt:game.snapshotAt})},options);
let ready = false, stopping = false,startAttempted=false;
const tools = [
  countryAIControlTool(),
  {name:'strategy_contract',description:'v1.5 战略入口：提交三维方针、1～3个量化目标和最多4项保留外交/战争决定，可选domesticActions最多4项普通法令或内阁议程设置。先inspect edicts/government核查；toggle_edict需要edict_key/enabled，关闭用enabled:false，set_council_agenda和launch_council_agenda需要agenda_key；发动只允许原生完整就绪，不提前花凝聚力。静态法令目录不证明可启用，只有原生明确can_activate=true才允许启用；cfsteer_*和系统/角色法令不可经此修改。state.adviceExecution是本局待落实任务，taskIds关联本次推进，domesticActions.taskId关联具体设置，taskUpdates逐条解释working/verifying/blocked/superseded及理由；不能输入succeeded。方针确认不代表经营目标完成；无改善必须重新诊断，不能只重复续期。具体设置只有真实回读确认才可完成，unknown不重发。原生AI保持开启，日常建设、科研、造船、舰队、扩张由原生自己执行。requestId防重；posted不等于已生效。普通复查180游戏日或重大事件触发；有待落实任务先处理或解释受阻。已设定目标且没有停滞和调整时才用country_ai_control continue；停滞要调整方针或目标，或在reason里以「维持理由：」开头说明依据。',inputSchema:{type:'object',properties:{requestId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},contract:strategyContractSchema},required:['requestId','contract'],additionalProperties:false}},
  {name:'campaign',description:'主动进攻、持续征服与战后恢复。普通、蜂巢、机械帝国均以当前合法战争条件为准。select 保存 target、reason、reviewDate；bind-war 用 warId 绑定已回读的真实战争；terminate 记录退出原因；view 读取。start 配置首战，advance 每次最多执行一个正常命令。需要 fleetId/rallySystem/targetSystem/planets/goalKey/finishDate；殖民地目标需要transportId，只有完整情报确认无殖民地星系才可planets:[]省略运输军，可选 resourceFloors/preparationTasks/minShips。已有select目标时start可省略target/reason/reviewDate。preparationTasks只能填tasks add返回的id，准备完成传[]；minShips是单支主力撤退底线，不是全帝国军舰总数。revise可在交战/议和阶段带reason更换已确认的fleetId/transportId、调整finishDate或同一敌国的targetSystem/planets；恢复阶段可换主力，原敌国和战争目标保持绑定。议和受阻可据新占领目标继续战斗；未知命令不重放。退出期限仅触发模型复查；未兑现的议和不会自动投降。模型应按实际兵力、敌情和收益选择继续进攻/修订日期或明确议和。bind-war需与原目标敌国匹配，start的goalKey必须匹配已绑定战争中己方的真实目标；未配置时再start补齐同一战争执行，不能重复宣战。战后用战前归属与实际所有权核对gainedPlanets/gainedSystems，requestedOutcome不等于和平条款已证实；完成恢复后继续评估下一目标。watch期间持续推进；暂停停止。战役配置生效后，主力/运输军移动与姿态由战役执行，直接覆盖会明确未发送并返回campaign调用；改战略用revise，确需接管先terminate给原因。宣战、登陆、议和都有引擎合法性检查与回读，posted 不等于成功。',inputSchema:{type:'object',properties:{operation:{enum:['select','start','revise','advance','bind-war','terminate','view']},target:{type:'integer',minimum:0},reason:{type:'string'},reviewDate:{type:'string'},warId:{type:'integer',minimum:0},fleetId:{type:'integer',minimum:0},transportId:{type:'integer',minimum:0},rallySystem:{type:'integer',minimum:0},targetSystem:{type:'integer',minimum:0},planets:{type:'array',items:{type:'integer',minimum:0},minItems:0,maxItems:8},goalKey:{type:'string'},finishDate:{type:'string'},resourceFloors:{type:'object'},preparationTasks:{type:'array',items:{type:'string'}},minShips:{type:'integer',minimum:1}},required:['operation'],additionalProperties:false}},
  {name:'tasks',description:'持久任务与共享预算。add 保存目标、一个orders动作、budget、dependencies、priority；run 可带id只执行该就绪任务，省略才按优先级选；priority是0..100数值；确需战略手动survey时可给顶层manualSurveyReason，不绕过控制权和在途对账。支出预算必须覆盖当前引擎候选的完整实际费用；空预算不能绕过月度/其他任务预留或维护底线。当前可核对费用的动作是market_trade、build_district、build_building、upgrade_building、build_ship、claim_system；其他支出在存在共享承诺时拒绝，不猜费用。view 查看等待和在途对账；cancel 取消未发出任务。',inputSchema:{type:'object',properties:{operation:{enum:['add','run','view','cancel']},id:{type:'string'},task:{type:'object',properties:{goal:{type:'string',minLength:1,maxLength:300},orders:{type:'array',minItems:1,maxItems:1,items:orderInputSchema(ORDER_FIELDS)},budget:{type:'object',additionalProperties:{type:'number',minimum:0}},dependencies:{type:'array',items:{type:'string'}},priority:{type:'number',minimum:0,maximum:100},wake:{type:'object',properties:{gameDate:{type:'string'},taskId:{type:'string'}},additionalProperties:false}},required:['goal','orders'],additionalProperties:false},manualSurveyReason:{type:'string',minLength:1,maxLength:300}},required:['operation'],additionalProperties:false}},
  {name: 'observe', description: '读取当前帝国、资源、己方舰队订单、三项科研、殖民地和内阁，以及有界strategy（主目标、财政余量、扩张是否暂缓、待轮查星球）。先读再操作，返回 snapshotId。', inputSchema: {type: 'object', properties: {}, additionalProperties: false}},
  {name: 'inspect', description: 'buildings可带building_key和当前真实zone_id定向只读核验；两字段须同时提供，只允许当前己方星球，返回此目标can_build、原生拒绝原因和quote，不授权施工。construction包含buildings时也可带这两字段；空批量候选不证明指定建筑非法，已有目标时用此定向核验，不猜zone_id。edicts读取当前启用法令清单；缺失的经费/维护标未知，不能据默认0判断免费，也不代表关闭权限。按需读取真实候选。construction需己方planet id，可用sections选择1..3类buildings/districts/jobs/upgrades/zones，默认建筑和区划；一次返回星球现况和所选真实候选，减少分开查询；未选范围不查，不必再重复查planet和同类候选。执行前仍核验费用和合法性。upgrades需要己方planet id，返回建筑唯一升级路径、building_id、zone_id及引擎条件；upgrade_building只使用当前候选。system/planet/districts/buildings/zones/jobs也需要id；expansion需purpose，route需fleet_id/system_id。market可选resource及action=buy/sell、units（整批数量），只查所选整笔报价，减少无关资源查询；units需要resource/action，数量须为当前batch_size的整数倍。省略仍查全市场。预览不代替执行时新鲜报价；未查方向的价格仍为估计。market还返回完整monthlyAccounting：覆盖未知不能当无订单，总净收支不再叠加月度贸易，未来卖出收入不作当前资金。月度真实设置、调整、撤销用monthly_trade工具，不以反复即时交易冒充自动化；登记不等于逐笔成交。attack_options需国家id，默认返回所有目标真实合法标记及完整征服原因；需要其他目标完整原因时加goal_key，不根据省略原因猜合法。claim_quote需目标星系id，返回当前一次新增宣称的真实影响力费用；claim_system执行重新报价并强制最高费用，tasks的budget须覆盖cost。其余查询包括科研、军队与在建预算、外交、内阁、传统、警报等。先复用返回state.research中的当前candidates和decisionReview.researchChoices；传统/飞升仅用inspect返回的当前candidates，解锁总数不是合法候选。缺字段或局势变化时才补查；候选执行前仍实时核对。候选和事实均需按最新局势核对，空数组不代表空槽，入队不代表完工。', inputSchema: {type: 'object', properties: {topic: {type: 'string', enum: ['claim_quote','targets','war_fleets','armies','attack_options','peace_options','landing','invasion','system', 'planet', 'construction', 'districts', 'buildings', 'upgrades', 'ships', 'leaders', 'expansion', 'traditions', 'events', 'research', 'military', 'designs', 'contacts', 'diplomacy', 'market', 'ascension', 'alerts', 'notifications', 'government', 'edicts', 'map', 'wars', 'war_goals', 'threats', 'route', 'zones', 'jobs', 'strategy']}, id: {type: 'integer', minimum: 0}, fleet_id: {type: 'integer', minimum: 0}, system_id: {type: 'integer', minimum: 0}, district_type: {type: 'string'}, goal_key:{type:'string',pattern:'^wg_[a-zA-Z0-9_]{1,100}$'}, sections:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{enum:['buildings','districts','jobs','upgrades','zones']}}, ...buildingInspectionProperties, resource:{type:'string',pattern:'^[a-z_][a-z0-9_]{0,99}$'}, action:{enum:['buy','sell']}, units:{type:'integer',minimum:1,maximum:5000}, jumps:{type:'integer',minimum:1,maximum:12}, purpose: {type: 'string', enum: ['unsurveyed', 'outpost', 'colonizable', 'deposit']}}, required: ['topic'], additionalProperties: false}},
  {name: 'apply_orders', description: `根据最新 snapshotId 批量提交 1..6 条正常游戏指令。requestId 在不确定结果时必须保持相同，禁止盲重发。arguments 使用原生 snake_case 参数。参数表: ${Object.entries(ORDER_FIELDS).map(([name, [required, optional]]) => `${name}(${required.join(',')}${optional.length ? ';可选:' + optional.join(',') : ''})`).join('；')}。混合调查中空闲且具备原生候选时，survey会明确未发送并返回survey_control的nextCall；优先采用该调用，仍须实际委派核验。确需手动调查可给顶层manualSurveyReason（不放arguments），明确未发送后才调整请求，旧在途/未知动作仍不得重放。assign_scientist 自动采用正确的舰队任命类型。成功状态 posted 只表示提交，要看返回 state 的实际订单/队列。建站、造船、科研正常耗时，不会瞬间完成。`, inputSchema: {type: 'object', properties: {requestId: {type: 'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'}, snapshotId: {type: 'string',minLength:1}, explanation: {type: 'string', description: '一句面向直播观众的中文自言自语，第一人称、45字以内，说明打算及简短原因，不包含内部推演、工具名或原始ID'}, ...(game.nativeCountryAIEnabled?{strategicResearchOverride:{type:'boolean',description:'仅已实际接管国家 AI 后的单项 select_research 干预可为 true；必须提供说明理由的 explanation，允许替换该槽的在研科技。普通科研不使用。'}}:{}), manualSurveyReason:{type:'string',minLength:1,maxLength:300,description:'混合调查中确需精确手动调查的战略理由；仅跳过委派偏好，不绕过实际控制权、旧订单、暂停或停止'}, orders: {type: 'array', minItems: 1, maxItems: 6, items: orderInputSchema(ORDER_FIELDS)}}, required: ['requestId', 'snapshotId', 'orders'], additionalProperties: false}},
  {name: 'watch', description: '本地等待并持续监测事件、敌情、资源与控制权；变化会提前返回。'+(game.nativeCountryAIEnabled?'国家 AI 已持权时最多900秒（六个月复查或关键事件提前返回），只续监督、不派日常订单；未委派时按普通等待上限。':game.hybridSurvey?'仅新鲜且确有子任务的原生委派允许最多'+game.surveyWatchSeconds+'秒；否则最多20秒。工作已安排且无新决策时优先等'+game.surveyWatchSeconds+'秒。':game.localWaitPilot?'已确认实例与队列的本地施工可等待最多60秒，否则最多20秒；未知或人工暂停提前交回。':'最多20秒。')+'空闲等待不额外请求模型。继续经营直到工具明确返回测试时长已到，不重复取消正在执行的订单。', inputSchema: {type: 'object', properties: {seconds: {type: 'number', minimum: 0, maximum: game.nativeCountryAIEnabled?900:game.hybridSurvey?game.surveyWatchSeconds:game.localWaitPilot?60:20}}, additionalProperties: false}}
];
tools.push({name:'monthly_trade',description:(game.monthlyLifecyclePilot?'库存/期限条件试点已显式开启；policy只随新建或实际调整登记，达到条件仅收回对应自有订单。':'')+'月度订单查询、预览、真实执行与回读。execute需requestId、最新snapshotId和set/cancel/replace变更；暂停后提交原生命令并核对order_id。调整先撤后建，非原子；old_order_removed_new_not_submitted表示旧单已撤但新单未提交，不能自动回退为新增。明确未发送/拒绝不会认领同字段手工单；cancellation_not_submitted表示原单仍需核对收回。未知结果用reconcile，不重试命令。登记不等于月结成交。停止撤销本会话创建的订单。inspect中的recovery列出当前进程绑定的旧会话记录；recover需previousSessionId、原requestId和最新snapshotId，仅撤旧单并回读，不恢复旧计划、不接管手工单。',annotations:{readOnlyHint:false,destructiveHint:true},inputSchema:{type:'object',properties:{operation:{enum:game.surveyPilot?['inspect','preview','reconcile']:['inspect','preview','execute','reconcile','recover']},previousSessionId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},requestId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},snapshotId:{type:'string'},change:monthlyChangeSchema,...(game.monthlyLifecyclePilot?{policy:monthlyLifecycleSchema}:{})},required:['operation'],anyOf:[{properties:{operation:{const:'inspect'}}},{properties:{operation:{const:'preview'}},required:['change']},{properties:{operation:{const:'execute'}},required:['requestId','snapshotId','change']},{properties:{operation:{const:'reconcile'}},required:['requestId']},{properties:{operation:{const:'recover'}},required:['previousSessionId','requestId','snapshotId']}],additionalProperties:false}});
tools.push({name:'survey_control',description:(game.hybridSurvey?'科研船局部委派试点。delegate仅委派自动调查。':'调查试点已关闭，仅保留查询与收权，不允许新委派。')+'inspect查询真实状态；reclaim撤销并回读；reconcile核对未确认交接；recover核对重启后的当前科研船并收权，不恢复旧任务。需要桥支持调查查询；更改需要最新snapshotId，旧会话先recover。控制权未交回前不能直接覆盖船的订单。',inputSchema:{type:'object',properties:{operation:{enum:game.hybridSurvey?['inspect','delegate','reclaim','reconcile','recover']:['inspect','reclaim','reconcile','recover']},fleetId:{type:'integer',minimum:0},snapshotId:{type:'string'}},required:['operation','fleetId'],additionalProperties:false}});
if(game.nativeCountryAIEnabled){
 const apply=tools.find(t=>t.name==='apply_orders');
 if(apply){
  const allowed=['declare_war','offer_peace','diplomacy','respond_diplomacy','resolve_event','open_war_goals','set_defender_war_goal','close_war_goals','build_building','move_fleet','set_fleet_stance'];
  apply.inputSchema.properties.orders.items=orderInputSchema(Object.fromEntries(allowed.map(name=>[name,ORDER_FIELDS[name]])));
  delete apply.inputSchema.properties.strategicResearchOverride;
  apply.description='本人具体经营任务仅在当前世界授权成立（userEconomicPolicy.worldTaskAuthorized=true）时开放。先country_ai_control takeover并确认human持权、暂停与AI关闭，才允许preferredUnityBuildings白名单节点的build_building（真实zone、当前定向CanBuild及完整费用/储备核验），或militaryPolicy=exploration_until_threat时的己方空闲现有军舰set_fleet_stance(evasive)与move_fleet安全探索；逐路点核验当前可达与已知军事风险，不派往已知外国领土。已充分核验的无敌安全航路不要求改姿态；未知邻居实际读回passive/evasive非主动追敌姿态即可；passive不保证自动避敌，不能凭Post成功冒称evasive生效或换requestId重设。当前世界确有相应探索授权时，intel低本身不拒绝，但只进入当前明确直接相邻航道，不跨多段未知路线；未知不等于证明绝对安全，不授权作战/扩军。先inspect military/route/map选实际目标，不得只写guidance。入队或移动订单不等于完成，本人执行期暂不resume，保持human用watch(20)推进至真实建筑完工/舰队抵达，再自动恢复已保存的原生委派。执行受阻先核对，不盲重放。AI开启时这些普通单仍拒绝，其他日常命令不开放。其余仅保留决定：宣战、议和、外交提议/回应，原生国家AI继续运行。中央事件和战争目标须先实际接管并确认暂停，再inspect events或wars/war_goals，只选择当前合法选项；完成后delegate/resume交还。优先使用strategy_contract统一提交战略；日常经营不由模型派单。';
 }
}
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if(game.colonyUpgradePilot)tools.push({name:'colony_upgrade_control',description:'有预算的单星球建筑升级托管，当前入口开关启用时提供。模型先inspect读取真实building_id、当前升级目标和费用，再delegate允许的upgrade_key列表、总预算、最多1..4次及复查间隔。本地仅升级允许且合法的现有建筑，普通施工队列不追加。pause/resume保持原预算，reclaim交回控制；停用不取消已有施工、不退款。',inputSchema:{type:'object',properties:{operation:{enum:game.surveyPilot?['inspect']:['inspect','delegate','advance','pause','resume','reclaim']},planetId:{type:'integer',minimum:0,maximum:4294967294},snapshotId:{type:'string'},policy:colonyUpgradePolicySchema},required:['operation'],anyOf:[{properties:{operation:{const:'inspect'}}},{properties:{operation:{const:'delegate'}},required:['snapshotId','policy']},{properties:{operation:{const:'advance'}},required:['snapshotId']},{properties:{operation:{enum:['pause','resume','reclaim']}},required:['snapshotId','planetId']}],additionalProperties:false}});
tools.push({name:'colony_control',description:'单星球本地住房托管，不开启原生行星AI。模型先inspect读取住房、当前定位和真实可建区划费用，再delegate给出policy：住房目标、住房区划、总支出上限、最多1..4次建设和复查间隔。watch中本地推进，无需每次请求模型；advance明确复查，pause暂停本地派发，resume核对同会话对象后沿用原预算恢复，reclaim收回控制。已排队建设保留，不宣称撤销或退款。托管星球手动建设前先收回；新会话不自动续权。',inputSchema:{type:'object',properties:{operation:{enum:game.surveyPilot?['inspect']:['inspect','delegate','advance','pause','resume','reclaim']},planetId:{type:'integer',minimum:0,maximum:4294967294},snapshotId:{type:'string'},policy:colonyRoutineSchema},required:['operation'],anyOf:[{properties:{operation:{const:'inspect'}}},{properties:{operation:{const:'delegate'}},required:['snapshotId','policy']},{properties:{operation:{const:'advance'}},required:['snapshotId']},{properties:{operation:{enum:['pause','resume','reclaim']}},required:['snapshotId','planetId']}],additionalProperties:false}});
async function handle(request) {
  if (request.id === undefined) return;
  let result;
  try {
    if (request.method === 'initialize') result = {protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: {tools: {}}, serverInfo: {name: 'cyberfish-stellaris-native', version: '0.1.0'}, instructions: game.nativeCountryAIEnabled ? '你是大肥鱼。v1.5 日常运营优先交本国原生国家AI，低频用strategy_contract引导；当前世界有明确授权（userEconomicPolicy.worldTaskAuthorized=true）的白名单建设和现有舰队探索才可以先takeover核实人类持权和暂停再受控执行。已接受的本人任务用human watch持续推进，真实完工或抵达后再resume，不能刚入队就交回让原生重排。战争和实际保供危机优先，未知结果不重放。没有本人任务时用原生委派和watch持续经营，宣战议和外交仍走保留决定。范围和未知如实说，开关/派发不代表经营效果。ID 0 有效，不作弊。' : '你是大肥鱼。只用原生工具正常经营群星。状态 ID 0 有效；不得作弊。先查候选再操作，每批简短解释目的。'};
    else if (request.method === 'tools/list') result = {tools:game.nativeCountryAIEnabled?tools.filter(t=>!['campaign','tasks','monthly_trade','colony_control','colony_upgrade_control','survey_control'].includes(t.name)):tools.filter(t=>t.name!=='strategy_contract')};
    else if (request.method === 'ping') result = {};
    else if (request.method === 'resources/list') result = {resources: []};
    else if (request.method === 'resources/templates/list') result = {resourceTemplates: []};
    else if (request.method === 'prompts/list') result = {prompts: []};
    else if (request.method === 'tools/call') {
      try {
        if(stopping)throw Error('控制会话正在停止，不接受新的游戏操作');
        if (!ready) {startAttempted=true;await game.start({keepPaused:process.env.CYBERFISH_START_PAUSED==='1'}); ready = true;}
        const {name, arguments: args = {}} = request.params || {};
        let value = name === 'strategy_contract' ? await game.strategyControl(args) : name === 'country_ai_control' ? await game.countryAIControl(args) : name === 'colony_upgrade_control' ? await game.colonyUpgradeControl(args) : name === 'colony_control' ? await game.colonyControl(args) : name === 'monthly_trade' ? await game.monthlyTrade(args) : name === 'survey_control' ? await game.surveyControl(args) : name === 'campaign' ? await game.campaign(args) : name === 'tasks' ? await game.task(args) : name === 'observe' ? await game.observe() : name === 'inspect' ? await game.inspect(args) : name === 'apply_orders' ? await game.apply(args) : name === 'watch' ? await game.watch(args.seconds ?? 15) : (() => {throw new Error('未知游戏工具');})();
        if(name==="inspect")await game.recordStrategyInspection(args.topic);
        if(name==="observe" || name==="watch") value=projectState(value,{full:name==="observe"});
        if(value.state)value={...value,state:projectState(value.state)};
        result = {content: [{type: 'text', text: JSON.stringify(value)}]};
      } catch (error) {
        const call=request.params;
        if(game.nativeCountryAIEnabled&&call?.name==='country_ai_control'&&['delegate','resume'].includes(call.arguments?.operation)){
          await game.requestStop('国家 AI 委派失败，停止本轮，不让模型重复尝试');
          await writeFile(join(game.directory,'startup-error.json'),JSON.stringify({started:game.started,at:Date.now(),code:'country_ai_startup',message:'原生国家 AI 委派失败，已停止自动重试。'}));
          await writeFile('.local/STOP',new Date().toISOString());
        }
        result = {isError: true, content: [{type: 'text', text: nativeToolErrorText(error)}]};
      }
    } else throw new Error('不支持的 MCP 方法');
    emit({jsonrpc: '2.0', id: request.id, result});
  } catch (error) {emit({jsonrpc: '2.0', id: request.id, error: {code: -32601, message: error.message}});}
}
const work=new SerialWork();let buffer='',lastToolAt=Date.now();
const monitor=setInterval(()=>{
  if(!ready||stopping)return;
  const execution=executionStatus({sessionId:game.sessionId,state:game.lastState,runtimeStatus:game.runtimeStatus});
  void quality.tick(execution.known?{date:execution.date,paused:execution.paused}:{});
  void work.idle(async()=>{
    await game.monitorDecision(Date.now()-lastToolAt);
    if(game.nativeStrategicReviewDue){
      const deferral=await readStrategyReviewDeferral(game.directory);
      if(deferral)await game.applyStrategyReviewDeferral(deferral);
    }
    if(await game.refreshOrderTracking())await game.checkpoint();
    await game.serviceAudienceQueries();
  }).catch(error=>process.stderr.write(`本地决策监测: ${error.message}\n`));
},1000);monitor.unref();
let checkingStop=false;
const stopMonitor=setInterval(async()=>{
 if(stopping||checkingStop)return;checkingStop=true;
 try{const reason=await readStopRequest({directory:game.directory,runId:process.env.CYBERFISH_CONTROLLER_RUN,baseline:Number(process.env.CYBERFISH_STOP_BASELINE)||game.started});if(reason)void shutdown(reason).catch(error=>process.stderr.write(`停止清理: ${error.message}\n`));}
 finally{checkingStop=false;}
},250);stopMonitor.unref();
const decoder = new StringDecoder('utf8');
process.stdin.on('data', data => {
  buffer += decoder.write(data);
  if (Buffer.byteLength(buffer) > 1024 * 1024) return void shutdown();
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    void work.run(async()=>{const request=JSON.parse(line);try{await handle(request);}finally{if(request.method==='tools/call')lastToolAt=Date.now();}}).catch(error => process.stderr.write(`MCP 请求错误: ${error.message}\n`));
  }
});
async function shutdown(reason='MCP连接关闭或收到停止信号') {if (stopping) return; stopping = true;const seal=game.requestStop(typeof reason==='string'?reason:'MCP收到停止信号');quality.stop();clearInterval(monitor);clearInterval(stopMonitor);await seal.catch(error=>process.stderr.write(`停止记录: ${error.message}\n`));await work.drain(); if (startAttempted){await game.stop();await writeStopCompletion(game.directory,{runId:process.env.CYBERFISH_CONTROLLER_RUN,sessionId:game.sessionId,cleanup:game.cleanup});}process.exit(0);}
process.stdin.on('end', shutdown); process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
