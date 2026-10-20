// 审查整改 F1：冷启动恢复页面栈（src/ui/route-memory.js、router.js coldStart、storage.writeRoute、schema route 键）。
// 覆盖：持久化（何时写、遮罩不写、切后台刷新离开时刻）、读回（严格校验）、过期（P108）、各页有效性降级、优先级（阻断 / 坏数据 /
// 深链）、router 冷启动重建 history 条目、深链压过冷恢复、storage 单键写不进 txn 且不受常规故障注入影响、repair 丢弃坏的路由提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as defaultPolicy from '../../src/config/policy.js';
import {
  createRouteMemory, encodeRoute, MAX_ROUTE_CHARS, parseRoute, planColdStart, RESTORE_GUARDS, routeFresh, routeStackOf,
} from '../../src/ui/route-memory.js';
import { createRouter, registerScreen } from '../../src/ui/router.js';
import { createBridge } from '../../src/platform/bridge.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS, BACKUP_EXCLUDED, BACKUP_WHITELIST, isBackupKey, specForKey } from '../../src/core/schema.js';
import { MemoryStorage } from '../store/helpers.mjs';

const Noop = () => null;
registerScreen('home', Noop, { tab: true, order: 0, label: 'H' });
registerScreen('mine', Noop, { tab: true, order: 2, label: 'M' });
registerScreen('write', Noop, { label: 'W', ownsBackGesture: true });
registerScreen('result', Noop, { label: 'R' });
registerScreen('backup', Noop, { label: 'B' });
registerScreen('detail', Noop, { label: 'D' });
registerScreen('detail-photo', Noop, { label: 'P' });
registerScreen('session-none', Noop, { label: 'N' });

const MIN = 60 * 1000;
const NOON = new Date(2026, 9, 3, 12, 0, 0).getTime();

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function session({ id = 's1', slot = 'A', kind, chars = ['永', '和'], cursor = 0, at = NOON, phase = 'recall' } = {}) {
  return {
    id, slot, kind: kind || (slot === 'B' ? 'picked' : 'daily'), source: { view: 'home' },
    queue: chars.map(c => `base:${c}`), cursor, items: [],
    current: { phase, strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
    lastLine: null, startedAt: at, startedDay: dayOf(at), updatedAt: at,
  };
}

function policyWith(routeRestore) {
  return { ...defaultPolicy, routeRestore: { ...defaultPolicy.routeRestore, ...routeRestore } };
}

const route = (stack, at = NOON - 5 * MIN) => ({ at, stack });
const lookup = key => (key === 'base:永' ? { target: '永' } : null);
const plan = (o) => planColdStart({ state: null, now: NOON, lookup, ...o });

// ---------------------------------------------------------------- 编码 / 读回

test('routeStackOf: pages only, cut at the first overlay; params carried', () => {
  const snap = { stack: [
    { k: 's', id: 'e1', n: 'home', p: {} },
    { k: 's', id: 'e2', n: 'write', p: { slot: 'B' } },
    { k: 'o', id: 'e3', n: 'confirm' },
    { k: 's', id: 'e4', n: 'detail', p: { char: '永' } },
  ] };
  assert.deepEqual(routeStackOf(snap), [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'B' } }]);
  assert.deepEqual(routeStackOf(null), []);
});

test('encodeRoute / parseRoute round-trip; bad shapes and oversize are rejected (null)', () => {
  const stack = [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }];
  const raw = encodeRoute(stack, NOON);
  assert.deepEqual(parseRoute(raw), { at: NOON, stack });
  assert.equal(encodeRoute([], NOON), null, 'empty stack is not written');
  assert.equal(encodeRoute(stack, NaN), null);
  assert.equal(encodeRoute([{ n: 'home', p: { big: 'x'.repeat(MAX_ROUTE_CHARS) } }], NOON), null, 'oversize is not written');
  for (const bad of [
    null, '', 'not json', '[]', '{"v":2,"at":1,"stack":[{"n":"home","p":{}}]}', '{"v":1,"stack":[{"n":"home","p":{}}]}',
    '{"v":1,"at":1,"stack":[]}', '{"v":1,"at":1,"stack":[{"n":"","p":{}}]}', '{"v":1,"at":1,"stack":[{"n":"home","p":[]}]}',
    '{"v":1,"at":1,"stack":[{"n":"home"}]}', '{"v":1,"at":1,"stack":"home"}',
  ]) assert.equal(parseRoute(bad), null, String(bad));
});

