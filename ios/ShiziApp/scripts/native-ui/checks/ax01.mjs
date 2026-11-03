// AX-01「AX 档不溢出」的判定（纯函数，test/native-ui-ax01.test.mjs 测）。
// 规则（B2.9b；D84 起不再对照网页参考，只判原生自己）：AX 档下每个文字 / 按钮不被截断、不被祖先裁掉、不伸出屏幕左右，
// 同一层里（页面 / 弹层 / 确认框 / 撤销条各算一层，浮层按设计盖在页面上）文字与按钮互不重叠（面积 > 1pt²）。只给读屏的元素（srOnly）不参与。
import { normText } from '../elements.mjs';

/** 两个框的重叠面积（pt²）。 */
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const isText = e => e.kind === 'text' || e.kind === 'button';
const nameOf = e => normText(e.text) || e.id || e.prop || '?';
/** 看得见的框：visibleFrame（滚动区里滚出去的不算；null = 全在可见框外）→ 文字框 → 元素框。 */
const box = e => (e.visibleFrame !== undefined ? e.visibleFrame : (e.kind === 'text' && e.textFrame ? e.textFrame : e.frame));

/**
 * 已知并接受的重叠（D84 前与网页参考同样重叠、当时记 info 的）：状态 → ["甲|乙", …]（文字归一后，不分先后）。新出现的重叠仍是失败。
 * annual-report 的 AX5：年度报告页的标题与「调整图片 ›」在最大字号下同行相压，网页版同样（B3.9），待界面清理阶段随细节问题一并处理。
 */
export const KNOWN_OVERLAPS = {
  'annual-report': ['调整图片›|年度报告'],
  // 月字帖页 AX3 / AX5：隐藏的页标题（读屏用）与可见标题同名同位，AX5 下「调整图片 ›」也压到标题上；练习记录页 AX 档返回键与标题差几 pt 相压。均与网页版相同（B3.9）。
  'month-ax5': ['9月字帖|9月字帖', '调整图片›|9月字帖'],
  'month-ink': ['9月字帖|9月字帖', '调整图片›|9月字帖'],
  'records-month': ['native-page-back|练习记录'],
};

/**
 * @param {object[]} native 原生元素（已配语义键 .key）
 * @param {string[]} known 已知并接受的重叠（"甲|乙"）
 * @returns {{pass:boolean, detail:string, bad:string[]}}
 */
export function evalAx01(native, known = []) {
  const accepted = new Set(known.flatMap(k => { const [a, b] = k.split('|'); return [`${a}|${b}`, `${b}|${a}`]; }));
  const els = (native || []).filter(e => isText(e) && !e.srOnly);
  const bad = [];
  for (const e of els) {
    const name = nameOf(e);
    if (e.truncated) bad.push(`「${name}」被截断`);
    if (e.clipped) bad.push(`「${name}」被裁掉`);
    if (e.offscreenX) bad.push(`「${name}」伸出屏幕`);
  }
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      const a = els[i], b = els[j];
      if ((a.layer || 'page') !== (b.layer || 'page')) continue;
      if (!box(a) || !box(b)) continue;
      const area = overlapArea(box(a), box(b));
      if (area <= 1) continue;
      if (accepted.has(`${nameOf(a)}|${nameOf(b)}`)) continue;
      bad.push(`「${nameOf(a)}」与「${nameOf(b)}」重叠 ${Math.round(area)}pt²`);
    }
  }
  const detail = bad.slice(0, 6).join('；') || `${els.length} 个元素都完整可见`;
  return { pass: !bad.length, detail, bad };
}
