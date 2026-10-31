import test from 'node:test';import assert from 'node:assert/strict';import {decodeDshToolResult} from '../src/dsh-tool-evidence.mjs';
test('bounded log previews and explicit errors never masquerade as complete tool state',()=>{
 for(const result of ['{"orders":[','{}'])assert.equal(decodeDshToolResult({type:'tool_result',truncated:true,status:'completed',result}).kind,'log_preview_truncated');
 assert.equal(decodeDshToolResult({type:'tool_result',status:'error',result:'Error: 已收到停止指令'}).kind,'tool_error');
 assert.equal(decodeDshToolResult({type:'tool_result',status:'completed',result:'{"state":'}).kind,'invalid_json');
});
test('complete JSON tool output remains usable without guessing missing values',()=>{
 assert.deepEqual(decodeDshToolResult({type:'tool_result',status:'completed',result:'{"orders":[],"paused":false}'}),{kind:'json',value:{orders:[],paused:false}});
 assert.equal(decodeDshToolResult({type:'tool_result',result:undefined}).kind,'missing_result');assert.equal(decodeDshToolResult({type:'tool_call'}).kind,'not_tool_result');
});
