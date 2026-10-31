import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function inspectNativeProcess(request) {
  return new Promise((resolve, reject) => {
    const child = spawn('C:/Program Files/Python315/python.exe', [fileURLToPath(new URL('../native/research/native_session.py', import.meta.url))], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let buffer = ''; child.stdout.setEncoding('utf8'); child.stderr.resume();
    child.stdout.on('data', data => {buffer += data; if (buffer.length > 65536) child.kill();});
    const timer = setTimeout(() => {child.kill(); reject(new Error('游戏进程绑定超时'));}, 5000);
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', code => {
      clearTimeout(timer);
      try {if (code !== 0) throw new Error('游戏进程绑定失败'); const value = JSON.parse(buffer); if (!value.ok) throw new Error(value.error); resolve(value);} catch (error) {reject(error);}
    });
    child.stdin.end(JSON.stringify(request));
  });
}
