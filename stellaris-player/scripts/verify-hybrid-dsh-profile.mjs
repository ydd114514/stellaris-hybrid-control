import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
const directory=resolve('.local/hybrid-control',`profile-check-${Date.now()}`);await mkdir(directory,{recursive:true});
const patch=join(directory,'environment.json');
await writeFile(patch,JSON.stringify(nativeMcpEnvironmentPatch({directory:join(directory,'native'),runId:'offline-profile-check',minutes:10,hybridSurvey:true,presentOrders:false,startPaused:true,surveyPilot:true})));
const basePatch=process.argv[2]||'plugins/stellaris-dsh/cordis.patch.yml';
const result=spawnSync(process.execPath,['C:/Users/YDD/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js','--profile','headless','--patch',resolve(basePatch),'--patch',patch,'--dump-config'],{encoding:'utf8',windowsHide:true,env:{...process.env,DSH_HOME:join(directory,'dsh-home'),DEEPSEEK_API_KEY:'offline-placeholder-not-a-key'}});
// Dump only an isolated profile with a dummy key. Never inspect the user's profile.
await writeFile(join(directory,'composed.yml'),result.stdout||'');await writeFile(join(directory,'stderr.log'),result.stderr||'');
const text=result.stdout||'';
const checks={exit:result.status===0,nonce:text.includes('offline-profile-check'),hybrid:text.includes('CYBERFISH_HYBRID_SURVEY'),scope:text.includes('CYBERFISH_SURVEY_PILOT'),transport:text.includes('toolCallTimeoutMs: 120000'),directory:text.includes('profile-check-'),presentation:text.includes('CYBERFISH_NATIVE_PRESENTATION'),memory:text.includes('game-compaction.mjs')};
await writeFile(join(directory,'result.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify({directory,checks}));
if(Object.values(checks).some(x=>!x))process.exitCode=1;
