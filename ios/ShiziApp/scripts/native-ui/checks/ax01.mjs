// AX-01「AX 档不溢出」的判定（纯函数，test/native-ui-ax01.test.mjs 测）。
// 规则（B3.9 第二轮）：只报网页参考在同一状态 / 字号 / 外观下**没有**的问题；网页里同一对语义元素同样重叠（或同样被截断）的，记 info、不算失败。
// 只给读屏的隐藏页标题（网页 class 含 --hidden，AX 档变成页头第二行里一行看不见的字）不参与重叠检查：它不是看得见的内容。
import { normText } from '../elements.mjs';

/** 两个框的重叠面积（pt²）。 */
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const isText = e => e.kind === 'text' || e.kind === 'button';
const nameOf = e => normText(e.text) || e.id || e.prop || '?';
/** 看得见的框：visibleFrame（滚动区里滚出去的不算；null = 全在可见框外）→ 文字框 → 元素框。 */
const box = e => (e.visibleFrame !== undefined ? e.visibleFrame : (e.kind === 'text' && e.textFrame ? e.textFrame : e.frame));
/** 网页只给读屏的隐藏标题。 */
/** 语义键（页头的返回键 / 标题在原生没有单独的键，按固定标识补上，与网页的 back / title 配对）。 */
const keyOf = e => e.key || (e.id === 'native-page-back' ? 'back' : e.id === 'native-page-title' ? 'title' : null);
const hiddenTitle = e => /--hidden\b/.test(e.class || '');

/**
 * @param {object[]} web 网页元素（已配语义键 .key）
 * @param {object[]} native 原生元素（已配语义键 .key）
 * @returns {{pass:boolean, detail:string, info:string[], bad:string[]}}
 */
export function evalAx01(web, native) {
  const webEls = (web || []).filter(e => isText(e) && !e.srOnly);
  const webByKey = new Map();
  for (const e of webEls) if (keyOf(e)) { if (!webByKey.has(keyOf(e))) webByKey.set(keyOf(e), []); webByKey.get(keyOf(e)).push(e); }
  const hiddenKeys = new Set(webEls.filter(hiddenTitle).map(keyOf).filter(Boolean));
  const els = (native || []).filter(e => isText(e) && !e.srOnly);
  const bad = [];
  const info = [];
  for (const e of els) {
    const name = nameOf(e);
    const webSame = keyOf(e) && (webByKey.get(keyOf(e)) || []);
    const webHas = flag => webSame && webSame.some(w => w[flag]);
    if (e.truncated) (webHas('truncated') ? info : bad).push(`「${name}」被截断`);
    if (e.clipped) (webHas('clipped') ? info : bad).push(`「${name}」被裁掉`);
    if (e.offscreenX) (webHas('offscreenX') ? info : bad).push(`「${name}」伸出屏幕`);
  }
  // 网页里这一对语义键是否重叠（任一对同键元素重叠就算）
  const webOverlaps = (ka, kb) => {
    if (!ka || !kb) return false;
    for (const a of webByKey.get(ka) || []) for (const b of webByKey.get(kb) || []) {
      if (a === b) continue;
      if ((a.layer || 'page') !== (b.layer || 'page')) continue;
      if (box(a) && box(b) && overlapArea(box(a), box(b)) > 1) return true;
    }
    return false;
  };
  const visible = els.filter(e => !(keyOf(e) && hiddenKeys.has(keyOf(e))));
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i], b = visible[j];
      if ((a.layer || 'page') !== (b.layer || 'page')) continue;
      if (!box(a) || !box(b)) continue;
      const area = overlapArea(box(a), box(b));
      if (area <= 1) continue;
      const msg = `「${nameOf(a)}」与「${nameOf(b)}」重叠 ${Math.round(area)}pt²`;
      (webOverlaps(keyOf(a), keyOf(b)) ? info : bad).push(msg);
    }
  }
  const detail = bad.slice(0, 6).join('；') || `${els.length} 个元素都完整可见${info.length ? `（与网页相同的 ${info.length} 处只记 info：${info.slice(0, 3).join('；')}）` : ''}`;
  return { pass: !bad.length, detail, info, bad };
}
