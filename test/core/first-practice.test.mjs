// 第一次练习（阶段 1 P1-E4，决定 D38：尴 → 赢 → 拾，3 个字；覆盖 D17 / P09 的 5 字）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as policy from '../../src/config/policy.js';
import { isWarmupChar } from '../../src/core/new-order.js';
import { createSession, selectFirst } from '../../src/core/sessions.js';
import { buildCards, cardKey } from '../../src/core/cards.js';
import { t } from '../../src/config/copy/index.js';
import { at, ROOT } from './helpers.mjs';

const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/engineering/v10/phase1/易忘度字表-1.0.json'), 'utf8'));

function loadSeed() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8') + ';this.SEED = SEED', ctx);
  return ctx.SEED;
}

test('policy.firstQueue is 尴 赢 拾: the table\'s default combination A, none of them a warm-up char', () => {
  assert.deepEqual([...policy.firstQueue], ['尴', '赢', '拾']);
  assert.deepEqual(selectFirst(), ['base:尴', 'base:赢', 'base:拾']);
  for (const c of policy.firstQueue) assert.equal(isWarmupChar(c), false, c);
  const combo = TABLE.firstCombos.find((x) => x.id === TABLE.defaultCombo);
  assert.deepEqual([...policy.firstQueue], combo.chars, 'policy.firstQueue = the table\'s default combination A');
  for (const row of combo.rows) assert.equal(row.norm, '一级', row.char + ' is in core3500');
});

test('all three first-practice chars are in the default library (规范常用字 = norm 一级) and their words are 尴尬 / 赢得 / 收拾', () => {
  const cards = buildCards({ seed: loadSeed(), overrides: {} });
  const byKey = new Map(cards.map((c) => [cardKey(c), c]));
  const words = { 尴: '尴尬', 赢: '赢得', 拾: '收拾' };
  for (const c of policy.firstQueue) {
    const card = byKey.get('base:' + c);
    assert.ok(card, c + ' is in the deck');
    assert.equal(card.norm, '一级', c + ' belongs to core3500');
    assert.equal(card.word, words[c], c + ' word');
  }
});

test('the first group is 3 characters and only the first practice: progress reads 1 / 3, later groups stay at groupSize', () => {
  const q = selectFirst();
  const s = createSession({ id: 's1', kind: 'first', queue: q, at: at('2026-09-24') });
  assert.equal(s.queue.length, 3);
  assert.equal(t('R-W01.progress', { n: s.cursor + 1, total: s.queue.length }), '1 / 3');
  assert.equal(t('R-H04.resumeFirst', { n: 1, total: 3 }), '首次练习 · 1 / 3');
  assert.equal(t('R-H04.resumeFirstAria', { n: 1, total: 3 }), '接着写首次练习，已写 1 个，共 3 个');
  assert.equal(t('R-H03.firstVisit'), '先写三个大家常忘的字。', 'P1-E5: the line under 开始写字 (stage-1 design §一)');
  assert.equal(policy.groupSize, 20); // D65 #2：每组字数缺省 20（首练仍是 3）
});
