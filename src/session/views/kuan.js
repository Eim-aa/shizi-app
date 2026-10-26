// 落款的文案引用（B3.5c：从 ui/work-text.js 的 kuan() 挪来，网页 kuan() = tRef(kuanRef(…))，原生页经 App API 拿同一个引用；无 DOM）。
// 落款是这个产品的签名：格式只有一种「{汉字年月日}　{汉字数}字」，字数永远带，月份落款没有日（规则说明见 ui/work-text.js）。
// 汉字数字转换只许落款代码用（scripts/verify_copy.mjs CN_HELPER_FILES 登记了本文件）。

import { ref } from '../../config/copy/index.js';
import { cnCount, cnNumber, isValidDay, localDay, signatureDateParts, signatureMonthParts } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';

/** 落款日期：日子缺（会话没有时间戳的异常数据）时退回今天，不让页面因为一个落款报错。 */
export function dateRef(day) {
  return ref('R-I01.signatureDate', signatureDateParts(isValidDay(day) ? day : localDay(envNow())));
}

export function monthRef(month) {
  return ref('R-I01.signatureMonth', signatureMonthParts(month));
}

/** 「其一」「其二」…：分张落款的末尾（i 从 1 数）。 */
export function partRef(i) {
  return ref('X-WORK.kuanPart', { n: cnNumber(i) });
}

/**
 * 所有落款的单一出口（引用形态）。参数含义同 ui/work-text.js kuan()：
 *   day：按日的作品；month：按月的作品；n：字数（汉字，永远带）；part / of：第几张 / 共几张；brand：年报卷首；picked：自己选字的这一组。
 */
export function kuanRef({ day = null, month = null, n = null, part = 0, of = 1, brand = false, picked = false } = {}) {
  if (brand) return ref('X-WORK.annualBrand');
  const date = month ? monthRef(month) : dateRef(day);
  const countKey = picked ? 'X-WORK.kuanCountPicked' : 'X-WORK.kuanCount';
  const base = Number.isFinite(n) && n >= 0 ? ref('X-WORK.kuanJoin', { date, n: ref(countKey, { n: cnCount(n) }) }) : date;
  return part && of > 1 ? ref('X-WORK.kuanJoinPart', { kuan: base, part: partRef(part) }) : base;
}

/** 年报卷首的年份「二〇二六」（B3.9：原生页不能自己算汉字数字，由会话层给）。 */
export function annualYearText(year) {
  return cnDigits(year);
}

/** 年报卷首那句话的文案引用（B3.9）。 */
export function annualCoverLineRef(n) {
  return ref('X-WORK.annualCoverLine', { n: cnCount(n) });
}
