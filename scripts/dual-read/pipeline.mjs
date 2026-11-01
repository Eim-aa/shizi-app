// 双读流水线（B4.8 预备；计划 §4.4）：脱敏副本 → 同一份数据分别交给 JS（参考实现）与 Swift（shizi-core-cli）→ 比整份状态 →
// 在这份状态上跑种子化随机操作序列、每步比回包与整份状态、失败缩小。只打印计数与差异路径，不打印任何记录内容。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openEngine } from '../core-diff/lib/engines.mjs';
import { compareLines } from '../core-diff/lib/compare.mjs';
import { commonOps, runSeq, shrink } from '../core-diff/lib/runner.mjs';
import { DOMAINS, makeCtx, rng, lineOf } from '../core-diff/lib/gen.mjs';
import { parseJson } from '../core-diff/lib/json-parse.mjs';
import { anonymize, readRows } from './anonymize.mjs';

const FALLBACK_CLOCK = 1790906400000; // 与 core-diff store 域同一个缺省时钟（2026-10-02 10:00 上海）
const RESET = '{"op":"reset","state":false}';
// 回放里只用「作用在已有库上」的 store 域 op：不重开 / 关闭 / 整体 seed（那会把真实数据换掉）；纯函数 op 与真数据无关，也不用
const REPLAY_OP = /^(store\.(?!open$|close$|seed$)|backup\.(restore|clearAll|undo|dropSafety|markExported|export)$|migrate\.(boot|release)$)/;

const reqLine = (op, args, state) => JSON.stringify({ op, args, state });

/** 磁盘键值里最晚的记录时间（折叠月看 kept）；没有记录返回 null。 */
function latestAt(disk) {
  let max = null;
  for (const key of Object.keys(disk)) {
    if (!key.startsWith('shizi.v2.records.')) continue;
    try {
      const v = parseJson(disk[key]);
      const list = Array.isArray(v) ? v : v && Array.isArray(v.kept) ? v.kept : [];
      for (const r of list) if (r && typeof r.at === 'number' && (max === null || r.at > max)) max = r.at;
    } catch {
      /* 坏月份交给 store 自己隔离 */
    }
  }
  return max;
}

/** 脱敏副本 → 开库前缀（每次回放都从它开始）与时钟。 */
export function prefixOf(anon, nowOverride = null) {
  if (anon.kind === 'sqlite') {
    const db = new DatabaseSync(anon.file, { readOnly: true });
    let disk;
    try {
      disk = readRows(db);
    } finally {
      db.close();
    }
    const last = latestAt(disk);
    const clock = nowOverride ?? (last === null ? FALLBACK_CLOCK : last + 3600000);
    return { clock, lines: [reqLine('store.open', { backend: 'native', clock, disk }, false)], keys: Object.keys(disk).length };
  }
  const text = fs.readFileSync(anon.file, 'utf8');
  const obj = parseJson(text);
  const disk = {};
  for (const k of Object.keys(obj.data || {})) if (typeof obj.data[k] === 'string') disk[k] = obj.data[k];
  const last = latestAt(disk);
  const clock = nowOverride ?? (last === null ? FALLBACK_CLOCK : last + 3600000);
  return {
    clock,
    lines: [reqLine('store.open', { backend: 'native', clock }, false), reqLine('backup.restore', { input: text }, false)],
    keys: Object.keys(disk).length,
  };
}

/** 状态 → 各域计数（只有数字）。 */
export function countsOf(state) {
  const monthsOf = (d) => (d && typeof d === 'object' ? Object.keys(d) : []);
  let records = 0;
  let folded = 0;
  let foldedKept = 0;
  let unfoldedMonths = 0;
  for (const m of monthsOf(state.records)) {
    const v = state.records[m];
    if (Array.isArray(v)) {
      unfoldedMonths += 1;
      records += v.length;
    } else if (v && v.folded) {
      folded += 1;
      foldedKept += Array.isArray(v.kept) ? v.kept.length : 0;
    }
  }
  let ink = 0;
  for (const m of monthsOf(state.ink)) ink += Object.keys(state.ink[m] || {}).length;
  const size = (x) => (x && typeof x === 'object' ? Object.keys(x).length : 0);
  const sess = state.sessions;
  return {
    records月份: unfoldedMonths,
    records条数: records,
    折叠月: folded,
    折叠月保留条数: foldedKept,
    sched条数: size(state.sched),
    ink条数: ink,
    custom自加字: state.custom && Array.isArray(state.custom.added) ? state.custom.added.length : 0,
    wordOff: size(state.wordOff),
    settings键数: size(state.settings),
    photos: size(state.photos),
    legacy: state.legacy ? 1 : 0,
    进行中会话: sess ? (sess.A ? 1 : 0) + (sess.B ? 1 : 0) : 0,
    funnel键数: size(state.funnel),
    保护副本: state.safety ? 1 : 0,
    serial: state.meta && typeof state.meta.serial === 'number' ? state.meta.serial : null,
  };
}

/** 引擎外包一层：协议里的 reset 之后自动重放开库前缀（runner 的 runSeq / shrink 原样可用）。 */
function withPrefix(engine, lines) {
  return {
    name: engine.name,
    close: () => engine.close(),
    async send(line) {
      const r = await engine.send(line);
      if (line === RESET) for (const l of lines) await engine.send(l);
      return r;
    },
  };
}

