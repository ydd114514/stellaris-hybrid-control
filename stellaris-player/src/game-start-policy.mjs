import {win32} from 'node:path';

export function assertGameStartPolicy({hasGame,requiresRestart=false}) {
  if(!hasGame)throw new Error('请先手动打开群星并载入当前测试存档；控制器不会自动启动游戏。');
  if(requiresRestart)throw new Error('游戏已加载其他版本的原生桥，请先手动重启群星；控制器不会自动关闭或重启游戏。');
}

export function assertNativeBridgeStartPolicy({bridgeModule,requiredPath}) {
  if(bridgeModule?.known!==true||typeof bridgeModule.loaded!=='boolean')throw new Error('无法读取当前原生桥版本，尚未启动控制器。');
  if(!bridgeModule.loaded)return;
  if(typeof bridgeModule.path!=='string'||!bridgeModule.path||typeof requiredPath!=='string'||!requiredPath)throw new Error('无法读取当前原生桥路径，尚未启动控制器。');
  assertGameStartPolicy({hasGame:true,requiresRestart:win32.normalize(bridgeModule.path).toLowerCase()!==win32.normalize(requiredPath).toLowerCase()});
}
