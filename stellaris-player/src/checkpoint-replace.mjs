import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// Windows readers/scanners may briefly prevent replacement. Keep the previous
// complete checkpoint visible; never delete it or retry any gameplay operation.
export async function replaceCheckpoint(temporary,destination,{renameFile=rename,wait=delay}={}){
 const backoff=[25,50,100,200,400];
 for(let attempt=0;;attempt++){
  try{return await renameFile(temporary,destination);}
  catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=backoff.length)throw error;
   await wait(backoff[attempt]);
  }
 }
}
