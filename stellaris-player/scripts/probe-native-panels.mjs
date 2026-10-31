import {NativePipe} from '../src/native-pipe.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
const pipe=new NativePipe();const report={at:new Date().toISOString(),panels:[]};
try {
  for(const panel of ['research','fleets','market','traditions','contacts','government','leaders','game']) {
    const result=await pipe.request('show_panel',{panel});await delay(300);
    const frame=await pipe.request('capture_game_frame');report.panels.push({panel,result,frame});
    console.log(JSON.stringify({panel,result,frame}));
  }
  report.planet=await pipe.request('focus_planet',{planet_id:3});await delay(300);
  report.planetFrame=await pipe.request('capture_game_frame');
  report.traditions=await pipe.request('get_tradition_candidates');
  report.ascension=await pipe.request('get_ascension_candidates');
  report.council=await pipe.request('get_council_candidates');
  report.fleets=await pipe.request('get_fleets');
  console.log(JSON.stringify({planet:report.planet,planetFrame:report.planetFrame,traditions:report.traditions,ascension:report.ascension,council:report.council,fleets:report.fleets}));
  await writeFile('.local/native-bridge/panel-probe.json',JSON.stringify(report,null,2));
} finally {pipe.close();}
