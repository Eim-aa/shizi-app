// M6-3 性能与容量（02 §8「性能：300 字 + 15 画字书写帧率（Chromium trace）、墙与完整页渲染时长、总占用 < 3.2MiB」；
// 01 §13 / §9；acceptance/M3-M4.md（隐藏页保持挂载的内存、300 字性能）；03 P78（ink v3）/ P05 / P28 / P57）。
// 复现方法与阈值来源见 scripts/perf/README.md。
//
// 注入：page.route 把 src/config/policy.js 的 features.perRecordInk 改成 true（P31 过渡关闭；源码不动，只在本 spec 的页面里，
//       同 44-scenario-ink-states）——所有格子走 InkMini 真实笔迹路径（M3/M4 未覆盖项）。
// 造数（页面里用真实 mutator judgeInDraft 逐条判断，id 顺序 = 时间顺序；时钟 2026-09-24 20:00）：
//   一年量级 300 字：2025-10 … 2026-08 每月 150 条（300 字轮转，每字约 5.5 次）+ 本月（2026-09）200 条（200 个不同的字）；
//   每条都带 ink v3（8–15 笔、每笔 30–46 个原始点，判断时按 policy 抽点到 ≤24 点/笔）；约 15% 写错。
//   judgeInDraft 每次判断按 D27 回收这个字中间那次的墨迹（阶段 1 P1-E3），种子里每字至多两份（第一次 + 最近一次）；
//   种子之前仍在草稿上跑一次 store/budget.js recover()（与每次 commit 写前回收同一函数），断言它不必再淘汰任何墨迹。
//   sessions.A = 今天的练习，当前字「德」（15 画）。
// 量（每项都打印成数字表，报告与 README 引用）：
//   1. 容量：localStorage 全部键 (键长 + 值长) × 2 < 3.2MiB（01 §9 / §13）；各桶字节数；种子后与写字页判断 commit 后各量一次。
//   2. 写字页 15 画：requestAnimationFrame 帧间隔均值 ≤ 16.7 × 1.5ms；Chromium trace 里 FireAnimationFrame / pointermove 的主线程耗时；
//      抬笔固化 = pointerup 处理（固化层追加一笔）+ 'write:strokes' 会话写入，每笔 ≤ 50ms（trace EventDispatch + 仪表化 commit）。
//   3. 首屏（nav 动作 → rAF 轮询到内容格子出现且笔迹 canvas 已按尺寸画好）：墙（字库 tab）、有记录的字完整页、
//      练习记录（本月 200 格 / 300 格变体）各 ≤ 200ms（01 §13；35-all 同口径）。
//   4. 页面栈 5 层（下层保持挂载）：CDP HeapProfiler.collectGarbage 后 Runtime.getHeapUsage，5 层时相对根页的增长与
//      退回根页后的残留；三轮进出残留不递增（无泄漏）。performance.memory 若可用一并打印。

import { bootTestHost, tid, topSel, waitNavIdle, PRESS_SETTLE_MS } from './helpers.mjs';

const CLOCK = '2026-09-24T20:00:00';
const TOP = '.sz-layer[data-top="true"]';
const TARGET = '德'; // 15 画（data/德.json strokes.length，断言见下）
const SECOND = '题'; // 会话第二个字：第二次判断量稳态 commit（第一次含浏览器首次创建 AudioContext）
const MiB = 1024 * 1024;

// 阈值（来源见 scripts/perf/README.md）
export const LIMITS = Object.freeze({
  totalBytes: 3.2 * MiB, // 01 §9 / §13 目标合计
  frameAvgMs: 16.7 * 1.5, // 02 §8 / 任务卡 M6-3：平均帧 ≤ 16.7ms × 1.5
  penUpMs: 50, // 任务卡 M6-3：抬笔固化 ≤ 50ms
  firstPaintMs: 200, // 01 §13 / 02 M3-4：300 字首屏 < 200ms
  heapGrowthBytes: 32 * MiB, // 工程取值：5 层页面栈相对根页的 JS 堆增长
  heapResidualBytes: 4 * MiB, // 工程取值：退回根页 + GC 后相对基线的残留
  heapLeakBytes: 2 * MiB, // 工程取值：第 3 轮与第 1 轮残留之差（每轮进出不递增）
});

