import {randomUUID} from 'node:crypto';
import {open,readFile,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {replaceCheckpoint} from './checkpoint-replace.mjs';
import {strategyDecisionReminder} from './runtime-continuation.mjs';

const token=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const requestFile=directory=>join(directory,'dsh/model-requests.jsonl');
const deferralFile=directory=>join(directory,'strategy-review-deferral.json');

export async function latestStrategyModelRequest(directory){
 let file;
 try{
  file=await open(requestFile(directory),'r');
  const {size}=await file.stat(),start=Math.max(0,size-4096),buffer=Buffer.alloc(size-start);
  const {bytesRead}=await file.read(buffer,0,buffer.length,start);
  const end=buffer.lastIndexOf(10,bytesRead-1);
  if(end<1)return null;
  const beginning=buffer.lastIndexOf(10,end-1)+1;
  if(beginning===0&&start>0)return null;
  const row=JSON.parse(buffer.toString('utf8',beginning,end));
  return row&&typeof row==='object'?{row,cursor:start+end+1}:null;
 }catch{return null;}
 finally{await file?.close();}
}

// Only the paired local DSH host and its exact live MCP review may use this
// mailbox. It carries no model output and has no dispatch or acknowledgement.
function identity(value){
 const {runId,sessionId,reviewId}=value??{};
 return [runId,sessionId,reviewId].every(token)?{runId,sessionId,reviewId}:null;
}
export async function requestStrategyReviewDeferral(directory,value){
 const request=identity(value);
 if(!request)throw Error('战略复查延后缺少本轮身份');
 const file=deferralFile(directory),tmp=file+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(tmp,JSON.stringify(request),{flag:'wx',mode:0o600});
  await replaceCheckpoint(tmp,file);
 }finally{await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function readStrategyReviewDeferral(directory){
 try{return identity(JSON.parse(await readFile(deferralFile(directory),'utf8')));}
 catch{return null;}
}

// Create one handler per DSH process. The cursor ensures that the same HTTP
// response cannot be counted as both the original attempt and its retry.
export function createStrategyTurnRecovery({readRequest,defer,waitForNextReview,now=Date.now}){
 let reviewId, retried=false, cursor=0;
 return async ({checkpoint,review,inject,signal})=>{
  if(!review?.id||!review.brief||review.id!==checkpoint.strategyReview?.id||signal?.aborted)return false;
  if(review.id!==reviewId){reviewId=review.id;retried=false;}
  const record=await readRequest();
  const row=record?.row;
  if(!row||record.cursor<=cursor||!Number.isFinite(row.at)||row.at<(review.startedAt??checkpoint.started)||row.at>now()+1000)return false;
  cursor=record.cursor;
  if(row.status!==200||row.toolUse!==false||!(row.stopReason==='max_tokens'||row.textChars===0))return false;
  if(signal?.aborted)return true;
  if(!retried){
   retried=true;
   inject((row.stopReason==='max_tokens'?'上一次思考达到输出上限，没有产生工具调用。':'上一次回复没有产生决定。')+strategyDecisionReminder(review));
   return true;
  }
  await defer({runId:checkpoint.controllerRunId,sessionId:checkpoint.sessionId,reviewId});
  // A normal headless exit closes the MCP pipe and revokes the AI lease. Keep
  // this awaited hook alive without a prompt until the next review or stop.
  await waitForNextReview(reviewId,{inject,signal});
  return true;
 };
}

export async function waitForDifferentStrategyReview(reviewId,{readRun,inject,signal,wait=delay}){
 while(!signal?.aborted){
  await wait(1000,undefined,{signal});
  const run=await readRun();
  const control=run?.checkpoint.countryAIControl??run?.checkpoint.state?.countryAIControl;
  if(!run||control?.owner!=='native')return;
  const next=run.continuation.review;
  if(next?.id&&next.id!==reviewId){
   inject(next.brief?run.continuation.text:'原生 AI 仍在运营。新的战略复查已经到期，调用 watch 读取本次简报并作出决定。');
   return;
  }
 }
}