// ---------------------------------------------------------------- 过期（P108）

test('routeFresh (P108): within maxAgeMinutes and same local day; crossDay / maxAge / clock skew', () => {
  const p = policyWith({ maxAgeMinutes: 360, crossDay: false });
  assert.equal(routeFresh(NOON - 5 * MIN, NOON, p), true);
  assert.equal(routeFresh(NOON - 359 * MIN, NOON, p), true);
  assert.equal(routeFresh(NOON - 361 * MIN, NOON, p), false, 'older than maxAgeMinutes');
  assert.equal(routeFresh(NOON + 361 * MIN, NOON, p), false, 'clock moved back past the window');
  // D66 ⑦：一天从凌晨 4 点起——23:50 → 0:10 仍是同一天；3:50 → 4:10 才算跨天
  const lateNight = new Date(2026, 9, 3, 23, 50).getTime();
  const afterMidnight = new Date(2026, 9, 4, 0, 10).getTime();
  assert.equal(routeFresh(lateNight, afterMidnight, p), true, 'midnight is no longer a day boundary');
  const beforeFour = new Date(2026, 9, 4, 3, 50).getTime();
  const afterFour = new Date(2026, 9, 4, 4, 10).getTime();
  assert.equal(routeFresh(beforeFour, afterFour, p), false, 'crossed the 4 am day boundary');
  assert.equal(routeFresh(beforeFour, afterFour, policyWith({ crossDay: true })), true, 'crossDay=true keeps it');
  assert.equal(routeFresh(NaN, NOON, p), false);
  // 过渡默认值与 03 P108 一致
  assert.deepEqual({ ...defaultPolicy.routeRestore }, { enabled: true, maxAgeMinutes: 360, crossDay: false });
});

// ---------------------------------------------------------------- 优先级与降级

test('planColdStart priority: disabled > none > blocked > corrupt > deep link > stale', () => {
  const r = route([{ n: 'mine', p: {} }, { n: 'backup', p: {} }]);
  assert.equal(plan({ route: r }).reason, 'ok');
  assert.equal(plan({ route: r, policy: policyWith({ enabled: false }) }).reason, 'disabled');
  assert.equal(plan({ route: null }).reason, 'none');
  assert.equal(plan({ route: r, blockReason: { kind: 'unavailable' }, corrupt: true, deepLink: true }).reason, 'blocked');
  assert.equal(plan({ route: r, corrupt: true, deepLink: true }).reason, 'corrupt');
  assert.equal(plan({ route: r, deepLink: true }).reason, 'deep-link');
  assert.equal(plan({ route: route(r.stack, NOON - 7 * 60 * MIN) }).reason, 'stale');
});

test('planColdStart: write page restores only while that slot has a resumable session', () => {
  const stack = [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }];
  const live = { sessions: { A: session({ phase: 'compare' }), B: null, lastEnded: {} } };
  assert.deepEqual(plan({ route: route(stack), state: live }), { stack, reason: 'ok' });
  assert.equal(plan({ route: route(stack), state: { sessions: { A: null, B: null, lastEnded: {} } } }).reason, 'invalid:write', 'session ended');
  const yesterday = { sessions: { A: session({ at: NOON - 24 * 60 * MIN }), B: null, lastEnded: {} } };
  assert.equal(plan({ route: route(stack), state: yesterday }).reason, 'invalid:write', 'daily from yesterday is expired (P37)');
  const done = { sessions: { A: session({ cursor: 2 }), B: null, lastEnded: {} } };
  assert.equal(plan({ route: route(stack), state: done }).reason, 'invalid:write', 'finished group');
  const bStack = [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'B' } }];
  assert.equal(plan({ route: route(bStack), state: live }).reason, 'invalid:write', 'slot B has no session');
  const picked = { sessions: { A: null, B: session({ slot: 'B', at: NOON - 3 * 24 * 60 * MIN }), lastEnded: {} } };
  assert.equal(plan({ route: route(bStack), state: picked }).reason, 'ok', 'picked groups do not expire across days (P61)');
});

