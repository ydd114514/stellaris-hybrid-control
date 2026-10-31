import {NativePipe} from '../src/native-pipe.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const pipe=new NativePipe();
try {
  console.log(JSON.stringify({picture:await pipe.request('get_picture_state'),pendingDiplomacy:await pipe.request('get_pending_diplomacy')}));
  console.log(JSON.stringify({before:await pipe.request('capture_game_frame')}));
  console.log(JSON.stringify({focus:await pipe.request('focus_fleet',{fleet_id:3})}));
  await delay(600);
  console.log(JSON.stringify({after:await pipe.request('capture_game_frame')}));
} finally {pipe.close();}
