import {ensureCommentary} from '../src/commentary-launch.mjs';
const {url}=await ensureCommentary();console.log('大肥鱼解说面板：'+url);console.log('OBS 浏览器源：'+url+'/overlay?voice=1');
