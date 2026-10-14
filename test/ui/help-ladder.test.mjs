// 求助梯子静态部分（W1，D34 / D51 ⑧；I2-02）：看答案没有确认框也不清空本人墨、第一次格下一行说明（settings.answerNoteSeen）。
// 提示的画法与对比度见 hint-layer.test.mjs / contrast.test.mjs / contrast-more.test.mjs；笔顺快放与描一遍整字合成见 trace-composite.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import {
  commitAnswerSeen, commitAnswerPhase, commitAnswerNext, commitAnswerNoteSeen, answerNoteDue, answerInkKey,
} from '../../src/ui/screens/write/answer.js';
import { storedStrokes, syncPatch } from '../../src/ui/screens/write/persist.js';
import { createSession, withCurrent } from '../../src/core/sessions.js';
import { decodeRawStrokes, encodeRawStrokes } from '../../src/core/ink-math.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import * as policy from '../../src/config/policy.js';
import { t, has } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T0 = new Date(2026, 9, 5, 12, 0).getTime();
const H = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];
const V = [{ x: 172, y: 60, t: 0 }, { x: 173, y: 170, t: 60 }, { x: 174, y: 280, t: 120 }];

function baseState(chars = ['永', '和']) {
  const A = createSession({ id: 's1', kind: 'daily', queue: chars.map(c => 'base:' + c), at: T0 });
  return { records: {}, sched: {}, ink: {}, settings: { sound: true }, sessions: { A, B: null, lastEnded: {} }, meta: null };
}

