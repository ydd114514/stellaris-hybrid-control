import {readFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

// The selected world is explicit. Never follow continue_game into a different
// campaign merely because the game updated its most-recent-save metadata.
export async function selectedTestWorld(configPath=resolve('.local/active-world.json')) {
  let config;
  try {config=JSON.parse(await readFile(configPath,'utf8'));}
  catch(error) {if(error.code==='ENOENT')return '_929703252';throw error;}
  const name=config?.directory;
  if(typeof name!=='string'||!name.length||name.length>160||name==='.'||name==='..'||/[\\/:\x00-\x1f]/.test(name)||/[. ]$/.test(name))throw new Error('当前测试世界配置无效，未启动其他存档');
  return name;
}

export async function verifyContinueWorld({documents,configPath}={}) {
  const directory=await selectedTestWorld(configPath);
  const metadata=JSON.parse(await readFile(resolve(documents,'continue_game.json'),'utf8'));
  const prefix=`save games/${directory}/`;
  if(typeof metadata.title!=='string'||!metadata.title.startsWith(prefix))throw new Error('继续游戏指向其他存档，未自动切换');
  const filename=metadata.title.slice(prefix.length);
  if(!filename||filename==='.'||filename==='..'||/[\\/:\x00-\x1f]/.test(filename))throw new Error('测试存档路径无效');
  const worldDirectory=resolve(documents,'save games',directory);
  const save=resolve(worldDirectory,filename+'.sav');
  if(!save.startsWith(worldDirectory+sep)||!(await stat(save)).isFile())throw new Error('测试存档路径无效');
  return save;
}
