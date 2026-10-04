// M3-5 换库：行模型（数量从数据算、M 按 judged 记录算、当前库 = settings.library → P73 默认库）、数量行整段、
// 一次 commit 只改 settings.library（真 store + 内存 Storage + 故障注入：失败不发布、重试成功、其余域不动）、确认框视图。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryRows, judgedChars, countSegments, commitLibrary, LibraryConfirmView, libraryName, libraryDesc,
  LIBRARY_SWITCH_SCREEN, SWITCH_LABEL,
} from '../../src/ui/screens/library/switch.js';
import { getScreen } from '../../src/ui/router.js';
import { LIBRARIES } from '../../src/core/cards.js';
import { setDeckSource, libraryOf, currentLibraryId, deckAdapter } from '../../src/data/deck.js';
import { planDaily } from '../../src/core/session-start.js';
import * as policy from '../../src/config/policy.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';
import { MemoryStorage } from '../store/helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date(2026, 8, 24, 12).getTime();
const AT = new Date(2026, 8, 24, 10).getTime();

function rec(id, char, { kind = 'judged', judgment = 'correct' } = {}) {
  const r = { id, cardKey: `base:${char}`, char, sessionId: 's1', kind, at: AT, localDay: '2026-09-24',
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

// 小题库替身：库 → keys
const FAKE = {
  core3500: ['base:的', 'base:一', 'base:永'],
  adv3000: ['base:耶', 'base:韦'],
  rare: ['base:於'],
  curriculum2500: ['base:的', 'base:一'],
};
const fakeLib = id => (FAKE[id] ? { keys: FAKE[id] } : null);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
}

function byTestid(vnode) {
  const out = {};
  walk(vnode, n => {
    const id = n.props && n.props['data-testid'];
    if (id) out[id] = n;
  });
  return out;
}

test('libraryRows: four rows in LIBRARIES order, names / descs from copy, n = keys in the library, m = judged chars in it', () => {
  const state = {
    settings: null,
    records: {
      '2026-09': [
        rec('r1', '的'), rec('r2', '一', { judgment: 'wrong' }), rec('r3', '的', { judgment: 'wrong' }),
        rec('r4', '耶'), rec('r5', '永', { kind: 'answer-seen' }), rec('r6', '韦', { kind: 'skipped' }),
      ],
      '2026-08': { folded: true, kept: [rec('r0', '於')] },
    },
  };
  const rows = libraryRows(state, { libraryOf: fakeLib });
  assert.deepEqual(rows.map(r => r.id), LIBRARIES.map(l => l.id));
  assert.deepEqual(rows.map(r => r.name), ['规范常用字', '规范次常用字', '规范专门用字', '小学初中常用字']);
  assert.equal(rows[0].desc, '日常最常用的字。大多数人从这里开始。');
  assert.equal(rows[3].desc, libraryDesc('curriculum2500'));
  assert.deepEqual(rows.map(r => r.total), [3, 2, 1, 2]);
  // 的 一 各算一次（同字两次判断计 1）；永只看过答案、韦只跳过 → 不算（D23）；折叠月的 kept 也算
  assert.deepEqual(rows.map(r => r.recorded), [2, 1, 1, 2]);
  assert.equal(rows[0].countLine, '可以练 3 个字 · 有记录 2 个');
  assert.deepEqual(rows.map(r => r.current), [true, false, false, false], 'no settings → P73 default library');
  assert.equal(policy.defaultLibrary, 'core3500');
});

test('libraryRows: current follows settings.library; unknown id falls back to the default library', () => {
  const rows = libraryRows({ settings: { library: 'adv3000' }, records: {} }, { libraryOf: fakeLib });
  assert.deepEqual(rows.map(r => r.current), [false, true, false, false]);
  assert.deepEqual(rows.map(r => r.recorded), [0, 0, 0, 0]);
  assert.equal(rows[1].countLine, '可以练 2 个字 · 有记录 0 个');
  const bad = libraryRows({ settings: { library: 'primary' }, records: {} }, { libraryOf: fakeLib });
  assert.deepEqual(bad.map(r => r.current), [true, false, false, false]);
  assert.deepEqual(libraryRows(null, { libraryOf: fakeLib }).map(r => r.current), [true, false, false, false], 'store not booted');
});

test('judgedChars: only judged (correct / wrong) records, deduped by char', () => {
  const s = { records: { '2026-09': [rec('r1', '的'), rec('r2', '的'), rec('r3', '一', { kind: 'answer-seen' })] } };
  assert.deepEqual([...judgedChars(s)], ['的']);
  assert.deepEqual([...judgedChars(null)], []);
});

test('real deck: counts come from the data (3500 / 2974 / 744 / 2500)', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8')}\n;globalThis.__seed = SEED;`, ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'data/context-overrides.js'), 'utf8')}\n;globalThis.__ov = CONTEXT_OVERRIDES;`, ctx);
  setDeckSource({ seed: ctx.__seed, overrides: ctx.__ov });
  try {
    const rows = libraryRows({ settings: null, records: { '2026-09': [rec('r1', '的'), rec('r2', '耶')] } });
    assert.deepEqual(rows.map(r => r.total), [3500, 2974, 744, 2500]);
    assert.deepEqual(rows.map(r => r.recorded), [1, 1, 0, 1]);
    assert.equal(rows[1].countLine, '可以练 2974 个字 · 有记录 1 个');
    // 新字来源跟着 settings.library 走（session-start 读 deck.currentLibraryId）
    assert.equal(currentLibraryId({ library: 'adv3000' }), 'adv3000');
    const plan = planDaily({ records: {}, sched: {}, settings: { library: 'adv3000' }, sessions: null },
      { today: '2026-09-24', deck: deckAdapter, policy });
    const adv = new Set(libraryOf('adv3000').keys);
    assert.ok(plan.newKeys.length > 0, 'new chars planned');
    assert.ok(plan.newKeys.every(k => adv.has(k)), 'new chars come from adv3000');
    assert.equal(plan.libraryId, 'adv3000');
  } finally {
    setDeckSource(null);
  }
});

