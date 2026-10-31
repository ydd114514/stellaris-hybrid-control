import {NativePipe} from '../src/native-pipe.mjs';import {writeFile} from 'node:fs/promises';
const p=new NativePipe(),rows=[];try{
 const status=await p.request('get_status');if(status.is_paused!==true)throw Error('只在暂停局执行诊断');
 for(const paused of [true,false,true]){
  await p.request('set_paused',{paused});
  rows.push({paused,status:await p.request('get_status'),route:await p.request('find_path',{fleet_id:142,to_system_id:0})});
 }
}finally{await p.request('set_paused',{paused:true}).catch(()=>{});p.close();await writeFile('.local/gestalt-live/current/route-consistency.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(r=>({paused:r.paused,date:r.status.date.formatted,route:r.route}))));}
