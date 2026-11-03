// M3-5 换库：行模型（数量从数据算、M 按 judged 记录算、当前库 = settings.library → P73 默认库）、数量行整段、
// 一次 commit 只改 settings.library（真 store + 内存 Storage + 故障注入：失败不发布、重试成功、其余域不动）、确认框视图。
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryRows as libraryRowsRaw, judgedChars, countSegments, commitLibrary, switchLibrary, SwitchFail, libraryName, libraryDesc,
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
import { t, renderRefs } from '../../src/config/copy/index.js';
import { MemoryStorage } from '../store/helpers.mjs';

// B3.4：换库行模型给文案引用；这里照 t() 渲染后核对文案一字不变。
const libraryRows = (...args) => renderRefs(libraryRowsRaw(...args));

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
  assert.deepEqual(rows.map(r => r.name), ['常用字', '次常用字', '少见字', '课本字']);
  assert.equal(rows[0].desc, '日常最常用的字。大多数人从这里开始。');
  assert.equal(rows[3].desc, libraryDesc('curriculum2500'));
  assert.deepEqual(rows.map(r => r.total), [3, 2, 1, 2]);
  // 的 一 各算一次（同字两次判断计 1）；永只看过答案、韦只跳过 → 不算（D23）；折叠月的 kept 也算
  assert.deepEqual(rows.map(r => r.recorded), [2, 1, 1, 2]);
  assert.equal(rows[0].countLine, '可练 3 个 · 写过 2 个');
  assert.deepEqual(rows.map(r => r.current), [true, false, false, false], 'no settings → P73 default library');
  assert.equal(policy.defaultLibrary, 'core3500');
});

test('libraryRows: current follows settings.library; unknown id falls back to the default library', () => {
  const rows = libraryRows({ settings: { library: 'adv3000' }, records: {} }, { libraryOf: fakeLib });
  assert.deepEqual(rows.map(r => r.current), [false, true, false, false]);
  assert.deepEqual(rows.map(r => r.recorded), [0, 0, 0, 0]);
  assert.equal(rows[1].countLine, '可练 2 个 · 写过 0 个');
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
  // D84：真题库读 ShiziCore 的 deck.json（seed + overrides）。
  const deck = JSON.parse(fs.readFileSync(path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled/deck.json'), 'utf8'));
  setDeckSource({ seed: deck.seed, overrides: deck.overrides });
  try {
    const rows = libraryRows({ settings: null, records: { '2026-09': [rec('r1', '的'), rec('r2', '耶')] } });
    assert.deepEqual(rows.map(r => r.total), [3500, 2974, 744, 2500]);
    assert.deepEqual(rows.map(r => r.recorded), [1, 1, 0, 1]);
    assert.equal(rows[1].countLine, '可练 2974 个 · 写过 1 个');
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
  assert.deepEqual(countSegments(t('R-L06.countLine', { n: 3500, m: 30 })), ['可练 3500 个', '写过 30 个']);
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

test('I3 P1-19: switching does not lose anything (records / custom / wrong list stay), so there is no confirm dialog any more', () => {
  const src = readFileSync(new URL('../../src/ui/screens/library/switch.js', import.meta.url), 'utf8');
  assert.ok(!/LibraryConfirm|openLibraryConfirm|alertdialog|libswitch-confirm|libswitch-ok/.test(src), 'no confirm component left');
  assert.throws(() => t('X-LIBSWITCH.confirmTitle', { library: 'x' }), 'confirm copy removed');
  assert.throws(() => t('R-L06.confirmBody'), 'confirm body removed');
});

test('switchLibrary: one commit, true on success; a failed write is reported untouched (the page then shows the in-place 三段式)', () => {
  const { store, storage } = freshStore();
  assert.equal(switchLibrary('adv3000', { getStore: () => store }).ok, true);
  assert.deepEqual(store.getState().settings, { library: 'adv3000' });
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  const r = switchLibrary('rare', { getStore: () => store });
  assert.equal(r.ok, false);
  assert.deepEqual(store.getState().settings, { library: 'adv3000' }, 'unchanged after the failed write');
  assert.equal(switchLibrary('rare', { getStore: () => store }).ok, true, 'retry is the same commit');
});

test('SwitchFail: 先不换 / 再试一次 with the save-failed sentence', () => {
  let retried = 0;
  let stayed = 0;
  const vnode = SwitchFail({ onRetry: () => { retried += 1; }, onStay: () => { stayed += 1; } });
  const ids = byTestid(vnode);
  assert.equal(textOf(ids['libswitch-fail-note']), '没保存上，刚才的选择没记下。');
  assert.equal(textOf(ids['libswitch-stay']), '先不换');
  assert.equal(textOf(ids['libswitch-retry']), '再试一次');
  ids['libswitch-retry'].props.onClick({ timeStamp: 1e9 });
  ids['libswitch-stay'].props.onClick({ timeStamp: 2e9 });
  assert.deepEqual([retried, stayed], [1, 1]);
});

test('screen registered as library-switch; library names from copy', () => {
  assert.equal(LIBRARY_SWITCH_SCREEN, 'library-switch');
  assert.ok(getScreen('library-switch'), 'registered');
  assert.equal(libraryName('rare'), '少见字');
  assert.throws(() => t('X-LIBSWITCH.switchedToast', { library: libraryName('adv3000') }), 'D58: switching shows no toast');
});
