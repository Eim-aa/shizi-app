// F4：文案里凡是承诺「你的笔迹 / 你写的字」的槽，要么按 policy.features.perRecordInk 取 …Glyph 变体（P31 关闭时出货的是变体），
// 要么在这里登记为「两种情况都成立」并写明理由。新增这类文案没登记会红，逼着先对照实际行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { COPY, inkKey, tInk, t } from '../../src/config/copy/index.js';

/** 提到笔迹 / 你写的字 / 你的书写 的槽（基础槽；变体槽单独核）。 */
const INK_WORDS = /笔迹|你写的|你的字|你的书写/;

/** 有 …Glyph 变体的槽：perRecordInk=true 才取基础槽，关闭（现行）取变体。 */
const VARIANTS = ['R-L03.legend', 'X-LIBHOME.legendDarkNote', 'R-A01.sortRecentNote', 'R-E03.wrongNote', 'R-E03.forgetNote'];

/** 两种情况都成立的槽（只在「有笔迹」或「说的是记录 / 文字」时才出现，或根本不涉及格子画什么）。 */
const BOTH_TRUE = {
  'X-ABOUT.privacy1': '隐私说明：写下的内容只存在本机，与格子画什么无关',
  'R-D04.noInkNote': '只在最近一次没有笔迹时出现，说的就是「没有」',
  'R-D07.noInkLabel': '没有笔迹时的标签',
  'R-D07.noInkLarge': '没有笔迹时的说明',
  'R-I01.glyphNote': '手写字图片只有最近一次有笔迹（持久或本页面会话）才能生成，否则入口置灰（R-D04）',
  'X-IMAGES.missingSession': '说明缺墨的字不在图里',
  'X-IMAGES.missingMonth': '说明缺墨的字不在图里',
  'R-R07.missingInk': '说明缺墨的字不在图里',
  'R-R07.allMissing': '说明没有笔迹，不能保存',
  'R-M06.inkDate': '年度报告只在这一次确有笔迹时才显示该说明行（annual.js hasInk）',
  'X-ANNUAL.firstInk': '只在有笔迹时用的读屏名称',
  'X-ANNUAL.firstNoInk': '没有笔迹时的读屏名称',
  'R-W09.labelMine': '对照页「你的书写」是刚写的笔画，perRecordInk 无关',
  'R-P03.todayChars': '「这天写的字」指记录里的字，不指笔迹',
  'R-W16.saveFailed': '写字页保存失败：刚写的笔画还在页面上',
  'X-LIBHOME.emptyTitle': '空态：写过的字会留在这里（字，不是笔迹）',
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
  const PROMISE = /最近一次的笔迹|每次的笔迹|你写错的那一次|你当时的笔迹|你的笔迹/;
  for (const base of VARIANTS) {
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, base), base + ' exists');
    const glyphKey = base + 'Glyph';
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, glyphKey), glyphKey + ' exists');
    assert.ok(!PROMISE.test([].concat(COPY[glyphKey]).join('')), glyphKey + ' must not promise ink');
    assert.ok(PROMISE.test([].concat(COPY[base]).join('')), base + ' is the ink-promising original (only valid with perRecordInk=true)');
  }
  // 变体槽名都有对应的基础槽（不留孤儿）
  for (const key of Object.keys(COPY)) {
    const base = key.slice(0, -'Glyph'.length);
    if (key.endsWith('Glyph') && Object.prototype.hasOwnProperty.call(COPY, base)) assert.ok(VARIANTS.includes(base), key + ' is a variant of ' + base + ': list it in VARIANTS');
  }
});

test('F4: tInk / inkKey follow policy.features.perRecordInk (live value; default off)', () => {
  assert.equal(policy.features.perRecordInk, false);
  for (const base of VARIANTS) {
    assert.equal(inkKey(base), base + 'Glyph');
    assert.equal(tInk(base), t(base + 'Glyph'));
    const on = { features: { perRecordInk: true } };
    assert.equal(inkKey(base, on), base);
    assert.equal(tInk(base, undefined, on), t(base));
  }
  // features 缺失 / 非 true 一律按关闭
  assert.equal(inkKey('R-A01.sortRecentNote', {}), 'R-A01.sortRecentNoteGlyph');
  assert.equal(inkKey('R-A01.sortRecentNote', { features: { perRecordInk: 'yes' } }), 'R-A01.sortRecentNoteGlyph');
});
