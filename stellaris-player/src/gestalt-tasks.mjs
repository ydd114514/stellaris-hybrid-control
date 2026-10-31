import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const scopedKey=(order,scope)=>canonical(scope?{order,scope}:order);

// A durable outbox. Unknown writes retain their commitments until observed.
export class GestaltTasks {
  constructor({directory,now=Date.now}) {this.file=join(directory,'gestalt.json');this.now=now;this.data={version:1,tasks:[],actions:[]};this.generation=0;this.paused=false;}
  async bind(binding,state) {
    const components=[binding?.pid,binding?.creationTime,state.player?.country_id,state.player?.capital_system_id];
    if(Number.isSafeInteger(state.nativeWorldGeneration))components.push(state.nativeWorldGeneration);
    const identity=JSON.stringify(components);
    if(this.identity) {if(this.identity!==identity||state.date<this.date)throw Error('存档身份或日期改变，停止旧任务');this.date=state.date;return;}
    this.identity=identity;this.date=state.date;
    this.file=join(this.file.slice(0,this.file.lastIndexOf('gestalt.json')),'gestalt-'+createHash('sha256').update(identity).digest('hex').slice(0,24)+'.json');
    try {const d=JSON.parse(await readFile(this.file,'utf8'));if(d.version===1&&d.identity===identity&&d.date<=state.date)this.data=d;}catch(e){if(e.code!=='ENOENT')throw Error('持久任务记录损坏，拒绝自动覆盖');}
    this.data.identity=identity;
    for(const a of this.data.actions)a.key=scopedKey(a.order,a.scope);
    for(const a of this.data.actions)if(['issued','submitted'].includes(a.status))a.status='unknown';
    await this.save();
  }
  async save(){this.data.date=this.date;await writeFile(this.file+'.tmp',JSON.stringify(this.data,null,2));await rename(this.file+'.tmp',this.file);}
  commitments(){const sum={};for(const r of this.data.monthlyTrades||[])if(!r.released)for(const [key,n]of Object.entries(r.reservation||{}))sum[key]=(sum[key]||0)+n;for(const t of this.data.tasks.filter(t=>['ready','executing','blocked'].includes(t.status)||(t.status==='waiting'&&!this.data.actions.some(a=>a.taskId===t.id))))for(const [r,n]of Object.entries(t.budget||{}))sum[r]=(sum[r]||0)+n;return sum;}
  async add(input,state){
    if(this.data.tasks.length>=128)throw Error('任务达到128项上限，请先归档');
    if(!input||typeof input.goal!=='string'||!input.goal.trim()||!Array.isArray(input.orders)||input.orders.length!==1)throw Error('每项持久任务需要目标和一个动作；多步使用依赖任务');
    if(input.priority!==undefined&&(!Number.isFinite(input.priority)||input.priority<0||input.priority>100))throw Error('priority必须为0..100数值');
    const budget=structuredClone(input.budget||{});const reserved=this.commitments();
    for(const [r,n]of Object.entries(budget))if(!Number.isFinite(n)||n<0||!Number.isFinite(state.resources?.[r]?.stockpile)||state.resources[r].stockpile-(reserved[r]||0)<n)throw Error('共享预算不足或库存未知：'+r);
    const dependencies=input.dependencies||[];if(!Array.isArray(dependencies)||dependencies.some(id=>!this.data.tasks.some(t=>t.id===id)))throw Error('任务依赖不存在');
    if(input.wake?.gameDate&&!/^\d{4}\.\d{2}\.\d{2}$/.test(input.wake.gameDate))throw Error('游戏唤醒日期无效');
    const task={id:randomUUID(),goal:input.goal.slice(0,300),orders:structuredClone(input.orders),budget,dependencies,priority:Math.min(100,Math.max(0,Number(input.priority)||0)),createdAt:this.now(),status:input.wake?'waiting':'ready',wake:input.wake||null};
    this.data.tasks.push(task);await this.save();return task;
  }
  async cancel(id){const t=this.data.tasks.find(t=>t.id===id);if(!t)throw Error('任务不存在');if(this.data.actions.some(a=>a.taskId===id&&['issued','unknown'].includes(a.status)))throw Error('在途动作必须先对账');t.status='cancelled';await this.save();}
  async upgradeVirtualEventScopes(){
    const groups=new Map();
    for(const a of this.data.actions)if(!a.scope&&a.order.command==='resolve_event'&&a.order.arguments.window_id===0xFFFF0003&&['issued','unknown','submitted'].includes(a.status)){
      const session=a.snapshotId?.split(':')[0];if(!/^[a-f0-9-]{36}$/.test(session||''))continue;
      if(!groups.has(session))groups.set(session,[]);groups.get(session).push(a);
    }
    for(const [session,rows]of groups){
      const input=createReadStream(join(this.file.slice(0,this.file.lastIndexOf('gestalt-')),`session-${session}.jsonl`),{encoding:'utf8'});
      const lines=createInterface({input,crlfDelay:Infinity});
      try{for await(const line of lines){
        let r;try{r=JSON.parse(line);}catch{continue;}
        if(r.type!=='state')continue;
        for(const a of rows.filter(a=>!a.scope&&a.snapshotId===r.state?.snapshotId)){
          const e=r.state.pendingEvents?.find(e=>e.window_id===0xFFFF0003);
          if(Number.isSafeInteger(e?.first_contact_id)){a.scope=[e.first_contact_id,e.title,e.kind];a.key=scopedKey(a.order,a.scope);}
        }
        if(rows.every(a=>a.scope))break;
      }}catch(error){if(error.code!=='ENOENT')throw error;}finally{lines.close();input.destroy();}
    }
  }
  async upgradeReinforcementScopes(){
    for(const a of this.data.actions)if(!a.scope&&a.order.command==='reinforce_fleet'&&a.trackingId&&['issued','unknown','submitted'].includes(a.status)){
      const session=a.snapshotId?.split(':')[0];if(!/^[a-f0-9-]{36}$/.test(session||''))continue;
      try{
        const tracking=JSON.parse(await readFile(join(this.file.slice(0,this.file.lastIndexOf('gestalt-')),`orders-${session}.json`),'utf8'));
        const targets=tracking.records?.find(r=>r.id===a.trackingId)?.baseline?.fleetTargets;
        if(Array.isArray(targets)&&targets.length&&targets.every(t=>Number.isSafeInteger(t.designId)&&Number.isSafeInteger(t.count))){a.scope=['reinforcement_template',[...targets].sort((x,y)=>x.designId-y.designId)];a.key=scopedKey(a.order,a.scope);}
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  async prepare(order,state,taskId,scope){
    if(this.paused)throw Error('任务调度已暂停');
    if(this.data.actions.length>=2048)throw Error('动作日志达到上限，请停止后归档核验');
    if(scope?.[0]==='reinforcement_template')await this.upgradeReinforcementScopes();
    else if(scope)await this.upgradeVirtualEventScopes();
    const key=scopedKey(order,scope),legacyKey=scopedKey(order);
    if(this.data.actions.some(a=>(a.key===key||scope&&!a.scope&&a.key===legacyKey)&&['issued','unknown'].includes(a.status)))throw Error('旧动作尚未确认，禁止重放');
    const action={id:randomUUID(),key,order,scope,taskId,snapshotId:state.snapshotId,status:'issued',at:this.now(),generation:this.generation};
    this.data.actions.push(action);await this.save();return action;
  }
  supersedeMoves(current){
    for(const old of this.data.actions)if(old.id!==current.id&&old.at<=current.at&&old.order.command==='move_fleet'&&old.order.arguments.fleet_id===current.order.arguments.fleet_id&&['issued','unknown','submitted'].includes(old.status)){
      old.status='superseded';old.supersededBy=current.id;old.reason='后续非排队移动已由游戏确认，旧移动不重放';
    }
  }
  async receipt(a,status,trackingId,{movementVerified=false}={}){a.status=status;a.trackingId=trackingId;if(movementVerified&&a.order.command==='move_fleet'&&!a.order.arguments.queue)this.supersedeMoves(a);await this.save();}
  async reconcileMoves(rpc){
    // Destination occupancy proves the movement goal, including after a process
    // restart. Never infer a purchase, landing or diplomatic result this way.
    const latest=new Map();for(const a of this.data.actions)if(a.order.command==='move_fleet'&&['issued','unknown','submitted'].includes(a.status)&&!a.order.arguments.queue)latest.set(a.order.arguments.fleet_id,a);
    const rows=[...latest.values()];if(!rows.length)return;
    const start=(this.movementCursor||0)%rows.length;this.movementCursor=start+2;
    for(let n=0;n<Math.min(2,rows.length);n++){
      const a=rows[(start+n)%rows.length],s=await rpc('get_system',{system_id:a.order.arguments.system_id});
      if(s.fleets?.some(f=>f.id===a.order.arguments.fleet_id&&f.own===true)){a.status='confirmed';a.proof={kind:'destination_occupied',systemId:a.order.arguments.system_id,replayed:false};this.supersedeMoves(a);}
    }
  }
  reconcileCampaignOutbox(){
    const c=this.data.campaign;if(!c)return;
    for(const [key,a]of Object.entries(c.actions||{}))if(['unknown','issued','duplicate_skipped','deferred','pending_confirmation','unconfirmed_not_replayed'].includes(a.status)&&!this.data.actions.some(row=>row.snapshotId===a.snapshotId&&canonical(row.order)===canonical(a.order))){
      // Every native write must have a durable outbox row before send. An absent
      // row proves this particular attempt stopped locally, before the RPC.
      delete c.actions[key];c.nextCheck='旧尝试未进入原生发送前日志，已解除本地延迟：'+key;
    }
  }
  async update(state,records=[]){
    for(const a of this.data.actions){const r=records.find(r=>r.id===a.trackingId);if(r?.status==='completed')a.status='confirmed';if(r?.status==='failed')a.status='failed';}
    for(const t of this.data.tasks){
      const actions=this.data.actions.filter(a=>a.taskId===t.id);
      if(actions.some(a=>['failed','superseded'].includes(a.status))){t.status='failed';t.reason='游戏回读确认失败或订单已被后续命令替换';}
      else if(actions.length===t.orders.length&&actions.every(a=>a.status==='confirmed')){t.status='completed';t.evidence=state.snapshotId;}
      else if(actions.length){t.status=actions.some(a=>['unknown','issued'].includes(a.status))?'blocked':'waiting';t.reason=t.status==='blocked'?'在途动作待对账':'等待游戏订单完成';}
      if(t.status==='waiting'&&!actions.length&&((t.wake?.gameDate&&state.date>=t.wake.gameDate)||(t.wake?.taskId&&this.data.tasks.find(d=>d.id===t.wake.taskId)?.status==='completed')))t.status='ready';
    }
    await this.save();
  }
  next(id){if(this.paused)return;if(id!==undefined){const t=this.data.tasks.find(t=>t.id===id);if(!t||t.status!=='ready'||!t.dependencies.every(d=>this.data.tasks.some(x=>x.id===d&&x.status==='completed')))throw Error('指定任务不存在、尚未就绪或依赖未完成；不会改跑其他任务');return t;}return this.data.tasks.filter(t=>t.status==='ready'&&t.dependencies.every(id=>this.data.tasks.find(d=>d.id===id)?.status==='completed')).sort((a,b)=>(b.priority+(this.now()-b.createdAt)/60000)-(a.priority+(this.now()-a.createdAt)/60000))[0];}
  pause(){this.paused=true;this.generation++;}
  view(){return {paused:this.paused,tasks:structuredClone(this.data.tasks),commitments:this.commitments(),unconfirmed:this.data.actions.filter(a=>['unknown','issued'].includes(a.status)).map(a=>({id:a.id,command:a.order.command,status:a.status,snapshotId:a.snapshotId})),campaign:this.data.campaign};}
}
