import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';
const file=process.argv[2];if(!file)throw Error('需要明确的测试条件 JSON 文件；不会接受模型或弹幕命令');
const setup=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(setup.commands)||!setup.commands.length||setup.commands.length>12||setup.commands.some(c=>typeof c!=='string'||c.includes('\n')||c.length>3500))throw Error('测试指令清单无效');
const pipe=new NativePipe({timeoutMs:20000}),report={at:Date.now(),explicitUserAuthorization:'2026-10-29 用户允许控制台修改当前独立新局以测试功能',reason:setup.reason,commands:[],observations:{}};
const directory=resolve('.local/gestalt-live/current');await mkdir(directory,{recursive:true});
try{
 assertBridgeCapabilities(await pipe.request('ping'));
 report.before=await pipe.request('get_status');if(!report.before.in_game||report.before.is_paused!==true)throw Error('只在已载入且暂停的独立测试局准备条件');
 for(const command of setup.commands){const result=await pipe.request('run_console',{command});report.commands.push({command,result});if(result.ok!==true)throw Error(result.error||'控制台接口拒绝');}
 report.after=await pipe.request('get_status');
}catch(e){report.error=e.message;process.exitCode=1;}
finally{pipe.close();await writeFile(join(directory,`console-${report.at}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({commands:report.commands,error:report.error,date:report.after?.date,resources:report.after?.resources},null,2));}