test('planColdStart: result / detail / detail-photo / session-none guards; unknown screen and tab position', () => {
  const ended = { ...session({ id: 's7', cursor: 2 }), endedAt: NOON };
  const st = { sessions: { A: null, B: null, lastEnded: { A: ended } }, custom: { added: [{ char: '鱻', at: 1 }] }, photos: { 龘: { day: '2025-01-01', at: 1, dataURL: 'data:' } },
    records: { '2026-09': [{ id: 'r1', char: '靐', cardKey: 'custom:靐', kind: 'judged' }] } };
  const ok = stack => plan({ route: route(stack), state: st }).reason;
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'result', p: { slot: 'A', sessionId: 's7' } }]), 'ok');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'result', p: { slot: 'A', sessionId: 's8' } }]), 'invalid:result');
  for (const ch of ['永', '鱻', '龘', '靐']) assert.equal(ok([{ n: 'home', p: {} }, { n: 'detail', p: { char: ch } }]), 'ok', ch);
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'detail', p: { char: '丂' } }]), 'invalid:detail', 'char no longer anywhere');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'detail', p: { char: '永和' } }]), 'invalid:detail');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'detail', p: { char: '龘' } }, { n: 'detail-photo', p: { char: '龘' } }]), 'ok');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'detail-photo', p: { char: '永' } }]), 'invalid:detail-photo');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'session-none', p: {} }]), 'invalid:session-none');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'gone-screen', p: {} }]), 'unknown-screen:gone-screen');
  assert.equal(ok([{ n: 'write', p: {} }]), 'unknown-screen:write', 'first entry must be a tab');
  assert.equal(ok([{ n: 'home', p: {} }, { n: 'mine', p: {} }]), 'unknown-screen:mine', 'a tab cannot be a sub page');
  // 备份页没有守卫：副本在不在只决定撤销底栏（backup.js），页面本身照常恢复。
  assert.equal(Object.prototype.hasOwnProperty.call(RESTORE_GUARDS, 'backup'), false);
  assert.equal(ok([{ n: 'mine', p: {} }, { n: 'backup', p: {} }]), 'ok');
});

// ---------------------------------------------------------------- schema / storage

test('schema: shizi.v2.route is a registered non-domain key, excluded from backups', () => {
  const spec = specForKey(KEYS.route);
  assert.equal(spec.id, 'route');
  assert.equal(spec.domain, null);
  assert.ok(BACKUP_EXCLUDED.includes('route'));
  assert.ok(!BACKUP_WHITELIST.includes('route'));
  assert.equal(isBackupKey(KEYS.route), false);
});

