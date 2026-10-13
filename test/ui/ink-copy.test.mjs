// F4：文案里凡是承诺「你的笔迹 / 你写的字」的槽，要么按 policy.features.perRecordInk 取 …Glyph 变体（P31 关闭时出货的是变体），
// 要么在这里登记为「两种情况都成立」并写明理由。新增这类文案没登记会红，逼着先对照实际行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { COPY, inkKey, tInk, t } from '../../src/config/copy/index.js';

/** 提到笔迹 / 你写的字 / 你的书写 的槽（基础槽；变体槽单独核）。 */
const INK_WORDS = /笔迹|你写的|你的字|你的书写/;

/** 有 …Glyph 变体的槽：perRecordInk=true 才取基础槽，关闭（现行）取变体。 */
const VARIANTS = ['R-L03.legend', 'X-LIBHOME.legendDarkNote', 'R-A01.sortRecentNote', 'R-E03.wrongNote', 'R-E03.forgetNote', 'R-D04.noInkNote'];

/** 两种情况都成立的槽（只在「有笔迹」或「说的是记录 / 文字」时才出现，或根本不涉及格子画什么）。 */
const BOTH_TRUE = {
  'X-ABOUT.privacy1': '隐私说明：写下的内容只存在本机，与格子画什么无关',
  'R-D07.noInkLabel': '没有笔迹时的标签',
  'R-D07.noInkLarge': '没有笔迹时的说明',
  'X-DETAIL.cellNoInkLabel': '详情记录格没存下墨时的读屏名称：只给这条记录确实没墨的格子（detail/records.js Cell has = false），与格子画什么一致',
  'R-I01.glyphNote': '手写字图片只有最近一次有笔迹（持久或本页面会话）才能生成，否则入口置灰（R-D04）',
  'X-IMAGES.missingSession': '说明缺墨的字不在图里',
  'X-IMAGES.missingDay': '说明缺墨的字不在图里',
  'X-IMAGES.missingMonth': '说明缺墨的字不在图里',
  'R-R07.missingInk': '说明缺墨的字不在图里',
  'R-R07.allMissing': '说明没有笔迹，不能保存',
  'R-M06.inkDate': '年度报告只在这一次确有笔迹时才显示该说明行（annual.js hasInk）',
  'X-ANNUAL.firstInk': '只在有笔迹时用的读屏名称',
  'X-ANNUAL.firstNoInk': '没有笔迹时的读屏名称',
  'R-W09.labelMine': '对照页「你的书写」是刚写的笔画，perRecordInk 无关',
  'R-W09.mineCardLabel': '对照卡读屏名称「你的书写，N 笔」，同样是刚写的笔画（A9），perRecordInk 无关',
  'R-P03.todayChars': '「这天写的字」指记录里的字，不指笔迹',
  'R-W16.saveFailed': '写字页保存失败：刚写的笔画还在页面上',
  'X-LIBHOME.emptyTitle': '空态：写过的字会留在这里（字，不是笔迹）',
  // 阶段 1 P1-E8「在纸上写」：说的是纸上那次「不留笔迹」，纸上记录本来就没有墨迹，与 perRecordInk 开关无关
  // 阶段 1 P1-E7：作品出口。下面都是「按这一条记录有没有墨」逐条判断后才出现的文案（有墨才画笔迹、没墨才说没有），与格子画什么一致
  'X-WORK.rowNoInkCorrect': '结果页作品下的行：这条记录确实没有墨（work.js state noInk），才出现这一行',
  'X-WORK.rowNoInkWrong': '同上（写错且没有墨）',
  'X-WORK.annualFirstDate': '年报卷首「{日期}的笔迹」：只在今年第一个字确有留墨的那一次时画成笔迹格（annual.js hasInk），说的是那次的日子',
  'X-WORK.monthUnderNote': '月字帖说明句：只在本月确有整月没留墨的字（画 under 衬底）时出现',
  'X-WORK.monthCellNoInk': '月字帖里画衬底的格子的读屏名称：只给 mode under 的格子',
  'X-WORK.cellInkDay': '月字帖格的读屏名称：只给取到墨迹、且墨迹日与角标日不同的格子（month.js cellLabel）',
  'X-WORK.annualFirstCellAria': '年报卷尾「同一个字，两次」两格的读屏名称：两格都是确有墨的记录（twiceOfYear 只选有墨的）',
  'X-WORK.annualLastCellAria': '同上（最近一次）',
};

test('F4: every copy slot that mentions 笔迹 / 你写的字 is a variant pair or registered as true either way', () => {
  const variantSet = new Set(VARIANTS);
  const unregistered = [];
  for (const [key, value] of Object.entries(COPY)) {
    if (key.endsWith('Glyph')) continue;
    const text = [].concat(value).join('');
    if (!INK_WORDS.test(text)) continue;
    if (variantSet.has(key) || Object.prototype.hasOwnProperty.call(BOTH_TRUE, key)) continue;
    unregistered.push(key + ' → ' + text);
  }
  assert.deepEqual(unregistered, [], '新的「笔迹」类文案要先对照 perRecordInk 开 / 关时实际画什么：做 …Glyph 变体，或登记进 BOTH_TRUE');
  for (const key of Object.keys(BOTH_TRUE)) assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), 'stale BOTH_TRUE entry ' + key);
});

