// 卡 C1（D50 ①）：来源授权有问题的 76 个补充字从题库与笔顺数据里移除（合规说明 §1.8–§1.10、附录 B；
// 记录与回执见 audit/compliance-2026-10/）。
//   1. 这 76 个字不在 SEED / GROUPS / data/<字>.json / core-strokes.js / 新字顺序里；𬇕（霞鹜文楷 GB 轮廓，OFL）保留；
//   2. 已有用户记录里有这些字时按现有「字不在题库」路径降级：不可练、不进今天的练习（到期复习 / 新字 / 自选）、不进提醒，
//      清单里照常列出但不可勾选，字库归属为空，备份照常导出再导入、记录一条不少——都不抛错。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.mjs';
import { setDeckSource, deckAdapter, isPracticable, cardForKey, libraryIdsOfKey } from '../../src/data/deck.js';
import { planDaily } from '../../src/core/session-start.js';
import { reminderCandidates } from '../../src/platform/reminder.js';
import { listModel } from '../../src/ui/screens/library/list-model.js';
import { buildBackupV2, serializeBackup, inspectBackup, stateOfEntries } from '../../src/core/backup.js';
import { makeRecord } from '../../src/core/records.js';
import { CHAR_ORDER } from '../../src/config/char-order.js';

const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/compliance-2026-10/source-removal-76.receipt.json'), 'utf8'));
const REMOVED = receipt.removed.map(row => row.character);

function loadDeckGlobals() {
  const context = vm.createContext(Object.create(null));
  for (const file of ['deck-data.js', 'data/context-overrides.js', 'core-strokes.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    new vm.Script(file === 'core-strokes.js' ? `var self = globalThis; ${src}` : src, { filename: file }).runInContext(context);
  }
  return JSON.parse(new vm.Script('JSON.stringify({ seed: SEED, groups: GROUPS, overrides: CONTEXT_OVERRIDES, core: self.SHIZI_CORE_STROKES })').runInContext(context));
}
const DECK = loadDeckGlobals();

test('the 76 source-problem characters are gone from the deck, the stroke data and the new-character order; 𬇕 stays', () => {
  assert.equal(REMOVED.length, 76);
  assert.equal(new Set(REMOVED).size, 76);
  assert.equal(receipt.removed.filter(r => r.source_group === 'strokeorder_cc').length, 59);
  assert.equal(receipt.removed.filter(r => r.source_group === 'moe_stroke_order').length, 10);
  assert.equal(receipt.removed.filter(r => r.source_group === 'stkaiti_outline').length, 7);
  const targets = new Set(DECK.seed.map(row => row.target));
  const ordered = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2, ...CHAR_ORDER.warmup]);
  for (const ch of REMOVED) {
    assert.ok(!targets.has(ch), `SEED still has ${ch}`);
    assert.ok(!(ch in DECK.groups), `GROUPS still has ${ch}`);
    assert.ok(!(ch in DECK.overrides), `context overrides still have ${ch}`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'data', `${ch}.json`)), `data/${ch}.json still ships`);
    assert.ok(!DECK.core.includes(ch), `core-strokes.js still lists ${ch}`);
    assert.ok(!ordered.has(ch), `char-order still lists ${ch}`);
  }
  assert.equal(DECK.seed.length, 7218);
  assert.equal(Object.keys(DECK.groups).length, 7218);
  assert.ok(targets.has('𬇕') && fs.existsSync(path.join(ROOT, 'data', '𬇕.json')), '𬇕 (LXGW WenKai GB outline, OFL) is kept');
  const manifest = fs.readFileSync(path.join(ROOT, 'scripts/shell-manifest.txt'), 'utf8').split('\n');
  for (const ch of REMOVED) assert.ok(!manifest.includes(`data/${ch}.json`), `shell manifest still lists data/${ch}.json`);
});

// ---------------------------------------------------------------- 旧记录降级

const TODAY = '2026-10-04';
const AT = new Date(2026, 9, 4, 9).getTime();
const DAY_MS = 24 * 3600 * 1000;
const GONE = ['廆', '嚭', '㧐']; // strokeorder.cc / 台湾教育部 / 华文楷体 各一个
const KEPT = ['永', '鼎'];

let serial = 0;
function judged(char, judgment, at) {
  serial += 1;
  return makeRecord({ id: `r${serial}`, cardKey: `base:${char}`, sessionId: 's1', kind: 'judged', judgment, at, help: {} });
}
function entry(due) {
  return { due, fsrs: { stability: 1 }, lastJudgedAt: AT - 3 * DAY_MS };
}
function legacyState() {
  const records = [
    ...GONE.map(ch => judged(ch, 'wrong', AT - 3 * DAY_MS)),
    ...KEPT.map(ch => judged(ch, 'wrong', AT - 3 * DAY_MS)),
  ];
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] = months[r.localDay.slice(0, 7)] || []).push(r);
  const sched = {};
  for (const ch of [...GONE, ...KEPT]) sched[`base:${ch}`] = entry('2026-10-01');
  return {
    records: months,
    sched,
    custom: { added: [{ char: '嚭', at: AT - DAY_MS }, { char: '永', at: AT - DAY_MS }] },
    settings: { library: 'rare', remind: { enabled: true, hour: 21, minute: 0 } },
    wordOff: null,
  };
}

test('old records that mention a removed character degrade through the existing 「not in the deck」 path without throwing', () => {
  setDeckSource({ seed: DECK.seed, overrides: DECK.overrides });
  try {
    for (const ch of GONE) {
      assert.equal(isPracticable(`base:${ch}`), false, `${ch} is no longer practicable`);
      assert.equal(cardForKey(`base:${ch}`), null);
      assert.deepEqual(libraryIdsOfKey(`base:${ch}`), [], `${ch} belongs to no library`);
    }
    for (const ch of KEPT) assert.equal(isPracticable(`base:${ch}`), true);

    const state = legacyState();
    const plan = planDaily(state, { today: TODAY, deck: deckAdapter });
    const planned = new Set(plan.queue);
    for (const ch of GONE) assert.ok(!planned.has(`base:${ch}`), `today's practice does not offer ${ch}`);
    assert.ok(planned.has('base:鼎') || planned.has('base:永'), 'due characters still in the deck are still offered');
    assert.equal(plan.libraryId, 'rare', 'the 三级 library (which held most removed characters) still works');

    const reminded = reminderCandidates(state).map(c => c.cardKey);
    for (const ch of GONE) assert.ok(!reminded.includes(`base:${ch}`), `reminder never asks for ${ch}`);

    const list = listModel(state, { kind: 'wrong', today: TODAY, cardFor: cardForKey, practicable: isPracticable });
    const rows = new Map(list.rows.map(r => [r.char, r]));
    for (const ch of GONE) {
      assert.ok(rows.has(ch), `the 写错过 list still shows the user's own record of ${ch}`);
      assert.equal(rows.get(ch).selectable, false, `${ch} cannot be picked for a new group`);
    }
    assert.ok(!list.selectedKeys.some(k => GONE.some(ch => k === `base:${ch}`)));

    const text = serializeBackup(buildBackupV2(state, { now: AT }));
    const report = inspectBackup(text);
    assert.equal(report.ok, true, 'a backup that contains removed characters is still valid');
    assert.equal(report.count, GONE.length + KEPT.length, 'every judged character is counted, removed ones included');
    const back = Object.values(stateOfEntries(report.entries).records).flat().map(r => r.char).sort();
    assert.deepEqual(back, [...GONE, ...KEPT].sort(), 'no record is dropped on export / import');
  } finally {
    setDeckSource(null);
  }
});
