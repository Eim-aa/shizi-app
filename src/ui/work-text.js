// 作品落款与纸面文字（阶段 1 P1-E7；交接 §5.2 / §6.4 / §6.7 / §8；R2-R1：落款只有一个函数 kuan()）。
// 汉字数字（2 写「两」，D36）只用于纸面落款：helper 来自 core/dates.js，本文件登记在 scripts/verify_copy.mjs CN_HELPER_FILES。
//
// 落款是这个产品的签名：结果页、这次 / 这天的图片、月字帖（页面与导出图）、年报册页、「我的」里的月字帖缩略图都经 kuan()，格式只有一种：
//   「{汉字年月日}　{汉字数}字」，字数永远带（一个字也写「一字」，V2-05），右对齐，印跟在末字右下；月份落款没有日。
// 界面里的数字（「10 月」「9 月」）是另一套规则：阿拉伯数字与「月」之间留空格，写在 copy 里；落款里全是汉字、不留空格（T2-04）。
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

/**
 * 所有落款的单一出口。
 * @param {{day?:string, month?:string, n?:number|null, part?:number, of?:number, brand?:boolean}} o
 *   day：按日的作品（结果页、这次的图片、这天的图片）→「二〇二六年十月五日　两字」；
 *   month：按月的作品（月字帖页与图、年报每月一页、我的页缩略图）→「二〇二六年十月　四十六字」；
 *   n：字数（汉字，永远带；缺省 null 只在没有数量可写的落款里——年报卷尾「二〇二六年十月」）；
 *   part / of：第几张 / 共几张（of > 1 才在末尾写「其几」）；
 *   brand：年报卷首的品牌落款「拾字　年报」；
 *   picked：自己选字的这一组（T2-03）→「二〇二六年十月四日　自选五字」，数量照样带。
 */
export function kuan({ day = null, month = null, n = null, part = 0, of = 1, brand = false, picked = false } = {}) {
  if (brand) return t('X-WORK.annualBrand');
  const date = month ? monthText(month) : dateText(day);
  const countKey = picked ? 'X-WORK.kuanCountPicked' : 'X-WORK.kuanCount';
  const base = Number.isFinite(n) && n >= 0 ? t('X-WORK.kuanJoin', { date, n: t(countKey, { n: cnCount(n) }) }) : date;
  return part && of > 1 ? t('X-WORK.kuanJoinPart', { kuan: base, part: partLabel(part) }) : base;
}

/** 首练结果页标题「这三个字，很多人提笔就忘。」：数取这一页上实际有几个字（汉字数字，2 写「两」）；没有可数的字时不写数量（V2-05）。 */
export function firstTitle(n) {
  return Number.isFinite(n) && n >= 1 ? t('X-FIRST.title', { n: cnCount(n) }) : t('X-FIRST.titlePlain');
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
