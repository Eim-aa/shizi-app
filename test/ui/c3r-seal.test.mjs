// 第三轮 C3-R（D53，I3-04 / I3-05 / T3-08）：落印三感同帧的纯逻辑部分。真实页面里的逐帧行为在 scripts/e2e/93-c3r-seal.spec.js。
//   · revealPlan 的 contactMs 就是印的「落下」段（100ms），回弹段 120ms，总长不变且 ≤ 750ms；样式里的着纸百分比与之一致；
//   · haptics.js 有 seal 档、记录发出时刻；
//   · sealedAt 通过会话校验；commitSealed 写会话上的 sealedAt（幂等、不在时 stale）；isSealed / shouldPlayReveal 认它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEAL_FALL_MS, SEAL_REBOUND_MS, commitSealed, isSealed, resetReveal, revealPlan, shouldPlayReveal,
} from '../../src/ui/screens/result/work.js';
import { HAPTIC_KINDS, haptic, hapticLog, hapticTimes, resetCommitFeedback } from '../../src/platform/haptics.js';
import { validateSession } from '../../src/core/schema.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('revealPlan: 印先落 100ms 到最小缩放（着纸），再 120ms 回弹到 1；总长仍 ≤ 750ms', () => {
  assert.equal(SEAL_FALL_MS, 100);
  assert.equal(SEAL_REBOUND_MS, 120);
  for (let n = 1; n <= 80; n += 1) {
    const p = revealPlan(n);
    assert.equal(p.contactMs, SEAL_FALL_MS, `n=${n}`);
    assert.equal(p.sealMs, SEAL_FALL_MS + SEAL_REBOUND_MS, `n=${n}: fall + rebound`);
    assert.ok(p.sealDelay + p.contactMs < p.total, `n=${n}: contact is before the rebound ends`);
    assert.ok(p.total <= 750, `n=${n}`);
  }
});

test('样式：着纸的关键帧百分比 = 落下段 / 总长，且最小缩放 .92、回弹到 1', () => {
  const src = readFileSync(join(ROOT, 'src/ui/screens/result/work.js'), 'utf8');
  const m = src.match(/@keyframes szResultSeal\{0%\{[^}]*\}([\d.]+)%\{opacity:1;transform:scale\(\.92\)\}100%\{opacity:1;transform:scale\(1\)\}\}/);
  assert.ok(m, 'keyframes found');
  const pct = (SEAL_FALL_MS / (SEAL_FALL_MS + SEAL_REBOUND_MS)) * 100;
  assert.ok(Math.abs(Number(m[1]) - pct) < 0.01, `${m[1]}% ≈ ${pct.toFixed(2)}%`);
  assert.match(src, /\.sz-seal--land\{animation:szResultSeal 220ms ease-out both\}/);
});

test('haptics: seal 档存在，记录发出时刻（与 hapticLog 一一对应）', () => {
  resetCommitFeedback();
  assert.ok(HAPTIC_KINDS.includes('seal'));
  const sent = [];
  const b = { postNative: (type, body) => { sent.push([type, body.kind]); return true; } };
  assert.equal(haptic('seal', { bridge: b }), 'native');
  assert.deepEqual(sent, [['haptic', 'seal']]);
  assert.deepEqual(hapticLog(), ['seal']);
  const times = hapticTimes();
  assert.equal(times.length, 1);
  assert.ok(Number.isFinite(times[0]));
  resetCommitFeedback();
  assert.deepEqual(hapticTimes(), []);
});

function session(extra = {}) {
  return {
    id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' }, queue: ['base:永'], cursor: 1, items: [],
    startedAt: 1, startedDay: '2026-10-05', updatedAt: 2, endedAt: 3, ...extra,
  };
}

test('sealedAt 是会话的合法字段（数字），别的类型被拒', () => {
  assert.equal(validateSession(session({ sealedAt: 1234 })), null);
  assert.equal(validateSession(session()), null);
  assert.ok(validateSession(session({ sealedAt: 'x' })));
});

function fakeStore(sessions) {
  const state = { sessions: JSON.parse(JSON.stringify(sessions)) };
  let commits = 0;
  return {
    commits: () => commits,
    getState: () => state,
    commit(label, mutate) {
      const draft = JSON.parse(JSON.stringify(state));
      mutate(draft, { now: 777, label });
      Object.assign(state, draft);
      commits += 1;
      return { ok: true, keys: ['sessions'], label };
    },
  };
}

test('commitSealed: 写在会话上（lastEnded / 槽里都行），幂等，会话不在时 stale', () => {
  const store = fakeStore({ A: null, B: null, lastEnded: { A: session() } });
  const r = commitSealed(store, { slot: 'A', sessionId: 's1' });
  assert.equal(r.ok, true);
  assert.equal(store.getState().sessions.lastEnded.A.sealedAt, 777);
  assert.equal(commitSealed(store, { slot: 'A', sessionId: 's1' }).already, true, 'second time writes nothing');
  assert.equal(store.commits(), 1);
  assert.equal(commitSealed(store, { slot: 'A', sessionId: 'nope' }).ok, false, 'stale');
  const live = fakeStore({ A: session(), B: null, lastEnded: {} });
  assert.equal(commitSealed(live, { slot: 'A', sessionId: 's1' }).ok, true);
  assert.equal(live.getState().sessions.A.sealedAt, 777);
});

test('isSealed / shouldPlayReveal: 会话上有 sealedAt、或本次打开页面里响过 → 不再演；没有作品 / 衬底一行 → 不演', () => {
  resetReveal();
  const work = { empty: false, cells: [{}] };
  const prev = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  try {
    assert.equal(shouldPlayReveal({ work, key: 'A:s1', session: session() }), true, 'fresh group plays');
    assert.equal(shouldPlayReveal({ work, key: 'A:s1', session: session({ sealedAt: 5 }) }), false, 'restored from a cold start: sealedAt present');
    assert.equal(isSealed('A:s1', session({ sealedAt: 5 })), true);
    assert.equal(shouldPlayReveal({ work: { empty: true, entries: [] }, key: 'A:s1' }), false, 'plain row has no seal');
    assert.equal(shouldPlayReveal({ work: null, key: 'A:s1' }), false);
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    assert.equal(shouldPlayReveal({ work, key: 'A:s1', session: session() }), false, 'reduce motion: final state');
  } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
});
