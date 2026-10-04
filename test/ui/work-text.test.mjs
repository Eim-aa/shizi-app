// 作品落款与纸面汉字文案（阶段 1 P1-E7；交接 §5.2 / §6.4 / §6.7 / §8；src/ui/work-text.js；R2-R1：落款只有一个函数 kuan()）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginate } from '../../src/core/images/paginate.js';
import { COPY } from '../../src/config/copy/index.js';
import { annualCoverLine, annualFirstDateText, annualTailDateText, annualYearText, kuan, monthDayText, partLabel } from '../../src/ui/work-text.js';
import * as workText from '../../src/ui/work-text.js';
import { signatureText } from '../../src/ui/screens/mine/records.js';

const cellsOn = (day, n, from = 0) => Array.from({ length: n }, (_, i) => ({ ch: String.fromCodePoint(0x4e00 + from + i), day }));

test('落款 text (§5.2 / §6.4): 汉字日期 + 全角空格 + 汉字字数；2 写「两」；一个字也写「一字」（V2-05）', () => {
  assert.equal(kuan({ day: '2026-10-05', n: 3 }), '二〇二六年十月五日　三字');
  assert.equal(kuan({ day: '2026-10-05', n: 2 }), '二〇二六年十月五日　两字');
  assert.equal(kuan({ day: '2026-10-05', n: 1 }), '二〇二六年十月五日　一字', 'the count is always there, also for one char');
  assert.equal(kuan({ day: '2026-10-05', n: 12 }), '二〇二六年十月五日　十二字');
  assert.ok(kuan({ day: '2026-10-05', n: 3 }).includes('　'), 'the gap is an ideographic space');
  assert.match(kuan({ day: null, n: 3 }), /^二〇\S+年\S+月\S+日　三字$/, 'a missing day falls back to today instead of throwing');
});

test('自选组的落款 (T2-03): 「自选N字」，数量照样带', () => {
  assert.equal(kuan({ day: '2026-10-04', n: 5, picked: true }), '二〇二六年十月四日　自选五字');
  assert.equal(kuan({ day: '2026-10-04', n: 2, picked: true }), '二〇二六年十月四日　自选两字');
  assert.equal(kuan({ day: '2026-10-04', n: 1, picked: true }), '二〇二六年十月四日　自选一字');
  assert.equal(kuan({ day: '2026-10-04', n: 5 }), '二〇二六年十月四日　五字', 'the daily kuan is unchanged');
});

test('分张的落款 (D39 / §6.7): 其一 / 其二 appended, each page writes its own count; one page has no 其几', () => {
  const pages = paginate(cellsOn('2026-09-01', 96));
  assert.deepEqual(pages.map(p => p.length), [80, 16]);
  assert.equal(kuan({ month: '2026-09', n: 80, part: 1, of: 2 }), '二〇二六年九月　八十字　其一');
  assert.equal(kuan({ month: '2026-09', n: 16, part: 2, of: 2 }), '二〇二六年九月　十六字　其二');
  assert.equal(kuan({ month: '2026-08', n: 46 }), '二〇二六年八月　四十六字', 'one page: no 其几');
  assert.equal(kuan({ month: '2026-08', n: 46, part: 1, of: 1 }), '二〇二六年八月　四十六字', 'of = 1 → no 其几');
  assert.equal(kuan({ day: '2026-10-05', n: 80, part: 3, of: 3 }), '二〇二六年十月五日　八十字　其三');
  assert.deepEqual([1, 2, 3, 10].map(partLabel), ['其一', '其二', '其三', '其十']);
});

test('落款只有一个函数：缩略图、年报卷首 / 卷尾也都是 kuan()，旧的另一套写法已删（T2-04）', () => {
  assert.equal(kuan({ month: '2026-10', n: 6 }), '二〇二六年十月　六字');
  assert.equal(signatureText({ month: '2026-10', days: 2, chars: 6 }), kuan({ month: '2026-10', n: 6 }), 'the 我的 thumbnail signature is kuan() — no 「有记录N天 · N个字」 any more');
  assert.equal(kuan({ month: '2026-10' }), '二〇二六年十月', 'the annual tail has no count to write');
  assert.equal(kuan({ brand: true }), '拾字　年报');
  for (const gone of ['workKuan', 'monthKuan', 'annualBrandKuan', 'annualTailKuan']) assert.equal(workText[gone], undefined, gone + ' is replaced by kuan()');
  assert.equal(COPY['R-I01.monthSignature'], undefined);
  assert.equal(COPY['R-P03.signature'], undefined);
});

test('界面里的月份写「10月」：月 / 日 / 年紧跟数字，不留空格，与落款一种写法（H1 / 03 P224，设计说明第 8 条）', () => {
  const keys = ['X-WORK.monthTitle', 'X-WORK.monthOpen', 'X-WORK.annualMonthName', 'X-WORK.annualMonthAria'];
  for (const key of keys) {
    const text = [].concat(COPY[key]).join('');
    assert.ok(/\{month\}月/.test(text), `${key}: 「{month}月」 with no space (got ${text})`);
    assert.ok(!/\{month\} 月/.test(text), `${key}: no 「{month} 月」`);
  }
  const bad = Object.entries(COPY).filter(([, v]) => /(\d|\{month\}|\{monthNum\}) 月/.test([].concat(v).join(''))).map(([k]) => k);
  assert.deepEqual(bad, [], 'no UI 「N 月」 with a space anywhere');
});

test('年报纸面文字 (§8.2): 卷首年份 / 一句话 / 日期；2 写「两」，年份逐位汉字', () => {
  assert.equal(annualYearText(2026), '二〇二六');
  assert.equal(annualCoverLine(290), '这一年，你写过两百九十个字。');
  assert.equal(annualCoverLine(2), '这一年，你写过两个字。');
  assert.equal(annualCoverLine(46), '这一年，你写过四十六个字。');
  assert.equal(monthDayText('2026-04-26'), '四月二十六日');
  assert.equal(annualFirstDateText('2026-04-26'), '四月二十六日的笔迹');
  assert.equal(annualTailDateText('2026-10-02'), '十月二日');
});

test('no source file builds a 落款 by hand: the signature templates are only used inside work-text.js', () => {
  const root = fileURLToPath(new URL('../../src', import.meta.url));
  const files = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(root);
  const users = files.filter(f => /X-WORK\.kuanJoin|R-I01\.signature(Date|Month)/.test(readFileSync(f, 'utf8')) && !/config\/copy\/|work-text\.js$/.test(f));
  assert.deepEqual(users.map(f => f.slice(root.length)), [], 'the templates are filled in one place');
});
