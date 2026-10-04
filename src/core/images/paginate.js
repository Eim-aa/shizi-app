// 超过 80 字分张（D39；交接 §6.7；阶段 1 P1-E7）。纯函数。
//
// 按日期顺序把「天」装进页：当前页字数 + 当天字数 ≤ max → 放入；否则开新页（同一天的字不拆到两张）；
// 单日 > max → 日内按 max 切（先收掉手头未满的那一页，切出来的最后一段继续作当前页，后面的天可以接着装）。
// 每页独立跑排版函数（最后一张按自己的字数重排），落款末尾加「其一」「其二」，字数写每张自己的（落款文案在 ui/work-text.js）。
// 超过 80 字不再返回 pending（D12 的 pending 契约改为返回分页结果）。

import { MAX_CHARS_PER_PAGE } from './layout.js';

/**
 * @param {Array<{day?:string}>} cells  按先后排好的格子；没有 day 的当作同一天
 * @param {number} [max]
 * @returns {Array<Array<object>>}  每页的格子（保持原顺序）；0 个格子返回 []
 */
export function paginate(cells, max = MAX_CHARS_PER_PAGE) {
  if (!Array.isArray(cells) || !cells.length) return [];
  const cap = Number.isSafeInteger(max) && max > 0 ? max : MAX_CHARS_PER_PAGE;
  // 连续同一天的格子归为一组（顺序以传入为准，不重新排序）
  const days = [];
  for (const cell of cells) {
    const day = cell && cell.day ? cell.day : '';
    const last = days[days.length - 1];
    if (last && last.day === day) last.cells.push(cell);
    else days.push({ day, cells: [cell] });
  }
  const pages = [];
  let current = [];
  for (const group of days) {
    if (group.cells.length > cap) {
      if (current.length) pages.push(current);
      current = [];
      for (let i = 0; i < group.cells.length; i += cap) {
        const part = group.cells.slice(i, i + cap);
        if (i + cap < group.cells.length) pages.push(part);
        else current = part;
      }
    } else if (current.length + group.cells.length <= cap) {
      current = current.concat(group.cells);
    } else {
      pages.push(current);
      current = group.cells.slice();
    }
    if (current.length === cap) {
      pages.push(current);
      current = [];
    }
  }
  if (current.length) pages.push(current);
  return pages;
}

/** 张数（不生成页内容）。 */
export function pageCount(cells, max = MAX_CHARS_PER_PAGE) {
  return paginate(cells, max).length;
}

/**
 * 分张后每页的日期角标：新页的第一个字一定带角标（它是那一页上这一天的第一个字）。tag 由调用方给的函数产生。
 * @param {Array<Array<{day?:string, tag?:string}>>} pages
 * @param {(day:string)=>string} dayTag
 */
export function retagPages(pages, dayTag) {
  return pages.map(page => {
    let prev = null;
    return page.map(cell => {
      const day = cell && cell.day ? cell.day : null;
      const tag = day && day !== prev ? dayTag(day) : '';
      if (day) prev = day;
      return { ...cell, tag };
    });
  });
}
