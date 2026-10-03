// 新字顺序（阶段 1 P1-E4：D28 易忘度排序、D39 姓氏与地名、D40 大写数字）：data/char-order.js（脚本生成）+ core/new-order.js + data/deck.js 适配器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHAR_ORDER } from '../../src/config/char-order.js';
import {
  capitalAfterKeys, capitalGroupKeys, isCapitalChar, isCapitalQueue, isReservedChar, isWarmupChar, orderNewKeys, warmupKeys,
} from '../../src/core/new-order.js';
import { capitalCard, deckAdapter, setDeckSource, libraryOf, newOrderOf, warmupOf } from '../../src/data/deck.js';
import { generate } from '../../scripts/build_char_order.mjs';
import { ROOT } from './helpers.mjs';

const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/engineering/v10/phase1/易忘度字表-初稿.json'), 'utf8'));
const K = (s) => [...s].map((c) => 'base:' + c);

test('char-order.js is generated from the draft table (--check passes) and a change to the table makes it stale', async () => {
  const r = spawnSync(process.execPath, ['scripts/build_char_order.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const onDisk = fs.readFileSync(path.join(ROOT, 'src/config/char-order.js'), 'utf8');
  assert.equal(await generate(ROOT), onDisk, 'generate() reproduces the checked-in file byte for byte');
});

test('default order = the table order minus the reserved chars; nothing is reordered or invented', () => {
  const reserved = new Set([...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places, ...CHAR_ORDER.reserved.capitalNumerals]);
  assert.deepEqual([...CHAR_ORDER.order], TABLE.order.filter((c) => !reserved.has(c)));
  assert.deepEqual([...CHAR_ORDER.level2], TABLE.level2Appendix.map((e) => e.char).filter((c) => !reserved.has(c)));
  assert.deepEqual([...CHAR_ORDER.warmup], TABLE.warmup.order, 'warm-up list is the table\'s, none of them reserved');
  assert.equal(new Set(CHAR_ORDER.order).size, CHAR_ORDER.order.length, 'no duplicates');
  assert.ok(CHAR_ORDER.order.length > 400);
});

test('D39 / D40: surnames, province abbreviations / common place names and capital numerals are not in the default sort', () => {
  const inOrder = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2]);
  const sample = {
    surnames: '戴魏薛谭蔡潘彭鲍萧黎熊颜霍傅阎鞠廖瞿龚',
    places: '冀豫赣鄂湘黔滇蜀闽粤桂渝沪厦藏疆',
    capital: '壹贰叁肆伍陆柒捌玖拾佰仟',
  };
  for (const [group, chars] of Object.entries(sample)) {
    for (const c of chars) {
      assert.equal(inOrder.has(c), false, `${c}（${group}）不应在默认排序里`);
      assert.equal(isReservedChar(c), true, `${c} reserved`);
    }
  }
  // 它们也不会从「清单之后的字频尾部」混进来
  const lib = K('的一是魏戴疆豫壹肆拾佰仟春酱尴赢热');
  const ordered = orderNewKeys(lib);
  for (const c of '魏戴疆豫壹肆拾佰仟') assert.equal(ordered.includes('base:' + c), false, c);
  // removed 列表逐个写明（供审读）：肆 贰 拾 是主表里的大写数字
  assert.ok(CHAR_ORDER.removed.capitalNumerals.some((x) => x.startsWith('肆')));
  assert.ok(CHAR_ORDER.removed.surnames.length >= 10 && CHAR_ORDER.removed.places.length >= 10);
  assert.equal(CHAR_ORDER.reserved.capitalNumerals.join(''), '壹贰叁肆伍陆柒捌玖拾佰仟');
});

test('listed chars come first in table order; unlisted chars follow in the original frequency order; keys outside the list are kept', () => {
  const freq = K('的一是了不我酱人在尴有他这春中大来醋上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工已');
  const ordered = orderNewKeys(freq);
  const listed = ordered.filter((k) => CHAR_ORDER.order.includes(k.slice(5)));
  assert.deepEqual(listed.map((k) => k.slice(5)), CHAR_ORDER.order.filter((c) => freq.includes('base:' + c)), 'listed part follows the table order');
  const firstUnlisted = ordered.findIndex((k) => !CHAR_ORDER.order.includes(k.slice(5)));
  assert.ok(firstUnlisted >= listed.length - 1 && ordered.slice(firstUnlisted).every((k) => !CHAR_ORDER.order.includes(k.slice(5))), 'listed chars all before unlisted ones');
  const tail = ordered.slice(firstUnlisted).map((k) => k.slice(5));
  assert.deepEqual(tail, [...freq].map((k) => k.slice(5)).filter((c) => !CHAR_ORDER.order.includes(c) && !CHAR_ORDER.level2.includes(c)), 'unlisted keep their frequency order');
  // 高频字「的 一 是」不再排最前（旧口径 P74 字频序）
  assert.notDeepEqual(ordered.slice(0, 3), K('的一是'));
  assert.equal(orderNewKeys([]).length, 0);
  assert.deepEqual(orderNewKeys(null), []);
});

