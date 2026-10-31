import {win32} from 'node:path';
export const colonyReadCandidate={version:'cyberfish-0.6.8-colony-read-r2',sha256:'bbeb50b3ec826fded88e7054c9691ff13cdc5b71e95fa8ed0c59cb9c6d459a6b'};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&win32.normalize(a).toLowerCase()===win32.normalize(b).toLowerCase();
export function admitColonyCandidate({candidate,digest,identity,expectedIdentity}={}){
 if(candidate?.version!==colonyReadCandidate.version||candidate?.sha256!==colonyReadCandidate.sha256||digest!==colonyReadCandidate.sha256)throw Error('候选版本或文件哈希不符');
 if(identity?.ok!==true||!Number.isSafeInteger(identity.pid)||identity.pid<=0||typeof identity.creationTime!=='string'||!identity.creationTime)throw Error('游戏进程身份未知');
 if(expectedIdentity&&(identity.pid!==expectedIdentity.pid||identity.creationTime!==expectedIdentity.creationTime))throw Error('游戏进程已变化');
 const module=identity.bridgeModule;
 if(module?.known!==true||typeof module.loaded!=='boolean')throw Error('已加载模块状态未知，不能当作冷启动');
 if(module.loaded&&!same(module.path,candidate.path))throw Error('已加载其他原生桥，需要手动重启后再验证，禁止热换');
 if(!module.loaded&&module.path!==null)throw Error('模块查询结果不一致');
 return {loadRequired:!module.loaded,hotSwap:false};
}
export function assertColonyCandidateRead(method){if(!['ping','get_status','get_galaxy_overview','get_planet_details','get_colony_automation'].includes(method))throw Error('候选验证只允许指定只读查询');}

export function assertColonyPipeOwner(owner,identity){
 if(owner?.ok!==true||owner.pid!==identity?.pid||owner.creationTime!==identity?.creationTime)throw Error('原生管道不属于所选游戏进程');
}
