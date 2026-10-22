// 同步调用 shizi-core-cli（B4.2，调度模拟器 --engine swift|both 用）。
// 模拟器的引擎（engine.mjs runScenario）是同步代码，而且 store.commit 的 mutate 里要当场拿到 Swift 的结果，所以不用异步的
// scripts/core-diff/lib/transport.mjs：建两个命名管道，子进程的 stdin / stdout 接到管道上，node 这边 fs.writeSync / fs.readSync 阻塞地一问一答。
// 协议与 ios/ShiziCore/README.md 相同（一行一个请求 / 回包；回包带 "state": false 以免回传快照）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { swiftBin } from '../../core-diff/lib/engines.mjs';

export class SwiftCallError extends Error {
  constructor(op, error) {
    super(`swift ${op}: ${error.code}: ${error.message}`);
    this.code = error.code;
    this.op = op;
  }
}

/** 开一个同步的 Swift 引擎。返回 { call(op, args) → reply（失败抛 SwiftCallError）, close() }。 */
export function openSyncSwift({ bin = swiftBin(), tz = process.env.TZ } = {}) {
  if (!bin) throw new Error('shizi-core-cli 未编译：swift build -c release --package-path ios/ShiziCore');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-sim-'));
  const reqPath = path.join(dir, 'req');
  const resPath = path.join(dir, 'res');
  execFileSync('mkfifo', [reqPath, resPath]);
  // 请求管道：子进程拿读端（O_RDWR 打开，open 不阻塞），本进程拿写端。
  // 回包管道：本进程以非阻塞只读打开读端，子进程拿写端；本进程不留写端，所以子进程退出时读到 EOF（不会永远阻塞）。
  const reqChild = fs.openSync(reqPath, 'r+');
  const reqFd = fs.openSync(reqPath, 'w');
  const resFd = fs.openSync(resPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const resChild = fs.openSync(resPath, 'w');
  // SHIZI_MATH=darwin：Math.exp / log 用 Darwin libm（= iOS 上的 JavaScriptCore），量它与 node（V8）的差别（JSMath.flavor）
  const math = process.env.SHIZI_MATH ? ['--math', process.env.SHIZI_MATH] : [];
  const child = spawn(bin, [...(tz ? ['--tz', tz] : []), ...math], { stdio: [reqChild, resChild, 'inherit'] });
  fs.closeSync(reqChild);
  fs.closeSync(resChild);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let dead = null;
  let pending = Buffer.alloc(0);
  const chunk = Buffer.alloc(1 << 20);
  let currentTz = tz;
  let n = 0;

  function readLine() {
    for (;;) {
      const nl = pending.indexOf(10);
      if (nl >= 0) {
        const line = pending.subarray(0, nl).toString('utf8');
        pending = pending.subarray(nl + 1);
        return line;
      }
      if (dead) throw new Error('shizi-core-cli exited: ' + dead);
      let got;
      try {
        got = fs.readSync(resFd, chunk, 0, chunk.length, null);
      } catch (error) {
        if (error.code !== 'EAGAIN') throw error;
        Atomics.wait(nap, 0, 0, 0.05); // 没有数据：睡 50µs 再看
        continue;
      }
      if (got === 0) dead = 'EOF';
      else pending = Buffer.concat([pending, chunk.subarray(0, got)]);
    }
  }

  function send(op, args) {
    const line = JSON.stringify({ op, args, state: false });
    if (line.includes('\n')) throw new Error('request line contains a newline');
    const buf = Buffer.from(line + '\n', 'utf8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(reqFd, buf, off, buf.length - off);
    n += 1;
    const res = JSON.parse(readLine());
    if (!res.ok) throw new SwiftCallError(op, res.error);
    return res.reply;
  }

  return {
    /** 一次调用；进程时区变了（模拟器的换时区场景）先同步过去。 */
    call(op, args = {}) {
      const tzNow = process.env.TZ;
      if (tzNow && tzNow !== currentTz) {
        send('tz.set', { zone: tzNow });
        currentTz = tzNow;
      }
      return send(op, args);
    },
    get calls() {
      return n;
    },
    close() {
      try {
        child.kill();
      } catch {
        // 已退出
      }
      try {
        fs.closeSync(reqFd);
        fs.closeSync(resFd);
      } catch {
        // 忽略
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
