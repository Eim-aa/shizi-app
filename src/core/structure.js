// 字的结构（左右 / 上下）与部件数，供参考字形的读屏名称用（R2-A1，第二轮审查 A2-09 / D45；03 P232）。
//
// 数据来源只有运行时已有的两样东西，不引入新数据：
//   · 部件分组 groups（deck-data.js 的 GROUPS：每个部件占几笔，按笔顺连续切开，最多 5 组；组数 = 部件数）；
//   · 笔顺数据 medians（data/<字>.json，每笔一条中线）。
// 没有现成的「部件是哪几个字」（decomposition / radical）数据——那份数据只在 sources/make-me-a-hanzi-dict.txt 里（LGPL，合规说明 §1.15 正在收缩它的使用），
// 不随 App 发布，所以部件名（「尢 + 监」）读不出来，这是已知缺口（见 03 P232）。结构与部件数从几何推导：
//   · 只有恰好 2 个部件、且两块的包围盒在一个方向上基本不重叠、在另一个方向上大部分重叠时，才断言「左右结构」或「上下结构」；
//     包围 / 半包围 / 镶嵌（⿴⿵⿸⿺⿻ 等）与 3 个以上部件的嵌套结构不断言（嵌套时顶层结构几何上推不出来），宁可不说也不说错；
//   · 校准（开发时用 MMAH 字典的 IDS 做对照，不入库）：2 部件字 1510 个断言里 1507 个与 IDS 一致（99.8%），覆盖约 22% 的字；阈值见下。
//   · 部件数只在 2–4 组时说（分组数据最多合并成 5 组，5 组可能是「5 个以上」，不说）。
// 纯函数，无 DOM。

/** 两块在「分离轴」上重叠不超过较短一块的 15%，在「并排轴」上重叠至少较短一块的 60%，才算清楚的左右 / 上下。 */
export const STRUCTURE_SEPARATION_MAX = 0.15;
export const STRUCTURE_SHARE_MIN = 0.6;
/** 部件数只在这个范围内报（超过 4 可能是合并后的「5 组」）。 */
export const PARTS_REPORT_MIN = 2;
export const PARTS_REPORT_MAX = 4;

function boxOfStrokes(medians, from, to) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = from; i < to; i += 1) {
    const line = medians[i];
    if (!Array.isArray(line)) return null;
    for (const p of line) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * 分组是否有效：每组为正整数、总和等于笔画数（与 hint-layer hasGroupData 同一判据，这里不依赖 UI 模块）。
 */
export function validGroups(groups, totalStrokes) {
  if (!Array.isArray(groups) || groups.length === 0) return false;
  let sum = 0;
  for (const n of groups) {
    if (!Number.isInteger(n) || n < 1) return false;
    sum += n;
  }
  return sum === totalStrokes;
}

/**
 * 两个部件的结构：'lr' | 'tb' | null（说不准就 null）。
 * @param {number[]} groups  每个部件的笔数（长度必须是 2）
 * @param {Array<Array<[number, number]>>} medians  每笔中线（hanzi-writer，y 向上；朝向不影响判断）
 */
export function inferStructure(groups, medians) {
  if (!Array.isArray(medians) || !validGroups(groups, medians.length) || groups.length !== 2) return null;
  const a = boxOfStrokes(medians, 0, groups[0]);
  const b = boxOfStrokes(medians, groups[0], groups[0] + groups[1]);
  if (!a || !b) return null;
  const axis = (lo, hi) => {
    const la = a[hi] - a[lo];
    const lb = b[hi] - b[lo];
    const shorter = Math.min(la, lb);
    return { shorter, over: overlap(a[lo], a[hi], b[lo], b[hi]) };
  };
  const x = axis('x0', 'x1');
  const y = axis('y0', 'y1');
  // 某一轴上的「长度」可能是 0（一横一点之类）：按 1 算，免得除零
  const ratio = ax => ax.over / (ax.shorter || 1);
  const clean = (sep, share) => ratio(sep) <= STRUCTURE_SEPARATION_MAX && ratio(share) >= STRUCTURE_SHARE_MIN;
  const lr = clean(x, y);
  const tb = clean(y, x);
  if (lr && !tb) return 'lr';
  if (tb && !lr) return 'tb';
  return null;
}

/**
 * 参考字形的结构说明：{structure: 'lr'|'tb'|null, parts: 数|null}。
 * 断言了结构就不再重复部件数（两个部件已含在「左右 / 上下结构」里）；没有结构、部件数在 2–4 时只给部件数；其余都是空。
 */
export function describeStructure({ groups, medians } = {}) {
  const none = { structure: null, parts: null };
  if (!Array.isArray(medians) || !validGroups(groups, medians.length)) return none;
  const structure = inferStructure(groups, medians);
  if (structure) return { structure, parts: null };
  const n = groups.length;
  return n >= PARTS_REPORT_MIN && n <= PARTS_REPORT_MAX ? { structure: null, parts: n } : none;
}
