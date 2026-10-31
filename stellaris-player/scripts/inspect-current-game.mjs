import {NativePipe} from '../src/native-pipe.mjs';
const pipe=new NativePipe();
try {
  const status=await pipe.request('get_status');
  console.log(JSON.stringify({date:status.date,paused:status.is_paused}));
  console.log(JSON.stringify({panel:await pipe.request('show_panel',{panel:'game'})}));
  console.log(JSON.stringify({events:await pipe.request('get_active_events')}));
  console.log(JSON.stringify({frame:await pipe.request('capture_game_frame')}));
}finally{pipe.close();}
