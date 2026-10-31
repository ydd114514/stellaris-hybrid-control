// --json is a bounded log projection, not the full model-facing tool result.
// Never repair a cut JSON prefix or interpret it as a complete game snapshot.
export function decodeDshToolResult(event){
 if(event?.type!=='tool_result')return {kind:'not_tool_result'};
 if(event.truncated===true)return {kind:'log_preview_truncated',status:event.status??null};
 if(event.status==='error')return {kind:'tool_error',text:typeof event.result==='string'?event.result:null};
 if(event.result&&typeof event.result==='object')return {kind:'json',value:event.result};
 if(typeof event.result!=='string')return {kind:'missing_result'};
 try{return {kind:'json',value:JSON.parse(event.result)};}
 catch{return {kind:/^\s*[\[{]/.test(event.result)?'invalid_json':'text'};}
}
