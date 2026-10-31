// Bounded development probe for the reviewed community bridge. Never retries.
import net from 'node:net';
import {StringDecoder} from 'node:string_decoder';
import {writeFile, mkdir} from 'node:fs/promises';

const [method = 'get_status', raw = '{}'] = process.argv.slice(2);
const denied = new Set(['run_console', 'self_test_purecall_guard']);
if (denied.has(method)) throw new Error('不暴露控制台或破坏性调试方法');
const params = JSON.parse(raw);
const start = Date.now();
const response = await new Promise((resolve, reject) => {
  const socket = net.createConnection('\\\\.\\pipe\\stellaris_mcp_bridge');
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const finish = (error, result) => {clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result);};
  const timer = setTimeout(() => finish(new Error('原生桥超时；操作结果未知，不自动重发')), 4500);
  socket.on('connect', () => socket.write(JSON.stringify({jsonrpc: '2.0', id: 1, method, params}) + '\n'));
  socket.on('error', error => finish(error));
  socket.on('data', data => {
    buffer += decoder.write(data);
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) return finish(new Error('响应过大'));
    if (!buffer.includes('\n')) return;
    try {finish(null, JSON.parse(buffer.slice(0, buffer.indexOf('\n'))));} catch (error) {finish(error);}
  });
});
const report = {at: new Date().toISOString(), method, params, elapsedMs: Date.now() - start, response};
await mkdir('.local/native-bridge/rpc', {recursive: true});
await writeFile(`.local/native-bridge/rpc/${Date.now()}-${method}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