function generateReplay(seed, steps, available, realState) {
  const g = makeCtx(rng(seed));
  g.available = available;
  for (const d of DOMAINS) if (d.prepare) d.prepare(g);
  g.storeState = realState; // 记录引用 / 月份等取自真实状态
  const store = DOMAINS.find((d) => d.id === 'store');
  const entries = Object.entries(store.ops)
    .filter(([op, spec]) => REPLAY_OP.test(op) && (spec.always || available.has(op)))
    .map(([op, spec]) => [[op, spec], spec.weight]);
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const [op, spec] = g.weighted(entries);
    out.push(spec.request ? spec.request(g) : { op, args: spec.args ? spec.args(g) : {} });
  }
  return out;
}

const fmtPath = (d) => `${d.kind} ${d.path}`;

/**
 * @returns {Promise<{ok: boolean, stage: 'load'|'replay'|'env', counts?: object, diff?: string, steps?: number, seconds?: number}>}
 */
export async function dualRead(input, { seeds = 50, steps = 200, seedStart = 1, swiftBin = null, now = null, keep = false, replay = true, log = console.log } = {}) {
  const anon = anonymize(input);
  log(`脱敏副本：${anon.dir}（${anon.kind}；替换图片 ${anon.stats.images} 处、报告字串 ${anon.stats.strings} 个，涉及 ${anon.stats.keys} 个键）`);
  let js;
  let sw;
  try {
    const pre = prefixOf(anon, now);
    log(`读入 ${pre.keys} 个键；时钟 ${new Date(pre.clock).toISOString()}，时区 ${process.env.TZ}`);
    try {
      js = openEngine('js');
      sw = openEngine('swift', { swiftPath: swiftBin });
    } catch (e) {
      log(e.message);
      return { ok: false, stage: 'env' };
    }

    // ---- 载入：两边各读一遍，比整份状态
    let la = null;
    let lb = null;
    await Promise.all([js.send(RESET), sw.send(RESET)]);
    for (let i = 0; i < pre.lines.length; i += 1) {
      const last = i === pre.lines.length - 1;
      const line = last ? pre.lines[i].replace(/"state":false}$/, '"state":true}') : pre.lines[i];
      [la, lb] = await Promise.all([js.send(line), sw.send(line)]);
      const d = compareLines(la, lb);
      if (d) {
        log(`A ≠ B：载入第 ${i + 1} 步 ${fmtPath(d)}`);
        return { ok: false, stage: 'load', diff: fmtPath(d) };
      }
    }
    const A = parseJson(la);
    const loadedState = A.ok && A.state && A.state.store ? A.state.store.state : null;
    const reply = A.reply;
    if (!A.ok || !loadedState) {
      log('两边一致，但库没能读进来（错误码相同）；只比较了错误回包，不继续回放。');
      return { ok: false, stage: 'load', diff: 'both-failed' };
    }
    const status = A.state.store.status || {};
    const counts = countsOf(loadedState);
    log('各域计数：');
    for (const [k, v] of Object.entries(counts)) log(`  ${k}：${v}`);
    const rep = status.lastRepair;
    const repairText = rep && typeof rep === 'object'
      ? `启动修复：残留事务 ${rep.txn}，隔离坏值 ${(rep.quarantined || []).length}，未知键 ${(rep.unknown || []).length}，清掉 ${(rep.dropped || []).length}`
      : '启动修复：无';
    log(`库状态：available=${status.available} blocked=${status.blocked ? 'yes' : 'no'}${status.corruptNotice ? ' corruptNotice=yes' : ''}；${repairText}`);
    log('A == B（整份状态逐字节相同：JS 读 = Swift 读）');

    if (!replay) return { ok: true, stage: 'load', counts };

    // ---- 回放
    const a = withPrefix(js, pre.lines);
    const b = withPrefix(sw, pre.lines);
    const ops = await commonOps(js, sw);
    const t0 = Date.now();
    let total = 0;
    for (let s = seedStart; s < seedStart + seeds; s += 1) {
      const seq = generateReplay(s, steps, ops, loadedState);
      const f = await runSeq(a, b, seq);
      total += f ? f.step + 1 : seq.length;
      if (f) {
        const sh = await shrink(a, b, seq, f);
        log(`回放出现不同：种子 ${s}，第 ${f.step + 1} 步，缩小到 ${sh.seq.length} 步（试跑 ${sh.runs} 次）`);
        sh.seq.forEach((req, i) => log(`  ${i + 1}. ${req.op}`));
        log(`  首个不同：${fmtPath(sh.failure.diff)}`);
        const repro = path.join(anon.dir, `repro-${s}.jsonl`);
        fs.writeFileSync(repro, [...pre.lines, ...sh.seq.map(lineOf)].join('\n') + '\n', { mode: 0o600 });
        log(`  复现文件（含脱敏数据，只在临时文件夹）：${repro}`);
        keep = true;
        return { ok: false, stage: 'replay', diff: fmtPath(sh.failure.diff), counts };
      }
    }
    const seconds = (Date.now() - t0) / 1000;
    log(`回放：${seeds} 条序列 × ${steps} 步，共 ${total} 步，每步比回包与整份状态，0 差异（${seconds.toFixed(1)} 秒）`);
    return { ok: true, stage: 'replay', counts, steps: total, seconds };
  } finally {
    if (js) await js.close();
    if (sw) await sw.close();
    if (!keep) fs.rmSync(anon.dir, { recursive: true, force: true });
    else log(`临时文件夹保留：${anon.dir}（含脱敏副本；用完请自行删除）`);
  }
}
