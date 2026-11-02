import {it,expect} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {createOperatorStandingBridge} from '../apps/desktop/electron/operator-standing'
import {OPERATOR_NOTE_LIMIT} from '../packages/shared/src/ai'
import {readOperatorStanding,OPERATOR_NOTE_LIMIT as CONTROLLER_NOTE_LIMIT} from '../../stellaris-player/src/operator-standing.mjs'
it('原生目标区分设置和实际效果，覆盖参谋虚假完成并隔离旧快照',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'standing-native-intent-'))
 const note='持续优化经营',intent:any={version:1,source:'user-current-chat',objective:note,targetResource:'unity',requestedFocus:'unity',effectiveFocus:'unity',controls:{steeringConfirmed:true,ownerPolicyConfirmed:true},status:'applied',reason:'引导已确认，等待实际增长',baseline:{date:'2200.01.01',net:20},current:{date:'2201.01.01',net:20},progress:{netDelta:0,traditionsGained:0},correctiveAction:'核查实际岗位与维护',unsupported:['持续舰队保护待确认'],extra:'不可发布的快照字段'}
 let stopped=false,nested=false
 const bridge=createOperatorStandingBridge({now:()=>1000000,getProject:async()=>root,state:()=>({running:true,note}),readSnapshot:async()=>({sessionId:'game-1',stopped,state:{date:'2201.01.01',...(nested?{strategy:{nativeIntent:intent}}:{nativeIntent:intent})}})})
 try{
  await bridge.refresh({rearm:true,review:{note,gameSessionId:'game-1',operator:{economyFocus:'research',until:{date:'',condition:''},status:'done',evidence:'方针已应用所以完成'}}})
  expect(bridge.view().status).toBe('blocked');expect(bridge.view().judgment?.status).toBe('blocked');expect(bridge.view().evidence).toContain('等待实际增长')
  expect(bridge.view().nativeIntent?.progress.netDelta).toBe(0);expect(bridge.view().nativeIntent).not.toHaveProperty('extra')
  intent.status='progressing';intent.current.net=35;intent.progress={netDelta:15,traditionsGained:1};intent.reason='同局实际净产提高，持续目标继续'
  await bridge.refresh();expect(bridge.view().status).toBe('on_track');expect(bridge.view().nativeIntent?.progress).toEqual({netDelta:15,traditionsGained:1})
  intent.status='stalled';intent.reason='实际净产回落';intent.current.net=18;intent.progress.netDelta=-2;nested=true
  await bridge.refresh();expect(bridge.view().status).toBe('blocked');expect(bridge.view().evidence).toBe('实际净产回落');expect(bridge.view().nativeIntent?.current.net).toBe(18)
  stopped=true;await bridge.refresh();expect(bridge.view().nativeIntent).toBeUndefined()
 }finally{if(dirname(root)!==parent)throw Error('测试清理目录无效');await rm(root,{recursive:true,force:true})}
})
it('600字要求贯穿中控发布和控制器读取，末尾变更不被当成同一要求',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'standing-note-'))
 let note='前'.repeat(580)+'最后的科研退出条件'
 try{
  expect(OPERATOR_NOTE_LIMIT).toBe(CONTROLLER_NOTE_LIMIT)
  const bridge=createOperatorStandingBridge({now:()=>1000000,getProject:async()=>root,state:()=>({running:true,note}),readSnapshot:async()=>({sessionId:'game-1',state:{date:'2200.01.01'}})})
  await bridge.refresh({rearm:true});const path=join(root,'.local/commentary/operator-standing.json'),first=await readOperatorStanding(path,'game-1',1000000)
  expect(first?.text).toBe(note);expect(bridge.view().text).toBe(note)
  note='前'.repeat(580)+'最后的经济退出条件';await bridge.refresh();const next=await readOperatorStanding(path,'game-1',1000000)
  expect(next?.text).toBe(note);expect(next?.id).not.toBe(first?.id)
 }finally{if(dirname(root)!==parent)throw Error('测试清理目录无效');await rm(root,{recursive:true,force:true})}
})
it('实际凝聚力停滞时不把模型乐观判断显示为按计划推进，真实第三飞升完成允许退出',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'standing-progress-'))
 let note='持续主拉凝聚力',adopted=[{key:'ap_one'},{key:'ap_two'}]
 const unityProgress={known:true,focused:true,stagnating:true,scalingBehind:false,reasons:['四年未推进传统']}
 try{
  const bridge=createOperatorStandingBridge({now:()=>1000000,getProject:async()=>root,state:()=>({running:true,note}),readSnapshot:async()=>({sessionId:'game-1',state:{date:'2240.01.01',ascensionPerks:{adopted},strategy:{version:3,unityProgress}}})})
  const review=(status:string)=>({note,gameSessionId:'game-1',operator:{economyFocus:'unity_traditions',until:{date:'',condition:''},status,evidence:'已切凝聚力方针所以完成'}})
  await bridge.refresh({rearm:true,review:review('on_track')})
  expect(bridge.view().status).toBe('blocked');expect(bridge.view().evidence).toContain('四年未推进传统')
  note='凝聚力优先，第三个飞升后转科研';await bridge.refresh({rearm:true,review:review('done')});expect(bridge.view().status).toBe('blocked')
  adopted=[...adopted,{key:'ap_three'}];await bridge.refresh({review:review('done')});expect(bridge.view().status).toBe('done')
 }finally{if(dirname(root)!==parent)throw Error('测试清理目录无效');await rm(root,{recursive:true,force:true})}
})
it('密集心跳合并为一次读写，保留解释和停止清理，不使常驻要求饥饿',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true})
 const root=await mkdtemp(join(parent,'standing-sync-'));let running=true,reads=0
 try{
  const bridge=createOperatorStandingBridge({now:()=>1000000,getProject:async()=>root,state:()=>({running,note:'前期凝聚力优先'}),readSnapshot:async()=>{reads++;await new Promise(r=>setTimeout(r,20));return{sessionId:'game-1',state:{date:'2200.01.01',resources:{unity:{net:15}}}}}})
  const first=bridge.refresh({rearm:true,review:{note:'前期凝聚力优先',gameSessionId:'game-1',operator:{economyFocus:'unity_traditions',until:{date:'2230.01.01',condition:''},status:'on_track',evidence:'凝聚力增长'}}})
  await Promise.all([first,...Array.from({length:40},()=>bridge.refresh())])
  expect(reads).toBe(1)
  const path=join(root,'.local/commentary/operator-standing.json')
  expect(JSON.parse(await readFile(path,'utf8'))).toMatchObject({text:'前期凝聚力优先',economyFocus:'unity_traditions',refreshedAt:1000000})
  await bridge.refresh({review:{note:'前期凝聚力优先',gameSessionId:'game-1',operator:{economyFocus:'research',until:{date:'2230.01.01',condition:''},status:'done',evidence:'退出条件已满足'}}})
  expect(JSON.parse(await readFile(path,'utf8')).economyFocus).toBe('unity_traditions');expect(bridge.view().status).toBe('blocked')
  // Explicitly preauthorized next stages may switch; an unspecified ending
  // above still requires the operator's confirmation.
  const phaseBridge=createOperatorStandingBridge({now:()=>1000000,getProject:async()=>root,state:()=>({running,note:'前期凝聚力，第三个飞升后再点科研'}),readSnapshot:async()=>({sessionId:'game-1',state:{date:'2240.01.01',ascensionPerks:{adopted:[{key:'ap_one'},{key:'ap_two'},{key:'ap_three'}]}}})})
  await phaseBridge.refresh({rearm:true,review:{note:'前期凝聚力，第三个飞升后再点科研',gameSessionId:'game-1',operator:{economyFocus:'unity_traditions',status:'on_track'}}})
  await phaseBridge.refresh({review:{note:'前期凝聚力，第三个飞升后再点科研',gameSessionId:'game-1',operator:{economyFocus:'research',status:'done'}}})
  expect(phaseBridge.view().economyFocus).toBe('research')
  running=false;await bridge.refresh();await expect(readFile(path,'utf8')).rejects.toMatchObject({code:'ENOENT'})
 }finally{if(dirname(root)!==parent)throw Error('测试清理目录无效');await rm(root,{recursive:true,force:true})}
})
it('回执仅认当前要求及新鲜合法档位，清空要求不被暂缺快照阻挡',async()=>{
 const parent=resolve('.local/test-data');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'standing-receipt-'))
 let now=1000000,note='前期主拉凝聚力',missing=false
 const bridge=createOperatorStandingBridge({now:()=>now,getProject:async()=>root,state:()=>({running:true,note}),readSnapshot:async()=>missing?undefined:{sessionId:'game-1',state:{date:'2200.01.01'}}})
 try{
  await bridge.refresh({rearm:true});const standingPath=join(root,'.local/commentary/operator-standing.json'),receiptPath=join(root,'.local/commentary/controller-receipt.json')
  const standing=JSON.parse(await readFile(standingPath,'utf8'))
  const receipt={operatorStandingId:standing.id,readAt:now,appliedFocus:'unity_traditions',steeringApplied:true,reason:'常驻要求有效'}
  for(const patch of [{operatorStandingId:'old'},{readAt:now+5001},{appliedFocus:'unknown'},{steeringApplied:'true'}]){
   await writeFile(receiptPath,JSON.stringify({...receipt,...patch}));await bridge.refresh();expect(bridge.view().receipt).toBeUndefined()
  }
  await writeFile(receiptPath,JSON.stringify({...receipt,secret:'not exposed'}));await bridge.refresh()
  expect(bridge.view().receipt).toEqual(receipt)
  await writeFile(receiptPath,JSON.stringify({...receipt,steeringApplied:false,reason:'方针尚未确认'}));await bridge.refresh();expect(bridge.view().receipt?.steeringApplied).toBe(false)
  now+=120001;expect(bridge.view().receipt).toBeUndefined();await bridge.refresh();expect(bridge.view().receipt).toBeUndefined()
  missing=true;note='';await bridge.refresh();await expect(readFile(standingPath,'utf8')).rejects.toMatchObject({code:'ENOENT'})
 }finally{if(dirname(root)!==parent)throw Error('测试清理目录无效');await rm(root,{recursive:true,force:true})}
})
