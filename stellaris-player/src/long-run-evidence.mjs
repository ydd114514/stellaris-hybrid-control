// A continuous controller interval is not the sum of resumed sessions or the
// supervisor's earlier bootstrap time. Safety pauses stay in the same interval.
const featureKeys=['colonyUpgrade','monthlyLifecycle','localWait'];
export function liveRunFeatureEnvironment({longRun=false}={}){
 if(typeof longRun!=='boolean')throw Error('长测功能配置必须为布尔值');
 const enabled=longRun?'1':'0';
 return {CYBERFISH_COLONY_UPGRADE_PILOT:enabled,CYBERFISH_MONTHLY_LIFECYCLE_PILOT:enabled,CYBERFISH_LOCAL_WAIT_PILOT:enabled};
}
export function longRunProfile({minutes=30,maxRequests=200}={}) {
 if(![30,60].includes(minutes))throw Error('长测只支持30或60分钟');
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>200)throw Error('长测请求上限需要1..200');
 return {minutes,maxRequests,mode:'hybrid',surveyPilot:false,presentOrders:false,requiredFeatureFlags:{colonyUpgrade:true,monthlyLifecycle:true,localWait:true},scope:'normal_hybrid_gameplay',durationOrigin:'native_controller_started',acceptanceClaimed:false};
}
export function assessLongRun({profile,report,checkpoint,controlEvidence,sessionIds=[],nativeStopRequestedAt,nativeStoppedAt}={}) {
 const failures=[];let observedDurationMs=null;
 if(![30,60].includes(profile?.minutes)||profile?.surveyPilot!==false||profile?.mode!=='hybrid')failures.push('长测运行配置未知或仍是调查专用短测');
 const featureScopeConfirmed=featureKeys.every(key=>profile?.requiredFeatureFlags?.[key]===true&&controlEvidence?.featureFlags?.[key]===true);
 if(!featureScopeConfirmed)failures.push('当前交付的升级/月度条件/施工等待功能未在实际控制器中确认开启');
 if(Number.isFinite(checkpoint?.started)&&Number.isFinite(checkpoint?.ends)&&checkpoint.ends-checkpoint.started===profile?.minutes*60000&&Number.isFinite(nativeStopRequestedAt)&&Number.isFinite(nativeStoppedAt)&&nativeStoppedAt>=nativeStopRequestedAt&&report?.ended>=nativeStoppedAt)observedDurationMs=nativeStopRequestedAt-checkpoint.started;
 else failures.push('原生控制器起止时间缺失或时长不符');
 if(observedDurationMs===null||observedDurationMs<profile?.minutes*60000)failures.push('原生控制器未运行满规定时长');
 if(new Set(sessionIds).size!==1||sessionIds[0]!==checkpoint?.sessionId||controlEvidence?.sessionId!==checkpoint?.sessionId)failures.push('缺少单一连续会话证据');
 if(report?.stopReason!=='long_run_deadline')failures.push('未按长测截止结束');
 if(controlEvidence?.mode!=='hybrid'||controlEvidence?.writeBoundaryComplete!==true||controlEvidence?.forbiddenWritesAfterStop!==0)failures.push('混合控制模式或停止写入边界未确认');
 if(checkpoint?.stopped!==true||checkpoint?.cleanup?.paused!==true||checkpoint?.cleanup?.surveyStatus!=='confirmed')failures.push('最终暂停与收权未确认');
 if(!Number.isSafeInteger(report?.model?.forwardedRequests)||report.model.forwardedRequests<1||report.model.forwardedRequests>profile?.maxRequests)failures.push('真实模型请求未知或超出预算');
 return {technicalDurationPassed:failures.length===0,featureScopeConfirmed,failures,observedDurationMs,controllerStarted:checkpoint?.started??null,outerDurationMs:report?.ended-report?.started||null,sessionId:checkpoint?.sessionId??null,exitCode:report?.exitCode??null,controlEvidence:controlEvidence??null,acceptancePassed:false,
 limitations:['仅核对连续控制器时长与停止边界；安全暂停包含在控制器时长中，实际游戏运行时长另看采样。','多任务同期推进、主动干预、支出解释、观感及前序阶段证据仍须独立核查，时长通过不等于整体验收。','DSH原始退出码保留；截止取消传输导致的错误不能记作正常退出验收。']};
}
