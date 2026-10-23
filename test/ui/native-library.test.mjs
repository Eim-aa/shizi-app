// B3.5b 字库首页（tab 根页）的 App API 契约：网页路径 == API 路径。
//   1. view.library = 网页页面渲染用的同一份数据（libraryPageView）：文案引用渲染出来与网页页面一字不差，区行 / 样字 / 路由与网页一致，样字墨迹进视图；
//   2. library.startToday = 网页 startToday（首页主按钮在该状态下的同一动作）：整份 store deepEqual、commit 序列相同、导航相同（开写字页 / 没字页）；
//      D07：提交失败不动（store 不变）、{ok:false} 原样回；重试只记一次；
//   3. 原生类 Library.swift：native:true ⇔ @objc(ShiziScreen_library)、root-pending 标记、搜索框 op、夹具与键。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFSRSGlobal, ROOT } from '../core/helpers.mjs';
import { MemoryStorage, inkEntry } from '../store/helpers.mjs';
import { createAppApi } from '../../src/session/api/index.js';
import { startTodayWith } from '../../src/session/api/library.js';
import * as views from '../../src/session/views/library.js';
import { renderRefs, t } from '../../src/config/copy/index.js';
import { bootStore } from '../../src/store/store.js';
import { setActiveRouter, getScreen } from '../../src/ui/router.js';
import { startToday } from '../../src/ui/screens/home/index.js';
import { LIBRARY_ROUTES, LIBRARY_TODAY_SOURCE, libraryName, todayTexts } from '../../src/ui/screens/library/index.js';
import { registerStageOp, stageCall } from '../../src/ui/native-stage.js';
import { normalizeKind } from '../../src/session/views/library-list.js';
import { deckAdapter } from '../../src/data/deck.js';
import * as policy from '../../src/config/policy.js';

loadFSRSGlobal();

const TODAY = '2026-10-22';
const NOW = new Date(`${TODAY}T09:00:00`).getTime();
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

test('B3.5b view.library = libraryPageView (web path == API path); texts render exactly as the web page renders them', () => {
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
    assert.deepEqual(view, direct);
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
    assert.ok(withInk[0].strokes.every(s => s.every(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite))));
    assert.equal(views.sampleStrokes(rows[0], store.getInk), null);
    assert.equal(views.sampleStrokes(rows[1], store.getInk, { ...policy, features: { ...policy.features, perRecordInk: false } }), null);
    // 样字格尺寸：34 pt，墨迹卡内缩 4%，小格抬到最小物理线宽（网页 InkMini minInkScale）
    assert.equal(view.sample.side, 34);
    assert.ok(Math.abs(view.sample.inkSide - 34 * 0.92) < 1e-9);
    assert.ok(view.sample.inkScale >= 1);
  } finally {
    Date.now = realNow;
  }
});

test('B3.5b view.library: empty library (no record) = state empty, three zones 0 and not tappable; refs only, no sentences', () => {
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
    else if (typeof o === 'string') assert.ok(/^[0-9-]*$|^(empty|records|fresh|half|done|due|shaky|known|skipped|library-.*|[a-z0-9]+)$/i.test(o), `no sentence in the view: ${o}`);
  };
  walk(view);
});

// ---------------------------------------------------------------- library.startToday

function fakeRouter() {
  const calls = [];
  const router = { push: (n, p) => calls.push(['push', n, p]), getState: () => ({ stack: [], top: null, depth: 0, topIsOverlay: false }) };
  return { calls, router };
}

function boot() {
  const { store } = bootStore({ backend: new MemoryStorage() });
  return store;
}

async function pinned(fn) {
  const realNow = Date.now;
  let k = 0;
  Date.now = () => new Date(`${TODAY}T20:00:00`).getTime() + (k += 5);
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}

test('B3.5b library.startToday = the web startToday: same store, same commits, same navigation (first visit → start; again → resume)', async () => {
  const run = async mode => {
    const store = boot();
    const labels = [];
    store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
    const { calls, router } = fakeRouter();
    setActiveRouter(router);
    const out = [];
    for (let i = 0; i < 2; i += 1) {
      if (mode === 'web') {
        const r = startToday({ source: LIBRARY_TODAY_SOURCE });
        out.push({ ok: r.ok !== false, opened: r.opened || null });
      } else {
        const api = createAppApi({ getStore: () => store, nav: router });
        const r = api.call('library.startToday');
        out.push({ ok: r.ok !== false, opened: r.opened || null });
      }
    }
    setActiveRouter(null);
    return { state: store.getState(), labels, calls, out };
  };
  const web = await pinned(() => run('web'));
  const viaApi = await pinned(() => run('api'));
  assert.deepEqual(viaApi.out, web.out);
  assert.deepEqual(viaApi.out.map(o => o.opened), ['new', 'resume']);
  assert.deepEqual(viaApi.labels, web.labels);
  assert.deepEqual(viaApi.calls, web.calls);
  assert.deepEqual(viaApi.calls.map(c => c[1]), ['write', 'write']);
  assert.deepEqual(viaApi.state, web.state, 'whole store deepEqual');
  assert.equal(web.state.sessions.A.source.view, 'library', 'the group knows it came from the library (result page leaves back to it)');
});

