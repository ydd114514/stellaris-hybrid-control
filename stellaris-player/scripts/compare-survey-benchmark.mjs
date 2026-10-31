import {readFile,writeFile} from 'node:fs/promises';import {compareSurveyBranches} from '../src/survey-benchmark.mjs';
import {compareNormalHybridBranches} from '../src/normal-hybrid-benchmark.mjs';
const args=process.argv.slice(2);if(args.length<2)throw Error('需要两组evidence.json路径，可选第三个输出报告路径');
const branches=await Promise.all(args.slice(0,2).map(async p=>JSON.parse(await readFile(p,'utf8'))));
const normal=branches.some(x=>x.spec?.comparisonProtocol==='normal_production_v3');
const report=(normal?compareNormalHybridBranches:compareSurveyBranches)(...branches);
if(args[2])await writeFile(args[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.matchedObservedStart)process.exitCode=1;