test('storage.writeRoute: single setItem, no txn; writeAll refuses the key; faults: halted refuses, generic failNextWrite / interrupt counter untouched', () => {
  const backend = new MemoryStorage();
  const order = [];
  backend.failWhen(({ op, key }) => {
    order.push(`${op}:${key}`);
    return null;
  });
  const storage = createStorage(backend);
  const raw = encodeRoute([{ n: 'home', p: {} }], NOON);
  assert.deepEqual(storage.writeRoute(raw), { ok: true, written: true });
  assert.deepEqual(order, [`set:${KEYS.route}`], 'one setItem, no txn');
  assert.deepEqual(storage.writeRoute(raw), { ok: true, written: false }, 'unchanged value is not rewritten');
  assert.throws(() => storage.writeAll([[KEYS.route, raw]]), /must not touch/);
  assert.throws(() => storage.writeRoute(42), TypeError);

  // failNextWrite 不带 matchKey：留给业务写，不被路由提示吃掉
  storage.failNextWrite(1, { kind: 'quota' });
  assert.equal(storage.writeRoute(encodeRoute([{ n: 'mine', p: {} }], NOON)).ok, true);
  assert.throws(() => storage.writeAll([[KEYS.custom, JSON.stringify({ added: [] })]]), e => e.kind === 'quota', 'the injected failure is still pending for writeAll');
  // 明确指向路由键：命中，静默失败
  storage.failNextWrite(1, { kind: 'quota', matchKey: KEYS.route });
  assert.deepEqual(storage.writeRoute(encodeRoute([{ n: 'home', p: {} }], NOON + 1)), { ok: false, kind: 'quota' });

  // interruptAfterWrite：路由写不计数；中断（halted）后拒写
  storage.clearFaults();
  storage.interruptAfterWrite(2);
  assert.equal(storage.writeRoute(encodeRoute([{ n: 'home', p: {} }], NOON + 2)).ok, true);
  assert.throws(() => storage.writeAll([[KEYS.custom, JSON.stringify({ added: [{ char: '永', at: 1 }] })]]), e => e.kind === 'interrupted', 'the 2nd counted write (first data key after txn) interrupts');
  assert.deepEqual(storage.writeRoute(encodeRoute([{ n: 'mine', p: {} }], NOON + 3)), { ok: false, kind: 'interrupted' });
});

test('storage.repair: a bad route hint is dropped silently (not quarantined, no corrupt notice); a live txn never touches it', () => {
  const backend = new MemoryStorage({ initial: { [KEYS.route]: '[1,2]' } });
  const storage = createStorage(backend);
  const report = storage.repair();
  assert.deepEqual(report.dropped, [KEYS.route]);
  assert.deepEqual(report.quarantined, []);
  assert.equal(backend.getItem(KEYS.route), null);
  assert.equal(backend.getItem(`shizi.corrupt.${KEYS.route}`), null);

  // 半写的 txn 回滚只动 txn.keys：路由提示保持离开时的值
  const raw = encodeRoute([{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }], NOON);
  const b2 = new MemoryStorage({ initial: {
    [KEYS.route]: raw,
    [KEYS.custom]: JSON.stringify({ added: [{ char: '永', at: 1 }] }),
    [KEYS.txn]: JSON.stringify({ label: 'x', at: 1, keys: [KEYS.custom], prev: { [KEYS.custom]: null }, phase: 'writing' }),
  } });
  const s2 = createStorage(b2);
  assert.equal(s2.repair().txn, 'rolled-back');
  assert.equal(b2.getItem(KEYS.custom), null);
  assert.equal(b2.getItem(KEYS.route), raw);
});

// ---------------------------------------------------------------- router 冷启动 + 记忆接线

function fakeHistory() {
  const entries = [{ state: null }];
  let index = 0;
  const queued = [];
  let listener = null;
  return {
    entries,
    get state() {
      return entries[index].state;
    },
    get index() {
      return index;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push({ state: structuredClone(state) });
      index += 1;
    },
    replaceState(state) {
      entries[index] = { state: structuredClone(state) };
    },
    back() {
      this.go(-1);
    },
    go(n) {
      const target = index + n;
      if (target >= 0 && target < entries.length) queued.push(target);
    },
    onPop(fn) {
      listener = fn;
    },
    flush() {
      while (queued.length) {
        index = queued.shift();
        if (listener) listener(entries[index].state);
      }
    },
  };
}

function fakeWin() {
  const docListeners = {};
  const winListeners = {};
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
  };
  return {
    document,
    addEventListener: (type, fn) => { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    removeEventListener: (type, fn) => { winListeners[type] = (winListeners[type] || []).filter(f => f !== fn); },
    hide() {
      document.visibilityState = 'hidden';
      for (const fn of docListeners.visibilitychange || []) fn();
    },
    pagehide() {
      for (const fn of winListeners.pagehide || []) fn();
    },
  };
}