test('B3.5b library.startToday D07: a failed commit leaves the store untouched, comes back as {ok:false}, no navigation; the retry records once', async () => {
  await pinned(async () => {
    const store = boot();
    const before = JSON.stringify(store.getState());
    const { calls, router } = fakeRouter();
    const api = createAppApi({ getStore: () => store, nav: router });
    const real = store.commit.bind(store);
    store.commit = () => ({ ok: false, error: { kind: 'generic' } });
    const failed = api.call('library.startToday');
    assert.equal(failed.ok, false);
    assert.equal(failed.error.kind, 'generic');
    assert.equal(JSON.stringify(store.getState()), before, 'nothing moved');
    assert.deepEqual(calls, [], 'no page opened');
    store.commit = real;
    const retry = api.call('library.startToday');
    assert.equal(retry.ok, true);
    assert.equal(retry.opened, 'new');
    assert.equal(calls.length, 1);
    assert.equal(store.getState().sessions.A.queue.length > 0, true);
    // 同一个函数直接调：失败形状与网页 startToday 一致
    const twin = boot();
    twin.commit = () => ({ ok: false, error: { kind: 'generic' } });
    assert.equal(startTodayWith({ store: twin, nav: router }).ok, false);
  });
});

test('B3.5b library.startToday without a router is an error reply, not a crash', () => {
  const api = createAppApi({ getStore: () => boot() });
  const r = api.call('library.startToday');
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'exception');
});

// ---------------------------------------------------------------- 原生一侧

test('B3.5b stage ops: the library page registers its own UI op (search box → web query sheet until B3.6), stageCall routes it', () => {
  registerStageOp('b35b.test', args => ({ ok: true, echo: args.x }));
  assert.deepEqual(stageCall('b35b.test', { x: 7 }), { ok: true, echo: 7 });
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/library/index.js'), 'utf8');
  assert.match(src, /registerStageOp\('library\.openQuery'/);
  assert.match(src, /registerScreen\(LIBRARY_TAB, LibraryScreen, \{[^}]*native: true[^}]*\}\)/);
});

test('B3.5b Library.swift: root-pending class, the Swift registry hides pending roots unless -shizi-native-roots, no Hanzi literals', () => {
  const swift = fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/Screens/Library.swift'), 'utf8');
  assert.match(swift, /@objc\(ShiziScreen_library\)\s*\nfinal class LibraryScreen: ShiziScreenViewController/);
  assert.match(swift, /override class var rootPending: Bool \{ true \}/);
  const stage = fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/NativeStage.swift'), 'utf8');
  assert.match(stage, /!cls\.rootPending \|\| UserDefaults\.standard\.bool\(forKey: "shizi-native-roots"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/ShiziKit/ShiziScreen.swift'), 'utf8'), /class var rootPending: Bool \{ false \}/);
  // 原生源码没有汉字字面量（注释除外；test/ios-shizikit.test.mjs 也扫全部原生文件）
  const code = swift.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
  assert.equal(/[一-鿿]/.test(code), false);
});

test('B3.5b fixtures: the five library states are native and each opens the native root before switching to the tab; leave-undo stays reference-only', () => {
  const dir = path.join(ROOT, 'ios/ShiziApp/ShiziUITests/States');
  for (const st of ['library-empty', 'library-records', 'library-half', 'library-done', 'library-today-fail']) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, `${st}.json`), 'utf8'));
    assert.equal(fx.native, true, st);
    assert.equal(fx.ready.native, 'id:native-library-screen', st);
    const ops = fx.setup.map(s => s.op);
    assert.ok(ops.indexOf('nativeRoots') >= 0 && ops.indexOf('nativeRoots') < ops.lastIndexOf('switchTab'), `${st}: nativeRoots before the final switchTab`);
  }
  const fail = JSON.parse(fs.readFileSync(path.join(dir, 'library-today-fail.json'), 'utf8'));
  assert.equal(fail.failNext, 1);
  assert.equal(fail.steps.find(s => s.tap).tap.native, 'native-library-today');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'library-leave-undo.json'), 'utf8')).native, false);
  assert.ok(fs.existsSync(path.join(dir, '_ops/nativeRoots.js')));
});
