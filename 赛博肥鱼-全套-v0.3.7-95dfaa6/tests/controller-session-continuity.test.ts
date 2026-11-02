import {it,expect} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {basename,dirname,join,resolve} from 'node:path'
import {createStellarisAi} from '../apps/desktop/electron/stellaris-ai'
import {controllerWorld,sameControllerWorld} from '../packages/core/src/controller-world'

it('同世界控制器续接保留场控意图并重绑新任务，真实换局/身份未知封口且手动停止不自启',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true})
 const root=await mkdtemp(join(parent,'controller-continuity-')),project=join(root,'player'),data=join(root,'data')
 await mkdir(join(project,'.local/native-bridge'),{recursive:true})
 const checkpoint=join(project,'.local/native-bridge/latest-session.json')
 const base:any={sessionId:'session-1',binding:{pid:37524,creationTime:'134300000000000000'},stopped:false,
  state:{date:'2200.05.01',nativeWorldGeneration:7,player:{country_id:0,capital_system_id:1},wars:[],resources:{unity:{net:20}}}}
 const anchor=controllerWorld(base)
 expect(sameControllerWorld(anchor,controllerWorld({...base,sessionId:'session-2',state:{...base.state,date:'2200.06.01'}}))).toBe(true)
 for(const patch of [
  {binding:{...base.binding,pid:37525}}, {binding:{...base.binding,creationTime:'134300000000000001'}},
  {binding:{pid:37524}}, {state:{...base.state,nativeWorldGeneration:8}},
  {state:{...base.state,nativeWorldGeneration:undefined}}, {state:{...base.state,player:{country_id:1,capital_system_id:1}}},
  {state:{...base.state,player:{country_id:0,capital_system_id:2}}}, {state:{...base.state,date:'2200.04.30'}},
 ])expect(sameControllerWorld(anchor,controllerWorld({...base,...patch}))).toBe(false)
 expect(sameControllerWorld(controllerWorld({...base,runtimeStatus:{sessionId:'session-1',date:'2200.06.01'}}),anchor)).toBe(false)
 await writeFile(checkpoint,JSON.stringify(base))
 let requests=0
 const service=createStellarisAi({dataDirectory:data,getProject:async()=>project,overlayPort:0,tickMs:10,
  secrets:{available:()=>true,encrypt:value=>value,decrypt:value=>value},
  fetch:async()=>{requests++;return{ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({focus:'继续发展凝聚力',
   nextSteps:['核对当前凝聚力维护与岗位'],directive:{text:'持续提高凝聚力净产',targetResource:'unity'},
   operator:{economyFocus:'unity_traditions',status:'on_track',until:{date:'',condition:''},evidence:'净产20'}})}}]})}}})
 const read=async(name:string)=>{try{return JSON.parse(await readFile(join(project,'.local/commentary',name),'utf8'))}catch{return null}}
 try{
  await service.action({type:'save-key',id:'deepseek',key:'offline-test-placeholder'})
  await service.action({type:'save-agents',agents:service.view().agents.map(a=>({...a,enabled:a.role==='strategist'}))})
  await service.action({type:'save-director',director:{...service.view().director,strategyNote:'持续提高凝聚力净产',idleCommentSeconds:0}})
  await service.action({type:'start'})
  await expect.poll(()=>service.view().blackboard.executionTasks?.gameSessionId).toBe('session-1')
  await expect.poll(async()=>(await read('strategy-directive.json'))?.gameSessionId).toBe('session-1')
  const oldIds=service.view().blackboard.executionTasks!.tasks.map(t=>t.id)
  await writeFile(checkpoint,JSON.stringify({...base,stopped:true,state:{...base.state,date:'2200.06.01'}}))
  await expect.poll(()=>service.view().status.message).toContain('等待同一世界')
  expect(service.view().status.running).toBe(true)
  await expect.poll(()=>read('operator-standing.json')).toBeNull()
  await expect.poll(()=>read('strategy-directive.json')).toBeNull()
  expect(service.view().blackboard.executionTasks).toBeUndefined()
  const waitingRequests=requests;await new Promise(done=>setTimeout(done,40));expect(requests).toBe(waitingRequests)
  const next={...base,sessionId:'session-2',state:{...base.state,date:'2200.06.02'}}
  await writeFile(checkpoint,JSON.stringify(next))
  await expect.poll(()=>service.view().blackboard.executionTasks?.gameSessionId).toBe('session-2')
  await expect.poll(async()=>(await read('operator-standing.json'))?.gameSessionId).toBe('session-2')
  await expect.poll(async()=>(await read('strategy-directive.json'))?.gameSessionId).toBe('session-2')
  expect(service.view().status.running).toBe(true)
  expect(service.view().blackboard.executionTasks!.tasks.every(t=>!oldIds.includes(t.id))).toBe(true)
  expect(requests).toBe(waitingRequests+1)
  await service.action({type:'stop'})
  const stoppedRequests=requests
  await writeFile(checkpoint,JSON.stringify({...next,sessionId:'session-3'}))
  // Saving a note may refresh identity, but never changes an explicit stop.
  await service.action({type:'save-director',director:service.view().director})
  await new Promise(done=>setTimeout(done,40))
  expect(service.view().status.running).toBe(false);expect(requests).toBe(stoppedRequests)
  expect(await read('operator-standing.json')).toBeNull()
  await service.action({type:'start'})
  await expect.poll(async()=>(await read('operator-standing.json'))?.gameSessionId).toBe('session-3')
  await writeFile(checkpoint,JSON.stringify({...next,sessionId:'session-4',state:{...next.state,nativeWorldGeneration:8}}))
  await expect.poll(()=>service.view().status.running).toBe(false)
  await expect.poll(()=>read('operator-standing.json')).toBeNull()
  await expect.poll(()=>read('strategy-directive.json')).toBeNull()
 }finally{
  await service.dispose()
  if(dirname(root)!==parent||!basename(root).startsWith('controller-continuity-'))throw Error('测试目录范围未知')
  await rm(root,{recursive:true,force:true})
 }
})
