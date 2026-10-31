import {loadHybridSettings,saveHybridSettings,hybridSettingsPath} from '../src/hybrid-settings.mjs';
const mode=process.argv[2]||'status';
if(!['status','on','off'].includes(mode))throw Error('用法：node scripts/configure-hybrid.mjs status|on|off');
if(mode!=='status')await saveHybridSettings(mode==='on');
const result=await loadHybridSettings();
console.log(JSON.stringify({...result,path:hybridSettingsPath,message:mode==='status'?'当前配置；每轮启动时固定。':'已保存，下一轮启动时生效；环境变量0/1优先。修改开关不会撤销游戏内自动化，收权应先通过控制器停止并确认。'},null,2));
