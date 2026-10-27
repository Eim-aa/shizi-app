// B3.5b 字库首页（tab 根页）的 App API 契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.library = 网页页面渲染用的同一份数据（libraryPageView）：文案引用渲染出来与网页页面一字不差，区行 / 样字 / 路由与网页一致，样字墨迹进视图；
//   2. library.startToday = 网页字库页的 startToday（首页主按钮在该状态下的同一动作）：整份 store deepEqual、commit 序列相同、路由栈相同；
//      D07：写失败回 {ok:false, error:{kind}}、store 不动，重试只记一次；
//   3. 离开撤销条：view.library 带着交过来的那一次机会，library.undoLeave / undoLeaveCancel 与网页同一批函数（stale 时回 stale）；
//   4. 原生一侧：Screens/Library.swift 的类名与 native:true 对上、原生源码没有汉字字面量、6 个字库夹具改了 native:true 并在造完数据后重新挂载根页（B3.5d 起根页常开）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStorage, inkEntry } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { createRouter, setActiveRouter, nav, getScreen } from '../../src/ui/router.js';
import { setClockOverride } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { libraryActions } from '../../src/session/api/library.js';
import * as views from '../../src/session/views/library.js';
import { inkParams } from '../../src/core/ink-math.js';
import { renderRefs, t } from '../../src/config/copy/index.js';
import { deckAdapter } from '../../src/data/deck.js';
import * as policy from '../../src/config/policy.js';
import { startToday } from '../../src/ui/screens/home/index.js';
import { LIBRARY_ROUTES, LIBRARY_TODAY_SOURCE, libraryName, todayTexts } from '../../src/ui/screens/library/index.js';
import { normalizeKind } from '../../src/session/views/library-list.js';
import { handoffLeaveUndo, clearLeaveUndo, undoLeave } from '../../src/ui/screens/write/skip.js';
import { commitSkip } from '../../src/session/ops/skip.js';
import { currentCardKey } from '../../src/core/sessions.js';
import { ROOT } from '../core/helpers.mjs';

const TODAY = '2026-10-22';
const NOW = new Date(`${TODAY}T09:00:00`).getTime();
// 两条路径（网页函数 / App API）各自 boot 一次，两次之间真实时钟会走过一两毫秒：会话里的 updatedAt 差 1ms——那是时钟噪声，不是两条路径的差别。
// 把 Date.now 冻在同一个瞬间（只在本文件里冻：node --test 每个文件一个进程）。
const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;
const at = day => new Date(`${day}T09:00:00`).getTime();
const rec = (n, char, judgment, day = '2026-10-01', extra = {}) => ({
  id: `r${n}`, cardKey: `base:${char}`, char, sessionId: 's9', kind: 'judged', judgment, at: at(day), localDay: day, help: { hints: 0, answerSeen: false, traced: false }, ...extra,
});
const sched = (due, stability, reps = 5, lapses = 0) => ({ fsrs: { stability, reps, lapses }, due, lastJudgedAt: 0 });

function stateOf(rows, schedMap = {}, extra = {}) {
  const records = {};
  for (const r of rows) (records[r.localDay.slice(0, 7)] || (records[r.localDay.slice(0, 7)] = [])).push(r);
  return { records, sched: schedMap, sessions: { A: null, B: null, lastEnded: {} }, settings: {}, custom: { added: [] }, ...extra };
}

// 两条路径（网页函数 / App API）各自 boot 一次：整份 store、commit 序列、路由栈逐项相同。
function boot(seed) {
  setClockOverride('2026-10-22T09:00:00');
  let storage = null;
  const { store } = bootStore({ backend: new MemoryStorage(), onStorage: s => { storage = s; } });
  if (seed) seed(store);
  const history = { state: null, pushState(s) { this.state = s; }, replaceState(s) { this.state = s; }, back() {}, go() {} };
  const router = createRouter({ history, setTimeout: () => 0, clearTimeout: () => {} });
  setActiveRouter(router);
  router.start({ defaultTab: 'home' });
  const labels = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
  const api = createAppApi({ getStore: () => store, nav });
  return { store, storage, router, api, labels };
}

const names = r => r.getState().stack.map(e => e.n);

