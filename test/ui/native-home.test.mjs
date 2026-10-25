// B3.5a 原生首页的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.home = 网页首页渲染用的同一个 homeModel + 同一组派生（homeCtaKey / ctaAria / progressText / resumeLine* / homeNoteOf），渲染出的字一字不差；
//   2. 写入 op（home.start / resumeOther / deferSpecial）调的是网页首页同一个函数：同一组输入分别走两条路，整份 store deepEqual、commit 序列相同、路由栈相同；
//   3. D07：写失败回 {ok:false, error:{kind}}、store 不动，重试只记一次；stale：撤销机会已没有时 home.undoLeave 回 stale；
//   4. D62：原生主按钮的真实矩形记成写字页 T-paper 的来源，返回时纸缩回原生报的「此刻」矩形；
//   5. tab 根页的闸：原生有类也要 __shiziNativeRoots 才显示（B3.5d 与 Tab 栏同开）；根页被网页页面 / 弹层盖住时让开。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { createRouter, setActiveRouter, nav, registerScreen, unregisterScreen } from '../../src/ui/router.js';
import { setClockOverride, now as envNow } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { homeActions, replyOf } from '../../src/session/api/home.js';
import { homeModel, homeView, homeCtaKey, ctaAria, progressText, homeNoteOf, resumeLineText, resumeLineAria } from '../../src/session/views/home.js';
import { renderRefs, tRef, t } from '../../src/config/copy/index.js';
import { deckAdapter } from '../../src/data/deck.js';
import * as home from '../../src/ui/screens/home/index.js';
import { handoffLeaveUndo, clearLeaveUndo } from '../../src/ui/screens/write/skip.js';
import { planPaper, nativeBackPlan, setNativeLiveSource, resetPaperSources } from '../../src/ui/paper-transition.js';
import { nativeScreenOn, rootCovered, isRootEntry } from '../../src/ui/native-stage.js';

const NOW = '2026-10-05T19:30:00';

// 两条路径（网页函数 / App API）各自 boot 一次，两次之间真实时钟会走过一两毫秒：platform/env.js 的 setClockOverride 是「平移」不是「冻结」，
// 于是会话里的 startedAt / updatedAt 差 1ms——那是时钟噪声，不是两条路径的差别。把 Date.now 冻在同一个瞬间，两条路径的会话时刻就逐字相同
// （其余字段仍然整份 deepEqual，不放宽任何别的断言）。只在本文件里冻：node --test 每个文件一个进程。
const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;

