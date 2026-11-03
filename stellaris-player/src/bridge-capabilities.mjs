export const BRIDGE_VERSION='cyberfish-0.6.6-gestalt-war-r1';
export const SURVEY_BRIDGE_VERSION='cyberfish-0.6.7-survey-pilot-r1';
export const MONTHLY_BRIDGE_VERSION='cyberfish-0.6.9-monthly-read-r2';
export const MONTHLY_QUOTE_BRIDGE_VERSION='cyberfish-0.6.10-monthly-quotes-r1';
export const UPGRADE_PATH_BRIDGE_VERSION='cyberfish-0.6.11-upgrade-paths-r1';
export const TRADE_BUDGET_BRIDGE_VERSION='cyberfish-0.6.12-trade-budget-r1';
export const CLAIM_BUDGET_BRIDGE_VERSION='cyberfish-0.6.14-claim-budget-r1';
const required=['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions'];
export function assertBridgeCapabilities(ping,{hybridSurvey=false,upgradePaths=false,tradeBudget=false,claimBudget=false,nativeCountryAI=false}={}){
 if(nativeCountryAI){
  if(!isCountryAIBridgeCompatible(ping)||required.some(f=>!ping.features.includes(f)))throw Error('国家 AI 需要 v1.5 默认放行和保留决定门控桥；请手动重启后加载新桥');
  return true;
 }
 if([MONTHLY_QUOTE_BRIDGE_VERSION,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version)&&(!Array.isArray(ping.features)||!ping.features.includes('engine_monthly_trade_quotes')||!ping.features.includes('monthly_trade_read_coverage_candidate')))throw Error('月度报价桥缺少对应功能标记，拒绝降级为未核对的接口');
 if((tradeBudget||[TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version))&&(![TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version)||!Array.isArray(ping.features)||!ping.features.includes('actual_market_upkeep_budget')))throw Error('动态交易预算需要对应原生维护保护功能，旧桥仍有固定门槛');
 if((upgradePaths||[UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version))&&(![UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version)||!Array.isArray(ping.features)||!ping.features.includes('building_upgrade_string_paths')))throw Error('建筑升级需要已修正字符串路径布局的新桥；旧桥保持禁用升级试点');
 if((claimBudget||ping?.bridge_version===CLAIM_BUDGET_BRIDGE_VERSION)&&(ping?.bridge_version!==CLAIM_BUDGET_BRIDGE_VERSION||!Array.isArray(ping.features)||!['engine_claim_cost_quotes','capped_claim_spending'].every(f=>ping.features.includes(f))))throw Error('宣称执行需要实时费用与原生最高费用保护');
 const survey=[SURVEY_BRIDGE_VERSION,MONTHLY_BRIDGE_VERSION,MONTHLY_QUOTE_BRIDGE_VERSION,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version)&&Array.isArray(ping.features)&&ping.features.includes('native_survey_automation_candidate');
 if((hybridSurvey?!survey:ping?.bridge_version!==BRIDGE_VERSION&&!survey)||!Array.isArray(ping.features)||required.some(key=>!ping.features.includes(key)))throw new Error('当前已加载的原生桥版本或功能不匹配；请结束控制后按正常流程重启游戏加载新版，不继续下单');
 return true;
}
import {isCountryAIBridgeCompatible} from './native-country-ai.mjs';
