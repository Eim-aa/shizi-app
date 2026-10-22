// QA-H1：元素清单的归一与配对（compare.mjs 用；纯函数，node:test 可测）。
//
// 两边清单形状相同（App 内 NativeQAHarness 写出）：{kind:'button'|'text'|'view', frame, textFrame?, text?, color?, bg?, border?,
// fontSize?, fontWeight?, enabled?, id?（原生 accessibilityIdentifier / 网页 data-testid）, prop?（原生页成员名）, axLabel?, srOnly?, iconFrame?}。
// 配对：先按语义键（下表：原生成员名 / id ↔ 网页 testid），其余文字与按钮按「归一后的文字」，同字多处按上下顺序。

/** 语义键。native：成员名（prop）或 accessibilityIdentifier；web：data-testid。phase 限定只在某些状态生效。 */
export const KEYS = [
  { key: 'back', native: ['prop:backButton'], web: ['id:page-back'] },
  { key: 'end', native: ['prop:endButton'], web: ['id:write-end'] },
  { key: 'skip', native: ['prop:skipButton'], web: ['id:write-skip'] },
  { key: 'progress', native: ['id:native-write-count', 'id:native-write-head-progress'], web: ['id:write-progress', 'id:redo-progress'] },
  // 原生页头中间的标签：回忆阶段是进度「n / N」，其余阶段是标题（assignKeys 里按文字分）；网页标题是 h1
  { key: 'center', native: ['id:native-write-progress'], web: [] },
  { key: 'prompt-cell-0', native: ['prop:promptCells[0]'], web: ['id:write-prompt-cell#0'] },
  { key: 'prompt-cell-1', native: ['prop:promptCells[1]'], web: ['id:write-prompt-cell#1'] },
  { key: 'prompt-cell-2', native: ['prop:promptCells[2]'], web: ['id:write-prompt-cell#2'] },
  { key: 'grid', native: ['prop:gridFrame'], web: ['id:write-grid', 'id:write-compare-mine'] },
  { key: 'ref-grid', native: ['prop:refFrame'], web: ['id:write-compare-ref'] },
  { key: 'undo', native: ['prop:undoButton'], web: ['id:write-undo', 'id:redo-undo'] },
  { key: 'clear', native: ['prop:clearButton'], web: ['id:write-clear', 'id:redo-clear'] },
  { key: 'line-text', native: ['prop:lineLabel'], web: ['id:write-line-text'] },
  { key: 'line-change', native: ['prop:changeButton'], web: ['id:write-line-change'] },
  { key: 'hint', native: ['prop:hintButtonView'], web: ['id:write-hint'] },
  { key: 'show-answer', native: ['prop:answerButton', 'prop:redoAnswerButton'], web: ['id:write-show-answer', 'id:redo-show-answer'] },
  // B2.9a 重写错字页（网页 write/redo.js）：对照阶段求助行「再写一次」（格下说明按文字配对）
  { key: 'redo-again', native: ['prop:redoAgainButton'], web: ['id:redo-again'] },
  { key: 'judge-wrong', native: ['prop:wrongButton'], web: ['id:write-judge-wrong'] },
  { key: 'judge-correct', native: ['prop:correctButton'], web: ['id:write-judge-correct'] },
  { key: 'primary', native: ['prop:doneButton', 'prop:primaryButton'], web: ['id:write-done', 'id:write-trace-done', 'id:write-answer-next', 'id:write-next', 'id:result-again', 'id:result-done', 'id:result-leave', 'id:redo-done', 'id:redo-next'] },
  { key: 'undo-bar', native: ['id:native-write-undo-bar'], web: ['id:write-skip-undo'] },
  { key: 'undo-bar-text', native: ['id:native-write-undo-text'], web: ['id:write-skip-undo-text'] },
  { key: 'end-dialog', native: ['id:native-write-end-dialog'], web: ['id:write-end-dialog'] },
  { key: 'end-body', native: ['id:native-write-end-body'], web: ['id:write-end-body'] },
  { key: 'sheet', native: ['prop:sheet.view'], web: ['id:write-change-sheet', 'id:result-sheet'] },
  { key: 'change-detail', native: [], web: ['id:write-change-detail', 'id:result-sheet-detail'] },
  { key: 'change-title', native: ['id:native-change-title'], web: [] },
  { key: 'change-mine', native: ['id:native-change-mine'], web: ['id:write-change-mine', 'id:result-sheet-mine'] },
  { key: 'change-ref', native: ['id:native-change-ref'], web: ['id:write-change-ref', 'id:result-sheet-ref'] },
  { key: 'change-note', native: ['id:native-change-note'], web: ['id:write-change-note', 'id:result-sheet-note'] },
  // B2.7 原生结果页（网页 result/index.js、work.js、first.js）
  { key: 'share', native: ['prop:shareButton'], web: ['id:result-share'] },
  { key: 'work', native: ['prop:workView'], web: ['id:work'] },
  // 作品第一格（墨迹像素比较的取样格，parity.config.json ink）
  { key: 'work-cell-0', native: ['id:native-result-cell#0'], web: ['id:work-cell#0'] },
  { key: 'seal', native: ['id:native-result-seal'], web: ['id:work-seal'] },
  { key: 'exrow-open', native: ['id:native-result-row-open'], web: ['id:result-exrow-open'] },
  { key: 'preview', native: ['id:native-result-preview'], web: ['id:result-preview'] },
  { key: 'result-title', native: ['id:native-result-title'], web: ['id:result-title'] },
  { key: 'result-sub', native: ['id:native-result-sub'], web: ['id:result-sub'] },
  { key: 'invite-body', native: ['id:native-result-invite-body'], web: ['id:result-invite-body'] },
  { key: 'invite-title', native: ['id:native-result-invite-title'], web: ['id:result-invite-title'] },
];