export async function injectPerRecordInk(page) {
  let hits = 0;
  await page.route(/\/src\/config\/policy\.js(\?.*)?$/, async route => {
    const res = await route.fetch();
    const body = await res.text();
    // D27 起源码默认已是 true；仍按值改写，保证这个 spec 不随默认值漂移
    const next = body.replace(/perRecordInk: (true|false),/, 'perRecordInk: true,');
    if (/perRecordInk: (true|false),/.test(body)) hits += 1;
    await route.fulfill({ response: res, body: next, headers: { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
  });
  return () => hits;
}

/**
 * 页面里造数并 seed。variant:
 *   'year'  一年量级 300 字 + 本月 200 条（主种子）
 *   'month300' 本月 300 个不同的字各一条（练习记录 300 格变体）
 */
export async function seedPerf(page, variant) {
  const res = await page.evaluate(async ({ variant: v, clock, target, second }) => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    const { allCards, isPracticable } = await import('/src/data/deck.js');
    const { recover, resolveBudgets } = await import('/src/store/budget.js');
    const T = window.__shiziTest;
    T.reset();
    T.setClock(clock);
    const now = T.now();
    const pool = [];
    for (const card of allCards()) {
      const c = card.target || card.char;
      if (c && c !== target && c !== second && isPracticable('base:' + c) && !pool.includes(c)) pool.push(c);
      if (pool.length >= 300) break;
    }
    // 确定性伪随机（mulberry32）
    let seed = 0x5eed;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const makeStrokes = () => {
      const n = 8 + Math.floor(rnd() * 8); // 8–15 笔
      const out = [];
      let t = 0;
      for (let s = 0; s < n; s += 1) {
        const pts = 30 + Math.floor(rnd() * 17);
        const x0 = 40 + rnd() * 260;
        const y0 = 40 + rnd() * 260;
        const ang = rnd() * Math.PI * 2;
        const len = 60 + rnd() * 160;
        const bend = (rnd() - 0.5) * 60;
        const stroke = [];
        for (let k = 0; k < pts; k += 1) {
          const u = k / (pts - 1);
          const x = x0 + Math.cos(ang) * len * u + Math.sin(u * Math.PI) * bend * -Math.sin(ang);
          const y = y0 + Math.sin(ang) * len * u + Math.sin(u * Math.PI) * bend * Math.cos(ang);
          stroke.push({ x: Math.max(1, Math.min(344, x)), y: Math.max(1, Math.min(344, y)), t: Math.round(t) });
          t += 7 + rnd() * 6;
        }
        t += 250;
        out.push(stroke);
      }
      return out;
    };
    const z = n => String(n).padStart(2, '0');
    const events = [];
    if (v === 'year') {
      let k = 0;
      for (let m = 11; m >= 1; m -= 1) {
        const d = new Date(2026, 8 - m, 1);
        const y = d.getFullYear();
        const mo = d.getMonth();
        const days = new Date(y, mo + 1, 0).getDate();
        for (let j = 0; j < 150; j += 1) {
          const day = 1 + Math.floor((j * days) / 150);
          events.push({ c: pool[k % 300], at: new Date(y, mo, day, 9, 0, 0).getTime() + j * 1000 });
          k += 1;
        }
      }
      for (let j = 0; j < 200; j += 1) {
        const day = 1 + Math.floor((j * 24) / 200);
        events.push({ c: pool[(j * 7) % 300], at: new Date(2026, 8, day, 8, 0, 0).getTime() + j * 1000 });
      }
    } else {
      for (let j = 0; j < 300; j += 1) {
        const day = 1 + Math.floor((j * 24) / 300);
        events.push({ c: pool[j], at: new Date(2026, 8, day, 8, 0, 0).getTime() + j * 1000 });
      }
    }
    events.sort((a, b) => a.at - b.at);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = x => x + (n += 1);
    const t0 = performance.now();
    events.forEach((e, i) => {
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + e.c], at: e.at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + e.c, judgment: 'correct', // 全部写对：写错的字不进月字帖（D51 ⑤），这里要 300 个格
        strokes: makeStrokes(), at: e.at, nextId, perRecordInk: true });
      draft.sessions.A = null;
    });
    const buildMs = performance.now() - t0;
    const rec = recover(draft, { now, budgets: resolveBudgets() });
    draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + target, 'base:' + second], at: now - 60000 });
    const r = T.seed(draft);
    const st = T.getState();
    let records = 0;
    for (const list of Object.values(st.records || {})) records += Array.isArray(list) ? list.length : (list.kept || []).length;
    let inks = 0;
    for (const table of Object.values(st.ink || {})) inks += Object.keys(table || {}).length;
    return {
      ok: !!(r && r.ok), r, events: events.length, records, inks, chars: new Set(events.map(e => e.c)).size,
      evicted: rec.actions.filter(a => a.type === 'evictInk').length, folded: rec.actions.filter(a => a.type === 'fold').length,
      buildMs: Math.round(buildMs),
    };
  }, { variant, clock: CLOCK, target: TARGET, second: SECOND });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return res;
}

/** localStorage 全部键的 UTF-16 估算（与 store/budget.js entryBytes 同口径）+ 分桶。 */
export async function storageUsage(page) {
  return page.evaluate(async () => {
    const { bucketOfKey } = await import('/src/store/budget.js');
    let total = 0;
    const byBucket = {};
    let keys = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const raw = localStorage.getItem(key);
      const bytes = (key.length + (raw ? raw.length : 0)) * 2;
      total += bytes;
      keys += 1;
      const b = bucketOfKey(key);
      byBucket[b] = (byBucket[b] || 0) + bytes;
    }
    return { total, byBucket, keys };
  });
}