function boot({ backend = new MemoryStorage(), state = { sessions: { A: session(), B: null, lastEnded: {} } }, clock = { t: NOON }, queued = null, status = {} } = {}) {
  const storage = createStorage(backend);
  const store = {
    storage,
    getState: () => state,
    status: { available: true, unavailableKind: null, blocked: null, corruptNotice: null, ...status },
  };
  const bridge = createBridge(null);
  if (queued) bridge.pending = () => [{ name: 'shiziOpenReminderTarget', args: [queued] }];
  const win = fakeWin();
  const history = fakeHistory();
  const memory = createRouteMemory({ getStore: () => store, bridge, win, now: () => clock.t, defaultTab: 'home' });
  const router = createRouter({ history, coldStart: () => memory.coldStart(), setTimeout: () => 0, clearTimeout: () => {} });
  history.onPop(s => router.handlePopState(s));
  router.start({ defaultTab: 'home' });
  memory.attach(router);
  return { backend, storage, store, history, router, memory, win, clock };
}

const names = r => r.getState().stack.map(e => e.n);
const saved = backend => parseRoute(backend.getItem(KEYS.route));

test('memory: writes on attach and on every page change; overlays do not change the saved stack; hidden / pagehide refresh the leave time', () => {
  const t = boot();
  assert.deepEqual(saved(t.backend).stack, [{ n: 'home', p: {} }], 'attach writes the fresh root');
  t.router.push('write', { slot: 'A' });
  assert.deepEqual(saved(t.backend).stack, [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }]);
  const before = t.backend.getItem(KEYS.route);
  t.router.openOverlay(Noop, {}, { name: 'confirm' });
  assert.equal(t.backend.getItem(KEYS.route), before, 'overlay: same pages → not rewritten');
  t.clock.t = NOON + 30 * MIN;
  t.win.hide();
  assert.equal(saved(t.backend).at, NOON + 30 * MIN, 'visibilitychange hidden refreshes at');
  t.clock.t = NOON + 31 * MIN;
  t.win.pagehide();
  assert.equal(saved(t.backend).at, NOON + 31 * MIN, 'pagehide refreshes at');
  t.router.setParams({ slot: 'A', x: 1 });
  t.history.flush();
  assert.deepEqual(saved(t.backend).stack[1], { n: 'write', p: { slot: 'A', x: 1 } }, 'setParams (top page under the overlay) is saved');
});

test('cold start: history.state is empty → the saved stack is rebuilt as real history entries (back works layer by layer)', () => {
  const backend = new MemoryStorage({ initial: {
    [KEYS.route]: encodeRoute([{ n: 'home', p: {} }, { n: 'detail', p: { char: '永' } }, { n: 'write', p: { slot: 'A' } }], NOON - 10 * MIN),
  } });
  const t = boot({ backend, state: { sessions: { A: session({ phase: 'answer' }), B: null, lastEnded: {} }, records: { '2026-10': [{ id: 'r1', char: '永' }] } } });
  assert.deepEqual(names(t.router), ['home', 'detail', 'write']);
  assert.deepEqual(t.memory.lastPlan(), { reason: 'ok', restored: true });
  const tr = t.router.getState().transition;
  assert.equal(tr.cause, 'restore');
  assert.equal(tr.cold, true);
  assert.equal(tr.to.n, 'write');
  assert.equal(t.history.entries.length, 3, 'one history entry per page');
  assert.deepEqual(t.history.entries.map(e => e.state.depth), [0, 1, 2]);
  assert.equal(t.history.index, 2);
  assert.equal(t.memory.pristine(), true);
  t.router.back();
  t.history.flush();
  assert.deepEqual(names(t.router), ['home', 'detail'], 'back pops one restored layer');
  assert.equal(t.memory.pristine(), false, 'navigating after the restore counts as touched');
  assert.deepEqual(saved(t.backend).stack.map(e => e.n), ['home', 'detail']);
});

