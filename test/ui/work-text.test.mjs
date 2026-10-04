// 作品落款与纸面汉字文案（阶段 1 P1-E7；交接 §5.2 / §6.4 / §6.7 / §8；src/ui/work-text.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../../src/core/images/paginate.js';
import {
  annualBrandKuan, annualCoverLine, annualFirstDateText, annualTailDateText, annualTailKuan, annualYearText, monthDayText, monthKuan, partLabel, workKuan,
} from '../../src/ui/work-text.js';

const cellsOn = (day, n, from = 0) => Array.from({ length: n }, (_, i) => ({ ch: String.fromCodePoint(0x4e00 + from + i), day }));

test('落款 text (§5.2 / §6.4): 汉字日期 + 全角空格 + 汉字字数；2 写「两」；单字不写字数', () => {
  assert.equal(workKuan({ day: '2026-10-05', n: 3 }), '二〇二六年十月五日　三字');
  assert.equal(workKuan({ day: '2026-10-05', n: 2 }), '二〇二六年十月五日　两字');
  assert.equal(workKuan({ day: '2026-10-05', n: 1 }), '二〇二六年十月五日');
  assert.equal(workKuan({ day: '2026-10-05', n: 12 }), '二〇二六年十月五日　十二字');
  assert.ok(workKuan({ day: '2026-10-05', n: 3 }).includes('　'), 'the gap is an ideographic space');
  assert.match(workKuan({ day: null, n: 3 }), /^二〇\S+年\S+月\S+日　三字$/, 'a missing day falls back to today instead of throwing');
});

test('分张的落款 (D39 / §6.7): 其一 / 其二 appended, each page writes its own count; one page has no 其几', () => {
  const pages = paginate(cellsOn('2026-09-01', 96));
  assert.deepEqual(pages.map(p => p.length), [80, 16]);
  assert.equal(monthKuan({ month: '2026-09', n: 80, part: 1, of: 2 }), '二〇二六年九月　八十字　其一');
  assert.equal(monthKuan({ month: '2026-09', n: 16, part: 2, of: 2 }), '二〇二六年九月　十六字　其二');
  assert.equal(monthKuan({ month: '2026-08', n: 46 }), '二〇二六年八月　四十六字', 'one page: no 其几');
  assert.equal(monthKuan({ month: '2026-08', n: 46, part: 1, of: 1 }), '二〇二六年八月　四十六字', 'of = 1 → no 其几');
  assert.equal(workKuan({ day: '2026-10-05', n: 80, part: 3, of: 3 }), '二〇二六年十月五日　八十字　其三');
  assert.deepEqual([1, 2, 3, 10].map(partLabel), ['其一', '其二', '其三', '其十']);
});

test('年报纸面文字 (§8.2): 卷首年份 / 一句话 / 日期，卷尾落款；2 写「两」，年份逐位汉字', () => {
  assert.equal(annualYearText(2026), '二〇二六');
  assert.equal(annualCoverLine(290), '这一年，你写过两百九十个字。');
  assert.equal(annualCoverLine(2), '这一年，你写过两个字。');
  assert.equal(annualCoverLine(46), '这一年，你写过四十六个字。');
  assert.equal(monthDayText('2026-04-26'), '四月二十六日');
  assert.equal(annualFirstDateText('2026-04-26'), '四月二十六日的笔迹');
  assert.equal(annualTailDateText('2026-10-02'), '十月二日');
  assert.equal(annualTailKuan('2026-10'), '二〇二六年十月');
  assert.equal(annualBrandKuan(), '拾字　年报');
});