test('F4: each …Glyph variant exists and makes no handwriting promise', () => {
  const PROMISE = /最近一次的笔迹|最近的笔迹|每次的笔迹|你写错的那一次|你当时的笔迹|你的笔迹|看笔迹|再写一次就能做图片/;
  for (const base of VARIANTS) {
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, base), base + ' exists');
    const glyphKey = base + 'Glyph';
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, glyphKey), glyphKey + ' exists');
    assert.ok(!PROMISE.test([].concat(COPY[glyphKey]).join('')), glyphKey + ' must not promise ink');
    // r7-C1（D61）：文案重写后个别说明句（R-E03.wrongNote / forgetNote）两种写法已无差别——原槽不再承诺笔迹，就不必比变体多说什么
    const same = [].concat(COPY[base]).join('') === [].concat(COPY[glyphKey]).join('');
    assert.ok(same || PROMISE.test([].concat(COPY[base]).join('')), base + ' is the ink-promising original (only valid with perRecordInk=true)');
  }
  // 变体槽名都有对应的基础槽（不留孤儿）
  for (const key of Object.keys(COPY)) {
    const base = key.slice(0, -'Glyph'.length);
    if (key.endsWith('Glyph') && Object.prototype.hasOwnProperty.call(COPY, base)) assert.ok(VARIANTS.includes(base), key + ' is a variant of ' + base + ': list it in VARIANTS');
  }
});

test('F4: tInk / inkKey follow policy.features.perRecordInk (live value; default on since D27)', () => {
  assert.equal(policy.features.perRecordInk, true, 'P31 decided D27 (stage 1 P1-E3)');
  const off = { features: { perRecordInk: false } };
  const on = { features: { perRecordInk: true } };
  for (const base of VARIANTS) {
    assert.equal(inkKey(base), base, 'default (on) → original slot');
    assert.equal(tInk(base), t(base));
    assert.equal(inkKey(base, on), base);
    assert.equal(tInk(base, undefined, on), t(base));
    assert.equal(inkKey(base, off), base + 'Glyph', 'off → Glyph variant (10.12 fallback kept)');
    assert.equal(tInk(base, undefined, off), t(base + 'Glyph'));
  }
  // features 缺失 / 非 true 一律按关闭
  assert.equal(inkKey('R-A01.sortRecentNote', {}), 'R-A01.sortRecentNoteGlyph');
  assert.equal(inkKey('R-A01.sortRecentNote', { features: { perRecordInk: 'yes' } }), 'R-A01.sortRecentNoteGlyph');
});

test('A5 (G17): detail / image no-ink note does not promise that writing again makes the image when perRecordInk is off', () => {
  const off = tInk('R-D04.noInkNote', undefined, { features: { perRecordInk: false } });
  assert.equal(off, t('R-D04.noInkNoteGlyph'));
  assert.ok(!/再写一次就能做图片/.test(off));
  // perRecordInk=true：笔迹落盘，「再写一次」成立，取原槽
  assert.equal(tInk('R-D04.noInkNote', undefined, { features: { perRecordInk: true } }), t('R-D04.noInkNote'));
});

test('D27 (P1-E3): with perRecordInk on, the shown slots only promise what is kept — first + latest ink per char, nothing about every time', () => {
  // D27 只留每字第一次与最近一次判断的墨迹，中间那次回收后显示「没有笔迹」：任何开启时出货的槽都不得承诺「每次 / 历次的笔迹」。
  const EVERY = /每次的笔迹|每一次的笔迹|历次的笔迹|所有的笔迹/;
  const shown = Object.keys(COPY).filter(key => !key.endsWith('Glyph'));
  const bad = shown.filter(key => EVERY.test([].concat(COPY[key]).join('')));
  assert.deepEqual(bad, [], 'slots promising every judgment\'s ink');
  // 字库墙说明（浅 / 深）改说第一次与最近一次，且仍是承诺笔迹的原槽（只在开启时取）
  for (const key of ['R-L03.legend', 'X-LIBHOME.legendDarkNote']) assert.match(t(key), /看笔迹/, key); // D61 文案重写：不再逐字说「第一次和最近一次」，仍是承诺笔迹的原槽
  // 月字帖按 P02 取「本月第一次」，缺墨说明不得说成「最近一次」
  assert.equal(policy.monthSheetPick, 'first');
  assert.doesNotMatch(t('X-IMAGES.missingMonth', { chars: '「水」' }), /最近一次/, 'month sheet picks the month\'s first record (P02)');
});

test('D42 (P122): month / day missing-ink sentences say the whole period has none — not "那一次" (a single record)', () => {
  assert.equal(t('X-IMAGES.missingMonth', { chars: '「水」' }), '「水」这个月没有留下笔迹，不在图里。');
  assert.equal(t('X-IMAGES.missingDay', { chars: '「水」' }), '「水」这天没有留下笔迹，不在图里。');
  assert.doesNotMatch(t('X-IMAGES.missingMonth', { chars: '「水」' }), /那一次|这一次/);
  assert.doesNotMatch(t('X-IMAGES.missingDay', { chars: '「水」' }), /那一次|这一次/);
  // 这次的图片（一次练习）仍是「这一次」：一次练习里同一个字的记录都没有墨迹
  assert.match(t('X-IMAGES.missingSession', { chars: '「水」' }), /这一次/);
});
