// Read-only compatibility checks for a proposed mod set. This never edits a
// launcher playset, enables a mod, or treats a descriptor version as a port.
export const AI_MOD_IDS=Object.freeze({stellar:'3610149307',stellarVanillaJobs:'3686836322',intelligent:'3814356797',bca:'3673829479',bcaJobs:'3755405597',bcaParallel:'3774886744'});
export const STEERING_CUSTOM_ZONES=Object.freeze(['cfsteer_zone_research','cfsteer_zone_research_physics','cfsteer_zone_research_society','cfsteer_zone_research_engineering','cfsteer_zone_research_unity','cfsteer_zone_unity','cfsteer_zone_unity_spiritualist','cfsteer_zone_unity_bio_trophy']);
const field=(text,key)=>typeof text==='string'?text.match(new RegExp('^\\s*'+key+'\\s*=\\s*"([^"\\r\\n]*)"','m'))?.[1]:undefined;
const filesOf=mod=>Object.fromEntries(Object.entries(mod.files??{}).filter(([,text])=>typeof text==='string'||Buffer.isBuffer(text)).map(([path,text])=>[path.replaceAll('\\','/'),text.toString()]));
const supports=(declared,version)=>{
 if(!declared)return null;
 const actual=version.replace(/^v/i,'').split('.'),wanted=declared.replace(/^v/i,'').split('.');
 return wanted.every((part,index)=>part==='*'||part===actual[index]);
};
const scriptFiles=files=>Object.entries(files).filter(([path,text])=>/^(?:common|events)\/.*\.txt$/.test(path)&&text.trim());
// Ignore comments so a compatibility note listing a zone does not count as
// construction/destruction support for that zone.
function scriptText(text){let result='',quoted=false,escaped=false,comment=false;for(const ch of text){if(comment){if(ch==='\n'){comment=false;result+='\n';}continue;}if(quoted){result+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='#'){comment=true;continue;}if(ch==='"')quoted=true;result+=ch;}return result;}

/** Assess downloaded, selected sources. Unselected catalog entries are ignored.
 * `files` is a relative-path -> UTF-8 text map, not executable mod code.
 * `verifiedOverhaulIntegration` is only for an integration actually reviewed
 * from both sources; a workshop description is not such a verification.
 */
export function assessAiModCompatibility({mods=[],gameVersion='4.5.2',nativeCountryAI=true,customZones=STEERING_CUSTOM_ZONES,verifiedOverhaulIntegration=false}={}){
 if(!Array.isArray(mods)||!/^\d+\.\d+(?:\.\d+)?$/.test(gameVersion))throw Error('Mod兼容检查参数无效');
 const blockers=[],warnings=[],inspected=[];
 const add=(target,code,modIds,message,details)=>target.push({code,modIds,message,...(details?{details}:{})});
 for(const mod of mods.filter(mod=>mod&&mod.enabled!==false)){
  const files=filesOf(mod),descriptor=mod.descriptorText??files['descriptor.mod']??'',id=String(mod.workshopId??field(descriptor,'remote_file_id')??'');
  const name=mod.name??field(descriptor,'name')??id,supportedVersion=field(descriptor,'supported_version'),scripts=scriptFiles(files);
  const row={id,name,files,scriptCount:scripts.length,supportedVersion};inspected.push(row);
  if(Object.values(AI_MOD_IDS).includes(id)&&!scripts.length)add(blockers,'AI_MOD_SOURCE_UNAVAILABLE',[id],'尚未取得该Mod的实际脚本，不能把页面介绍当作已完成兼容适配');
  if([AI_MOD_IDS.bca,AI_MOD_IDS.bcaJobs].includes(id)){
   if(supports(supportedVersion,gameVersion)!==true)add(blockers,'BCA_GAME_VERSION_UNVERIFIED',[id],`BCA组件未声明适配当前${gameVersion}；不能仅修改supported_version冒充移植`,{supportedVersion:supportedVersion??null});
   if(id===AI_MOD_IDS.bca){
    const automation=scripts.filter(([path])=>/common\/(?:colony_automation|scripted_effects|scripted_triggers)\//.test(path)).map(([,text])=>scriptText(text)).join('\n');
    const missing=customZones.filter(zone=>typeof zone==='string'&&/^[a-zA-Z0-9_]+$/.test(zone)&&!new RegExp('\\b'+zone+'\\b').test(automation));
    if(missing.length)add(blockers,'BCA_CUSTOM_ZONES_UNSUPPORTED',[id],'BCA尚未显式适配本机科研/凝聚力区域的建设计划及拆除处理',{missingZones:missing});
    if(nativeCountryAI)add(blockers,'BCA_NATIVE_AI_OWNERSHIP_UNVERIFIED',[id],'BCA月度建设、拆除和调岗与本国原生AI尚无经核对的职责互斥适配，本组合暂不启用');
   }
  }
  if(id===AI_MOD_IDS.bcaParallel&&gameVersion!=='4.4.6')add(blockers,'BCA_PARALLEL_BINARY_VERSION_MISMATCH',[id],`4.4.6并行施工补丁不能安装到${gameVersion}；不执行其安装脚本或修改游戏二进制`);
  if(id===AI_MOD_IDS.intelligent)add(warnings,'INTELLIGENT_MODIFICATION_RESTRICTED',[id],'作者要求修改、分叉或转载前取得书面许可；本工具只读检查，不生成该Mod源码的衍生版本');
 }
 const ids=new Set(inspected.map(mod=>mod.id));
 if(ids.has(AI_MOD_IDS.stellar)&&ids.has(AI_MOD_IDS.stellarVanillaJobs))add(blockers,'STELLAR_VARIANTS_TOGETHER',[AI_MOD_IDS.stellar,AI_MOD_IDS.stellarVanillaJobs],'Stellar AI两个版本只能选择一个，不能同时加载岗位产出原版与修改版');
 if(ids.has(AI_MOD_IDS.bcaJobs)&&!ids.has(AI_MOD_IDS.bca))add(blockers,'BCA_JOBS_MISSING_PARENT',[AI_MOD_IDS.bcaJobs],'宏观岗位统计与调控组件依赖BCA主Mod，不能作为独立的原生AI优化包启用');
 const stellar=inspected.find(mod=>[AI_MOD_IDS.stellar,AI_MOD_IDS.stellarVanillaJobs].includes(mod.id));
 if(stellar&&ids.has(AI_MOD_IDS.intelligent)&&!verifiedOverhaulIntegration)add(blockers,'AI_OVERHAUL_INTEGRATION_UNVERIFIED',[stellar.id,AI_MOD_IDS.intelligent],'作者虽说明可叠加，但本机人格、经济计划和战略控制尚未按两份实际源码完成合并核对；暂不自动叠加');
 return {ok:blockers.length===0,gameVersion,blockers,warnings,inspected:inspected.map(({files,...mod})=>mod),enabledByChecker:false,runtimeTested:false};
}

export function assertAiModCompatibility(options){
 const result=assessAiModCompatibility(options);
 if(!result.ok)throw Object.assign(Error(result.blockers.map(row=>row.message).join('；')),{code:'AI_MOD_COMPATIBILITY_BLOCKED',compatibility:result});
 return result;
}
