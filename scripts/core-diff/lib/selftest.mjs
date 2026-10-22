// 差分驱动自检（B4.0 验收「JS↔JS 差分自检通过」「空规则下协议往返」）。
//   ① js ↔ js-cli（同一实现经子进程）：N 个种子 0 差异——证明传输、生成器确定性、比对器本身不误报；
//   ② 埋错必抓、缩小必短：js ↔ js~localDay-boundary（值不同，缩到 ≤ 3 步：ddmin 保证 1-最小，即删掉任一步都不再失败）；js ↔ js-cli~number-format（只差字节，缩到 1 步）；
//   ③ 有 Swift 命令行时：固定的协议语料（hello / echo 刁钻值 / kv / 坏请求）逐行比对。
import { compareLines } from './compare.mjs';
import { openEngine } from './engines.mjs';
import { commonOps, describeFailure, runSeeds } from './runner.mjs';
import { lineOf } from './gen.mjs';

export const PROTOCOL_CORPUS = [
  { op: 'state' },
  { id: 1, op: 'echo', args: { value: { b: 1, 2: 0, a: [1, 1.5, -0, 1e21, 1e-7, 123e-20, 5e-324, 1.7976931348623157e308, 2 ** 53 + 2, 0.1 + 0.2] } } },
  { id: 'x', op: 'echo', args: { value: '\u0000\u001f"\\/\b\f\n\r\t\u007f  éé拾😀👍🏽﻿' } },
  { op: 'echo', args: { value: JSON.parse('{"é":1,"e\\u0301":2,"10":3,"9":4,"01":5,"4294967295":6,"4294967294":7,"__proto__":8,"":9}') } },
  { op: 'echo', args: { value: [[], {}, [[[]]], null, true, false, ''] } },
  { op: 'kv.set', args: { key: 'b', value: 1 } },
  { op: 'kv.set', args: { key: '1', value: { z: 1, y: 2 } } },
  { op: 'kv.set', args: { key: 'a', value: null } },
  { op: 'kv.set', args: { key: '__proto__', value: 'p' } },
  { op: 'kv.keys' },
  { op: 'kv.get', args: { key: 'a' } },
  { op: 'kv.get', args: { key: 'missing' } },
  { op: 'kv.delete', args: { key: 'b' } },
  { op: 'kv.delete', args: { key: 'b' } },
  { op: 'clock.set', args: { t: 1772488800000 } },
  { op: 'clock.advance', args: { ms: 0.25 } },
  { op: 'clock.advance', args: { ms: -86400000 } },
  { op: 'kv.keys', state: false },
  { op: 'reset', args: { state: { clock: 5, kv: { k: [1] } } } },
  { op: 'reset', args: { state: { kv: 1 } } },
  { op: 'reset' },
  { op: 'nope' },
  { op: 'echo' },
  { op: 'echo', args: [] },
  { __raw: '{"op":"echo","args":{"value":1e400}}' },
  { __raw: '{"op":"echo","args":{"value":-1E-400}}' },
  { __raw: ' { "op" : "echo" , "args" : { "value" : [ 1 , 2 ] } } ' },
  { __raw: '{"op":"echo","args":{"value":1,"value":2}}' },
  { __raw: '{"op":"echo","args":{"value":"\\ud83d\\ude00\\u00e9"}}' },
  { __raw: '{"op":"echo"' },
  { __raw: '[]' },
  { __raw: 'tru' },
];

async function corpus(a, b) {
  const bad = [];
  const hello = await Promise.all([a, b].map(async (e) => JSON.parse(await e.send(JSON.stringify({ op: 'hello', state: false })))));
  if (hello[0].reply.protocol !== hello[1].reply.protocol) bad.push(`protocol ${hello[0].reply.protocol} vs ${hello[1].reply.protocol}`);
  const onlyA = hello[0].reply.ops.filter((o) => !hello[1].reply.ops.includes(o));
  const onlyB = hello[1].reply.ops.filter((o) => !hello[0].reply.ops.includes(o));
  for (const req of PROTOCOL_CORPUS) {
    const line = req.__raw !== undefined ? req.__raw : JSON.stringify(req);
    const [la, lb] = await Promise.all([a.send(line), b.send(line)]);
    const d = compareLines(la, lb);
    if (d) bad.push(`${line}\n    ${a.name}: ${la}\n    ${b.name}: ${lb}`);
  }
  return { bad, onlyA, onlyB };
}

async function withEngines(specs, opts, fn) {
  const es = specs.map((s) => openEngine(s, opts));
  try {
    return await fn(...es);
  } finally {
    await Promise.all(es.map((e) => e.close()));
  }
}

/**
 * @param {{ seeds?: number, steps?: number, swift?: boolean, swiftPath?: string|null, log?: (s: string) => void }} o
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function selfTest({ seeds = 50, steps = 300, swift = false, swiftPath = null, log = () => {} } = {}) {
  const lines = [];
  let ok = true;
  const say = (s) => {
    lines.push(s);
    log(s);
  };
  const opts = { swiftPath };

  await withEngines(['js', 'js-cli'], opts, async (a, b) => {
    const r = await runSeeds(a, b, { seeds, steps });
    if (r.ok) say(`① js ↔ js-cli：${seeds} 个种子 × ${steps} 步，${r.steps} 步 0 差异（可用 op ${r.ops.size} 个）`);
    else {
      ok = false;
      say(`① js ↔ js-cli 出现差异（不应该）：\n${describeFailure(r, a, b)}`);
    }
  });

  for (const [specA, specB, kind, maxLen] of [['js', 'js~localDay-boundary', 'value', 3], ['js', 'js-cli~number-format', 'encoding', 1]]) {
    await withEngines([specA, specB], opts, async (a, b) => {
      const r = await runSeeds(a, b, { seeds, steps });
      const got = r.ok ? null : r.shrunk;
      const pass = got && got.failure.diff.kind === kind && got.seq.length <= maxLen;
      if (!pass) ok = false;
      say(`② ${specB}：${r.ok ? '没抓到（不应该）' : `种子 ${r.seed} 第 ${r.original.step + 1} 步抓到 ${got.failure.diff.kind}，缩小到 ${got.seq.length} 步（要求 ≤ ${maxLen}）`}${pass ? '' : ' ✗'}`);
      if (got) for (const req of got.seq) say(`     ${lineOf(req)}`);
    });
  }

  if (swift) {
    await withEngines(['js', 'swift'], opts, async (a, b) => {
      const c = await corpus(a, b);
      if (c.bad.length) ok = false;
      say(`③ 协议语料 js ↔ swift：${PROTOCOL_CORPUS.length} 行，${c.bad.length} 处不同${c.bad.length ? '\n  ' + c.bad.join('\n  ') : ''}`);
      const common = await commonOps(a, b);
      say(`   op：两边共有 ${common.size} 个${c.onlyA.length ? `；Swift 尚未实现 ${c.onlyA.length} 个（${c.onlyA.join('、')}）` : ''}${c.onlyB.length ? `；只有 Swift 有 ${c.onlyB.join('、')}` : ''}`);
      if (c.onlyB.length) ok = false;
    });
  }
  return { ok, lines };
}
