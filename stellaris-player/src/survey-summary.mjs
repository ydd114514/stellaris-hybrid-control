import {executionStatus} from './execution-status.mjs';
// Public counts only. A stale assignment must not look like live work.
export function surveySummary(checkpoint,now=Date.now()) {
 const raw=checkpoint?.state?.surveyControl?.records;
 const records=raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.values(raw):[];
 let assigned=0,working=0,uncertain=0;const execution=executionStatus(checkpoint,now);
 for(const r of records){
  if(!r||typeof r!=='object'||!['manual','native','unknown'].includes(r.owner)){uncertain++;continue;}
  if(r.sessionId!==checkpoint.sessionId||r.owner==='unknown'||r.pending){uncertain++;continue;}
  if(r.owner!=='native')continue;
  const age=typeof r.observedAt==='number'?now-r.observedAt:NaN;
  if(checkpoint.stopped||!Number.isFinite(age)||age<0||age>15000){uncertain++;continue;}
  assigned++;
  if(execution.known&&execution.paused===false&&Array.isArray(r.observation?.orders)&&r.observation.orders.some(o=>o?.automation===false))working++;
 }
 return {assigned,working,uncertain};
}
