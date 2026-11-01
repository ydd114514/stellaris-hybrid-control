// Read-only prerequisite check. No bridge loading, pipe, screenshot, model or game launch.
import {existsSync} from 'node:fs';
import {currentGame,nativeBridgePath} from '../src/native-bootstrap.mjs';
import {credentialStatus} from '../src/credentials.mjs';
import {assertGameStartPolicy,assertNativeBridgeStartPolicy} from '../src/game-start-policy.mjs';
import {loadHybridSettings} from '../src/hybrid-settings.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
try {
  if(process.platform!=='win32')throw new Error('群星原生控制器目前支持 Windows。');
  const game=await currentGame();assertGameStartPolicy({hasGame:!!game,requireRunningGame:true});
  if((await loadHybridSettings()).nativeCountryAI===true){
    const requiredPath=nativeBridgePath({nativeCountryAI:true});
    if(!existsSync(requiredPath))throw new Error('缺少当前国家 AI 原生桥，请先完成本机构建。');
    const {bridgeModule}=await inspectNativeProcess({op:'bridge_module',pid:game.pid});
    assertNativeBridgeStartPolicy({bridgeModule,requiredPath});
  }
  if(!credentialStatus().stored)throw new Error('群星控制器尚未配置本机 DeepSeek 密钥，请先在控制器中完成配置。');
  if(!existsSync(`${process.env.APPDATA}/npm/node_modules/@deepseek-ai/dsh/lib/bin.js`))throw new Error('未找到本机 DSH，请先安装 DeepSeek Harness。');
  console.log(JSON.stringify({ok:true,message:'已打开群星，控制器依赖就绪。'}));
}catch(error){console.log(JSON.stringify({ok:false,message:error.message}));}
