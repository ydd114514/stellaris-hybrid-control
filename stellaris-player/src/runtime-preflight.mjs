import {setTimeout as delay} from 'node:timers/promises';

// Called before DSH is spawned: a hidden/minimized game must cost zero tokens.
// No UI automation, no game simulation resume, and no model in this loop.
export async function waitForGamePicture({probe,isStopped=async()=>false,onWaiting=async()=>{},sleep=delay}={}) {
  while(!await isStopped()) {
    let picture,error;
    try{picture=await probe();}catch(e){error=e.message;}
    if(picture?.rendering===true&&picture.visible===true)return picture;
    await onWaiting({stage:'waiting_for_picture',picture,error});
    await sleep(2000);
  }
  return null;
}