async function nav(page, method, ...args) {
  await page.evaluate(async ({ m, a }) => {
    const { nav: n } = await import('/src/ui/router.js');
    n[m](...a);
  }, { m: method, a: args });
}

async function goTab(page, tab) {
  await nav(page, 'switchTab', tab);
  await page.waitForFunction(async t => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === t;
  }, tab);
  await waitNavIdle(page, { settleMs: 150 });
}

async function backToDepth(page, depth) {
  for (;;) {
    const d = await page.evaluate(async () => (await import('/src/ui/router.js')).getRouter().getState().depth);
    if (d <= depth) break;
    await nav(page, 'back');
    await page.waitForFunction(async want => (await import('/src/ui/router.js')).getRouter().getState().depth < want, d);
    await waitNavIdle(page, { settleMs: 100 });
  }
}

/**
 * 首屏计时：在页面里执行 nav.<method>(...args)，rAF 轮询到「首屏就绪」，再等这一帧画完（rAF 回调里 post 一条
 * MessageChannel 消息，消息回调在该帧的样式 / 布局 / 绘制之后才跑），返回 nav 动作到此刻的毫秒数。
 * 首屏就绪：顶层图层 containerSel 里有 cellSel 格子，且与视口相交的格子里的笔迹 canvas 都已画好
 * （InkMini 画完会给 canvas 标 data-painted="true"；视口外的笔迹可以晚画）。
 */
