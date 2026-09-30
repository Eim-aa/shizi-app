// 首页题记（决定-D13「宋体先固定文案 + 三条题记」；R-H13）。
// 逐字取自原型首页壳 docs/design/v10/extracted/首页壳-v3-第十稿交接版.dc.html L141 的 QUOTES；
// test/core/epigraphs.test.mjs 从该文件重新解析核对。每条 = 上句、下句、出处（上下两半等长）。
// 轮换：按日「一年中第几天 mod 3」（P23，policy.epigraphRotation；原型写死 `267 % 3` = 9 月 24 日）。

import { dayOfYear } from '../core/dates.js';

export const EPIGRAPHS = Object.freeze([
  Object.freeze({ lines: Object.freeze(['心不厌精，', '手不忘熟。']), source: '孙过庭《书谱》' }),
  Object.freeze({ lines: Object.freeze(['文章千古事，', '得失寸心知。']), source: '杜甫《偶题》' }),
  Object.freeze({ lines: Object.freeze(['我书意造本无法，', '点画信手烦推求。']), source: '苏轼《石苍舒醉墨堂》' }),
]);

/** 某日（YYYY-MM-DD）显示哪一条题记（P23：dayOfYear % 3）。 */
export function epigraphIndexFor(day) {
  return dayOfYear(day) % EPIGRAPHS.length;
}

export function epigraphFor(day) {
  return EPIGRAPHS[epigraphIndexFor(day)];
}
