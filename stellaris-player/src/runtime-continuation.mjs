// Continue only the already-authorized, bounded live run. Never extend its
// deadline, override STOP, or start another game/controller.
export function runtimeContinuation(checkpoint,{now=Date.now(),stopAt=0}={}) {
  if(!checkpoint?.state?.snapshotId||checkpoint.stopped||checkpoint.state.terminal||!Number.isFinite(checkpoint.started)||!Number.isFinite(checkpoint.ends)||checkpoint.ends<=checkpoint.started||!Number.isFinite(now)||now<checkpoint.started||checkpoint.ends<=now||stopAt>=checkpoint.started)return null;
  const remaining=Math.ceil((checkpoint.ends-now)/1000);
  if((checkpoint.countryAIControl??checkpoint.state.countryAIControl)?.enabled===true)return {remaining,text:`本轮国家 AI 战略指挥尚余${remaining}秒，不增加时长。先核对 country_ai_control 当前持权；无关键干预用 watch 监督，战略复查保持方向用 continue。新方向用strategy_contract，宣战议和外交直接执行且原生AI保持开启，takeover仅紧急收权。不得逐条经营、恢复旧战役或重放未知开启；停止信号和原期限始终优先。`};
  return {remaining,text:`这是本地运行器的自动续跑提醒，不是新的用户任务。当前测试尚余${remaining}秒，仍使用同一游戏和控制器。不要以纯文字结束；先observe或watch回读，再继续有效经营。工作已安排且没有新决策时，按watch工具公布的上限等待；控制器会实时核对可信工作、缩短等待或因事件提前返回，不因本提醒增加授权时长。有中央事件先处理；仅在工具明确时长结束、游戏结束或停止信号出现时收尾。不重发未知指令，先核对月度/建设的持久请求和控制记录。`};
}
