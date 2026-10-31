import {COUNTRY_AI_POLICIES} from './native-country-ai-economic-policy.mjs';
export function countryAIControlTool({economyCandidate=false}={}){
 const operations=['status','delegate','takeover','reclaim','resume','continue','stop'];
 const properties={operation:{enum:economyCandidate?[...operations,'protect']:operations},
  policy:{enum:Object.keys(COUNTRY_AI_POLICIES).filter(p=>economyCandidate||!p.startsWith('economy'))},
  maxGameDays:{type:'integer',minimum:1,maximum:720},maxWallSeconds:{type:'number',minimum:1,maximum:3600}};
 if(economyCandidate){
  properties.protectedTargets={type:'object',properties:Object.fromEntries(['jobs','colonies','shipyards'].map(k=>[k,
   {type:'array',items:{type:'integer',minimum:0,maximum:4294967294},maxItems:256}])),additionalProperties:false};
  properties.reason={type:'string',minLength:1,maxLength:500};
 }
 return {name:'country_ai_control',description:'v1.4 国家 AI 混合控制入口。status 查询实际控制者与支持范围；delegate 让游戏原生国家 AI 自己选择并执行已支持领域的经营，程序只监督，不逐条选择项目。takeover/reclaim/stop 先暂停、关闭本轮国家 AI 并排空命令，真实回读后才开放关键干预；resume 核对同一世界并用新代次交还。托管时本地经营和战役派单封口，watch与模型等待只续监督。普通战略复查保持原生经营，用continue确认；关键干预先 takeover，完成后resume。重大外交、政策和其他不在允许范围的本国AI命令在原生入队及已识别本国Post前阻止，未覆盖路径如实显示。不承诺全领域、原生花费硬预算或核心目标已完成。调查、本地任务、开关true不能替代原生国家AI持续经营。'+
  (economyCandidate?'显式候选入口：economy含科研、普通行星建设、岗位上限和专精，economy_and_ship_production另含普通静态星基船坞的普通船与殖民船。候选尚待统一实机验收，必须匹配桥的真实能力；不含联邦/共同体船、移动船坞或完整扩张。protect仅在真实接管后保存关键设置保护，必须给reason及完整protectedTargets；这是整份替换，清空必须显式{}。colonies保护岗位上限/专精，jobs保护单岗位上限，shipyards阻止新增生产，均不取消已有施工。返回pending_native_revalidation不是已生效，交还时须读回原生约束才开启。首次delegate也可给protectedTargets；resume沿用已保存策略和保护，不用普通接口逐条派日常经营订单。':'当前仅科研/普通行星建设试点，不提供经济候选或保护功能。'),
  inputSchema:{type:'object',properties,required:['operation'],additionalProperties:false}};
}
