import {surveyedBodyDelta} from './survey-benchmark-cohort.mjs';
import {createHash} from 'node:crypto';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])])):x;
export function benchmarkStartFingerprint(state){
 const keys=['date','paused','speed','player','resources','research','civilian','capacities','council','traditions','wars','pendingEvents'];
 if(!state||keys.some(k=>state[k]===undefined))throw Error('对照起点缺少必要实时字段');
 return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(keys.map(k=>[k,state[k]]))))).digest('hex');
}
// A matched starting file is necessary but insufficient. Check actual starting
// observations, full wall-time, normal cleanup, real requests and equal coverage.
export function compareSurveyBranches(a,b){
 const baseline=a?.spec?.mode==='baseline'?a:b,hybrid=a?.spec?.mode==='hybrid'?a:b;
 const failures=[];
 if(baseline===hybrid||baseline?.spec?.mode!=='baseline'||hybrid?.spec?.mode!=='hybrid')failures.push('需要一组baseline和一组hybrid');
 for(const key of ['initialSaveSha256','initialDate','minutes','maxRequests','speed','model','scope'])if(baseline?.spec?.[key]===undefined||baseline.spec[key]!==hybrid?.spec?.[key])failures.push(`对照条件不一致：${key}`);
 if((baseline?.spec?.coverage??'initial_candidates_v1')!==(hybrid?.spec?.coverage??'initial_candidates_v1')||(baseline?.spec?.cohortJumps??null)!==(hybrid?.spec?.cohortJumps??null))failures.push('统计范围协议或半径不同');
 if((baseline?.spec?.adapterRevision!==undefined||hybrid?.spec?.adapterRevision!==undefined)&&baseline?.spec?.adapterRevision!==hybrid?.spec?.adapterRevision)failures.push('适配实现版本不同');
 if((baseline?.spec?.hybridWatchSeconds??60)!==(hybrid?.spec?.hybridWatchSeconds??60))failures.push('对照等待策略配置不同');
 let startA,startB;
 try{startA=benchmarkStartFingerprint(baseline.readyState);startB=benchmarkStartFingerprint(hybrid.readyState);if(startA!==startB)failures.push('统一准备后的实际起点不同');}catch{failures.push('实时起点证据缺失');}
 for(const branch of [baseline,hybrid]){
  if(branch?.fullTimedBranch!==true)failures.push('未完成约定的整轮时长');
  if(branch?.stopConfirmed!==true)failures.push('结束暂停与调查关闭未确认');
  if(branch?.run?.controlEvidence?.writeBoundaryComplete!==true||branch.run.controlEvidence.forbiddenWritesAfterStop!==0)failures.push('停止写入边界不完整或停止后仍有工作写入');
  if(branch?.preflightPassed!==true)failures.push('初始准入未通过');
  if(branch?.spec?.nativeWatchSeconds!==undefined&&branch?.run?.controlEvidence?.watchMaximumSeconds!==branch.spec.nativeWatchSeconds)failures.push('实际等待上限与对照声明不同或缺失');
  if(branch?.run?.actualMode!==branch?.spec?.mode)failures.push('原生会话模式与对照声明不一致');
  if(branch?.run?.requestedModels?.length!==1||branch.run.requestedModels[0]!==branch.spec.model)failures.push('实际模型请求与声明不一致或未知');
  if(!Number.isSafeInteger(branch?.run?.modelRequests)||branch.run.modelRequests<=0)failures.push('缺少真实模型请求计数');
 }
 if(!baseline?.run?.controlEvidence?.bridgeVersion||baseline.run.controlEvidence.bridgeVersion!==hybrid?.run?.controlEvidence?.bridgeVersion)failures.push('实际桥版本未知或不同');
 if(!baseline?.run?.serverModels?.length||JSON.stringify(baseline.run.serverModels)!==JSON.stringify(hybrid?.run?.serverModels))failures.push('服务端实际模型未知或不同');
 const targets=branch=>(branch?.trackedSystems||[]).slice().sort((x,y)=>x.id-y.id);
 const before=branch=>targets(branch).map(x=>({id:x.id,before:x.before}));
 if(!targets(baseline).length||JSON.stringify(canonical(before(baseline)))!==JSON.stringify(canonical(before(hybrid))))failures.push('起始目标覆盖不一致或为空');
 const measure=branch=>{
  const rows=targets(branch);
  const complete=rows.filter(x=>x.before?.id===x.id&&x.after?.id===x.id&&x.before.surveyed===false&&x.after.surveyed===true).map(x=>x.id);
  const coverage=rows.every(x=>x.before?.id===x.id&&x.after?.id===x.id&&typeof x.after.surveyed==='boolean');
  const bodies=rows.map(x=>surveyedBodyDelta(x.before,x.after));const flatBodies=bodies.filter(x=>x!==null).flat();const bodyCoverageKnown=rows.length>0&&bodies.every(x=>x!==null)&&new Set(flatBodies).size===flatBodies.length;
  return {bodyCoverageKnown,newlySurveyedBodies:bodyCoverageKnown?bodies.flat().length:null,requests:branch?.run?.modelRequests??null,usage:branch?.run?.usage??null,completedSystems:complete,coverageComplete:coverage,pauseSamples:branch?.run?.controlEvidence?.sampledIntervals??null};
 };
 const base=measure(baseline),mix=measure(hybrid);
 if(!base.coverageComplete||!mix.coverageComplete)failures.push('结束目标回读不完整');
 const valid=failures.length===0,sameWork=base.completedSystems.length>0&&JSON.stringify(base.completedSystems)===JSON.stringify(mix.completedSystems);
 return {matchedObservedStart:valid,worldLineageVerified:false,failures:[...new Set(failures)],baseline:base,hybrid:mix,
  requestReductionPercent:valid&&sameWork?(base.requests-mix.requests)/base.requests*100:null,
  costReductionPercent:null,
  limitations:['只反映这一次配对；随机事件和模型缓存会影响结果，不能外推为长期提升。','未完成相同目标集或证据不完整时不计算请求减少比例；价格与账单未核对时不估算费用。','文件哈希与实时起点匹配不代表任意跨存档血缘已被证明。']};
}