export async function timedNav(page, { method, args = [], containerSel, cellSel }) {
  const out = await page.evaluate(async ({ m, a, containerSel: cs, cellSel: cl }) => {
    const { nav: n } = await import('/src/ui/router.js');
    const t0 = performance.now();
    n[m](...a);
    return new Promise(resolve => {
      const done = info => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve({ ...info, ms: performance.now() - t0 });
        ch.port2.postMessage(0);
      };
      const tick = () => {
        const top = document.querySelector('.sz-layer[data-top="true"]');
        const box = top ? top.querySelector(cs) : null;
        const cells = box ? [...box.querySelectorAll(cl)] : [];
        if (cells.length) {
          const h = window.innerHeight;
          const visible = cells.filter(c => {
            const r = c.getBoundingClientRect();
            return r.bottom > 0 && r.top < h;
          });
          const vc = visible.flatMap(c => [...c.querySelectorAll('canvas')]);
          // P1-E2：练习字轮廓（SVG 字形 / 衬底 canvas）也算首屏内容：还在「加载中」的不算就绪
          const glyphWaiting = visible.some(c => c.querySelector('.sz-pg[data-glyph-src="loading"], canvas[data-glyph="loading"]'));
          if (vc.every(c => c.dataset.painted === 'true') && !glyphWaiting) {
            const canvases = box.querySelectorAll('canvas');
            done({ readyMs: performance.now() - t0, cells: cells.length, canvases: canvases.length, visibleCells: visible.length,
              visibleInk: vc.length, painted: box.querySelectorAll('canvas[data-painted="true"]').length });
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, { m: method, a: args, containerSel, cellSel });
  await waitNavIdle(page, { settleMs: 150 });
  return out;
}

async function heapUsed(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize;
}

const fmtMs = ms => `${ms.toFixed(1)}ms`;
const fmtMiB = b => `${(b / MiB).toFixed(3)}MiB`;
const fmtRun = r => `${fmtMs(r.ms)} [ready ${fmtMs(r.readyMs)}; ${r.cells} cells, ${r.visibleCells} in view; ink ${r.painted}/${r.canvases} painted]`;

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const table = [];
  const row = (item, value, limit, pass) => table.push({ item, value, limit, pass: pass ? 'PASS' : 'FAIL' });

  const hits = await injectPerRecordInk(page);
  await bootTestHost(page, ctx.baseURL);
  assert.ok(hits() >= 1, 'policy.js served with perRecordInk injected');
  assert.equal(await page.evaluate(async () => (await import('/src/config/policy.js')).features.perRecordInk), true, 'features.perRecordInk === true in this page');
  const strokeCount = await page.evaluate(async c => (await (await fetch(`/data/${encodeURIComponent(c)}.json`)).json()).strokes.length, TARGET);
  assert.equal(strokeCount, 15, `「${TARGET}」 has 15 strokes`);

  // ------------------------------------------------------------------ 1. 种子与容量
  step('seed: one year, 300 chars, 200 records this month, ink v3 on every record; storage < 3.2MiB');
  const seeded = await seedPerf(page, 'year');
  console.log(`    seed: ${seeded.events} judgments over ${seeded.chars} chars (build ${seeded.buildMs}ms); kept ${seeded.records} records, ${seeded.inks} inks; recover evicted ${seeded.evicted} inks, folded ${seeded.folded} months`);
  assert.equal(seeded.chars, 300, '300 distinct chars');
  assert.equal(seeded.records, seeded.events, 'no records folded within a year (P28 400 days / 1.5MiB)');
  const u0 = await storageUsage(page);
  console.log(`    storage after seed: ${fmtMiB(u0.total)} ${JSON.stringify(Object.fromEntries(Object.entries(u0.byBucket).map(([k, v]) => [k, fmtMiB(v)])))}`);
  row('localStorage 总占用（种子后）', fmtMiB(u0.total), '< 3.2MiB', u0.total < LIMITS.totalBytes);
  row('  其中 records / ink / sched', `${fmtMiB(u0.byBucket.records || 0)} / ${fmtMiB(u0.byBucket.ink || 0)} / ${fmtMiB(u0.byBucket.sched || 0)}`, 'P28 1.5MiB / P05 1.5MiB / —', true);
  // D27（阶段 1 P1-E3）：每字只留第一次 + 最近一次的墨迹（判断时回收中间那次），不必再靠预算回收。
  // 上限 1.2MiB 是 localStorage 时代（5MiB 配额）定的；B1 起数据在 App 的 SQLite，B2.3 起墨迹按记录一行存原始点（ink schema 2），
  // 300 字两份实测约 2.2MiB。新上限 2.4MiB 只防退化（合计仍守 3.2MiB）；全部墨迹历史（D27 修订）待负责人定后再重定。
  const inkBytes0 = u0.byBucket.ink || 0;
  row('  ink：300 字 × 第一次 + 最近一次（D27）', fmtMiB(inkBytes0), '≤ 2.4MiB', inkBytes0 <= 2.4 * MiB);
  assert.ok(seeded.inks <= 2 * seeded.chars, `D27: at most first + latest ink per char (${seeded.inks} inks over ${seeded.chars} chars)`);
  assert.equal(seeded.evicted, 0, 'D27 retention alone keeps ink under the P05 budget: budget recovery evicts nothing');
  assert.ok(inkBytes0 <= 2.4 * MiB, `300 chars × (first + latest) ink = ${fmtMiB(inkBytes0)} ≤ 2.4MiB (ink schema 2 + SQLite, B1/B2.3)`);
  const status0 = await page.evaluate(() => window.__shiziTest.getStatus().usage);
  assert.ok(status0 && Math.abs(status0.total - u0.total) < 1024, `store usage estimate agrees (${status0 && status0.total} vs ${u0.total})`);

  // ------------------------------------------------------------------ 2. 墙首屏
  step('library home first paint (r7-L1 D60: three zone rows with ink-mini samples; the wall itself is on library-all, measured below)');
  await goTab(page, 'home');
  const wallRuns = [];
  for (let k = 0; k < 3; k += 1) {
    wallRuns.push(await timedNav(page, { method: 'switchTab', args: ['library'], containerSel: '[data-testid="library-home"]', cellSel: '[data-testid="library-zone-sample"]' }));
    await goTab(page, 'home');
  }
  const wallMax = Math.max(...wallRuns.map(r => r.ms));
  console.log(`    wall: ${wallRuns.map(r => `${fmtRun(r)}`).join(' / ')}`);
  row('字库首页首屏（字库 tab，3 次最大）', fmtMs(wallMax), '≤ 200ms', wallMax <= LIMITS.firstPaintMs);
  assert.ok(wallRuns[0].canvases > 0, `zone samples draw real ink minis (${wallRuns[0].canvases})`);

  // ------------------------------------------------------------------ 3. 有记录的字完整页首屏
  step('library-all first paint (300 chars, first batch ≤ 72 cells with ink)');
  await goTab(page, 'library');
  const allRuns = [];
  for (let k = 0; k < 3; k += 1) {
    allRuns.push(await timedNav(page, { method: 'push', args: ['library-all', {}], containerSel: '[data-testid="all-body"]', cellSel: '[data-testid="all-cell"]' }));
    await backToDepth(page, 0);
  }
  const allMax = Math.max(...allRuns.map(r => r.ms));
  console.log(`    library-all: ${allRuns.map(r => `${fmtRun(r)}`).join(' / ')}`);
  row('写过的字完整页首屏（3 次最大）', fmtMs(allMax), '≤ 200ms', allMax <= LIMITS.firstPaintMs);
  assert.ok(allRuns[0].canvases > 0, 'library-all draws real ink minis');

  // ------------------------------------------------------------------ 4. 练习记录（本月 200 条）
  step('records (practice log) first paint, this month (200 records)');
  await goTab(page, 'mine');
  const recRuns = [];
  for (let k = 0; k < 3; k += 1) {
    recRuns.push(await timedNav(page, { method: 'push', args: ['records', { month: '2026-09' }], containerSel: '[data-testid="records-sheet"]', cellSel: '[data-testid="records-sheet-cell"]' }));
    await backToDepth(page, 0);
  }
  const recMax = Math.max(...recRuns.map(r => r.ms));
  console.log(`    records (this month): ${recRuns.map(r => `${fmtRun(r)}`).join(' / ')}`);
  row(`练习记录首屏（本月 ${recRuns[0].cells} 格，3 次最大）`, fmtMs(recMax), '≤ 200ms', recMax <= LIMITS.firstPaintMs);

  // ------------------------------------------------------------------ 5. 页面栈 5 层内存
  step('page stack of 5 (lower pages stay mounted): JS heap growth and residual after popping');
  const cdp = await page.context().newCDPSession(page);
  await goTab(page, 'library');
  const base = await heapUsed(cdp);
  const { wrongChar, anyChar } = await page.evaluate(() => {
    const recs = [];
    for (const v of Object.values(window.__shiziTest.getState().records)) recs.push(...(Array.isArray(v) ? v : v.kept || []));
    const w = recs.find(r => r.judgment === 'wrong');
    return { wrongChar: w ? w.char : null, anyChar: recs[0].char };
  });
  const stack = [
    ['library-all', {}],
    ['detail', { char: anyChar }],
    ['library-list', { kind: 'wrong' }],
    ['detail', { char: wrongChar || anyChar }],
    ['records', { month: '2026-09' }],
  ];
  const cycles = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const [name, params] of stack) {
      await nav(page, 'push', name, params);
      await page.waitForFunction(want => {
        const app = document.querySelector('.sz-app');
        return app && app.dataset.topScreen === want;
      }, name);
      await waitNavIdle(page, { settleMs: 200 });
    }
    const depth = await page.evaluate(async () => (await import('/src/ui/router.js')).getRouter().getState().depth);
    const layers = await page.evaluate(() => document.querySelectorAll('.sz-layer').length);
    const peak = await heapUsed(cdp);
    await backToDepth(page, 0);
    const after = await heapUsed(cdp);
    cycles.push({ depth, layers, peak, after });
  }
  const perfMem = await page.evaluate(() => (performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null));
  console.log(`    heap: base ${fmtMiB(base)}; ${cycles.map((c, i) => `cycle ${i + 1}: depth ${c.depth} (${c.layers} layers) peak ${fmtMiB(c.peak)}, after pop ${fmtMiB(c.after)}`).join('; ')}; performance.memory ${perfMem ? fmtMiB(perfMem.used) : 'n/a'}`);
  const growth = Math.max(...cycles.map(c => c.peak)) - base;
  const residual = cycles[cycles.length - 1].after - base;
  const leak = cycles[2].after - cycles[0].after;
  assert.equal(cycles[0].depth, 5, 'stack depth 5 above the tab root');
  row('JS 堆：5 层页面栈相对根页增长', fmtMiB(growth), `≤ ${fmtMiB(LIMITS.heapGrowthBytes)}`, growth <= LIMITS.heapGrowthBytes);
  row('JS 堆：退回根页 GC 后残留', fmtMiB(residual), `≤ ${fmtMiB(LIMITS.heapResidualBytes)}`, residual <= LIMITS.heapResidualBytes);
  row('JS 堆：第 3 轮 − 第 1 轮残留', fmtMiB(leak), `≤ ${fmtMiB(LIMITS.heapLeakBytes)}`, leak <= LIMITS.heapLeakBytes);

  // ------------------------------------------------------------------ 6. 写字页 15 画
  step(`write page: 15 strokes of 「${TARGET}」 — frame pacing, pen-up solidify`);
  await goTab(page, 'home');
  await page.waitForTimeout(PRESS_SETTLE_MS); // 新页面 0.4s 按钮不响应（01 §6.6）
  // 仪表化：pointerup 捕获→冒泡的同步处理（固化层追加一笔）；'write:strokes' commit 的耗时；rAF 帧间隔。
  await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    const store = getStore();
    const perf = { ups: [], commits: [], frames: [], rec: false };
    window.__perf = perf;
    window.addEventListener('pointerup', () => { perf.upStart = perf.rec ? performance.now() : null; }, true);
    window.addEventListener('pointerup', () => {
      if (perf.rec && perf.upStart != null) perf.ups.push({ sync: performance.now() - perf.upStart, t0: perf.upStart });
    }, false);
    const orig = store.commit;
    store.commit = function (label, ...rest) {
      const t = performance.now();
      const r = orig.call(this, label, ...rest);
      perf.commits.push({ label, ms: performance.now() - t, end: performance.now(), ok: !!(r && r.ok) });
      return r;
    };
    const loop = ts => {
      if (perf.rec) perf.frames.push(ts);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.click(tid('write-test-entry'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const box = await page.locator(topSel('write-grid-live')).boundingBox();
  const at = (fx, fy) => [box.x + fx * box.width, box.y + fy * box.height];
  // 15 笔：横、竖、撇、点交替铺满格子；每笔 5 个折点、折点间 10 步鼠标移动（≈ 40 个 pointermove）。
  const strokes = [];
  for (let s = 0; s < 15; s += 1) {
    const r0 = 0.12 + (s % 5) * 0.17;
    const kind = s % 3;
    if (kind === 0) strokes.push([[0.15, r0], [0.35, r0 - 0.01], [0.55, r0], [0.75, r0 + 0.01], [0.86, r0]]);
    else if (kind === 1) strokes.push([[r0, 0.15], [r0 + 0.01, 0.35], [r0, 0.55], [r0 - 0.01, 0.75], [r0, 0.86]]);
    else strokes.push([[0.8 - r0 * 0.5, 0.2], [0.7 - r0 * 0.5, 0.35], [0.6 - r0 * 0.5, 0.5], [0.45 - r0 * 0.5, 0.62], [0.3 - r0 * 0.5 + 0.1, 0.72]]);
  }
  const browser = page.context().browser();
  let traced = false;
  if (browser && typeof browser.startTracing === 'function') {
    try {
      await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] });
      traced = true;
    } catch (error) {
      traced = false;
    }
  }
  await page.evaluate(() => { window.__perf.rec = true; });
  for (const pts of strokes) {
    const [x0, y0] = at(...pts[0]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i += 1) await page.mouse.move(...at(...pts[i]), { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__perf.rec = false; });
  let trace = null;
  if (traced) {
    const buf = await browser.stopTracing();
    try {
      trace = JSON.parse(buf.toString('utf8'));
    } catch (error) {
      trace = null;
    }
  }
  const w = await page.evaluate(() => {
    const p = window.__perf;
    const gaps = [];
    for (let i = 1; i < p.frames.length; i += 1) gaps.push(p.frames[i] - p.frames[i - 1]);
    const strokesCommits = p.commits.filter(c => c.label === 'write:strokes');
    // 每一笔：pointerup 捕获 → 其后第一次 'write:strokes' commit 结束
    const penUp = p.ups.map(u => {
      const c = strokesCommits.find(x => x.end >= u.t0);
      return { sync: u.sync, commit: c ? c.ms : null, total: c ? c.end - u.t0 : null };
    });
    const count = Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount);
    return { gaps, penUp, count, commits: strokesCommits.length };
  });
  assert.equal(w.count, 15, '15 strokes on the grid');
  const avgGap = w.gaps.reduce((a, b) => a + b, 0) / Math.max(1, w.gaps.length);
  const sortedGaps = [...w.gaps].sort((a, b) => a - b);
  const p95Gap = sortedGaps[Math.floor(sortedGaps.length * 0.95)] || 0;
  const maxGap = sortedGaps[sortedGaps.length - 1] || 0;
  console.log(`    frames: ${w.gaps.length} intervals, avg ${fmtMs(avgGap)}, p95 ${fmtMs(p95Gap)}, max ${fmtMs(maxGap)}`);
  row('写字页 15 画：rAF 平均帧间隔', fmtMs(avgGap), `≤ ${fmtMs(LIMITS.frameAvgMs)}`, avgGap <= LIMITS.frameAvgMs);
  row('  p95 / 最大帧间隔', `${fmtMs(p95Gap)} / ${fmtMs(maxGap)}`, '（记录）', true);
  assert.ok(w.gaps.length > 30, `enough frames sampled (${w.gaps.length})`);
  const syncMax = Math.max(...w.penUp.map(x => x.sync));
  const commitMax = Math.max(...w.penUp.map(x => x.commit || 0));
  const totalMax = Math.max(...w.penUp.map(x => x.total || 0));
  console.log(`    pen-up: sync handler max ${fmtMs(syncMax)}, strokes commit max ${fmtMs(commitMax)}, pointerup→commit done max ${fmtMs(totalMax)} (${w.commits} commits)`);
  assert.equal(w.penUp.length, 15, '15 pointerups observed');
  assert.ok(w.penUp.every(x => x.commit !== null), 'every stroke persisted by a write:strokes commit (M1-6)');
  row('抬笔固化：pointerup 同步处理（最大）', fmtMs(syncMax), '≤ 50ms', syncMax <= LIMITS.penUpMs);
  row('抬笔固化：write:strokes 会话写入（最大）', fmtMs(commitMax), '≤ 50ms', commitMax <= LIMITS.penUpMs);
  row('抬笔固化：pointerup → 写入完成（含等下一帧，最大）', fmtMs(totalMax), '≤ 50ms', totalMax <= LIMITS.penUpMs);

  if (trace) {
    const events = Array.isArray(trace) ? trace : trace.traceEvents || [];
    const dur = e => (e.dur || 0) / 1000;
    const fire = events.filter(e => e.name === 'FireAnimationFrame' && e.ph === 'X');
    const moves = events.filter(e => e.name === 'EventDispatch' && e.ph === 'X' && e.args && e.args.data && e.args.data.type === 'pointermove');
    const ups = events.filter(e => e.name === 'EventDispatch' && e.ph === 'X' && e.args && e.args.data && e.args.data.type === 'pointerup');
    const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const mx = xs => (xs.length ? Math.max(...xs) : 0);
    const fireAvg = avg(fire.map(dur));
    const upMax = mx(ups.map(dur));
    console.log(`    trace: FireAnimationFrame ${fire.length} avg ${fmtMs(fireAvg)} max ${fmtMs(mx(fire.map(dur)))}; pointermove ${moves.length} avg ${fmtMs(avg(moves.map(dur)))} max ${fmtMs(mx(moves.map(dur)))}; pointerup ${ups.length} max ${fmtMs(upMax)}`);
    row('trace：FireAnimationFrame 平均 / 最大', `${fmtMs(fireAvg)} / ${fmtMs(mx(fire.map(dur)))}`, `平均 ≤ ${fmtMs(LIMITS.frameAvgMs)}`, fireAvg <= LIMITS.frameAvgMs);
    row('trace：pointerup EventDispatch 最大', fmtMs(upMax), '≤ 50ms', upMax <= LIMITS.penUpMs);
  } else {
    console.log('    trace: browser.startTracing unavailable — NOT-RUN (rAF timing above is the assertion)');
  }

  // 判断一次（记录 + ink + sched + 会话推进，全量状态下最重的一次 commit），之后再量容量。
  step('judge twice on the full state (record + ink + sched + session); storage still < 3.2MiB');
  const judgeOnce = async () => {
    await page.click(topSel('write-done'));
    await page.waitForSelector(topSel('write-compare'));
    await waitNavIdle(page);
    await page.evaluate(() => { window.__perf.commits.length = 0; });
    await page.click(topSel('write-judge-correct'));
    await page.waitForFunction(() => window.__perf.commits.some(c => c.label === 'write:judge'));
    return page.evaluate(() => window.__perf.commits.find(c => c.label === 'write:judge'));
  };
  const judge1 = await judgeOnce();
  assert.ok(judge1.ok, `judgment of 「${TARGET}」 committed`);
  await waitNavIdle(page);
  const [sx, sy] = at(0.2, 0.5);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(...at(0.8, 0.5), { steps: 12 });
  await page.mouse.up();
  const judge2 = await judgeOnce();
  assert.ok(judge2.ok, `judgment of 「${SECOND}」 committed`);
  row('判断 commit 第 1 次（含浏览器首次创建 AudioContext，按键音）', fmtMs(judge1.ms), '（记录）', true);
  row('判断 commit 第 2 次（稳态：记录 + 墨迹 + sched + 会话 + 通知）', fmtMs(judge2.ms), '（记录）', true);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'result');
  await waitNavIdle(page, { settleMs: 200 });
  const u1 = await storageUsage(page);
  console.log(`    judge commits ${fmtMs(judge1.ms)} / ${fmtMs(judge2.ms)}; storage after judging: ${fmtMiB(u1.total)}`);
  row('localStorage 总占用（判断后）', fmtMiB(u1.total), '< 3.2MiB', u1.total < LIMITS.totalBytes);
  assert.ok(!('txn' in u1.byBucket), 'no transaction log left behind');

  // ------------------------------------------------------------------ 7. 练习记录 300 格变体
  step('records (practice log) with 300 cells this month');
  await backToDepth(page, 0);
  await goTab(page, 'mine');
  const seeded300 = await seedPerf(page, 'month300');
  assert.equal(seeded300.chars, 300, '300 distinct chars this month');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const rec300 = [];
  for (let k = 0; k < 3; k += 1) {
    rec300.push(await timedNav(page, { method: 'push', args: ['records', { month: '2026-09' }], containerSel: '[data-testid="records-sheet"]', cellSel: '[data-testid="records-sheet-cell"]' }));
    await backToDepth(page, 0);
  }
  const rec300Max = Math.max(...rec300.map(r => r.ms));
  console.log(`    records 300: ${rec300.map(r => `${fmtRun(r)}`).join(' / ')}`);
  assert.equal(rec300[0].cells, 300, '300 cells in the month sheet (not truncated, P89)');
  row('练习记录首屏（300 格，3 次最大）', fmtMs(rec300Max), '≤ 200ms', rec300Max <= LIMITS.firstPaintMs);
  const u2 = await storageUsage(page);
  row('localStorage 总占用（300 格变体）', fmtMiB(u2.total), '< 3.2MiB', u2.total < LIMITS.totalBytes);

  // ------------------------------------------------------------------ 8. 练习字轮廓首屏（P1-E2）
  step('no-ink cells are outlines (P1-E2): wall and month sheet, ~70 chars with no ink, cold stroke cache');
  await goTab(page, 'home');
  const outlineSeed = await page.evaluate(async ({ clock }) => {
    const chars = [...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什写相'].slice(0, 72);
    const records = {};
    chars.forEach((c, i) => {
      const day = `2026-09-${String(1 + (i % 20)).padStart(2, '0')}`;
      const at = new Date(`${day}T08:00:00`).getTime() + i * 1000;
      (records['2026-09'] || (records['2026-09'] = [])).push({ id: `r${i + 1}`, cardKey: `base:${c}`, char: c, sessionId: 's901', kind: 'judged', judgment: 'correct', at, localDay: day, help: { hints: 0, answerSeen: false, traced: false } });
    });
    window.__shiziTest.reset();
    window.__shiziTest.setClock(clock);
    const r = window.__shiziTest.seed({ records });
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: !!(r && r.ok), n: chars.length, r: JSON.stringify(r).slice(0, 300) };
  }, { clock: CLOCK });
  assert.ok(outlineSeed.ok && outlineSeed.n >= 60, `seeded ${outlineSeed.n} no-ink records ${outlineSeed.r}`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const coldWall = [];
  const coldMonth = [];
  for (let k = 0; k < 3; k += 1) {
    await page.evaluate(async () => (await import('/src/data/strokes.js')).getStrokesLoader().clear());
    coldWall.push(await timedNav(page, { method: 'push', args: ['library-all', { sort: 'age' }], containerSel: '[data-testid="all-body"]', cellSel: '[data-testid="all-cell"]' }));
    await backToDepth(page, 0);
    await goTab(page, 'home');
  }
  await goTab(page, 'mine');
  for (let k = 0; k < 3; k += 1) {
    await page.evaluate(async () => (await import('/src/data/strokes.js')).getStrokesLoader().clear());
    coldMonth.push(await timedNav(page, { method: 'push', args: ['records', { month: '2026-09' }], containerSel: '[data-testid="records-sheet"]', cellSel: '[data-testid="records-sheet-cell"]' }));
    await backToDepth(page, 0);
  }
  const outlineGlyphs = await page.evaluate(async () => {
    const { nav: n } = await import('/src/ui/router.js');
    n.switchTab('library');
    await new Promise(r => setTimeout(r, 500));
    n.push('library-all', { sort: 'age' });
    await new Promise(r => setTimeout(r, 800));
    return [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="all-cell"] .sz-pg')].map(g => g.dataset.glyphSrc);
  });
  const coldWallMax = Math.max(...coldWall.map(r => r.ms));
  const coldMonthMax = Math.max(...coldMonth.map(r => r.ms));
  console.log(`    wall (~70 outline cells, cold): ${coldWall.map(r => fmtMs(r.ms)).join(' / ')}; month sheet (~70 under outlines, cold): ${coldMonth.map(r => fmtMs(r.ms)).join(' / ')}`);
  assert.ok(outlineGlyphs.length >= 60 && outlineGlyphs.every(x => x === 'outline'), `wall glyph cells are outlines (${outlineGlyphs.length})`);
  row('墙首屏（约 70 个无笔迹字轮廓，冷笔顺缓存，3 次最大）', fmtMs(coldWallMax), '≤ 200ms', coldWallMax <= LIMITS.firstPaintMs);
  row('练习记录首屏（约 70 个无笔迹衬底轮廓，冷缓存，3 次最大）', fmtMs(coldMonthMax), '≤ 200ms', coldMonthMax <= LIMITS.firstPaintMs);
  await backToDepth(page, 0);
  await goTab(page, 'home');

  // 参考：CDP CPU 4× 降速（粗略模拟中端手机主线程；不作断言，真机数字见 M7）。
  step('reference only: the same first paints under CDP CPU throttling 4×');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slowRec = await timedNav(page, { method: 'push', args: ['records', { month: '2026-09' }], containerSel: '[data-testid="records-sheet"]', cellSel: '[data-testid="records-sheet-cell"]' });
  await backToDepth(page, 0);
  await goTab(page, 'home');
  const slowWall = await timedNav(page, { method: 'switchTab', args: ['library'], containerSel: '[data-testid="library-home"]', cellSel: '[data-testid="library-zone-sample"]' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`    CPU 4×: records 300 ${fmtRun(slowRec)}; wall ${fmtRun(slowWall)}`);
  row('参考 CPU 4×：练习记录 300 格 / 墙首屏', `${fmtMs(slowRec.ms)} / ${fmtMs(slowWall.ms)}`, '（记录，不断言）', true);

  // ------------------------------------------------------------------ 数字表
  console.log('\n    | 项 | 实测 | 阈值 | 结论 |');
  console.log('    |---|---|---|---|');
  for (const r of table) console.log(`    | ${r.item} | ${r.value} | ${r.limit} | ${r.pass} |`);
  console.log('');
  for (const r of table) assert.ok(r.pass === 'PASS', `${r.item.trim()}: ${r.value} (${r.limit})`);
}
