export function assertGameStartPolicy({hasGame,requiresRestart=false}) {
  if(!hasGame)throw new Error('请先手动打开群星并载入当前测试存档；控制器不会自动启动游戏。');
  if(requiresRestart)throw new Error('游戏已加载其他版本的原生桥，请先手动重启群星；控制器不会自动关闭或重启游戏。');
}
