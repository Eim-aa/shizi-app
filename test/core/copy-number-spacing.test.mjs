// 第三轮 C3-R（T3-13）：数字体例写成一条规则并门禁。
//
// 规则（03 P224 / D51 已决定，这里只是把它写成单测）：
//   · 阿拉伯数字与汉字之间留一个空格：「共 3 个字」「记录了 3 次」「在 10月」「{month}月有记录 {n} 天」；
//   · 唯一的例外是日期记法：数字 + 年 / 月 / 日 是一个整体，单位字紧跟数字不留空格——「10月5日」「2026年10月」；
//     这个整体与前后别的汉字之间仍按上一条留空格（「在 10月」「10月有记录 3 天」里 10月 是一个词，月 与后面的「有」同是汉字，不算数字贴汉字）；
//   · 落款与册页（作品）里的数字全用汉字数字（「二〇二六年十月四日」「这一年，你写过二百九十个字」），不在这条规则里（HANZI_NUMBER_KEYS）。
// 做法：把每条运行时文案里的数字占位符（{n} {m} {k} {month} {day} {year} {total} {left} {a} {b} {max}）换成 7，别的占位符换成一个汉字，
// 再逐条查「数字紧贴汉字」。新增文案违反规则时这里红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '../../src/config/copy/index.js';

const NUMERIC = new Set(['n', 'm', 'k', 'month', 'day', 'year', 'total', 'left', 'a', 'b', 'max']);

/** 数字在这些键里是汉字数字（纸面作品 / 落款），不适用阿拉伯数字的空格规则。 */
const HANZI_NUMBER_KEYS = new Set([
  'R-I01.signatureDate', 'R-I01.signatureMonth', // 「二〇二六年十月四日」
  'X-WORK.kuanCount', 'X-WORK.kuanCountPicked', 'X-WORK.kuanMonthDay', 'X-WORK.kuanPart', // 「两字」「自选五字」「四月二十六日」「其二」
  'X-WORK.annualCoverLine', // 「这一年，你拾回两百一十八个字。」
  'X-FIRST.title', // 「这三个字，很多人提笔就忘。」
]);

const HAN = /[\u3400-\u9fff]/;
const DIGIT = /[0-9]/;
const DATE_UNIT = /^[年月日]$/;

/** 数字紧贴汉字的位置（日期记法 数字 + 年 / 月 / 日、年 / 月 + 下一个数字 放行）；返回贴着的那两个字符。 */
export function tightNumberSpots(text) {
  const chars = [...text];
  const out = [];
  for (let i = 0; i + 1 < chars.length; i += 1) {
    const [a, b] = [chars[i], chars[i + 1]];
    if (DIGIT.test(a) && HAN.test(b) && !DATE_UNIT.test(b)) out.push(a + b);
    else if (HAN.test(a) && DIGIT.test(b) && !/^[年月]$/.test(a)) out.push(a + b); // 年 / 月 后面紧跟的是日期里的下一个数字：「2026年10月」「10月5日」
  }
  return out;
}

function filled(template) {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name) => (NUMERIC.has(name) ? '7' : '字'));
}

test('规则本身：数字贴汉字报错，日期记法与带空格的写法放行', () => {
  assert.deepEqual(tightNumberSpots('共 7 个字'), []);
  assert.deepEqual(tightNumberSpots('在 10月'), []);
  assert.deepEqual(tightNumberSpots('10月5日有记录 3 天'), []);
  assert.deepEqual(tightNumberSpots('2026年10月'), []);
  assert.deepEqual(tightNumberSpots('3个字'), ['3个']);
  assert.deepEqual(tightNumberSpots('共3 个字'), ['共3']);
  assert.deepEqual(tightNumberSpots('7月有记录7天'), ['录7', '7天']);
});

test('全部运行时文案：阿拉伯数字与汉字之间留空格（日期记法除外），落款与册页用汉字数字', () => {
  const bad = [];
  let checked = 0;
  for (const [key, value] of Object.entries(COPY)) {
    if (HANZI_NUMBER_KEYS.has(key)) continue;
    for (const line of Array.isArray(value) ? value : [value]) {
      if (typeof line !== 'string') continue;
      checked += 1;
      const spots = tightNumberSpots(filled(line));
      if (spots.length) bad.push(`${key}: ${line}  →  ${spots.join(' ')}`);
    }
  }
  assert.ok(checked > 400, `scanned the runtime copy (${checked} lines)`);
  assert.deepEqual(bad, [], 'numbers touching Chinese characters:\n' + bad.join('\n'));
});

test('汉字数字的键确实是汉字数字：用到的占位符由 cnCount / cnNumber 之类的函数给，模板里没有阿拉伯数字', () => {
  for (const key of HANZI_NUMBER_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), `${key} exists`);
    assert.ok(!/[0-9]/.test(String(COPY[key])), `${key}: no digits written into the template`);
  }
});
