// 引擎传输层（B4.0）：统一成「送一行请求、收一行回包」。
//   inProcess(engine)       同进程 JS 参考引擎（js-engine.mjs），线上形状 = JSON.parse / JSON.stringify
//   subprocess(cmd, args)   JSON 行协议的子进程（scripts/core-diff/js-cli.mjs 或 Swift 的 shizi-core-cli）
import { spawn } from 'node:child_process';
import { onLines } from './lines.mjs';

export function inProcess(engine) {
  return {
    name: engine.name,
    send: async (line) => engine.handleLine(line),
    close: async () => {},
  };
}

export function subprocess(name, cmd, args = [], { env = process.env } = {}) {
  const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = [];
  let stderr = '';
  let dead = null;
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  onLines(child.stdout, (line) => {
    const p = pending.shift();
    if (p) p.resolve(line);
  });
  const die = (why) => {
    if (dead) return;
    dead = new Error(`${name} exited: ${why}${stderr ? '\n' + stderr.trim() : ''}`);
    while (pending.length) pending.shift().reject(dead);
  };
  child.on('exit', (code, signal) => die(signal || 'code ' + code));
  child.on('error', (e) => die(e.message));
  child.stdin.on('error', (e) => die(e.message));
  return {
    name,
    send(line) {
      if (dead) return Promise.reject(dead);
      if (line.includes('\n')) return Promise.reject(new Error('request line contains a newline'));
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(line + '\n');
      });
    },
    async close() {
      if (dead) return;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.stdin.end();
      });
    },
  };
}
