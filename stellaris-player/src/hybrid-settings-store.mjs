import {replaceCheckpoint} from './checkpoint-replace.mjs';
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
/** @param {boolean} survey @param {{path?:string}} [options] */
export async function saveHybridSettings(survey,{path}={}){
 if(typeof path!=='string'||!path)throw Error('配置路径不能为空');
 if(typeof survey!=='boolean')throw Error('survey必须为布尔值');
 await mkdir(dirname(path),{recursive:true});
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,JSON.stringify({version:1,survey},null,2)+'\n',{flag:'wx'});await replaceCheckpoint(temporary,path);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {survey,source:'local_configuration'};
}
export async function saveNativeCountryAISettings(nativeCountryAI,{path}={}){
 if(typeof nativeCountryAI!=='boolean')throw Error('国家 AI 模式必须为布尔值');
 if(typeof path!=='string'||!path)throw Error('配置路径不能为空');
 const previous=await loadHybridSettings({path,environment:{}});
 await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,JSON.stringify({version:1,survey:previous.survey,nativeCountryAI},null,2)+'\n',{flag:'wx'});await replaceCheckpoint(temporary,path);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {survey:previous.survey,nativeCountryAI,source:'local_configuration'};
}
/** @param {{path?:string,environment?:Record<string,string|undefined>}} [options] */
export async function loadHybridSettings({path,environment=process.env}={}){
 const native=environment.CYBERFISH_NATIVE_COUNTRY_AI;
 if(native!==undefined&&!['0','1'].includes(native))throw Error('国家 AI 环境配置必须为0或1');
 const explicitNative=native===undefined?{}:{nativeCountryAI:native==='1'};
 const explicit=environment.CYBERFISH_HYBRID_SURVEY;
 if(explicit!==undefined){
  if(!['0','1'].includes(explicit))throw Error('自动调查环境配置必须为0或1');
  return {survey:explicit==='1',source:'environment',...explicitNative};
 }
 let raw;
 try{raw=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return {survey:false,source:'default',...explicitNative};throw error;}
 if(Buffer.byteLength(raw)>16384)throw Error('混合控制配置超出上限');
 let value;try{value=JSON.parse(raw);}catch{throw Error('混合控制配置不是有效JSON');}
 if(value?.version!==1||typeof value.survey!=='boolean')throw Error('混合控制配置需要version为1及survey布尔值');
 if(value.nativeCountryAI!==undefined&&typeof value.nativeCountryAI!=='boolean')throw Error('国家 AI 本地配置必须为布尔值');
 return {survey:value.survey,source:'local_configuration',...(value.nativeCountryAI===undefined?{}:{nativeCountryAI:value.nativeCountryAI}),...explicitNative};
}