test('swapping the table swaps the order: orderNewKeys / warmupKeys read only the data they are given', () => {
  const data = {
    order: ['乙', '甲'], level2: ['丙'], warmup: ['丁', '春'],
    reserved: { surnames: ['戊'], places: [], capitalNumerals: [] },
    capital: CHAR_ORDER.capital,
  };
  assert.deepEqual(orderNewKeys(K('甲乙丙丁戊'), data), K('乙甲丙丁'));
  assert.deepEqual(warmupKeys(K('春丁甲'), data), K('丁春'));
  assert.equal(isWarmupChar('丁', data), true);
  assert.equal(isWarmupChar('甲', data), false);
  assert.equal(isReservedChar('戊', data), true);
});

test('deck adapter: newCandidates are in table order for the default library, 的 一 是 do not lead, warm-up chars are listed separately', () => {
  const row = (ans, ci, rank, norm = '一级', edu = '表一') => ({ py: 'x', hint: 'h', ans, ci, target: Array.from(ans)[ci], rank, strokes: 8, parts: 2, topic: 't', d: 50, band: '进阶', edu, common: 3, norm, std: 1, ctx: 'dict' });
  const seed = [row('的确', 0, 1), row('一个', 0, 2), row('是的', 0, 3), row('春天', 0, 400), row('酱油', 0, 900), row('尴尬', 0, 950), row('魏国', 0, 1000), row('壹元', 0, 1100), row('拾取', 0, 1200), row('疆土', 0, 1300), row('嚏喷', 0, 1400, '二级', null)];
  setDeckSource({ seed, overrides: {} });
  try {
    const core = deckAdapter.newCandidates('core3500');
    assert.deepEqual(core.slice(0, 2), K('酱尴'), 'listed chars first (酱 before 尴 in the table), table order');
    assert.equal(core.includes('base:魏') || core.includes('base:壹') || core.includes('base:拾') || core.includes('base:疆'), false, 'reserved never come as new');
    assert.deepEqual(core.slice(2), K('的一是春'), 'then the rest in frequency order');
    assert.deepEqual(deckAdapter.warmupCandidates('core3500'), K('春'));
    assert.deepEqual(warmupOf('adv3000'), [], '二级库里没有热身字');
    assert.deepEqual(deckAdapter.newCandidates('adv3000'), K('嚏'));
    assert.deepEqual(newOrderOf('core3500'), core);
    assert.ok(Object.isFrozen(newOrderOf('core3500')));
    assert.equal(libraryOf('core3500').keys.includes('base:魏'), true, 'the library itself still holds them (look-up, pick)');
  } finally {
    setDeckSource(null);
  }
});

test('capital numerals data: groups 壹贰叁肆伍 / 陆柒捌玖拾, 佰仟 after; every one has a leak-free context word with the target exactly once', () => {
  assert.deepEqual(capitalGroupKeys().map((g) => g.map((k) => k.slice(5)).join('')), ['壹贰叁肆伍', '陆柒捌玖拾']);
  assert.deepEqual(capitalAfterKeys(), K('佰仟'));
  for (const c of '壹贰叁肆伍陆柒捌玖拾佰仟') {
    assert.equal(isCapitalChar(c), true);
    const ctx = CHAR_ORDER.capital.contexts[c];
    assert.ok(ctx, c + ' has a context');
    const chars = Array.from(ctx.word);
    assert.equal(chars[ctx.ci], c);
    assert.equal(chars.filter((x) => x === c).length, 1, 'target appears once → no repeat-blank instruction');
    assert.equal(ctx.promptHint.includes(c), false, 'hint does not leak the answer');
    assert.match(ctx.promptHint, /借条|报销|红包|收据/);
    assert.ok(ctx.py);
  }
  assert.equal(isCapitalQueue(K('壹贰叁肆伍')), true);
  assert.equal(isCapitalQueue(K('陆柒捌玖拾')), true);
  assert.equal(isCapitalQueue(K('壹贰叁肆春')), false);
  assert.equal(isCapitalQueue([]), false);
});

test('capitalCard swaps in the money context only for a whole-capital queue; other cards and queues are untouched', () => {
  const card = { word: '大肆', chars: ['大', '肆'], ci: 1, target: '肆', py: 'sì', hint: 'h', ctx: 'dict', rank: 1 };
  const plain = capitalCard(card, K('肆尴赢'));
  assert.equal(plain, card, 'not a special group → the very same card');
  const special = capitalCard(card, K('壹贰叁肆伍'));
  assert.equal(special.word, '肆仟元整');
  assert.deepEqual(special.chars, ['肆', '仟', '元', '整']);
  assert.equal(special.ci, 0);
  assert.equal(special.target, '肆');
  assert.equal(special.ctx, 'override');
  assert.equal(special.promptHint, '借条上写的金额');
  assert.equal(card.word, '大肆', 'input not mutated');
  assert.equal(capitalCard(null, K('壹')), null);
  const noCtx = { word: '尴尬', chars: ['尴', '尬'], ci: 0, target: '尴' };
  assert.equal(capitalCard(noCtx, K('壹贰叁肆伍')), noCtx);
});
