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
import vm from 'node:vm';
import { COMMON_RANK_MAX, generate } from '../../scripts/build_char_order.mjs';
import { ROOT } from './helpers.mjs';

const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/engineering/v10/phase1/易忘度字表-1.0.json'), 'utf8'));
const deckRows = () => vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8') + '\n;SEED');
const K = (s) => [...s].map((c) => 'base:' + c);

test('char-order.js is generated from the draft table (--check passes) and a change to the table makes it stale', async () => {
  const r = spawnSync(process.execPath, ['scripts/build_char_order.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const onDisk = fs.readFileSync(path.join(ROOT, 'src/config/char-order.js'), 'utf8');
  assert.equal(await generate(ROOT), onDisk, 'generate() reproduces the checked-in file byte for byte');
});

test('default order = the table order minus the reserved chars; nothing is reordered or invented', () => {
  const reserved = new Set([...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places, ...CHAR_ORDER.reserved.capitalNumerals, ...CHAR_ORDER.reserved.heavy]);
  assert.deepEqual([...CHAR_ORDER.order], TABLE.order.filter((c) => !reserved.has(c)));
  assert.deepEqual([...CHAR_ORDER.level2], TABLE.level2Appendix.map((e) => e.char).filter((c) => !reserved.has(c)));
  assert.deepEqual([...CHAR_ORDER.warmup], TABLE.warmup.order, 'warm-up list is the table\'s, none of them reserved');
  assert.equal(new Set(CHAR_ORDER.order).size, CHAR_ORDER.order.length, 'no duplicates');
  assert.ok(CHAR_ORDER.order.length > 400);
});

test('D39 / D40 / D45: rarely-used surnames / place names and capital numerals are not in the default sort', () => {
  const inOrder = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2]);
  const sample = {
    surnames: '滕翟蔺',
    places: '黔滇渝',
    capital: '壹贰叁肆伍陆柒捌玖拾佰仟',
  };
  for (const [group, chars] of Object.entries(sample)) {
    for (const c of chars) {
      assert.equal(inOrder.has(c), false, `${c}（${group}）不应在默认排序里`);
      assert.equal(isReservedChar(c), true, `${c} reserved`);
    }
  }
  // 它们也不会从「清单之后的字频尾部」混进来
  const lib = K('的一是滕翟黔渝壹肆拾佰仟春酱尴赢热');
  const ordered = orderNewKeys(lib);
  for (const c of '滕翟黔渝壹肆拾佰仟') assert.equal(ordered.includes('base:' + c), false, c);
  // removed 列表逐个写明（供审读）：肆 贰 拾 是主表里的大写数字；姓氏 / 地名带字频
  assert.ok(CHAR_ORDER.removed.capitalNumerals.some((x) => x.startsWith('肆')));
  assert.ok(CHAR_ORDER.removed.surnames.every((x) => /字频#\d+/.test(x)) && CHAR_ORDER.removed.places.every((x) => /字频#\d+/.test(x)));
  assert.deepEqual(CHAR_ORDER.removed.surnames.map((x) => x[0]).sort(), [...'滕翟蔺'].sort());
  assert.deepEqual(CHAR_ORDER.removed.places.map((x) => x[0]).sort(), [...'黔滇渝'].sort());
  assert.equal(CHAR_ORDER.reserved.capitalNumerals.join(''), '壹贰叁肆伍陆柒捌玖拾佰仟');
});

test('D45 / P145: commonly-used surnames and place names (熊 颜 藏 桂 厦 傅 鞠 豫 疆 …) are back in the default sort, at their table positions', () => {
  const inOrder = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2]);
  for (const c of '熊颜藏桂厦傅鞠豫疆') {
    assert.equal(inOrder.has(c), true, `${c} 常用字在默认排序里`);
    assert.equal(isReservedChar(c), false, `${c} not reserved`);
    assert.equal([...CHAR_ORDER.commonKept.surnames, ...CHAR_ORDER.commonKept.places].includes(c), true, `${c} 登记在 commonKept`);
  }
  // 原位：与易忘度表里的相对顺序一致（只少了被剔除的字）
  const tableRest = TABLE.order.filter((c) => !CHAR_ORDER.reserved.capitalNumerals.includes(c) && !CHAR_ORDER.reserved.surnames.includes(c) && !CHAR_ORDER.reserved.places.includes(c));
  assert.deepEqual([...CHAR_ORDER.order], tableRest);
  // 经 orderNewKeys：常用姓氏 / 地名字按表序出现在前，不被挡在字频尾部之后
  const ordered = orderNewKeys(K('的一是熊颜藏桂厦傅鞠豫疆酱尴春')).map((k) => k.slice(5));
  for (const c of '熊颜藏桂厦傅鞠豫疆') assert.ok(ordered.includes(c), c);
  assert.ok(ordered.indexOf('疆') < ordered.indexOf('的'), 'listed chars precede the frequency tail');
  // 阈值与字频：reserved 里的姓氏 / 地名都比阈值靠后，commonKept 都不超过阈值；两边合起来正好是 curation 的两张清单
  const ranks = new Map();
  for (const row of deckRows()) if (!ranks.has(row.target) || row.rank < ranks.get(row.target)) ranks.set(row.target, row.rank);
  const max = CHAR_ORDER.meta.commonRankMax;
  assert.equal(max, COMMON_RANK_MAX);
  const surnameOnly = new Set(CHAR_ORDER.surnameOnly);
  for (const c of [...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places]) {
    if (!surnameOnly.has(c)) assert.ok(!(ranks.get(c) <= max), `${c} 生僻（字频 > ${max}）才剔除`);
  }
  for (const c of [...CHAR_ORDER.commonKept.surnames, ...CHAR_ORDER.commonKept.places]) assert.ok(ranks.get(c) <= max, `${c} 字频 ≤ ${max}`);
  assert.equal(CHAR_ORDER.reserved.surnames.length + CHAR_ORDER.commonKept.surnames.length, 32, '签名姓氏 31 字 ∪ 只作姓氏 7 字（袁不在签名清单里）');
  assert.equal(CHAR_ORDER.reserved.places.length + CHAR_ORDER.commonKept.places.length, 21);
});