function samePaths(seed, web, op, args = {}) {
  const a = boot(seed);
  const rWeb = web();
  const webOut = { state: a.store.getState(), labels: a.labels, stack: names(a.router) };
  const b = boot(seed);
  const rApi = b.api.call(op, args);
  assert.deepEqual(rApi, rWeb, `${op}: same reply`);
  assert.deepEqual(b.store.getState(), webOut.state, `${op}: whole store deepEqual`);
  assert.deepEqual(b.labels, webOut.labels, `${op}: same commit sequence`);
  assert.deepEqual(names(b.router), webOut.stack, `${op}: same route`);
  return { web: webOut, api: b, reply: rApi };
}

test('B3.5b view.library = the web library page model; the rendered words are exactly the web page\'s', () => {
  const rows = [rec(1, '永', 'wrong'), rec(2, '和', 'correct', '2026-09-01'), rec(3, '春', 'correct', '2026-08-01'), rec(4, '日', 'correct', '2026-08-02')];
  const state = stateOf(rows, { 'base:和': sched('2026-11-30', 10), 'base:春': sched('2026-12-30', 60), 'base:日': sched('2026-12-30', 60) });
  const store = { getState: () => state, getInk: record => (record.char === '和' ? inkEntry(6, 2) : null) };
  const api = createAppApi({ getStore: () => store });
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const r = api.call('view.library');
    assert.equal(r.ok, true);
    const view = r.view;
    const direct = views.libraryPageView(state, NOW, { today: TODAY, deck: deckAdapter, getInk: store.getInk });
    assert.deepEqual(view, direct, 'same function');
    // 文案：引用渲染 = 网页页面的字
    const text = renderRefs(view);
    assert.equal(text.title, t('X-TABS.library'));
    assert.equal(text.search.placeholder, t('X-LIBFOUR.searchPlaceholder'));
    assert.equal(text.range.label, t('R-S01.library'));
    assert.equal(text.range.value, libraryName(view.range.libraryId));
    const plan = views.todayPlanModel(state, NOW, { deck: deckAdapter });
    assert.equal(text.todayRow.value, todayTexts(plan).value);
    assert.equal(text.todayRow.sub || '', todayTexts(plan).sub);
    assert.equal(view.todayRow.phase, plan.phase);
    assert.equal(view.todayRow.n, plan.n);
    assert.equal(text.written.heading, t('X-LIBFOUR.writtenHeading'));
    assert.equal(text.written.all, t('X-LIBFOUR.writtenAll'));
    assert.equal(text.written.allAria, t('X-LIBFOUR.writtenAllAria'));
    // 区行：名称 / 数 / 样字（最多三个、本人墨档位）与网页同一个 memoryZones / skippedZone
    const mem = views.memoryZones(state, TODAY);
    assert.equal(view.recorded, mem.recorded);
    assert.equal(view.state, 'records');
    assert.deepEqual(view.zones.map(z => z.kind), [...views.MEMORY_ZONES]);
    for (const z of view.zones) {
      assert.equal(z.n, mem.zones[z.kind].n);
      assert.equal(renderRefs(z.name), t(`X-LIBFOUR.zone.${z.kind}`));
      assert.deepEqual(z.samples.map(s => [s.char, s.tone]), views.zoneSamples(mem.zones[z.kind]).map(c => [c.char, c.tone]));
      assert.deepEqual(z.to, z.n ? { screen: LIBRARY_ROUTES.list, params: { kind: normalizeKind(z.kind) } } : null, '0 个字的行不可点');
    }
    assert.equal(view.skipped.kind, 'skipped');
    assert.equal(renderRefs(view.skipped.name), t('X-LIBFOUR.zone.skipped'));
    // 路由名与网页 LIBRARY_ROUTES 一致
    assert.equal(view.written.to.screen, LIBRARY_ROUTES.all);
    assert.equal(view.range.to.screen, LIBRARY_ROUTES.switch);
    assert.equal(views.LIBRARY_PAGE_ROUTES.list, LIBRARY_ROUTES.list);
    for (const name of Object.values(views.LIBRARY_PAGE_ROUTES)) assert.ok(getScreen(name), `${name} is a registered screen`);
    // 样字墨迹：逐判断笔迹打开且存下了墨迹才带笔画（紧凑数组 [x,y,t,p?]），否则 null（原生画标准字形）
    const withInk = view.zones.flatMap(z => z.samples).filter(s => s.strokes);
    assert.deepEqual(withInk.map(s => s.char), ['和']);
    assert.equal(withInk[0].strokes.length, 2);
    assert.deepEqual(view.ink, inkParams(policy), 'cold-launch sample replay carries the complete brush table without opening write');
    assert.ok(withInk[0].strokes.every(s => s.every(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite))));
    assert.equal(views.sampleStrokes(rows[0], store.getInk), null);
    assert.equal(views.sampleStrokes(rows[1], store.getInk, { ...policy, features: { ...policy.features, perRecordInk: false } }), null);
    // 样字格尺寸：34 pt，墨迹卡内缩 4%，小格抬到最小物理线宽（网页 InkMini minInkScale）
    assert.equal(view.sample.side, 34);
    assert.ok(Math.abs(view.sample.inkSide - 34 * 0.92) < 1e-9);
    assert.ok(view.sample.inkScale >= 1);
  } finally {
    Date.now = () => FROZEN_NOW;
  }
});

