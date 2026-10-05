// 首页「最近写的字」的取字（H1 / D51 ④、T2-09、N2-09）：今天还没写、离开一周回来时，字帖位放本人最近写的几个字，不放品牌「拾」。
//
// 独立的选择函数（不碰作品取字的共用函数：今天的字帖行的取字另有卡在改）：
//   - 成员口径就是作品成员规则的单一来源 core/work-members.js isWorkMember（D51 ⑤：写对 ∪ 留有墨的看后自写；写错、跳过、只看过答案没写、纸上记录不进），
//     首页今天的字帖行、结果页、月字帖、年报共用同一条；
//   - 「最近」按字：每个字以它最近一次作品记录的先后排名；取排名最靠前的 limit 个不同的字；
//   - 每个字取墨：D27 每字只留第一次与最近一次的墨，中间回收——取这个字**最近一次仍留有墨**的那条记录（D42 的口径，core/ink-pick pickInkRecord），
//     整个字都没有墨的跳过（不拿别的字顶替它之前先看下一个字），不冒充；
//   - 返回按先后排（早 → 晚，与今天的字帖行同方向），每项就是要画的那条记录。
// 纯函数：hasInk 由调用方注入（页面按存下的墨迹表查，不解码）。

import { compareRecordIds, sortById } from '../../../core/records.js';
import { isWorkMember } from '../../../core/work-members.js';
import { pickInkRecord } from '../../../core/ink-pick.js';
import { flattenRecords } from '../../../core/query.js';
import { diffDays } from '../../../core/dates.js';

/**
 * @param {object[]|{[month:string]:any}|null} records  全部记录（按月分键的 state.records，或已平铺的数组）
 * @param {{limit?: number, hasInk: (record:object)=>boolean}} o
 * @returns {object[]} 最多 limit 条记录（早 → 晚），一字一条
 */
export function recentInkRow(records, { limit = 3, hasInk } = {}) {
  if (typeof hasInk !== 'function' || !(limit >= 1)) return [];
  const flat = Array.isArray(records) ? records : flattenRecords(records);
  const members = sortById(flat.filter(r => isWorkMember(r, { hasInk })));
  if (!members.length) return [];
  const byCard = new Map(); // cardKey → 记录（id 升序）
  for (const r of members) {
    const list = byCard.get(r.cardKey);
    if (list) list.push(r);
    else byCard.set(r.cardKey, [r]);
  }
  // 以每个字最近一次作品记录的先后排名（新 → 旧）
  const lastOf = list => list[list.length - 1];
  const ranked = [...byCard.entries()].sort((a, b) => compareRecordIds(lastOf(b[1]).id, lastOf(a[1]).id));
  const picked = [];
  for (const [, list] of ranked) {
    if (picked.length >= limit) break;
    const record = pickInkRecord(list, { prefer: 'last', hasInk });
    if (record) picked.push(record);
  }
  return sortById(picked);
}

/**
 * 最近写的字下面的一句（C3-H / N3-02，D53；03 P246）：最近的字用 ink2 画（与今天写的区分），格下说清是哪天写的——不然第二天读起来像被预告了题目。
 * 这几个字都是同一天写的：昨天 →「昨天写的字。」、前天 →「前天写的字。」、3–6 天前 →「{n} 天前写的字。」；不是同一天写的 →「最近写的字。」；
 * 离开一周以上（那个态有自己的一句「你写过的 N 个字都还在。」）或算不出天数时返回 ''。
 * @param {object[]} row  recentInkRow 的结果
 * @param {string} today  今天的日键
 * @param {(key:string, vars?:object)=>string} translate  copy.t
 */
export function recentDayLine(row, today, translate) {
  const days = [...new Set((row || []).map(r => r && r.localDay).filter(d => typeof d === 'string'))];
  if (!days.length || typeof today !== 'string') return '';
  if (days.length > 1) return translate('X-HOME.recentMixed');
  const n = diffDays(days[0], today);
  if (!(n >= 1) || n >= 7) return '';
  if (n === 1) return translate('X-HOME.recentYesterday');
  if (n === 2) return translate('X-HOME.recentDayBefore');
  return translate('X-HOME.recentDaysAgo', { n });
}
