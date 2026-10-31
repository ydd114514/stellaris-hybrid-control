import net from 'node:net';
import {StringDecoder} from 'node:string_decoder';

// Reviewed precondition failures in Yidhar/stellaris-mcp 6cc8e820. These return
// before constructing/posting a command. Timeouts and execution exceptions do not.
export function isNativeRejection(method, code, message) {
  if (/rejected by the engine/.test(message)) return true;
  if ([-32601, -32602].includes(code)) return true;
  if (method === 'hire_leader' && code === -32072 && /^Candidate leader ID \d+ not found$/.test(message)) return true;
  if (method === 'assign_leader' && code === -32081 && /^Leader ID \d+ not found$/.test(message)) return true;
  if (method === 'select_research' && code === -32044 && /not found in candidate pool/.test(message)) return true;
  if (method === 'resolve_event' && code === -32006 && message === 'Event window_id not found among active events') return true;
  if (method === 'resolve_event' && [-32009, -32011].includes(code) && /^Option \d+ is (not shown|disabled) in event window/.test(message)) return true;
  return false;
}

/** One writer, one ordered connection. A timeout never replays an engine command. */
export class NativePipe {
  constructor({path = '\\\\.\\pipe\\stellaris_mcp_bridge', connect = net.createConnection, timeoutMs = 4500,beforeWrite} = {}) {
    Object.assign(this, {path, connect, timeoutMs,beforeWrite});
    this.nextId = 1;this.connectionEpoch=0; this.buffer = ''; this.decoder = new StringDecoder('utf8');
  }
  async open() {
    if (this.socket && !this.socket.destroyed) return;
    this.buffer = ''; this.decoder = new StringDecoder('utf8');
    await new Promise((resolve, reject) => {
      const socket = this.connect(this.path); this.socket = socket;
      const timeout = setTimeout(() => {socket.destroy(); reject(new Error('游戏桥连接超时'));}, this.timeoutMs);
      socket.once('connect', () => {clearTimeout(timeout);this.connectionEpoch++; resolve();});
      socket.on('error', error => {clearTimeout(timeout); reject(error); if (this.socket === socket) this.fail(error);});
      socket.on('close', () => {if (this.socket === socket) this.fail(new Error('游戏桥连接关闭；未确认的动作不能重发'));});
      socket.on('data', chunk => {
        this.buffer += this.decoder.write(chunk);
        if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.fail(new Error('游戏桥响应超过上限'));
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          if (!line.trim()) continue;
          let response;
          try {response = JSON.parse(line);} catch {return this.fail(new Error('游戏桥返回无效 JSON'));}
          const request = this.pending;
          if (!request || response.id !== request.id) continue;
          clearTimeout(request.timer); this.pending = undefined;
          if (response.error) {
            const error = new Error(response.error.message || '原生命令被拒绝');
            error.rpcCode = response.error.code;
            error.rejected = isNativeRejection(request.method, error.rpcCode, error.message);
            request.reject(error);
          } else request.resolve(response.result);
        }
      });
    });
  }
  fail(error) {
    if (this.pending) {clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined;}
    this.socket?.destroy(); this.socket = undefined;
  }
  async request(method, params = {},context) {
    if (this.requesting) {const error=new Error('原生桥请求必须顺序执行');error.nativeWriteAttempted=false;throw error;}
    this.requesting = true;
    let written=false;
    try {await this.open();
    // Connection establishment can yield. Recheck the owner immediately before
    // the actual pipe write, with no await between this guard and socket.write.
    this.beforeWrite?.(method,params,context);
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      this.pending = {id, method, resolve, reject, timer: setTimeout(() => this.fail(new Error(`原生桥 ${method} 超时；结果未知，先回读，禁止重发`)), this.timeoutMs)};
      written=true;this.socket.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n', error => {if (error) this.fail(error);});
    });}catch(error){error.nativeWriteAttempted=written;throw error;} finally {this.requesting = false;}
  }
  close() {this.fail(new Error('控制连接已停止'));}
}