test('D45 / P145: the threshold is a generator parameter — a stricter one (1500) removes more of the list', async () => {
  const strict = await generate(ROOT, { commonRankMax: 1500 });
  const onDisk = fs.readFileSync(path.join(ROOT, 'src/config/char-order.js'), 'utf8');
  assert.notEqual(strict, onDisk);
  const m = (text, key) => new RegExp('    ' + key + ': Object.freeze\\(\\[([^\\]]*)\\]\\)').exec(text.slice(text.indexOf('reserved: Object.freeze')))[1];
  // 1500：熊 颜 桂 厦 …仍被剔除，藏 谢 鲁 戴 韩留下 → 说明阈值确实起作用
  assert.ok(m(strict, 'surnames').includes('熊') && !m(strict, 'surnames').includes('谢'));
  assert.ok(m(strict, 'places').includes('桂') && !m(strict, 'places').includes('藏'));
  assert.ok(strict.includes('commonRankMax: 1500'));
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
  const seed = [row('的确', 0, 1), row('一个', 0, 2), row('是的', 0, 3), row('春天', 0, 400), row('酱油', 0, 900), row('尴尬', 0, 950), row('滕国', 0, 1000), row('壹元', 0, 1100), row('拾取', 0, 1200), row('渝州', 0, 1300), row('嚏喷', 0, 1400, '二级', null)];
  setDeckSource({ seed, overrides: {} });
  try {
    const core = deckAdapter.newCandidates('core3500');
    assert.deepEqual(core.slice(0, 2), K('尴酱'), 'listed chars first (尴 before 酱 in the 1.0 table), table order');
    assert.equal(core.includes('base:滕') || core.includes('base:壹') || core.includes('base:拾') || core.includes('base:渝'), false, 'reserved never come as new');
    assert.deepEqual(core.slice(2), K('的一是春'), 'then the rest in frequency order');
    assert.deepEqual(deckAdapter.warmupCandidates('core3500'), K('春'));
    assert.deepEqual(warmupOf('adv3000'), [], '二级库里没有热身字');
    assert.deepEqual(deckAdapter.newCandidates('adv3000'), K('嚏'));
    assert.deepEqual(newOrderOf('core3500'), core);
    assert.ok(Object.isFrozen(newOrderOf('core3500')));
    assert.equal(libraryOf('core3500').keys.includes('base:滕'), true, 'the library itself still holds them (look-up, pick)');
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
  assert.equal(special.promptHint, '借条上的大写金额');
  assert.equal(card.word, '大肆', 'input not mutated');
  assert.equal(capitalCard(null, K('壹')), null);
  const noCtx = { word: '尴尬', chars: ['尴', '尬'], ci: 0, target: '尴' };
  assert.equal(capitalCard(noCtx, K('壹贰叁肆伍')), noCtx);
});

test('D50 ⑤ ⑥ (C1): surname-only chars go to 「姓氏与地名」 whatever their frequency; heavy chars never come as new, yet stay practicable', () => {
  assert.deepEqual([...CHAR_ORDER.surnameOnly], [...'薛彭潘蔡阎魏袁']);
  for (const c of '薛彭潘蔡阎魏袁') {
    assert.ok(CHAR_ORDER.reserved.surnames.includes(c), `${c} in reserved.surnames`);
    assert.ok(!CHAR_ORDER.commonKept.surnames.includes(c), `${c} not kept in the default order`);
    assert.equal(isReservedChar(c), true);
  }
  for (const c of '癌瘤瘟痢癣瘸棺妓娼嫖') {
    assert.ok(CHAR_ORDER.reserved.heavy.includes(c), `${c} in reserved.heavy`);
    assert.equal(isReservedChar(c), true);
  }
  const inOrder = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2, ...CHAR_ORDER.warmup]);
  for (const c of [...CHAR_ORDER.surnameOnly, ...CHAR_ORDER.reserved.heavy]) assert.ok(!inOrder.has(c), `${c} not in any default list`);
  // 字频尾部也不出现：彭 #1340、癌 #1907 这类常用字以前会按字频冒出来
  const ordered = orderNewKeys(K('的一是彭潘蔡魏癌瘤棺妓春')).map((k) => k.slice(5));
  assert.deepEqual([...ordered].sort(), [...'的一是春'].sort(), 'only the ordinary chars come as new');
});