test('B3.5b view.library: an empty library = state empty, three zones 0 and not tappable; refs only, no sentences', () => {
  const state = stateOf([]);
  const view = views.libraryPageView(state, NOW, { today: TODAY, deck: deckAdapter, getInk: () => null });
  assert.equal(view.state, 'empty');
  assert.equal(view.recorded, 0);
  assert.ok(view.zones.every(z => z.n === 0 && z.to === null && z.samples.length === 0));
  assert.equal(view.skipped.n, 0);
  const walk = o => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if (typeof o.copy === 'string') return;
      for (const v of Object.values(o)) walk(v);
    } else if (Array.isArray(o)) o.forEach(walk);
    else if (typeof o === 'string') assert.ok(/^(empty|records|fresh|half|done|due|shaky|known|skipped|library-.*|\d{4}-\d{2}-\d{2}|[a-z0-9]+)$/i.test(o), `no sentence in the view: ${o}`);
  };
  walk(view);
});

test('B3.5b library.startToday = the web startToday: same store, same commits, same route (first → start, again → resume)', () => {
  const run = mode => {
    const { store, labels, router, api } = boot();
    const out = [];
    for (let i = 0; i < 2; i += 1) {
      if (mode === 'web') {
        const r = startToday({ source: LIBRARY_TODAY_SOURCE });
        out.push({ ok: r.ok !== false, opened: r.opened || null });
      } else {
        const r = api.call('library.startToday');
        out.push({ ok: r.ok !== false, opened: r.opened || null });
      }
    }
    return { state: store.getState(), labels, stack: names(router), out };
  };
  const web = run('web');
  const viaApi = run('api');
  assert.deepEqual(viaApi.out, web.out);
  assert.deepEqual(viaApi.out.map(o => o.opened), ['new', 'resume']);
  assert.deepEqual(viaApi.labels, web.labels);
  assert.deepEqual(viaApi.stack, web.stack);
  assert.deepEqual(viaApi.state, web.state, 'whole store deepEqual');
  assert.equal(web.state.sessions.A.source.view, 'library', 'the group knows it came from the library (the result page leaves back to it)');
});

test('B3.5b library.startToday D07: a failed start returns {ok:false, error:{kind}}, the store does not move, the retry commits once', () => {
  const { api, store, storage, labels } = boot();
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('library.startToday');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
  const again = api.call('library.startToday');
  assert.equal(again.ok, true);
  assert.equal(labels.length, 1, 'one commit for the retry');
});

test('B3.5b leave undo: view.library carries the handed-over chance; library.undoLeave is the web function (stale when it is gone)', () => {
  const { api, store } = boot();
  handoffLeaveUndo({ slot: 'A', sessionId: 's', recordId: 'r', char: '永', strokes: [], until: 1e15, failed: false });
  const v = api.call('view.library').view;
  assert.equal(v.leaveUndo.char, '永');
  assert.equal(renderRefs(v.leaveUndo.text), t('R-W20.skippedToast', { char: '永' }));
  assert.ok(v.leaveUndo.remainingMs > 0);
  clearLeaveUndo();
  assert.equal(api.call('view.library').view.leaveUndo, null);
  assert.deepEqual(api.call('library.undoLeave'), { ok: false, error: { kind: 'stale' } });
});

