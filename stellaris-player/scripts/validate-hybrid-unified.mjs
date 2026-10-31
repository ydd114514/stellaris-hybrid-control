// Preparation only: without --run this prints the offline validation plan.
// Run only after the user resumes validation. No game, API, desktop or E2E steps.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const desktop=resolve(root,'../赛博肥鱼-全套-v0.3.7-95dfaa6');
const bash='C:\\Program Files\\Git\\bin\\bash.exe';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const tests=[
 'monthly-trade-accounting','monthly-trade-changes','monthly-trade-execution','monthly-trade-lifecycle','monthly-trade-recovery',
 'shared-spending-guard','delegation-budget','trade-spending-policy','market-inspection','construction-inspection','market-maintenance','military-budget','first-war','building-upgrades','order-tracker','local-work-wait','colony-routine','colony-upgrade-routine','colony-candidate-policy',
 'native-game','native-pipe','native-mcp-schema','native-mcp-tools','native-bootstrap','gestalt-tasks','gestalt-campaign',
 'supervisor-cleanup','stop-boundary','cooperative-stop','dsh-host-stop','dsh-mcp-environment','dsh-tool-evidence','hybrid-work-summary','hybrid-settings',
 'hybrid-watch-policy','decision-review','game-checkpoint','runtime-continuation','model-view','survey-delegation','survey-routing-policy','survey-candidates','control-evidence','hybrid-work-evidence','conquest-evidence','gestalt-campaign','strategic-review','strategy-planner','long-run-evidence','survey-idle-policy','survey-alert-handoff','survey-pilot-scope','survey-benchmark','survey-benchmark-cohort','normal-hybrid-benchmark'
].map(name=>'test/'+name+'.test.mjs');
const syntaxFiles=['scripts/play-native-dsh.mjs','src/native-mcp.mjs','scripts/accept-colony-upgrades.mjs','scripts/accept-colony-routine.mjs','scripts/accept-monthly-lifecycle.mjs','scripts/validate-hybrid-unified.mjs','scripts/run-hybrid-live.mjs','scripts/report-hybrid-work.mjs','scripts/run-survey-benchmark.mjs','scripts/compare-survey-benchmark.mjs','scripts/verify-survey-routing-run.mjs','scripts/assess-conquest-run.mjs'];
const plan=[
 {id:'source-syntax',cwd:root,command:'for hybrid_check_file in '+syntaxFiles.map(quote).join(' ')+'; do node --check "$hybrid_check_file" || exit $?; done'},
 {id:'controller-offline',cwd:root,command:'node --test --test-concurrency=1 '+tests.map(quote).join(' ')},
 {id:'desktop-targeted',cwd:desktop,command:'pnpm exec vitest run tests/stellaris-controller.test.ts tests/stellaris-profile.test.ts tests/stellaris-basic.test.ts'},
 {id:'desktop-types',cwd:desktop,command:'pnpm typecheck'},
 {id:'desktop-local-build',cwd:desktop,command:'pnpm build:dsh'}
];
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
if(only&&(!only.length||only.some(id=>!plan.some(step=>step.id===id))))throw Error('--only仅接受本脚本列出的步骤ID，以逗号分隔');
const selected=only?plan.filter(step=>only.includes(step.id)):plan;
if(!process.argv.includes('--run')){
 console.log(JSON.stringify({mode:'plan_only',executed:false,gameSteps:0,manualLoads:0,steps:selected,notes:['用户休息期间不执行；恢复验证后显式使用--run。','首个失败即停止后续步骤，修复后使用--only重跑受影响项。','不启动DSH、游戏、E2E、模型或打包安装程序。']},null,2));
}else{
 const directory=resolve(root,'.local/hybrid-unified-offline-'+Date.now());await mkdir(directory,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(root,'.local/hybrid-control/pending-validation.json'),'utf8'));
 const sourceFiles=[...Object.keys(manifest.sourceHashes), 'scripts/validate-hybrid-unified.mjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all([...new Set(sourceFiles)].map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,f))).digest('hex')])));
 const report={startedAt:new Date().toISOString(),scope:'selected_offline_source_and_local_build_steps',entireDefaultBatch:!only,requestedSteps:selected.map(step=>step.id),plannedGameSteps:0,manualLoads:0,plannedRealModelCalls:0,steps:[],sourceHashes:await hashes(),passed:false};
 const env={...process.env,DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',CYBERFISH_HYBRID_SURVEY:'0',CYBERFISH_COLONY_UPGRADE_PILOT:'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:'0',CYBERFISH_LOCAL_WAIT_PILOT:'0',CYBERFISH_SURVEY_PILOT:'0'};
 delete env.ELECTRON_RUN_AS_NODE;
 try{
  for(const step of selected){
   console.log(JSON.stringify({event:'step_started',id:step.id}));
   const start=Date.now(),output=[];
   const result=await new Promise(done=>{
    const child=spawn(bash,['-lc',step.command],{cwd:step.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let spawnError;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output.push(chunk));
    child.on('error',error=>{spawnError=error.message;});
    child.on('close',(code,signal)=>done({code,signal,spawnError}));
   });
   const log=step.id+'.log';await writeFile(resolve(directory,log),Buffer.concat(output));
   const row={id:step.id,...result,elapsedMs:Date.now()-start,log,passed:result.code===0&&!result.spawnError};report.steps.push(row);
   await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({event:'step_finished',...row}));
   if(!row.passed)throw Error('定向验收未通过：'+step.id+'；停止后续步骤，查看本批日志修复');
  }
  report.finalSourceHashes=await hashes();
  report.sourcesChangedDuringRun=Object.keys(report.sourceHashes).filter(f=>report.finalSourceHashes[f]!==report.sourceHashes[f]);
  if(report.sourcesChangedDuringRun.length)throw Error('验收期间源码发生变化，不能把本轮结果归给最后源码');
  report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed,error:report.error}));}
}