function fakeStore(state) {
  let cur = state;
  let now = T0 + 60_000;
  let serial = 10;
  const labels = [];
  return {
    labels,
    getState: () => cur,
    commit(label, fn) {
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: (now += 1000), label, nextId: p => `${p}${(serial += 1)}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      cur = draft;
      labels.push(label);
      return { ok: true, keys: [] };
    },
  };
}

const withRecallInk = (state, strokes) => {
  const A = withCurrent(state.sessions.A, { strokes: encodeRawStrokes(strokes) }, T0 + 1000);
  return { ...state, sessions: { ...state.sessions, A } };
};

test('看答案（D64 ②）：点一下直接进描一遍——一次 commit、不换卡、格子是空的，记录 traced=true', () => {
  const store = fakeStore(withRecallInk(baseState(), [H, V]));
  assert.equal(store.getState().sessions.A.current.strokes.length, 2);
  const r = commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  assert.ok(r.ok);
  const cur = store.getState().sessions.A.current;
  assert.equal(cur.phase, 'trace', 'no middle 「answer」 step any more');
  assert.equal(cur.answerSeen, true);
  assert.deepEqual(cur.strokes, [], 'the trace grid starts empty');
  assert.equal(store.getState().sessions.A.cursor, 0, 'same card, cursor not advanced');
  assert.deepEqual(store.labels, ['write:answer-seen'], 'exactly one commit, no confirm step, no separate 「描一遍」 commit');
  const seen = Object.values(store.getState().records).flat().filter(x => x.kind === 'answer-seen');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].help, { hints: 0, answerSeen: true, traced: true });
});

test('提示给完整个字（D64 ①）：同一个 commitAnswerSeen（stay），留在回忆页、笔画不动、hints / hintRange 一并写入，记录与看答案同口径', () => {
  const store = fakeStore(withRecallInk(baseState(), [H, V]));
  const before = store.getState().sessions.A.current.strokes;
  const r = commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永', stay: true, hints: 4, hintRange: { from: 0, to: 5 } });
  assert.ok(r.ok);
  const cur = store.getState().sessions.A.current;
  assert.deepEqual([cur.phase, cur.answerSeen, cur.hints, cur.hintRange], ['recall', true, 4, { from: 0, to: 5 }]);
  assert.deepEqual(cur.strokes, before, 'own strokes untouched');
  const seen = Object.values(store.getState().records).flat().filter(x => x.kind === 'answer-seen');
  assert.equal(seen.length, 1, 'one answer-seen record, like the 看答案 button');
  assert.deepEqual(seen[0].help, { hints: 4, answerSeen: true, traced: false });
  assert.deepEqual(store.labels, ['write:answer-seen']);
  // 之后再点「看答案」：不新增记录，进描一遍并把 traced 置 true
  assert.ok(commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' }).ok);
  const seen2 = Object.values(store.getState().records).flat().filter(x => x.kind === 'answer-seen');
  assert.equal(seen2.length, 1, 'no duplicate event');
  assert.equal(seen2[0].help.traced, true);
  assert.equal(store.getState().sessions.A.current.phase, 'trace');
});

test('笔画现场的分组键：回忆 / 判断共用一份；描一遍 / 凭记忆写各自一份空格子（旧存档的 answer 阶段仍与回忆共用）', () => {
  assert.equal(answerInkKey('base:永', 'recall'), 'base:永');
  assert.equal(answerInkKey('base:永', 'answer'), 'base:永', 'legacy answer phase shares the recall ink');
  assert.equal(answerInkKey('base:永', 'compare'), 'base:永');
  assert.equal(answerInkKey('base:永', 'trace'), 'base:永|trace');
  assert.equal(answerInkKey('base:永', 'retrace'), 'base:永|retrace');
  // 看答案后直接是描一遍：空格子；刷新后也是空的
  const store = fakeStore(withRecallInk(baseState(), [H, V]));
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  const s = store.getState().sessions.A;
  assert.equal(storedStrokes(s, 'base:永', answerInkKey('base:永', s.current.phase)).length, 0, 'trace grid restored empty');
  assert.equal(syncPatch(s, { cardKey: 'base:永', inkKey: 'base:永|trace', strokes: decodeRawStrokes(s.current.strokes), phase: 'trace' }), null);
});

test('看答案之后：进描一遍清空笔画、看答案前回忆阶段写的笔画不会被存成「看后写的」墨迹（Q1 存墨规则不变）', () => {
  const store = fakeStore(withRecallInk(baseState(), [H, V]));
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace' }).ok);
  assert.deepEqual(store.getState().sessions.A.current.strokes, [], 'trace starts from an empty grid');
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' }).ok);
  assert.deepEqual(store.getState().ink, {}, 'nothing stored: recall ink is not the after-seen self-write');
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok);
  const ink = store.getState().ink;
  const keys = Object.keys(ink).flatMap(m => Object.keys(ink[m]));
  assert.equal(keys.length, 1, 'only the retrace strokes are stored (Q1)');
});

test('settings.answerNoteSeen 标志位（C3-H / D53 起界面不再读它、第一次的格下说明已删）：answerNoteDue / commitAnswerNoteSeen 照旧，只在 answer 阶段、从没记过时 due；记即 store.commit，之后不再写', () => {
  assert.equal(answerNoteDue({ settings: null, phase: 'answer' }), true);
  assert.equal(answerNoteDue({ settings: { answerNoteSeen: false }, phase: 'answer' }), true);
  assert.equal(answerNoteDue({ settings: { answerNoteSeen: true }, phase: 'answer' }), false, 'seen once → never again');
  assert.equal(answerNoteDue({ settings: null, phase: 'recall' }), false);
  assert.equal(answerNoteDue({ settings: null, phase: 'trace' }), false);
  const store = fakeStore(baseState());
  const r = commitAnswerNoteSeen(store);
  assert.ok(r.ok);
  assert.deepEqual(store.getState().settings, { sound: true, answerNoteSeen: true }, 'other settings kept');
  assert.deepEqual(store.labels, ['write:answer-note']);
  const again = commitAnswerNoteSeen(store);
  assert.equal(again.skipped, true);
  assert.equal(store.labels.length, 1, 'already recorded → no second commit');
  assert.equal(has('R-W07.firstExplain'), false, 'C3-H / D53: the line itself is gone; only the flag and these helpers remain');
});

test('schema：settings.answerNoteSeen 是可缺省的布尔，类型不对被拒绝', () => {
  assert.equal(validateValue(KEYS.settings, {}), null, 'optional (old data without it stays valid)');
  assert.equal(validateValue(KEYS.settings, { answerNoteSeen: true }), null);
  assert.notEqual(validateValue(KEYS.settings, { answerNoteSeen: 'yes' }), null);
});

test('看答案层的源码约束：没有确认框', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/answer.js'), 'utf8');
  assert.ok(!/openAnswerConfirm|R-W07\.confirm/.test(src), 'the 「看了答案…」 confirm dialog is gone');
});