test('cold start degrades to the fresh home root: stale, ended session, blocked, corrupt, queued deep link', () => {
  const stack = [{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }];
  const cases = [
    { name: 'stale', at: NOON - 7 * 60 * MIN, opts: {}, reason: 'stale' },
    { name: 'ended', at: NOON - MIN, opts: { state: { sessions: { A: null, B: null, lastEnded: {} } } }, reason: 'invalid:write' },
    { name: 'blocked', at: NOON - MIN, opts: { status: { blocked: { reason: 'rollback-failed' } } }, reason: 'blocked' },
    { name: 'corrupt', at: NOON - MIN, opts: { status: { corruptNotice: { keys: [KEYS.sessions] } } }, reason: 'corrupt' },
    { name: 'deep link', at: NOON - MIN, opts: { queued: 'base:永' }, reason: 'deep-link' },
  ];
  for (const c of cases) {
    const backend = new MemoryStorage({ initial: { [KEYS.route]: encodeRoute(stack, c.at) } });
    const t = boot({ backend, ...c.opts });
    assert.deepEqual(names(t.router), ['home'], c.name);
    assert.equal(t.router.getState().transition.cause, 'start', c.name);
    assert.deepEqual(t.memory.lastPlan(), { reason: c.reason, restored: false }, c.name);
    assert.equal(t.history.entries.length, 1, `${c.name}: no extra history entries`);
    if (c.name === 'blocked') {
      assert.equal(t.backend.getItem(KEYS.route), encodeRoute(stack, c.at), 'blocked: nothing is written while the block page is up');
    } else {
      assert.deepEqual(saved(t.backend).stack, [{ n: 'home', p: {} }], `${c.name}: the stale hint is overwritten by the fresh root`);
    }
  }
});

test('reload (history.state present) never consults the saved route', () => {
  const backend = new MemoryStorage({ initial: { [KEYS.route]: encodeRoute([{ n: 'mine', p: {} }, { n: 'backup', p: {} }], NOON - MIN) } });
  const storage = createStorage(backend);
  const store = { storage, getState: () => ({}), status: { available: true, blocked: null, corruptNotice: null } };
  const memory = createRouteMemory({ getStore: () => store, bridge: createBridge(null), win: fakeWin(), now: () => NOON });
  const history = fakeHistory();
  history.replaceState({ tag: 'shizi-router', v: 1, depth: 0, name: 'home', params: {}, tab: 'home', stack: [{ k: 's', id: 'e1', n: 'home', p: {} }] });
  let asked = 0;
  const router = createRouter({ history, coldStart: () => { asked += 1; return memory.coldStart(); }, setTimeout: () => 0, clearTimeout: () => {} });
  router.start({ defaultTab: 'home' });
  assert.equal(asked, 0);
  assert.deepEqual(names(router), ['home']);
});

test('deep link after a pristine cold restore: silently back to home first, then the link runs; after touching it runs directly', () => {
  const backend = new MemoryStorage({ initial: { [KEYS.route]: encodeRoute([{ n: 'mine', p: {} }, { n: 'backup', p: {} }], NOON - MIN) } });
  const t = boot({ backend });
  assert.deepEqual(names(t.router), ['mine', 'backup']);
  const ran = [];
  const how = t.memory.yieldToDeepLink(() => {
    ran.push(names(t.router));
    t.router.push('write', { slot: 'B' });
  });
  assert.equal(how, 'yielded');
  assert.deepEqual(ran, [], 'waits for the silent pop');
  t.history.flush();
  assert.deepEqual(ran, [['home']], 'runs on the fresh home root');
  assert.deepEqual(names(t.router), ['home', 'write']);
  assert.equal(t.router.getState().transition.kind, 'push');
  // 第二次（已动过）：直接叠在当前页上
  const again = [];
  assert.equal(t.memory.yieldToDeepLink(() => again.push(names(t.router))), 'direct');
  assert.deepEqual(again, [['home', 'write']]);
});

test('deep link after going to the background (warm tap) does not unwind the restored stack', () => {
  const backend = new MemoryStorage({ initial: { [KEYS.route]: encodeRoute([{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }], NOON - MIN) } });
  const t = boot({ backend });
  assert.deepEqual(names(t.router), ['home', 'write']);
  t.win.hide();
  const ran = [];
  assert.equal(t.memory.yieldToDeepLink(() => ran.push(names(t.router))), 'direct');
  assert.deepEqual(ran, [['home', 'write']]);
});