export const normText = t => String(t || '').replace(/\s+/g, '').replace(/[›>]+$/, '›');

/** 参与对比的元素：可见、非读屏专用、不是纯结构容器（有语义键、或有文字、或是按钮）。 */
export function relevant(list) {
  return list.filter(e => !e.srOnly && (e.kind === 'button' || e.text || e.key));
}

/** 给每个元素标语义键（就地写 e.key），返回同一数组。 */
export function assignKeys(list, side) {
  const counters = {};
  const sorted = [...list].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  for (const e of sorted) {
    if (e.id) {
      counters[e.id] = (counters[e.id] ?? -1) + 1;
      e._idx = counters[e.id];
    }
  }
  for (const e of list) {
    if (side === 'web' && e.tag === 'h1' && !e.srOnly) { e.key = 'title'; continue; }
    if (side === 'native' && e.id === 'native-write-progress') { e.key = /^\d+ \/ \d+$/.test(String(e.text || '').trim()) ? 'progress' : 'title'; continue; }
    // 主按钮只认底栏满宽的那一枚（.sz-btn--primary）：描一遍阶段求助行的「下一个」也用 write-answer-next 这个 testid（answer.js nextLink），它按文字配对
    if (side === 'web' && e.id === 'write-answer-next' && !/\bsz-btn--primary\b/.test(e.class || '')) continue;
    // 首练结果页的「再写一组」是主按钮正上方的文字按钮（与主按钮同一个 testid result-again），按文字配对
    if (side === 'web' && e.id === 'result-again' && !/\bsz-btn--primary\b/.test(e.class || '')) continue;
    for (const k of KEYS) {
      const hit = k[side].some(sel => {
        const [type, rest] = sel.split(':');
        const [val, idx] = rest.split('#');
        if (type === 'prop') return e.prop === val;
        if (type === 'id') return e.id === val && (idx === undefined || String(e._idx) === idx);
        return false;
      });
      if (hit) { e.key = k.key; break; }
    }
  }
  return list;
}

