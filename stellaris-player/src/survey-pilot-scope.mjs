// Only the dedicated technical pilot uses this gate; ordinary gameplay keeps
// the existing action set. Whole batches are checked before any side effect.
const allowed=new Set(['resolve_event','select_research','move_fleet','set_fleet_stance','set_speed','adopt_tradition','launch_council_agenda','set_council_agenda']);
export function assertSurveyPilotOrders(orders,{hybridSurvey=true}={}){
 for(const order of orders){
  if(order.command==='survey'&&hybridSurvey===false)continue; // matched manual baseline
  if(!allowed.has(order.command))throw Error('调查专用试验不允许此经营动作；保留现有队列，继续当前调查、必要科研和事件处理');
  if(order.command==='set_speed'&&order.arguments.speed>2)throw Error('调查专用试验速度最多2，不提高速度缩短测试');
  if(order.command==='set_fleet_stance'&&order.arguments.stance!=='evasive')throw Error('调查专用试验保持回避姿态');
 }
}
