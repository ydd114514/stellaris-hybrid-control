// Only the parent IPC channel can request an administrative host shutdown.
// An exit is authorized by this run's completed, durable game cleanup, never
// merely by a transport error or a stale checkpoint.
export function confirmedHostStop(message,{runId,checkpoint,completion,request}){
 return message?.type==='cyberfish-host-stop'&&typeof runId==='string'&&message.runId===runId&&
  completion?.version===1&&completion.runId===runId&&completion.sessionId===message.sessionId&&
  checkpoint?.controllerRunId===runId&&checkpoint.sessionId===message.sessionId&&checkpoint.stopped===true&&
  Number.isFinite(completion.completedAt)&&completion.completedAt>=checkpoint.started&&
  request?.version===1&&request.runId===runId&&Number.isFinite(request.requestedAt)&&
  request.requestedAt>=checkpoint.started&&completion.completedAt>=request.requestedAt;
}
export function hostStopExitCode(completion,hadAgentError){
 return !hadAgentError&&completion?.pauseConfirmed===true&&completion?.surveyConfirmed===true&&completion?.monthlyTradeConfirmed!==false&&completion?.colonyControlConfirmed!==false?0:1;
}
