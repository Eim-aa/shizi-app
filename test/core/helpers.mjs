// 测试助手（不是测试文件：不以 .test.mjs 结尾）。
// vendor/fsrs6.min.js 是 UMD，浏览器里挂 globalThis.FSRS。node 里用 vm 在当前 realm 求值即得到同样的全局，
// 与浏览器行为一致（src/core/fsrs.js 默认读 globalThis.FSRS）。loadFSRSInNewRealm 给跨 realm 注入测试用。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FSRS_PATH = path.join(ROOT, 'vendor/fsrs6.min.js');

export function loadFSRSGlobal() {
  if (!globalThis.FSRS) vm.runInThisContext(fs.readFileSync(FSRS_PATH, 'utf8'), { filename: FSRS_PATH });
  return globalThis.FSRS;
}

export function loadFSRSInNewRealm() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(FSRS_PATH, 'utf8'), ctx, { filename: FSRS_PATH });
  return ctx.FSRS;
}

/** 本地时间 ms：at('2026-09-24', 20) = 2026-09-24 20:00 本地。 */
export function at(day, hour = 12, minute = 0) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

/** 构造记录（绕过 makeRecord 的便捷写法，字段与 01 §3.2 一致）。 */
export function rec(serial, char, kind, judgment, day, extra = {}) {
  const r = {
    id: 'r' + serial,
    cardKey: 'base:' + char,
    char,
    sessionId: extra.sessionId || 's1',
    kind,
    at: extra.at ?? at(day, 12, serial % 60),
    localDay: day,
    help: { hints: extra.hints || 0, answerSeen: kind === 'answer-seen', traced: false },
  };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

/** 一个 policy 覆盖（其余沿用真实 policy）。 */
export async function policyWith(overrides) {
  const base = await import('../../src/config/policy.js');
  return { ...base, ...overrides };
}
