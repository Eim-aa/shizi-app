// 跑序列、比对、缩小（B4.0；计划 §4.3 ④「失败自动缩小到最短复现序列」）。
import { compareLines } from './compare.mjs';
import { generate, lineOf } from './gen.mjs';

/** 两个引擎的 op 交集（各自 hello）。 */
export async function commonOps(a, b) {
  const ops = async (e) => {
    const r = JSON.parse(await e.send(JSON.stringify({ op: 'hello', state: false })));
    if (!r.ok || r.reply.protocol !== 1) throw new Error(`${e.name}: unexpected hello ${JSON.stringify(r)}`);
    return new Set(r.reply.ops);
  };
  const [sa, sb] = await Promise.all([ops(a), ops(b)]);
  return new Set([...sa].filter((op) => sb.has(op) && op !== 'hello'));
}

/**
 * 从干净状态（reset）跑一条序列；返回第一处不同或 null。
 * @returns {Promise<null | { step, req, diff, la, lb }>}
 */
export async function runSeq(a, b, seq) {
  const reset = JSON.stringify({ op: 'reset', state: false });
  await Promise.all([a.send(reset), b.send(reset)]);
  for (let i = 0; i < seq.length; i += 1) {
    const line = lineOf(seq[i]);
    const [la, lb] = await Promise.all([a.send(line), b.send(line)]);
    const diff = compareLines(la, lb);
    if (diff) return { step: i, req: seq[i], diff, la, lb };
  }
  return null;
}

/** ddmin：在「仍然出现不同」的前提下删掉尽量多的步骤。返回最短序列与它的失败。 */
export async function shrink(a, b, seq, failure) {
  let cur = seq.slice(0, failure.step + 1);
  let fail = failure;
  let runs = 0;
  const tryCand = async (cand) => {
    runs += 1;
    const f = await runSeq(a, b, cand);
    return f ? { seq: cand.slice(0, f.step + 1), f } : null;
  };
  let n = 2;
  while (cur.length >= 2) {
    const chunk = Math.ceil(cur.length / n);
    let reduced = false;
    for (let i = 0; i < cur.length; i += chunk) {
      const hit = await tryCand([...cur.slice(0, i), ...cur.slice(i + chunk)]);
      if (hit) {
        cur = hit.seq;
        fail = hit.f;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (n >= cur.length) break;
      n = Math.min(cur.length, n * 2);
    }
  }
  return { seq: cur, failure: fail, runs };
}

/** 跑一批种子；第一处失败时缩小并返回。 */
export async function runSeeds(a, b, { seedStart = 1, seeds = 200, steps = 300, onSeed = null, available = null } = {}) {
  const ops = available || (await commonOps(a, b));
  let total = 0;
  for (let s = seedStart; s < seedStart + seeds; s += 1) {
    const seq = generate(s, steps, ops);
    const f = await runSeq(a, b, seq);
    total += f ? f.step + 1 : seq.length;
    if (f) {
      const shrunk = await shrink(a, b, seq, f);
      return { ok: false, seed: s, steps: total, original: f, shrunk, ops };
    }
    if (onSeed) onSeed(s);
  }
  return { ok: true, seeds, steps: total, ops };
}

export function describeFailure(r, a, b) {
  const f = r.shrunk.failure;
  const L = [];
  L.push(`种子 ${r.seed}：第 ${r.original.step + 1} 步出现不同（${r.original.diff.kind}），缩小到 ${r.shrunk.seq.length} 步（试跑 ${r.shrunk.runs} 次）：`);
  r.shrunk.seq.forEach((req, i) => L.push(`  ${i + 1}. ${lineOf(req)}`));
  L.push(`不同之处：${f.diff.kind} ${f.diff.path}`);
  L.push(`  ${a.name}: ${JSON.stringify(f.diff.a)}`);
  L.push(`  ${b.name}: ${JSON.stringify(f.diff.b)}`);
  L.push(`  ${a.name} 回包: ${f.la}`);
  L.push(`  ${b.name} 回包: ${f.lb}`);
  return L.join('\n');
}