/** 配对。返回 {pairs:[[web, native]], onlyWeb:[], onlyNative:[]}。 */
export function pairUp(web, native) {
  const pairs = [];
  const wLeft = new Set(web);
  const nLeft = new Set(native);
  // 1. 语义键
  for (const w of web) {
    if (!w.key) continue;
    const n = native.find(x => nLeft.has(x) && x.key === w.key);
    if (n) { pairs.push([w, n]); wLeft.delete(w); nLeft.delete(n); }
  }
  // 2. 文字（同字多处按距离最近）
  for (const w of [...wLeft]) {
    const t = normText(w.text || w.axLabel);
    if (!t) continue;
    const cands = [...nLeft].filter(n => normText(n.text || n.axLabel) === t);
    if (!cands.length) continue;
    cands.sort((a, b) => dist(a, w) - dist(b, w));
    pairs.push([w, cands[0]]); wLeft.delete(w); nLeft.delete(cands[0]);
  }
  return { pairs, onlyWeb: [...wLeft], onlyNative: [...nLeft] };
}

function dist(a, b) {
  return Math.hypot(a.frame.x - b.frame.x, a.frame.y - b.frame.y);
}

export function rgba(hex) {
  const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})?$/i.exec(hex || '');
  if (!m) return null;
  return [1, 2, 3, 4].map(i => (m[i] === undefined ? 255 : parseInt(m[i], 16)));
}

