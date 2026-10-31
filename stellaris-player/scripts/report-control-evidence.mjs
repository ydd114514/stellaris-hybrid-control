import {readFile,writeFile} from 'node:fs/promises';
import {analyzeControlEvidence} from '../src/control-evidence.mjs';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
if(!value('--journal'))throw Error('用法：node scripts/report-control-evidence.mjs --journal 日志.jsonl [--output 报告.json]');
const text=await readFile(value('--journal'),'utf8'),events=[];let malformedLines=0;
for(const line of text.split('\n'))if(line.trim()){try{events.push(JSON.parse(line));}catch{malformedLines++;}}
const report=analyzeControlEvidence(events);
report.malformedLines=malformedLines;
if(malformedLines){report.writeBoundaryComplete=false;report.forbiddenWritesAfterStop=null;}
if(value('--output'))await writeFile(value('--output'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