test('countSegments: the count line splits into whole segments (折行整段换行)', () => {
  assert.deepEqual(countSegments(t('R-L06.countLine', { n: 3500, m: 30 })), ['可以练 3500 个字', '有记录 30 个']);
});

// ---------------------------------------------------------------- 写入

function freshStore() {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  return { store, storage, backend };
}

test('commitLibrary: one commit writes only settings.library; keeps other settings; failure publishes nothing; retry works', () => {
  const { store, storage, backend } = freshStore();
  const seeded = store.seed({
    records: { '2026-09': [rec('r1', '的'), rec('r2', '一', { judgment: 'wrong' })] },
    sched: { 'base:的': { fsrs: { stability: 5, difficulty: 5, state: 2 }, due: '2026-10-01', lastJudgedAt: AT } },
    custom: { added: [{ char: '永', at: AT }] },
    settings: { sound: true },
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  const before = store.getState();
  const rawBefore = new Map(['records', 'sched', 'custom'].map(d => [d, JSON.stringify(before[d])]));

  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  const fail = commitLibrary(store, 'adv3000');
  assert.equal(fail.ok, false, 'failure reported');
  assert.deepEqual(store.getState().settings, { sound: true }, 'nothing published on failure');
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.settings)), { sound: true }, 'storage rolled back');

  const ok = commitLibrary(store, 'adv3000');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.keys, [KEYS.settings], 'only the settings key is written');
  assert.deepEqual(store.getState().settings, { sound: true, library: 'adv3000' });
  for (const [d, raw] of rawBefore) assert.equal(JSON.stringify(store.getState()[d]), raw, `${d} unchanged`);

  const w = backend.writeCount;
  const again = commitLibrary(store, 'adv3000');
  assert.equal(again.ok, true);
  assert.equal(backend.writeCount, w, 'same library → no storage write');
  assert.equal(SWITCH_LABEL, 'library:switch');
});

test('commitLibrary on an empty store creates settings with library only', () => {
  const { store } = freshStore();
  const r = commitLibrary(store, 'curriculum2500');
  assert.equal(r.ok, true);
  assert.deepEqual(store.getState().settings, { library: 'curriculum2500' });
});

// ---------------------------------------------------------------- 视图

test('LibraryConfirm: ask state — title with the library name, two-line body, 取消 / 换成这个库', () => {
  const vnode = LibraryConfirmView({ id: 'curriculum2500', onConfirm: () => {} });
  const ids = byTestid(vnode);
  assert.equal(ids['libswitch-confirm'].props['data-state'], 'ask');
  assert.equal(ids['libswitch-confirm'].props.role, 'alertdialog');
  assert.equal(textOf(ids['libswitch-confirm-title']), '换成「小学初中常用字」？');
  assert.equal(textOf(ids['libswitch-confirm-body']), '以后的新字从这个字库里来。\n已有的记录、自选的字和写错过的字都不变。');
  assert.equal(textOf(ids['libswitch-cancel']), '取消');
  assert.equal(textOf(ids['libswitch-ok']), '换成这个库');
  assert.ok(!ids['libswitch-retry'] && !ids['libswitch-stay']);
});

test('LibraryConfirm: failed state — save-failed sentence, 先不换 / 再试一次 (就地重试)', () => {
  let confirmed = 0;
  let closed = 0;
  const vnode = LibraryConfirmView({ id: 'adv3000', failed: true, onConfirm: () => { confirmed += 1; }, close: () => { closed += 1; } });
  const ids = byTestid(vnode);
  assert.equal(ids['libswitch-confirm'].props['data-state'], 'failed');
  assert.equal(textOf(ids['libswitch-confirm-title']), '换成「规范次常用字」？');
  assert.equal(textOf(ids['libswitch-confirm-body']), '没保存上，刚才的选择没记下。');
  assert.equal(textOf(ids['libswitch-stay']), '先不换');
  assert.equal(textOf(ids['libswitch-retry']), '再试一次');
  assert.ok(!ids['libswitch-ok'] && !ids['libswitch-cancel']);
  ids['libswitch-retry'].props.onClick({ timeStamp: 1e9 });
  assert.equal(confirmed, 1, '再试一次 → the same commit again');
  ids['libswitch-stay'].props.onClick({ timeStamp: 2e9 });
  assert.equal(closed, 1, '先不换 → close');
});

test('screen registered as library-switch; library names from copy', () => {
  assert.equal(LIBRARY_SWITCH_SCREEN, 'library-switch');
  assert.ok(getScreen('library-switch'), 'registered');
  assert.equal(libraryName('rare'), '规范专门用字');
  assert.equal(t('X-LIBSWITCH.switchedToast', { library: libraryName('adv3000') }), '已换成「规范次常用字」。');
});