/** 一套干净的 store + 路由（每条路径各一套，同一时钟）。 */
function boot(seed) {
  setClockOverride(NOW);
  resetPaperSources();
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

/** 两条路径各跑一遍，比整份 store、commit 序列、路由栈。 */
function samePaths(seed, web, op, args = {}) {
  const a = boot(seed);
  const rWeb = replyOf(web());
  const webOut = { state: a.store.getState(), labels: a.labels, stack: names(a.router) };
  const b = boot(seed);
  const rApi = b.api.call(op, args);
  assert.deepEqual(rApi, rWeb, `${op}: same reply`);
  assert.deepEqual(b.store.getState(), webOut.state, `${op}: whole store deepEqual`);
  assert.deepEqual(b.labels, webOut.labels, `${op}: same commit sequence`);
  assert.deepEqual(names(b.router), webOut.stack, `${op}: same route`);
  return { web: webOut, api: b, reply: rApi };
}

test('B3.5a view.home = the web home model and derivations, rendered word for word', () => {
  const { api, store } = boot();
  const v = api.call('view.home').view;
  assert.deepEqual(v, homeView(store.getState(), envNow(), { deck: deckAdapter, ui: homeActions().ui() }), 'same function');
  const model = homeModel(store.getState(), envNow(), { deck: deckAdapter });
  assert.equal(v.view, model.view);
  assert.equal(tRef(v.cta.label), t(homeCtaKey(model)));
  assert.equal(tRef(v.cta.aria), ctaAria(model, t));
  assert.equal(tRef(v.date), t('R-H02.line', { date: t('R-H02.dateFormat', model.dateParts), period: t(`R-H02.period.${model.period}`) }));
  assert.deepEqual(renderRefs(v.motto), [t('X-HOME.mottoLine1'), t('X-HOME.mottoLine2'), t('X-HOME.mottoLine3')]);
  assert.equal(v.firstTip && tRef(v.firstTip), t('R-H03.firstVisit'));
  assert.ok(Array.isArray(v.shi) && v.shi.length > 9 && Array.isArray(v.seal), 'brand / seal glyph paths');
  // 进行中：「继续写字 · 已写 / 总数」与 S01 行
  const r = api.call('home.start');
  assert.equal(r.ok, true);
  const v2 = api.call('view.home').view;
  const m2 = homeModel(store.getState(), envNow(), { deck: deckAdapter });
  assert.equal(v2.view, 'progress');
  assert.equal(tRef(v2.cta.progress), progressText(m2.primary, t));
  assert.equal(tRef(v2.cta.aria), ctaAria(m2, t));
  const note = homeNoteOf(m2);
  assert.equal(v2.note, note);
  if (m2.other) {
    assert.equal(tRef(v2.other.text), resumeLineText(m2.other, t));
    assert.equal(tRef(v2.other.aria), resumeLineAria(m2.other, t));
  }
});

test('B3.5a home.start (first practice) = web startMain: same store, commits and route', () => {
  const { web, reply } = samePaths(null, () => home.startMain(), 'home.start', {});
  assert.equal(reply.opened, 'new');
  assert.deepEqual(web.stack, ['home', 'write']);
  assert.ok(web.labels.length >= 1);
});

test('B3.5a home.start resumes the open group / home.resumeOther = web resumeOther', () => {
  // 先开一组首练（没写完），两条路径都从这份数据起步
  const a = boot();
  assert.equal(home.startMain().ok, true);
  const state = a.store.getState();
  assert.ok(state.sessions.A, 'an open group to resume');
  const seeded = store => store.commit('test-seed', draft => { Object.assign(draft, structuredClone(state)); });
  const r1 = samePaths(seeded, () => home.startMain(), 'home.start', {});
  assert.equal(r1.reply.opened, 'resume');
  samePaths(seeded, () => home.resumeOther(), 'home.resumeOther', {});
});

test('B3.5a D07: a failed start returns {ok:false, error:{kind}}, the store does not move, the retry commits once', () => {
  const { api, store, storage, labels } = boot();
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('home.start');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
  const again = api.call('home.start');
  assert.equal(again.ok, true);
  assert.equal(labels.length, 1, 'one commit for the retry');
});

test('B3.5a home.deferSpecial = web deferral and start: same store, commits and route; failed deferral stays in place', () => {
  const seed = store => store.commit('test-seed-special', draft => {
    draft.records = { '2026-09': Array.from({ length: 10 }, (_, i) => ({
      id: `r${i + 1}`, cardKey: `base:${String.fromCodePoint(0x6100 + i)}`, char: String.fromCodePoint(0x6100 + i),
      sessionId: `s${i + 1}`, kind: 'judged', judgment: 'correct',
      at: new Date('2026-09-28T20:00:00').getTime() + i * 60000, localDay: '2026-09-28',
      help: { hints: 0, answerSeen: false, traced: false },
    })) };
  });
  const result = samePaths(seed, () => home.deferCapital(), 'home.deferSpecial');
  // node 契约环境没有装题库，顺延后的普通开组会去没字页；App 的真题库由流程用例验证。
  assert.deepEqual(result.web.stack, ['home', 'session-none']);
  assert.equal(result.api.store.getState().settings.capitalDeferredDay, '2026-10-05');
  const { api, store, storage, labels } = boot(seed);
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  assert.equal(api.call('home.deferSpecial').ok, false);
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(labels, []);
  assert.equal(api.call('home.deferSpecial').ok, true);
  assert.equal(store.getState().settings.capitalDeferredDay, '2026-10-05');
});

test('B3.5a leave-undo: view.home carries the handed-over undo; home.undoLeave on a finished chance is stale', () => {
  const { api } = boot();
  handoffLeaveUndo({ slot: 'A', sessionId: 's', recordId: 'r', char: '永', strokes: [], until: 1e15, failed: false });
  const v = api.call('view.home').view;
  assert.equal(v.leaveUndo.char, '永');
  assert.equal(tRef(v.leaveUndo.text), t('R-W20.skippedToast', { char: '永' }));
  assert.ok(v.leaveUndo.remainingMs > 0);
  clearLeaveUndo();
  assert.equal(api.call('view.home').view.leaveUndo, null);
  assert.deepEqual(api.call('home.undoLeave'), { ok: false, error: { kind: 'stale' } });
});

test('B3.5a D62: the native CTA rect is the write page T-paper source, the way back shrinks into the rect native reports now', () => {
  const { api, router } = boot();
  const rect = { x: 81, y: 713, w: 240, h: 54 };
  const r = api.call('home.start', { source: { rect, label: t('X-HOME.start'), radius: 12, solid: true } });
  assert.equal(r.ok, true);
  const [root, write] = router.getState().stack;
  const plan = planPaper({ kind: 'push', from: root, to: write }, { reduced: false, root: null });
  assert.equal(plan.mode, 'B1');
  assert.deepEqual(plan.source.rect, rect);
  assert.equal(plan.source.label, t('X-HOME.start'));
  // 原生排版后报的「此刻」（字变成「继续写字 · 0 / 3」、位置不变）：返回的纸缩回这里
  api.call('home.source', { key: 'home-start', rect: { ...rect, y: 700 }, label: 'L2' });
  const back = nativeBackPlan(write, root, null);
  assert.equal(back.mode, 'paper');
  assert.deepEqual(back.source.rect, { ...rect, y: 700 });
  assert.equal(back.source.label, 'L2');
  assert.equal(back.source.gone, false);
  setNativeLiveSource('home-start', null);
});

test('B3.5a tab roots stay web until __shiziNativeRoots (B3.5d flips all three with the tab bar); covered by web pages / overlays', () => {
  const win = { __shiziNative: true, __shiziNativeWriteForce: true, __shiziNativeScreens: ['home', 'about'] };
  assert.equal(nativeScreenOn('home', win), false, 'root gated');
  assert.equal(nativeScreenOn('about', win), true, 'pushed pages are not gated');
  win.__shiziNativeRoots = true;
  assert.equal(nativeScreenOn('home', win), true);
  registerScreen('b35a-web', () => null, {});
  try {
    const rootE = { k: 's', id: 'e1', n: 'home' };
    const snap = (stack, topIsOverlay = false) => ({ stack, top: [...stack].reverse().find(e => e.k === 's'), topIsOverlay });
    assert.equal(isRootEntry(snap([rootE]), 'e1'), true);
    assert.equal(rootCovered(snap([rootE]), 'e1'), false);
    assert.equal(rootCovered(snap([rootE, { k: 'o', id: 'o1', n: 'query' }], true), 'e1'), true, 'web overlay on the root');
    assert.equal(rootCovered(snap([rootE, { k: 's', id: 'e2', n: 'b35a-web' }]), 'e1'), true, 'web page above');
  } finally {
    unregisterScreen('b35a-web');
  }
});

test('B3.5a D62: the secondary resume entry follows its current native rect independently of the main CTA', () => {
  const { api, router } = boot();
  const rect = { x: 100, y: 620, w: 200, h: 44 };
  assert.equal(api.call('home.resumeOther', { source: { rect, solid: false } }).ok, true);
  const [root, write] = router.getState().stack;
  const plan = planPaper({ kind: 'push', from: root, to: write }, { reduced: false, root: null });
  assert.equal(plan.mode, 'B1');
  assert.deepEqual(plan.source.rect, rect);
  api.call('home.source', { key: 'home-start', rect: { ...rect, y: 710 }, label: 'main' });
  api.call('home.source', { key: 'other-line', rect: { ...rect, y: 600 }, label: 'secondary' });
  const back = nativeBackPlan(write, root, null);
  assert.deepEqual(back.source.rect, { ...rect, y: 600 });
  assert.equal(back.source.label, '', 'text entry keeps the paper source label empty');
});
