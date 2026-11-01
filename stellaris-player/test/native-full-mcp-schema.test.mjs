import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('native country AI publishes nonempty schemas and only reserved apply commands',async()=>{
 const child=spawn(process.execPath,['src/native-mcp.mjs'],{windowsHide:true,env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_NATIVE_COUNTRY_AI:'1'},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('MCP exited '+code)));});
 const timer=setTimeout(()=>child.kill(),5000);
 try{
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');await done;
  const tools=JSON.parse(output.trim().split('\n')[0]).result.tools;
  const check=node=>{if(!node||typeof node!=='object')return;for(const key of ['anyOf','oneOf','allOf','enum'])if(key in node)assert.ok(node[key].length>0,'empty '+key);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(check);else check(value);};
  tools.forEach(t=>check(t.inputSchema));
  const item=tools.find(t=>t.name==='apply_orders').inputSchema.properties.orders.items;
  const allowed=['declare_war','offer_peace','diplomacy','respond_diplomacy'];
  assert.deepEqual(item.properties.command.enum,allowed);
  assert.deepEqual(item.anyOf[0].properties.command.enum,allowed);
 }finally{clearTimeout(timer);}
});
