// Offline only. Does not drive the game, load a save or invoke any model.
import {readFile,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {assessConquestEvidence} from '../src/hybrid-work-evidence.mjs';import {analyzeControlEvidence} from '../src/control-evidence.mjs';import {decodeDshToolResult} from '../src/dsh-tool-evidence.mjs';
if(!process.argv[2])throw Error('需要实际DSH运行目录');const d=resolve(process.argv[2]);
const json=async p=>JSON.parse(await readFile(join(d,p),'utf8')),lines=async p=>(await readFile(p,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const cp=await json('native/latest-session.json'),run=await json('report.json'),source=await json('source-verification.json');
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(cp.sessionId))throw Error('会话ID不合法');
const native=await lines(join(d,'native',`session-${cp.sessionId}.jsonl`)),current=await json('native/dsh/current.json'),tools=await lines(current.events),calls=new Map(),modelActions=[],omitted={};
for(const e of tools){if(e.type==='tool_call')calls.set(e.callId,e);if(e.type!=='tool_result')continue;const call=calls.get(e.callId),decoded=decodeDshToolResult(e);if(e.status!=='completed'||call?.truncated===true||decoded.kind!=='json'){omitted[decoded.kind]=(omitted[decoded.kind]??0)+1;continue;}
 const value=decoded.value;if(call?.tool?.endsWith('__campaign')&&value.campaign?.id)modelActions.push({kind:'campaign',operation:call.input?.operation,campaignId:value.campaign.id,target:value.campaign.target});
 if(call?.tool?.endsWith('__inspect')&&call.input?.topic==='targets'&&value.source==='current_known_contacts_and_map')modelActions.push({kind:'targets'});
}
const gameplay=assessConquestEvidence({events:native,modelActions,realModelRequests:run.model?.forwardedRequests,sourceUnchanged:source.unchanged===true}),control=analyzeControlEvidence(native),cleanup=cp.cleanup;
const cleanupConfirmed=cp.stopped===true&&cleanup?.bindingConfirmed===true&&cleanup.paused===true&&cleanup.monthlyTrade?.confirmed===true&&cleanup.monthlyTrade?.recovered?.confirmed===true&&cleanup.surveyStatus==='confirmed';
const passed=run.exitCode===0&&gameplay.conquestEvidencePassed&&control.writeBoundaryComplete===true&&control.forbiddenWritesAfterStop===0&&cleanupConfirmed;
const result={scope:'latest proactive conquest gameplay and stop acceptance; independent of runtime length',passed,gameplay,control,cleanupConfirmed,exitCode:run.exitCode,omittedLogProjections:omitted,limitations:['无实际战斗/占领/领土收益/恢复/后续目标评估时不通过；不能由时长或posted抵扣。','报告仅覆盖这一次真实会话；不回写或重新解释旧长测结论。','不声称已验证所有帝国、所有战争目标或完整项目效率指标。']};
await writeFile(join(d,'conquest-acceptance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!passed)process.exitCode=1;
