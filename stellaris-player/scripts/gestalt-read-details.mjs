import {NativePipe} from '../src/native-pipe.mjs';
import {writeFile} from 'node:fs/promises';
const p=new NativePipe({timeoutMs:12000});try{
 const data={at:Date.now(),system:await p.request('get_system',{system_id:Number(process.argv[2]||144)}),armies:await p.request('get_armies'),forces:await p.request('get_war_fleets'),tactics:await p.request('get_fleet_tactics',{details:true})};
 await writeFile('.local/gestalt-live/current/details.json',JSON.stringify(data,null,2));
 console.log(JSON.stringify(data,null,2));
}finally{p.close();}
