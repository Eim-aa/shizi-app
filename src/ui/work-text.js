// 作品落款与纸面文字（阶段 1 P1-E7；交接 §5.2 / §6.4 / §6.7 / §8）：汉字日期 + 全角空格 + 汉字字数 [+ 全角空格 + 其一 / 其二]。
// 汉字数字（2 写「两」，D36）只用于纸面落款：helper 来自 core/dates.js，本文件登记在 scripts/verify_copy.mjs CN_HELPER_FILES。
// 单字作品（n = 1）不写字数；多张时每张写自己的字数。
import { t } from '../config/copy/index.js';
import { cnCount, cnDigits, cnNumber, isValidDay, localDay, signatureDateParts, signatureMonthParts } from '../core/dates.js';
import { now as envNow } from '../platform/env.js';

/** 落款日期：日子缺（会话没有时间戳的异常数据）时退回今天，不让页面因为一个落款报错。 */
function dateText(day) {
  return t('R-I01.signatureDate', signatureDateParts(isValidDay(day) ? day : localDay(envNow())));
}

function monthText(month) {
  return t('R-I01.signatureMonth', signatureMonthParts(month));
}

/** 「其一」「其二」…：分张落款的末尾（i 从 1 数）。 */
export function partLabel(i) {
  return t('X-WORK.kuanPart', { n: cnNumber(i) });
}

function withPart(kuan, part, of) {
  return part && of > 1 ? t('X-WORK.kuanJoinPart', { kuan, part: partLabel(part) }) : kuan;
}

/**
 * 这次的图片 / 这天写的字的落款：「二〇二六年十月五日　三字」；单字只有日期。
 * @param {{day:string, n:number, part?:number, of?:number}} o  part / of：第几张 / 共几张（of > 1 才写「其几」）
 */
export function workKuan({ day, n, part = 0, of = 1 }) {
  const date = dateText(day);
  const kuan = n > 1 ? t('X-WORK.kuanJoin', { date, n: t('X-WORK.kuanCount', { n: cnCount(n) }) }) : date;
  return withPart(kuan, part, of);
}

/** 月字帖落款：「二〇二六年八月　四十六字」。 */
export function monthKuan({ month, n, part = 0, of = 1 }) {
  const kuan = t('X-WORK.kuanJoin', { date: monthText(month), n: t('X-WORK.kuanCount', { n: cnCount(n) }) });
  return withPart(kuan, part, of);
}

/** 年报册页的落款：卷首「拾字　年报」、卷尾「二〇二六年十月」。 */
export function annualBrandKuan() {
  return t('X-WORK.annualBrand');
}

export function annualTailKuan(month) {
  return monthText(month);
}

/** 年报卷首：年份「二〇二六」、一句话「这一年，你写过二百九十个字。」、「四月二十六日的笔迹」（纸面汉字）。 */
export function annualYearText(year) {
  return cnDigits(year);
}

export function annualCoverLine(n) {
  return t('X-WORK.annualCoverLine', { n: cnCount(n) });
}

/** 「四月二十六日」（汉字月日）。 */
export function monthDayText(day) {
  const p = signatureDateParts(day);
  return t('X-WORK.kuanMonthDay', { month: p.month, day: p.day });
}

export function annualFirstDateText(day) {
  return t('X-WORK.annualFirstDate', { date: monthDayText(day) });
}

export function annualTailDateText(day) {
  return monthDayText(day);
}