test('B3.5b leave undo: the native undo and the web undo do the same thing (one commit, same store)', () => {
  const run = mode => {
    const { store, router, api, labels } = boot();
    const calls = [];
    const realPush = router.push.bind(router);
    router.push = (n, p) => { calls.push([n, p]); return realPush(n, p); };
    api.call('library.startToday');
    const session = store.getState().sessions.A;
    const skipped = commitSkip(store, { slot: 'A', cardKey: currentCardKey(session) });
    assert.equal(skipped.ok, true);
    handoffLeaveUndo({ slot: 'A', sessionId: session.id, recordId: skipped.record.id, char: skipped.record.char, strokes: [], until: 1e15, failed: false });
    const before = structuredClone(store.getState());
    const commit = store.commit.bind(store);
    store.commit = () => ({ ok: false, error: { kind: 'generic' } });
    const act = () => (mode === 'web' ? undoLeave(slot => router.push('write', { slot })) : api.call('library.undoLeave'));
    assert.equal(act().ok, false, 'a failed save stays in place');
    assert.deepEqual(store.getState(), before);
    assert.equal(api.call('view.library').view.leaveUndo.failed, true);
    store.commit = commit;
    labels.length = 0;
    assert.equal(act().ok, true);
    assert.equal(api.call('view.library').view.leaveUndo, null);
    return { state: store.getState(), calls, labels: [...labels] };
  };
  const web = run('web');
  const native = run('native');
  assert.deepEqual(native, web);
  assert.equal(native.labels.length, 1);
});

test('B3.5b the web library page registers its actions for the App API (native:true + the same functions)', () => {
  const actions = libraryActions();
  assert.ok(actions, 'the library page registered its actions');
  for (const name of ['startToday', 'openQuery', 'undoLeave', 'undoLeaveCancel', 'ui']) {
    assert.equal(typeof actions[name], 'function', name);
  }
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/library/index.js'), 'utf8');
  assert.match(src, /registerScreen\(LIBRARY_TAB, LibraryScreen, \{[^}]*native: true[^}]*\}\)/);
  assert.match(src, /setLibraryActions\(\{/);
  // 原生源码没有汉字字面量（注释除外；test/ios-shizikit.test.mjs 也扫全部原生文件）
  const swift = fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/Screens/Library.swift'), 'utf8');
  assert.match(swift, /@objc\(ShiziScreen_library\)\s*\nfinal class LibraryScreen: ShiziScreenViewController, ShiziRootProbing/);
  const code = swift.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.equal(/[一-鿿]/.test(code), false, 'no Chinese literals in the native page');
});

test('B3.5b fixtures: the six library states are native and open the native root; the write failure is armed for both sides', () => {
  const dir = path.join(ROOT, 'ios/ShiziApp/ShiziUITests/States');
  for (const st of ['library-empty', 'library-records', 'library-half', 'library-done', 'library-today-fail', 'library-leave-undo']) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, `${st}.json`), 'utf8'));
    assert.equal(fx.native, true, st);
    assert.equal(fx.ready.native, 'id:native-library-screen', st);
    const ops = fx.setup.map(s => s.op);
    // B3.5d：根页常开，夹具只在造完数据后重新挂载根页（switchTab remount，取代 B3.5a 的 nativeRoots 闸 op）
    const roots = fx.setup.findIndex(s => s.op === 'switchTab' && s.remount === true);
    assert.ok(roots >= 0, `${st}: remount the root`);
    assert.equal(fx.setup[roots].tab, 'library', `${st}: the native root is the library tab`);
    assert.ok(roots > ops.lastIndexOf('seed'), `${st}: remount after the data is seeded`);
    assert.equal(ops.includes('nativeRoots'), false, `${st}: no root gate op`);
  }
  const fail = JSON.parse(fs.readFileSync(path.join(dir, 'library-today-fail.json'), 'utf8'));
  assert.equal(fail.failNext, 1, 'the write failure is armed for the web and the native alike');
  assert.equal(fail.steps.find(s => s.tap).tap.native, 'native-library-today');
  const leave = JSON.parse(fs.readFileSync(path.join(dir, 'library-leave-undo.json'), 'utf8'));
  const taps = leave.steps.filter(s => s.tap).map(s => s.tap.native);
  assert.deepEqual(taps, ['native-library-today', 'native-write-skip', 'native-write-back']);
  assert.equal(fs.existsSync(path.join(dir, '_ops/nativeRoots.js')), false, 'B3.5d: the root gate op is gone');
});
