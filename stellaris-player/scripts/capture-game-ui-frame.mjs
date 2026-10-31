import {NativePipe} from '../src/native-pipe.mjs';import {copyFile,mkdir} from 'node:fs/promises';
const output='.local/hybrid-control/ui-reload/game-frame.bmp',pipe=new NativePipe();
try{const status=await pipe.request('get_status');const frame=await pipe.request('capture_game_frame');if(!frame.success)throw Error(frame.error);await mkdir('.local/hybrid-control/ui-reload',{recursive:true});await copyFile(frame.path,output);console.log(JSON.stringify({date:status.date?.formatted,paused:status.is_paused,picture:frame.picture,output}));}finally{pipe.close();}