/** WCAG 2.x 对比度（只看 RGB，忽略透明度）；任一缺失 → null。 */
export function contrastRatio(a, b) {
  const x = rgba(a), y = rgba(b);
  if (!x || !y) return null;
  const lum = c => {
    const [r, g, bl] = c.slice(0, 3).map(v => {
      const u = v / 255;
      return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** 两色最大通道差（0–255）；任一缺失 → null。透明度按纸色上叠合前直接比通道（够用于找差异）。 */
export function colorDelta(a, b) {
  const x = rgba(a), y = rgba(b);
  if (!x || !y) return null;
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
}

/** 一对元素的差异：同一元素的各方面合成一条（aspects 记类别）；没有差异返回 null。 */
export function diffElement(w, n, tol) {
  const parts = diffPair(w, n, tol);
  if (!parts.length) return null;
  const aspects = [...new Set(parts.map(p => p.type))];
  return { type: aspects[0], aspects, label: parts[0].label, msg: parts.map(p => p.msg).join('；'), w, n };
}

/** 一对元素逐方面的差异。tol：{pos, size, color, font, weight}。 */
export function diffPair(w, n, tol) {
  const out = [];
  const label = w.key || normText(w.text) || w.id || '?';
  const useText = w.textFrame && n.textFrame;
  const fw = useText ? w.textFrame : w.frame;
  const fn = useText ? n.textFrame : n.frame;
  const what = useText ? '文字位置' : '位置';
  // 文字：比左缘与竖向中线（行高 / 字体度量不同，不比文字框顶边），高度用 textHeight 容差
  const dx = fn.x - fw.x, dy = useText ? (fn.y + fn.h / 2) - (fw.y + fw.h / 2) : fn.y - fw.y, dw = fn.w - fw.w, dh = fn.h - fw.h;
  const hTol = useText ? (tol.textHeight ?? tol.size) : tol.size;
  if (Math.abs(dx) > tol.pos || Math.abs(dy) > tol.pos) out.push({ type: 'position', label, msg: `${what} 网页 (${fw.x}, ${fw.y}) 原生 (${fn.x}, ${fn.y})，差 (${r1(dx)}, ${r1(dy)})pt${useText ? '（竖向按中线）' : ''}`, w, n });
  if (Math.abs(dw) > tol.size || Math.abs(dh) > hTol) out.push({ type: 'size', label, msg: `${useText ? '文字' : ''}尺寸 网页 ${fw.w}×${fw.h} 原生 ${fn.w}×${fn.h}，差 (${r1(dw)}, ${r1(dh)})pt`, w, n });
  if (w.key && (w.text || n.text) && normText(w.text) !== normText(n.text)) out.push({ type: 'text', label, msg: `文案 网页「${w.text || ''}」原生「${n.text || ''}」`, w, n });
  const cd = colorDelta(w.color, n.color);
  if (cd !== null && cd > tol.color) out.push({ type: 'color', label, msg: `文字色 网页 ${w.color} 原生 ${n.color}`, w, n });
  const bd = colorDelta(w.bg || '#00000000', n.bg || '#00000000');
  if ((w.bg || n.bg) && bd !== null && bd > tol.color) out.push({ type: 'color', label, msg: `底色 网页 ${w.bg || '无'} 原生 ${n.bg || '无'}`, w, n });
  if (w.fontSize && n.fontSize && Math.abs(w.fontSize - n.fontSize) > tol.font) out.push({ type: 'font', label, msg: `字号 网页 ${w.fontSize} 原生 ${n.fontSize}`, w, n });
  if (w.fontWeight !== undefined && n.fontWeight !== undefined && Math.abs(w.fontWeight - n.fontWeight) > tol.weight) out.push({ type: 'font', label, msg: `字重 网页 ${w.fontWeight} 原生 ${n.fontWeight}`, w, n });
  if (w.enabled !== undefined && n.enabled !== undefined && w.enabled !== n.enabled) out.push({ type: 'state', label, msg: `可点 网页 ${w.enabled} 原生 ${n.enabled}`, w, n });
  if (!!w.hasIcon !== !!n.hasIcon && w.kind === 'button' && n.kind === 'button') out.push({ type: 'icon', label, msg: `图标 网页 ${w.hasIcon ? '有' : '无'} 原生 ${n.hasIcon ? '有' : '无'}`, w, n });
  if (w.iconFrame && n.iconFrame && (Math.abs(w.iconFrame.w - n.iconFrame.w) > tol.size || Math.abs(w.iconFrame.h - n.iconFrame.h) > tol.size)) out.push({ type: 'icon', label, msg: `图标尺寸 网页 ${w.iconFrame.w}×${w.iconFrame.h} 原生 ${n.iconFrame.w}×${n.iconFrame.h}`, w, n });
  return out;
}

const r1 = x => Math.round(x * 10) / 10;

/** 一个状态的全部差异。 */
export function diffState(webDump, nativeDump, tol) {
  const web = relevant(assignKeys(webDump.elements || [], 'web'));
  const native = relevant(assignKeys(nativeDump.elements || [], 'native'));
  const { pairs, onlyWeb, onlyNative } = pairUp(web, native);
  const diffs = [];
  for (const [w, n] of pairs) { const d = diffElement(w, n, tol); if (d) diffs.push(d); }
  for (const w of onlyWeb) if (w.kind !== 'view' || w.key) diffs.push({ type: 'missing', aspects: ['missing'], label: w.key || normText(w.text) || w.id, msg: `原生缺少：网页有${w.kind === 'button' ? '按钮' : w.kind === 'text' ? '文字' : '元素'}「${w.text || w.axLabel || w.id}」(${w.frame.x}, ${w.frame.y} ${w.frame.w}×${w.frame.h})`, w });
  for (const n of onlyNative) if (n.kind !== 'view' || n.key) diffs.push({ type: 'extra', aspects: ['extra'], label: n.key || normText(n.text) || n.id || n.prop, msg: `原生多出：${n.kind === 'button' ? '按钮' : n.kind === 'text' ? '文字' : '元素'}「${n.text || n.axLabel || n.id || n.prop}」(${n.frame.x}, ${n.frame.y} ${n.frame.w}×${n.frame.h})`, n });
  return { pairs, diffs, web, native };
}
