// QA-H2：线（rules）、装饰（decos）、墨格（cells）的比较（compare.mjs 用；纯函数，test/native-ui-graphics.test.mjs 测）。
//
// 两边的取证（NativeQAHarness：网页 qaWebExtrasJS、原生 qaNativeGraphics）给同一形状、窗口坐标 pt 的清单，屏外但滚得到的带 off: true：
//   rules  {x, y, w, h, color, src}  看得见的线：网页 CSS 边框边 / 0 模糊 box-shadow 细条 / 细的有底色元素 / 只有横竖线段的大 svg（格线、外框）；
//                                     原生 图层边框 / 细的有底色视图或图层 / CAShapeLayer 横竖线段 / draw(_:) 自己画线的视图声明的线（ShiziDrawnLines）
//   decos  {kind:'icon'|'circle', x, y, w, h, color?}  ≤ 40pt 的图标（svg / img；原生图片 / 小 CAShapeLayer）、≤ 48pt 的圆（选中日圆底、圆按钮底）
//   cells  {kind:'ink'|'glyph'|'image', x, y, w, h}   墨格：canvas、有曲线 / 斜线的大 svg（笔迹、字形轮廓）、> 40pt 的 img；
//                                     原生 类名带 Ink / Glyph 的视图、> 40pt 的图片视图；字形格：单个汉字、字号 ≥ 24 的文字框
// 规则通用、不分页（阈值 GRAPHICS_DEFAULTS，parity.config.json graphics 可改）：
//   线 —— 按位置配对，不按键：同方向的线先合并（同一条线上相接的几段、上下相邻元素的两条边），再看网页每条线有多少长度被原生同方向、
//          中线差 ≤ pos 容差的线盖住（两端各放宽 pos）；没盖住的部分 > max(2·pos, 10% 线长) 记「原生缺少线」，反过来记「原生多出线」；
//          盖住的那一对比颜色（通道 ±color）与线宽（±lineWidth）。一条缺少、一条多出，长短与横向位置都对得上、只差竖向位置 → 合成一条「线位置」（vertical）。
//   装饰 —— 同类（图标 / 圆）配对：两边所属元素（包住它的最小元素）已配上对时按「相对所属元素的文字框（两边都有时）或元素框」的位置配、
//          比相对位置（行尾 › 跟在字后面还是钉在右缘，行本身对得上也分得出来）；否则按绝对位置、相距 ≤ decoPairDist 才配。比位置（±pos）、尺寸（±size）、圆的颜色。
//   墨格 —— 按中心配对（中心差 ≤ max(pos, 格边 25%)、边长差 ≤ max(size, 25%)）；网页格里没有任何原生格（中心）→ 缺少，原生格中心不在任何网页格里 → 多出；
//          配上的比中心差（±pos）；两边都完整在屏上时 compare.mjs 再取掩膜比墨（inkMetrics / judgeInk：容 1 格 IoU、重心差、墨外框）。
//   交叉：一边是图标、另一边是墨格（同一个小笔迹 / 样字，网页画成 svg、原生画成墨视图，或反过来），框对得上（±pos / ±size）就算同一个，按墨格比墨。
//   所属元素是「原生缺少 / 多出」的按钮或文字时，它里面的线 / 装饰 / 墨格不另报（那条元素差异已经报了，或已具名忽略）。
import { colorDelta, normText } from './elements.mjs';

/** 缺省阈值（parity.config.json graphics 可改）。 */
export const GRAPHICS_DEFAULTS = {
  lineWidth: 0.6, // 线宽差（pt）
  ruleUncoveredFrac: 0.1, // 线没盖住的部分占线长
  decoPairDist: 24, // 不靠所属元素配对时，装饰相距多远以内才算同一个
  ink: {
    // 墨格掩膜：N×N（N = 网页格边长 pt，最多 maxN），内缩 max(inset pt, 格边 × insetFrac)，与格底亮度差 > max(minContrast, 格内最大差 × threshold) 记墨
    maxN: 64, inset: 2, insetFrac: 0.04, minContrast: 40, threshold: 0.5,
    iou1: 0.6, // 容 1 格的 IoU 下限（抗锯齿 / 亚像素对位不报）
    centroid: 0.05, centroidMin: 1.5, // 墨的位置（墨外框中心）差 > max(centroidMin pt, 格边 × centroid)
    scale: 0.12, scaleMin: 4, // 墨外框宽 / 高差 > max(scaleMin pt, 网页外框 × scale)（细横画的外框只有 1–2 格高，只看比例会误报；笔端圆头与网页笔锋的长短差可到 ~4pt）
    minInk: 6, // 两边墨点都少于这么多 → 当作空格
    band: 0.25, // 墨掩膜的缓冲带（QA-H4）：与格底亮度差在截止值 ±25% 之内的点既不算墨也不算非墨（淡字压在截止值上，两边差几个灰度就翻），只用「肯定是墨」的点量外框 / 位置 / 点数
    minInkHyst: 2, // 图标「看得见」的有无判定的滞回（QA-H4）：两边墨点数相差 ≤ 2 × 这个数不算有无之差
  },
  // 文字像素色（QA-H3e）：文字框里的主导字色 vs 底色，原生对网页（dump 里的颜色是 titleColor / CSS color，不等于画出来的）
  glyph: {
    minDist: 40, // 与底色最大通道差 ≥ 这么多的像素算字
    minPx: 8, // 字像素少于这么多 → 当作取不到字色
    color: 64, // 字色（取最远 20% 像素的均值）通道差 > 这么多记差异（抗锯齿 / 字重差不报）
    contrast: 0.5, // 原生字与底色的最大差 < 网页的这个比例 → 「对比弱」
  },
};

const r1 = x => Math.round(x * 10) / 10;
const center = f => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
const inside = (p, f, slack = 0) => p.x >= f.x - slack && p.x <= f.x + f.w + slack && p.y >= f.y - slack && p.y <= f.y + f.h + slack;
const offNote = d => (d.off ? '，在屏外（滚动区里）' : '');

/** Tab 栏的上沿（QA-H4）：元素清单里语义键 tab-* 的最小顶边（没有 Tab 栏 → null）。diffGraphics 把两边较小的那个写在清单的 tabTop 上，两边按同一条线认。 */
export function tabBarTop(els) {
  if (els && typeof els.tabTop === 'number') return els.tabTop;
  let top = null;
  for (const e of els || []) if (e.key && /^tab-/.test(e.key) && e.frame && (top === null || e.frame.y < top)) top = e.frame.y;
  return top;
}

/**
 * 所属元素：包住这个点的最小元素（元素清单 webAll / nativeAll，含屏外），没有 → null。
 * QA-H4：落在系统 Tab 栏的范围里（顶边以下、全宽）的点一律归 Tab 项（横向最近的 tab-*）——Tab 栏的顶线、图标不能算成被它盖住的页面元素
 * （页面元素的框常常一直铺到屏底），否则 TAB-01 的豁免对不上。
 */
export function ownerOf(p, els, slack = 1) {
  const top = tabBarTop(els);
  if (top !== null && p.y >= top - 2) {
    let nearest = null;
    for (const e of els) if (e.key && /^tab-/.test(e.key) && e.frame && (!nearest || Math.abs(center(e.frame).x - p.x) < Math.abs(center(nearest.frame).x - p.x))) nearest = e;
    if (nearest) return nearest;
  }
  let best = null;
  for (const e of els || []) {
    const f = e.frame;
    if (!f || !inside(p, f, slack)) continue;
    if (!best || f.w * f.h < best.frame.w * best.frame.h) best = e;
  }
  return best;
}
const labelOf = e => (e ? e.key || normText(e.text) || e.id || e.prop || '—' : '—');

/** 元素配对的上下文：{web, native, pairs} → 查所属元素、是否配上、配的是谁。 */
function context(els = {}) {
  const pairOf = new Map((els.pairs || []).map(([w, n]) => [w, n]));
  const pairedN = new Set((els.pairs || []).map(([, n]) => n));
  // 所属元素是没配上的按钮 / 文字（原生缺少 / 多出那一条已经报了）→ 里面的东西不另报
  const orphan = (e, side) => !!e && (e.kind === 'button' || e.kind === 'text') && (side === 'web' ? !pairOf.has(e) : !pairedN.has(e));
  return { pairOf, orphan, web: els.web || [], native: els.native || [] };
}

// ───────────────────────── 线 ─────────────────────────

/** 线 → {o:'h'|'v', c 中线, a–b 区间, t 线宽, color, off}；同一条线上相接 / 重叠的几段（颜色、线宽相同）合成一条。 */
export function normRules(list, tol) {
  const lines = (list || []).filter(r => Math.max(r.w, r.h) >= 3).map(r => {
    const h = r.w >= r.h;
    return { o: h ? 'h' : 'v', c: h ? r.y + r.h / 2 : r.x + r.w / 2, a: h ? r.x : r.y, b: h ? r.x + r.w : r.y + r.h, t: h ? r.h : r.w, color: r.color, off: !!r.off };
  }).sort((p, q) => (p.o < q.o ? -1 : p.o > q.o ? 1 : p.c - q.c || p.a - q.a));
  const out = [];
  for (const l of lines) {
    const m = out.find(x => x.o === l.o && Math.abs(x.c - l.c) <= 1 && l.a <= x.b + 1 && l.b >= x.a - 1
      && Math.abs(x.t - l.t) <= 0.5 && (colorDelta(x.color, l.color) ?? 0) <= tol.color);
    if (m) { m.a = Math.min(m.a, l.a); m.b = Math.max(m.b, l.b); m.off = m.off && l.off; } else out.push({ ...l });
  }
  return out;
}

/** l 的区间被 others（同方向、中线差 ≤ pos）盖住的长度；两端各放宽 pos。 */
function coveredLength(l, others, pos) {
  const iv = others.filter(o => o.o === l.o && Math.abs(o.c - l.c) <= pos)
    .map(o => [Math.max(l.a, o.a - pos), Math.min(l.b, o.b + pos)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let len = 0, end = -Infinity;
  for (const [a, b] of iv) { if (b <= end) continue; len += b - Math.max(a, end); end = b; }
  return len;
}

const ruleRect = l => (l.o === 'h' ? { x: r1(l.a), y: r1(l.c - l.t / 2), w: r1(l.b - l.a), h: r1(l.t) } : { x: r1(l.c - l.t / 2), y: r1(l.a), w: r1(l.t), h: r1(l.b - l.a) });
const ruleDesc = l => `${l.o === 'h' ? '横' : '竖'}线 (${r1(l.o === 'h' ? l.a : l.c)}, ${r1(l.o === 'h' ? l.c : l.a)}) 长 ${r1(l.b - l.a)} 宽 ${r1(l.t)} ${l.color}${offNote(l)}`;
const ruleMid = l => (l.o === 'h' ? { x: (l.a + l.b) / 2, y: l.c } : { x: l.c, y: (l.a + l.b) / 2 });

/** 线的差异。els：{web, native, pairs}（diffState 的 webAll / nativeAll / pairs）。 */
export function diffRules(webRules, nativeRules, tol, els = {}, opts = GRAPHICS_DEFAULTS) {
  if (!webRules || !nativeRules) return [];
  const ctx = context(els);
  // 格里面的线（田字格的辅助线、墨视图自己画的格线）是格的画面，归墨格比；图标里面的线（印章的内框）是图标的画法，归装饰比；只比格外与格边上的线
  const icons = d => (d || []).filter(x => x.kind === 'icon');
  // 格：边上 2pt 以内的线（格框、inset 内框）照比；图标：边上 1.5pt 以外都算图标里面（印章的 7% 内框）
  // QA-H4：格框两边的位置有 ≤ pos 的差时，一个方框的上边线（原生 +2.1）落进另一边格框 2pt 之内的判定之外，下边线又留着，
  // 配对时上边对上了别的线（年报「同字两次」AX 档报 141pt 竖向差）。格边上的「照比」带放宽 pos：两边格框错开 pos 以内，同一条框线两边的取舍一致。
  const boxes = [...[...((els.cells || {}).web || []), ...((els.cells || {}).native || [])].map(c => [c, 2 + tol.pos]),
    ...[...icons((els.decos || {}).web), ...icons((els.decos || {}).native)].map(c => [c, 1.5]),
    // 圆的边框不是直线（四条「边」只是框的外切线）：圆框上（含 1pt 外沿）的线归圆比
    ...[...((els.decos || {}).web || []), ...((els.decos || {}).native || [])].filter(c => c.kind === 'circle').map(c => [c, -1])];
  const inCell = l => { const p = ruleMid(l); return boxes.some(([c, m]) => p.x > c.x + m && p.x < c.x + c.w - m && p.y > c.y + m && p.y < c.y + c.h - m); };
  const W = normRules(webRules, tol).filter(l => !inCell(l)), N = normRules(nativeRules, tol).filter(l => !inCell(l));
  const pos = tol.pos, out = [];
  const lost = (l, others) => { const len = l.b - l.a; const un = len - coveredLength(l, others, pos); return un > Math.max(2 * pos, (opts.ruleUncoveredFrac ?? 0.1) * len) ? un : 0; };
  const missing = [], extra = [];
  for (const l of W) {
    const owner = ownerOf(ruleMid(l), ctx.web);
    if (ctx.orphan(owner, 'web')) continue;
    const label = labelOf(owner);
    const un = lost(l, N);
    if (un) { missing.push({ l, label, un }); continue; }
    // 盖住它最多的那条原生线：比颜色、线宽
    let best = null, bestLen = 0;
    for (const n of N) {
      if (n.o !== l.o || Math.abs(n.c - l.c) > pos) continue;
      const ov = Math.min(l.b, n.b) - Math.max(l.a, n.a);
      if (ov > bestLen) { bestLen = ov; best = n; }
    }
    if (!best) continue;
    // 同一处叠着几条不同颜色的线（外框 + 内圈选中框）：任一条原生线颜色、线宽都对得上就算对上
    const over = N.filter(n => n.o === l.o && Math.abs(n.c - l.c) <= pos && Math.min(l.b, n.b) - Math.max(l.a, n.a) > 0);
    if (over.some(n => (colorDelta(l.color, n.color) ?? 0) <= tol.color && Math.abs(l.t - n.t) <= (opts.lineWidth ?? 0.6))) continue;
    const msgs = [];
    const cd = colorDelta(l.color, best.color);
    if (cd !== null && cd > tol.color) msgs.push(`线色 网页 ${l.color} 原生 ${best.color}`);
    if (Math.abs(l.t - best.t) > (opts.lineWidth ?? 0.6)) msgs.push(`线宽 网页 ${r1(l.t)} 原生 ${r1(best.t)}`);
    if (msgs.length) out.push({ type: 'rule', aspects: ['rule'], label, msg: `${msgs.join('；')}（${ruleDesc(l)}）`, w: { frame: ruleRect(l) }, n: { frame: ruleRect(best) } });
  }
  for (const n of N) {
    const owner = ownerOf(ruleMid(n), ctx.native);
    if (ctx.orphan(owner, 'native')) continue;
    const un = lost(n, W);
    if (un) extra.push({ l: n, label: labelOf(owner), un });
  }
  // 一条缺少 + 一条多出、长短与横向位置都对得上、只差竖向 → 合成一条线位置差（vertical：axis:'y' 的忽略规则认它）
  const used = new Set();
  for (const m of missing) {
    const l = m.l;
    const k = extra.findIndex((x, i) => !used.has(i) && x.l.o === l.o && Math.abs((x.l.b - x.l.a) - (l.b - l.a)) <= pos
      && (l.o === 'h' ? Math.abs(x.l.a - l.a) <= pos : Math.abs(x.l.c - l.c) <= pos) && (colorDelta(x.l.color, l.color) ?? 0) <= tol.color);
    if (k >= 0) {
      used.add(k);
      const n = extra[k].l;
      const dy = l.o === 'h' ? n.c - l.c : n.a - l.a;
      out.push({ type: 'rule', aspects: ['rule'], label: m.label, vertical: true, msg: `线位置 网页${ruleDesc(l)} 原生竖向差 ${r1(dy)}pt`, w: { frame: ruleRect(l) }, n: { frame: ruleRect(n) } });
    } else out.push({ type: 'rule', aspects: ['rule'], label: m.label, msg: `原生缺少线：网页${ruleDesc(l)}（没对上的长度 ${r1(m.un)}）`, w: { frame: ruleRect(l) } });
  }
  extra.forEach((x, i) => { if (!used.has(i)) out.push({ type: 'rule', aspects: ['rule'], label: x.label, msg: `原生多出线：${ruleDesc(x.l)}（网页没有的长度 ${r1(x.un)}）`, n: { frame: ruleRect(x.l) } }); });
  return out;
}

// ───────────────────────── 装饰 ─────────────────────────

/** 同一边：框相同（±1pt）的同类装饰只留一个；套在另一个图标里面的图标并进外面那个（一个图标画成几层：印章的方框与里面的字）。 */
export function normDecos(list) {
  const ds = [];
  for (const d of list || []) if (!ds.some(o => o.kind === d.kind && Math.abs(o.x - d.x) <= 1 && Math.abs(o.y - d.y) <= 1 && Math.abs(o.w - d.w) <= 1 && Math.abs(o.h - d.h) <= 1)) ds.push({ ...d });
  return ds.filter(d => d.kind !== 'icon' || !ds.some(o => o !== d && o.kind === 'icon' && o.w * o.h > d.w * d.h
    && d.x >= o.x - 0.5 && d.y >= o.y - 0.5 && d.x + d.w <= o.x + o.w + 0.5 && d.y + d.h <= o.y + o.h + 0.5));
}

/** 所属元素的锚：两边都有文字框、且两个文字框对得上（±pos）时用文字框（「相对字」）；否则元素框对得上时用元素框；都对不上 → null（按绝对位置比，所属元素的差另报）。 */
const near = (a, b, tol) => Math.abs(a.x - b.x) <= tol.pos && Math.abs(a.y - b.y) <= tol.pos;
function anchors(ow, on, tol) {
  if (ow.textFrame && on.textFrame && near(ow.textFrame, on.textFrame, tol)) return [ow.textFrame, on.textFrame];
  if (near(ow.frame, on.frame, tol)) return [ow.frame, on.frame];
  return null;
}

/** 装饰的差异。els：{web, native, pairs}。 */
export function diffDecos(webDecos, nativeDecos, tol, els = {}, opts = GRAPHICS_DEFAULTS) {
  if (!webDecos || !nativeDecos) return [];
  const ctx = context(els);
  const W = normDecos(webDecos), N = normDecos(nativeDecos);
  const ow = W.map(d => ownerOf(center(d), ctx.web)), on = N.map(d => ownerOf(center(d), ctx.native));
  const cands = [];
  W.forEach((w, i) => N.forEach((n, j) => {
    if (w.kind !== n.kind) return;
    const cw = center(w), cn = center(n);
    const anc = ow[i] && on[j] && ctx.pairOf.get(ow[i]) === on[j] ? anchors(ow[i], on[j], tol) : null;
    const owned = !!anc;
    const [aw, an] = anc || [];
    const dx = owned ? (cn.x - an.x) - (cw.x - aw.x) : cn.x - cw.x;
    const dy = owned ? (cn.y - an.y) - (cw.y - aw.y) : cn.y - cw.y;
    const d = Math.hypot(dx, dy);
    if (!owned && d > (opts.decoPairDist ?? 24)) return;
    cands.push({ i, j, dx, dy, d, owned, score: d + Math.abs(w.w - n.w) + Math.abs(w.h - n.h) + (owned ? 0 : 1000) });
  }));
  cands.sort((p, q) => p.score - q.score);
  const usedW = new Set(), usedN = new Set(), out = [];
  out.pairs = [];
  const kindName = d => (d.kind === 'circle' ? '圆' : '图标');
  const desc = d => `${kindName(d)} (${d.x}, ${d.y} ${d.w}×${d.h})${offNote(d)}`;
  for (const c of cands) {
    if (usedW.has(c.i) || usedN.has(c.j)) continue;
    usedW.add(c.i); usedN.add(c.j);
    const w = W[c.i], n = N[c.j];
    out.pairs.push({ w, n, label: labelOf(ow[c.i]) });
    const msgs = [];
    let vertical = true;
    if (Math.abs(c.dx) > tol.pos || Math.abs(c.dy) > tol.pos) { msgs.push(`${kindName(w)}位置 网页 (${w.x}, ${w.y}) 原生 (${n.x}, ${n.y})，${c.owned ? '相对所属元素' : ''}差 (${r1(c.dx)}, ${r1(c.dy)})pt`); if (Math.abs(c.dx) > tol.pos) vertical = false; }
    if (Math.abs(w.w - n.w) > tol.size || Math.abs(w.h - n.h) > tol.size) { msgs.push(`${kindName(w)}尺寸 网页 ${w.w}×${w.h} 原生 ${n.w}×${n.h}`); vertical = false; }
    if (w.kind === 'circle') { const cd = colorDelta(w.color, n.color); if (cd !== null && cd > tol.color) { msgs.push(`圆的颜色 网页 ${w.color} 原生 ${n.color}`); vertical = false; } }
    if (msgs.length) out.push({ type: 'deco', aspects: ['deco'], label: labelOf(ow[c.i]), vertical, msg: msgs.join('；'), w: { frame: w }, n: { frame: n } });
  }
  W.forEach((w, i) => { if (!usedW.has(i) && !ctx.orphan(ow[i], 'web')) out.push({ type: 'deco', aspects: ['deco'], label: labelOf(ow[i]), msg: `原生缺少装饰：网页有${desc(w)}`, w: { frame: w } }); });
  // 原生多出：屏外的不报（网页的字形轮廓等滚进来才画，屏外的网页清单里可能还没有）；屏上的另在截图上看是不是空的（compare.mjs：只为取证量框的透明图片不算）
  N.forEach((n, j) => { if (!usedN.has(j) && !n.off && !ctx.orphan(on[j], 'native')) out.push({ type: 'deco', aspects: ['deco'], label: labelOf(on[j]), lone: 'native', msg: `原生多出装饰：${desc(n)}`, n: { frame: n } }); });
  return out;
}

// ───────────────────────── 墨格 ─────────────────────────

/** 同一边框相同（±1pt）的格只留一个（网页写字格的墨层与实时层）；字形格挨着另一个同高的字形格（一个词逐字排开）的不算格——那是文字，按文字比。 */
export function normCells(list) {
  const out = [];
  const glyphs = (list || []).filter(c => c.kind === 'glyph');
  const inWord = c => glyphs.some(o => o !== c && Math.abs(o.y - c.y) <= 1 && Math.abs(o.h - c.h) <= 1 && (Math.abs(o.x - (c.x + c.w)) <= 4 || Math.abs(c.x - (o.x + o.w)) <= 4));
  // 字形格（用文字排出来的单字）不作墨格比：文字已按元素比字号 / 位置 / 颜色；墨格只比画出来的字（canvas / 墨视图 / 图片 / 字形轮廓）
  list = (list || []).filter(c => c.kind !== 'glyph' && !inWord(c));
  for (const c of list || []) if (!out.some(o => Math.abs(o.x - c.x) <= 1 && Math.abs(o.y - c.y) <= 1 && Math.abs(o.w - c.w) <= 1 && Math.abs(o.h - c.h) <= 1)) out.push(c);
  return out;
}

const sameBox = (a, b, tol) => Math.abs(center(a).x - center(b).x) <= tol.pos && Math.abs(center(a).y - center(b).y) <= tol.pos && Math.abs(a.w - b.w) <= tol.size && Math.abs(a.h - b.h) <= tol.size;

/**
 * 交叉配对：一边的图标与另一边的墨格框对得上 → 同一个东西（小笔迹 / 样字两边画法不同），从装饰与墨格里拿掉、作一对墨格比墨。
 * 返回 {webDecos, nativeDecos, webCells, nativeCells, pairs:[{w, n, dx, dy}]}。
 */
export function crossMatch(webDecos, nativeDecos, webCells, nativeCells, tol) {
  const wd = normDecos(webDecos), nd = normDecos(nativeDecos), wc = normCells(webCells), nc = normCells(nativeCells);
  const pairs = [];
  const take = (decos, cells, decoIsWeb) => {
    for (let i = decos.length - 1; i >= 0; i -= 1) {
      const d = decos[i];
      if (d.kind !== 'icon') continue;
      // 框对得上；只差竖向（≤ 24pt，弹层下面的页跟着弹层位置上下差）也算同一个，另报竖向位置差
      const k = cells.findIndex(c => sameBox(d, c, tol) || (Math.abs(center(d).x - center(c).x) <= tol.pos && Math.abs(center(d).y - center(c).y) <= 24 && Math.abs(d.w - c.w) <= tol.size && Math.abs(d.h - c.h) <= tol.size));
      if (k < 0) continue;
      const c = cells[k];
      const w = decoIsWeb ? d : c, n = decoIsWeb ? c : d;
      pairs.push({ w: { ...w, kind: decoIsWeb ? 'ink' : w.kind }, n, dx: center(n).x - center(w).x, dy: center(n).y - center(w).y });
      decos.splice(i, 1); cells.splice(k, 1);
    }
  };
  if (webDecos && nativeCells) take(wd, nc, true);
  if (nativeDecos && webCells) take(nd, wc, false);
  return { webDecos: webDecos && wd, nativeDecos: nativeDecos && nd, webCells: webCells && wc, nativeCells: nativeCells && nc, pairs };
}

/**
 * 墨格配对。返回 {pairs:[{w, n, dx, dy}], diffs}。中心差 ≤ max(pos, 格边 25%) 算同一格（同中心的几层取边长最接近的），边长差 > max(size, 25%) 报「格大小」；
 * 网页格里没有任何原生格（中心）→ 缺少；原生格中心不在任何网页格里 → 多出（同一格原生画成两层：墨视图 + 衬底字视图，不算多出）。
 */
/** 网页还没画的懒加载 canvas：屏外、框是浏览器默认的 2:1（宽 ≈ 2 × 高）占位——它的高不是真格的高。 */
export const lazyPlaceholder = c => !!c.off && c.kind === 'ink' && c.h > 4 && Math.abs(c.w - 2 * c.h) <= Math.max(1.5, 0.04 * c.w);

export function pairCells(webCells, nativeCells, tol, els = {}) {
  if (!webCells || !nativeCells) return { pairs: [], diffs: [] };
  const ctx = context(els);
  const W = normCells(webCells), N = normCells(nativeCells);
  const cands = [];
  W.forEach((w, i) => N.forEach((n, j) => {
    const cw = center(w), cn = center(n);
    // QA-H4：网页远处还没懒画的 canvas 只有浏览器默认的 2:1 占位框（300×150 的比例），高只有真格的一半——按横向中心 + 顶边配，不比大小
    const ph = lazyPlaceholder(w);
    const dx = cn.x - cw.x, dy = ph ? n.y - w.y : cn.y - cw.y;
    const d = Math.hypot(dx, dy);
    const side = Math.min(w.w, w.h);
    if (ph ? d <= tol.pos : d <= Math.max(tol.pos, 0.25 * side)) cands.push({ i, j, ph, d: d + (ph ? 0 : Math.abs(n.w - w.w) + Math.abs(n.h - w.h)), dx, dy });
  }));
  cands.sort((p, q) => p.d - q.d);
  const usedW = new Set(), usedN = new Set(), pairs = [], diffs = [];
  const desc = c => `${c.kind === 'glyph' ? `字形格「${c.text || ''}」` : c.kind === 'image' ? '图片格' : '墨格'} (${c.x}, ${c.y} ${c.w}×${c.h})${offNote(c)}`;
  for (const c of cands) {
    if (usedW.has(c.i) || usedN.has(c.j)) continue;
    usedW.add(c.i); usedN.add(c.j);
    const w = W[c.i], n = N[c.j];
    const bigger = !c.ph && (Math.abs(n.w - w.w) > Math.max(tol.size, 0.25 * w.w) || Math.abs(n.h - w.h) > Math.max(tol.size, 0.25 * w.h));
    if (bigger) { diffs.push({ type: 'cell', aspects: ['cell'], label: labelOf(ownerOf(center(w), ctx.web)), msg: `格大小 网页${desc(w)} 原生${desc(n)}`, w: { frame: w }, n: { frame: n } }); continue; }
    pairs.push({ w, n, dx: c.dx, dy: c.dy });
    if (Math.abs(c.dx) > tol.pos || Math.abs(c.dy) > tol.pos) diffs.push({ type: 'cell', aspects: ['cell'], label: labelOf(ownerOf(center(w), ctx.web)), vertical: Math.abs(c.dx) <= tol.pos, msg: `格位置 网页${desc(w)} 原生${desc(n)}，中心差 (${r1(c.dx)}, ${r1(c.dy)})pt`, w: { frame: w }, n: { frame: n } });
  }
  W.forEach((w, i) => {
    if (usedW.has(i) || N.some(n => inside(center(n), w))) return;
    const o = ownerOf(center(w), ctx.web);
    if (!ctx.orphan(o, 'web')) diffs.push({ type: 'cell', aspects: ['cell'], label: labelOf(o), lone: 'web', msg: `原生缺少${desc(w)}`, w: { frame: w } });
  });
  N.forEach((n, j) => {
    if (usedN.has(j) || n.off || W.some(w => inside(center(n), w))) return; // 屏外的原生多出不报（同装饰：网页屏外的图可能还没画）
    const o = ownerOf(center(n), ctx.native);
    if (!ctx.orphan(o, 'native')) diffs.push({ type: 'cell', aspects: ['cell'], label: labelOf(o), lone: 'native', msg: `原生多出${desc(n)}`, n: { frame: n } });
  });
  return { pairs, diffs };
}

/** 一个状态的线 / 装饰 / 墨格差异，与要比墨的格对。 */
export function diffGraphics(webDump, nativeDump, tol, els = {}, opts = GRAPHICS_DEFAULTS) {
  // QA-H4：两边的 Tab 栏上沿取较小的一个，同一条线以下都算 Tab 栏（原生浮起的玻璃胶囊比网页通栏矮，不统一的话网页那条顶线两边认不到同一个所属）
  const tabs = [els.web, els.native].map(tabBarTop).filter(t => t !== null);
  if (tabs.length) {
    const top = Math.min(...tabs);
    els = { ...els, web: Object.assign([...(els.web || [])], { tabTop: top }), native: Object.assign([...(els.native || [])], { tabTop: top }) };
  }
  const x = crossMatch(webDump.decos, nativeDump.decos, webDump.cells, nativeDump.cells, tol);
  const cells = pairCells(x.webCells, x.nativeCells, tol, els);
  const crossDiffs = x.pairs.filter(p => Math.abs(p.dy) > tol.pos).map(p => ({ type: 'cell', aspects: ['cell'], label: labelOf(ownerOf(center(p.w), els.web)), vertical: true,
    msg: `格位置 网页 (${p.w.x}, ${p.w.y} ${p.w.w}×${p.w.h}) 原生 (${p.n.x}, ${p.n.y})，竖向差 ${r1(p.dy)}pt`, w: { frame: p.w }, n: { frame: p.n } }));
  const decos = diffDecos(x.webDecos, x.nativeDecos, tol, els, opts);
  const diffs = [...crossDiffs, ...diffRules(webDump.rules, nativeDump.rules, tol, { ...els, cells: { web: webDump.cells, native: nativeDump.cells }, decos: { web: webDump.decos, native: nativeDump.decos } }, opts), ...decos, ...cells.diffs];
  // 配上对的图标另在截图上看「画出来没有」（被底色盖住、透明）：compare.mjs 取掩膜，一边有墨一边没有就报
  return { diffs, inkPairs: [...cells.pairs, ...x.pairs], iconPairs: (decos.pairs || []).filter(p => p.w.kind === 'icon') };
}

/**
 * 滚动区的公共可见窗（QA-H3e / D75）：两边都有的滚动区（语义键 *-scroll）可见高度不同时（网页 WebKit 表单辅助栏占 68pt、原生弹层贴键盘，原生滚动区更高），
 * 只在两边都看得见的高度里比线 / 装饰 / 墨格 / 画出来的字色：滚动内容里「越过公共窗下沿」（含骑在下沿上）的东西两边都不比——
 * 它在较矮的一边被裁掉 / 盖在底栏与键盘下面、在较高的一边看得见，是同一份内容裁在不同高度，不是画法的差异。
 * 返回 {web, native}：每边 [{x, w, top, feet}]（滚动区的横向范围、公共窗下沿、固定底栏 *-foot / *-bar 的框）；没有成对且不等高的滚动区 → 两边都是空数组。
 */
export function scrollWindows(webEls, nativeEls) {
  const isScroll = e => e.key && /(^|-)scroll$/.test(e.key) && e.frame;
  const feetOf = els => (els || []).filter(e => e.key && /-(foot|bar)$/.test(e.key) && e.frame).map(e => e.frame);
  const out = { web: [], native: [] };
  for (const w of (webEls || []).filter(isScroll)) {
    const n = (nativeEls || []).find(e => isScroll(e) && e.key === w.key);
    if (!n || Math.abs(w.frame.h - n.frame.h) <= 1) continue;
    const H = Math.min(w.frame.h, n.frame.h);
    out.web.push({ x: w.frame.x, w: w.frame.w, top: w.frame.y + H, feet: feetOf(webEls) });
    out.native.push({ x: n.frame.x, w: n.frame.w, top: n.frame.y + H, feet: feetOf(nativeEls) });
  }
  return out;
}

const withinX = (z, f) => f.x >= z.x - 1 && f.x + f.w <= z.x + z.w + 1;
const boxIn = (f, g) => f.x >= g.x - 1 && f.y >= g.y - 1 && f.x + f.w <= g.x + g.w + 1 && f.y + f.h <= g.y + g.h + 1;

/** 图形（线 / 装饰 / 墨格）落在公共窗下沿以下、滚动区横向范围里 → 不比。 */
export function hiddenGraphic(zones, side, g) {
  return (zones[side] || []).some(z => withinX(z, g) && g.y + g.h > z.top);
}

/** 文字（元素 + 文字框）：同上；但整个元素在固定底栏里的（主按钮）不算——底栏盖在滚动内容上面，它自己是真的画面。 */
export function hiddenText(zones, side, el) {
  const f = el.textFrame || el.frame;
  return (zones[side] || []).some(z => withinX(z, f) && f.y + f.h > z.top && !z.feet.some(ft => boxIn(el.frame, ft)));
}

export function commonScrollWindow(webDump, nativeDump, webEls, nativeEls) {
  const zones = scrollWindows(webEls, nativeEls);
  if (!zones.web.length) return { web: webDump, native: nativeDump };
  // 被裁掉的装饰 / 墨格自己的边线（圆的边、格框）跟着一起不比：线的框落在它们的框里（±1.5）
  const strip = (dump, side) => {
    const gone = [...(dump.decos || []), ...(dump.cells || [])].filter(g => hiddenGraphic(zones, side, g));
    const owned = r => gone.some(g => r.x >= g.x - 1.5 && r.y >= g.y - 1.5 && r.x + r.w <= g.x + g.w + 1.5 && r.y + r.h <= g.y + g.h + 1.5);
    return { ...dump,
      decos: (dump.decos || []).filter(d => !hiddenGraphic(zones, side, d)),
      cells: (dump.cells || []).filter(c => !hiddenGraphic(zones, side, c)),
      rules: (dump.rules || []).filter(r => !hiddenGraphic(zones, side, r) && !owned(r)) };
  };
  return { web: strip(webDump, 'web'), native: strip(nativeDump, 'native'), zones };
}

/**
 * 盖在不透明弹层下面的页面图形（QA-H3e）：线 / 装饰 / 墨格差异的图形，所属元素在清单里排在弹层（语义键 *-sheet）之前（清单是树序，后画的在上）、
 * 图形中心落在弹层框里 → 两边的截图上都被弹层盖住，不是画面差异。只有一边的差异（缺少 / 多出）看那一边；两边都有的两边都得盖住。
 */
export function underSheet(d, webEls, nativeEls) {
  const hid = (g, els) => {
    const f = g && g.frame;
    if (!f) return null;
    const owner = ownerOf(center(f), els);
    const oi = owner ? els.indexOf(owner) : -1;
    if (oi < 0) return false;
    return els.some((e, i) => i > oi && e.key && /-sheet$/.test(e.key) && e.frame && inside(center(f), e.frame));
  };
  const a = hid(d.w, webEls), b = hid(d.n, nativeEls);
  const sides = [a, b].filter(x => x !== null);
  return sides.length > 0 && sides.every(Boolean);
}

/**
 * 文字框里的主导字色（QA-H3e）：data = RGBA 一维数组（getImageData）、w × h。
 * 底色 = 最常出现的颜色（每通道 16 档量化后取众数那一档的均值）；字 = 与底色最大通道差 ≥ minDist 的像素；
 * 字色 = 差最大的 20% 字像素的均值（抗锯齿边不拉淡）。返回 {bg:[r,g,b], ink:[r,g,b]|null, n, maxDist}。自包含（compare.mjs 把它整个送进浏览器跑）。
 */
export function glyphInk(data, w, h, minDist = 40, minPx = 8) {
  const bins = new Map();
  const N = w * h;
  for (let k = 0; k < N; k += 1) {
    const i = k * 4, key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
    const b = bins.get(key) || { c: 0, r: 0, g: 0, b: 0 };
    b.c += 1; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    bins.set(key, b);
  }
  let top = null;
  for (const b of bins.values()) if (!top || b.c > top.c) top = b;
  if (!top) return { bg: [0, 0, 0], ink: null, n: 0, maxDist: 0 };
  const bg = [top.r / top.c, top.g / top.c, top.b / top.c];
  const ds = [];
  let maxDist = 0;
  for (let k = 0; k < N; k += 1) {
    const i = k * 4;
    const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
    if (d > maxDist) maxDist = d;
    if (d >= minDist) ds.push([d, data[i], data[i + 1], data[i + 2]]);
  }
  const r = x => Math.round(x);
  if (ds.length < minPx) return { bg: bg.map(r), ink: null, n: ds.length, maxDist: r(maxDist) };
  ds.sort((a, b) => b[0] - a[0]);
  const m = Math.max(3, Math.floor(ds.length * 0.2));
  const sum = [0, 0, 0];
  for (let k = 0; k < m; k += 1) { sum[0] += ds[k][1]; sum[1] += ds[k][2]; sum[2] += ds[k][3]; }
  return { bg: bg.map(r), ink: sum.map(v => r(v / m)), n: ds.length, maxDist: r(maxDist) };
}

/** 一对文字的字色判定（glyphInk 的两个结果，网页 / 原生）：返回差异说明数组（空 = 一致）。 */
export function judgeGlyph(web, native, opts = GRAPHICS_DEFAULTS.glyph) {
  if (!web || !native || !web.ink) return []; // 网页取不到字（空框 / 图标）→ 不比
  const hex = c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (!native.ink) return [`画出来的字几乎看不见：网页字 ${hex(web.ink)} 在底 ${hex(web.bg)} 上（与底最大差 ${web.maxDist}），原生文字框里找不到字（与底 ${hex(native.bg)} 最大差只有 ${native.maxDist}）`];
  const out = [];
  const pw = Math.sign(lum(web.ink) - lum(web.bg)), pn = Math.sign(lum(native.ink) - lum(native.bg));
  if (pw !== pn) out.push(`画出来的字明暗反了：网页字 ${hex(web.ink)} / 底 ${hex(web.bg)}，原生字 ${hex(native.ink)} / 底 ${hex(native.bg)}`);
  else if (Math.max(...web.ink.map((v, i) => Math.abs(v - native.ink[i]))) > (opts.color ?? 64)) out.push(`画出来的字色 网页 ${hex(web.ink)}（底 ${hex(web.bg)}）原生 ${hex(native.ink)}（底 ${hex(native.bg)}）`);
  else if (native.maxDist < (opts.contrast ?? 0.5) * web.maxDist) out.push(`画出来的字对比弱：与底最大差 网页 ${web.maxDist} 原生 ${native.maxDist}`);
  return out;
}

/** 采样区：网页格的大小，各自以自己格的中心为中心（格位置差另报，这里只比格里的墨）。 */
export function cellRegions(pair, opts = GRAPHICS_DEFAULTS.ink) {
  const { w, n } = pair;
  const N = Math.max(8, Math.min(opts.maxN ?? 64, Math.round(Math.min(w.w, w.h))));
  const inset = Math.max(opts.inset ?? 2, (opts.insetFrac ?? 0) * Math.min(w.w, w.h));
  const cn = center(n);
  return { n: N, inset, web: { x: w.x, y: w.y, w: w.w, h: w.h }, native: { x: cn.x - w.w / 2, y: cn.y - w.h / 2, w: w.w, h: w.h } };
}

/**
 * 掩膜去掉「整块落在靠边一条（边长 12%）里、又小」的连通块（8 连通、< 15% 墨点）：骑在格线上的日期角标、邻格伸进来的一角——不是这一格的墨。
 * 格里的墨有内边（9–12%），落不进靠边那一条；字画大了伸到边上的是大块，照留。两边同一规则。
 */
export function cleanMask(m, n) {
  const lab = new Int32Array(n * n).fill(-1);
  const total = [...m].reduce((s, ch) => s + (ch === '1' ? 1 : 0), 0);
  if (!total) return m;
  const out = m.split('');
  for (let s = 0; s < n * n; s += 1) {
    if (m[s] !== '1' || lab[s] >= 0) continue;
    const stack = [s], comp = [];
    lab[s] = s;
    let x0 = n, y0 = n, x1 = -1, y1 = -1;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const i = p % n, j = (p - i) / n;
      x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j);
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const q = y * n + x;
        if (m[q] === '1' && lab[q] < 0) { lab[q] = s; stack.push(q); }
      }
    }
    const band = Math.floor(0.12 * n);
    const edge = y1 <= band || y0 >= n - 1 - band || x1 <= band || x0 >= n - 1 - band;
    // 细横画 / 小格的整格墨点很少，15% 不到一个角标字的墨点：再按绝对大小认——靠边、又只有「一个小字角」那么大（≤ 0.4n 点、外框边长 < 0.25n）的块也不是这一格的墨
    const tagLike = comp.length <= 0.4 * n && x1 - x0 < 0.25 * n && y1 - y0 < 0.25 * n;
    if (edge && (comp.length < 0.15 * total || tagLike)) for (const p of comp) out[p] = '0';
  }
  return out.join('');
}

/**
 * 缓冲带（QA-H4）：compare.mjs sampleCells 给的掩膜字符是 '1' 肯定是墨、'b' 略过截止值（算墨）、'c' 略低于截止值（不算墨）、'0' 肯定不是（旧掩膜只有 '0' / '1'）。
 * 某个点两边判得不一样，但两边都落在各自截止值的 ±band 缓冲带里（淡字压在截止值上，两边差几个灰度就翻）→ 不是真差异，两边都去掉；
 * 一边在带里、另一边明显有墨 / 明显没墨的照常算差异。最后 'b' 记墨、'c' 记非墨。
 */
export function settleBorderline(a, b) {
  const border = ch => ch === 'b' || ch === 'c';
  const A = a.split(''), B = b.split('');
  for (let k = 0; k < A.length; k += 1) {
    if (border(A[k]) && border(B[k]) && A[k] !== B[k]) { A[k] = '0'; B[k] = '0'; }
  }
  const fin = ch => (ch === 'b' ? '1' : ch === 'c' ? '0' : ch);
  return [A.map(fin).join(''), B.map(fin).join('')];
}

/**
 * 两张 N×N 掩膜（'0' / '1' 串）的比较：iou1（容 1 格：双方墨点落在对方墨 1 格内的比例取小者）、墨外框中心差（pt）、墨外框（pt）。
 * cellPt：采样区边长（pt，换算格 → pt）。返回 {web, native, iou1, dx, dy, sw, sh, box}。
 */
export function inkMetrics(a, b, n, cellPt) {
  if (!a || !b || a.length !== n * n || b.length !== n * n) return null;
  [a, b] = settleBorderline(a, b);
  a = cleanMask(a, n); b = cleanMask(b, n);
  const at = (m, i, j) => i >= 0 && j >= 0 && i < n && j < n && m.charCodeAt(j * n + i) === 49;
  const near = (m, i, j) => { for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) if (at(m, i + di, j + dj)) return true; return false; };
  // 位置用墨外框的中心（不用质心：笔锋粗细分布两边画法不同，质心会跟着偏，外框不会）
  const stat = m => { let c = 0, x0 = n, y0 = n, x1 = -1, y1 = -1; for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) if (at(m, i, j)) { c += 1; x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j); } return { c, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bw: x1 - x0 + 1, bh: y1 - y0 + 1 }; };
  const A = stat(a), B = stat(b);
  let nearA = 0, nearB = 0;
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    if (at(a, i, j) && near(b, i, j)) nearA += 1;
    if (at(b, i, j) && near(a, i, j)) nearB += 1;
  }
  const k = cellPt / n, r3 = x => Math.round(x * 1000) / 1000;
  return {
    web: A.c, native: B.c,
    iou1: A.c && B.c ? r3(Math.min(nearA / A.c, nearB / B.c)) : (A.c === B.c ? 1 : 0),
    dx: r1((B.cx - A.cx) * k), dy: r1((B.cy - A.cy) * k),
    sw: A.c && B.c ? r3(B.bw / A.bw) : null, sh: A.c && B.c ? r3(B.bh / A.bh) : null,
    // 墨外框（pt）：网页 [宽, 高]、原生 [宽, 高]
    box: A.c && B.c ? [r1(A.bw * k), r1(A.bh * k), r1(B.bw * k), r1(B.bh * k)] : null,
  };
}

/** 一对墨格的判定：返回差异说明数组（空 = 一致）。cellPt：格边长（pt）。 */
export function judgeInk(m, cellPt, opts = GRAPHICS_DEFAULTS.ink) {
  if (!m) return [];
  const min = opts.minInk ?? 6;
  if (m.web < min && m.native < min) return [];
  if (m.web < min) return [`格里原生有墨（${m.native} 点）、网页没有`];
  if (m.native < min) return [`格里网页有墨（${m.web} 点）、原生没有`];
  const out = [];
  if (m.iou1 < (opts.iou1 ?? 0.6)) out.push(`墨形不合（容 1 格 IoU ${m.iou1} < ${opts.iou1 ?? 0.6}）`);
  const lim = Math.max(opts.centroidMin ?? 1.5, (opts.centroid ?? 0.05) * cellPt);
  if (Math.hypot(m.dx, m.dy) > lim) out.push(`墨的位置偏 (${m.dx}, ${m.dy})pt > ${r1(lim)}`);
  const sc = opts.scale ?? 0.12, smin = opts.scaleMin ?? 2;
  const [ww, wh, nw, nh] = m.box || [0, 0, 0, 0];
  if (Math.abs(nw - ww) > Math.max(smin, sc * ww) || Math.abs(nh - wh) > Math.max(smin, sc * wh)) out.push(`墨的外框 网页 ${ww}×${wh} 原生 ${nw}×${nh}pt（容 ±${sc} 且 > ${smin}pt）`);
  return out;
}

/**
 * 图标在截图里「看得见」的判定带滞回（QA-H4）：两边的墨点数落在 minInk 两侧但相差很小（7 对 5，抗锯齿的一两个点）不算有无之差；
 * 一边看得见、另一边看不见，且相差超过 2 × minInkHyst 点才报。
 */
export function iconVisibilityDiffers(a, b, opts = GRAPHICS_DEFAULTS.ink) {
  const min = opts.minInk ?? 6, hyst = opts.minInkHyst ?? 2;
  return (a >= min) !== (b >= min) && Math.abs(a - b) > 2 * hyst;
}

/**
 * 框是否伸进了系统 Tab 栏的范围（QA-H4）：Tab 栏顶边（两边 tab-* 的较小顶边）以下的像素是 Tab 栏（网页通栏 / 原生玻璃胶囊）的，不是页面的——
 * 跨过 Tab 栏顶边的格 / 文字不按整块比截图像素（Tab 栏的图标、标签、玻璃会落进掩膜 / 字色里）；位置与有无照比。
 */
export function reachesTabBar(frame, top) {
  return top !== null && top !== undefined && !!frame && frame.y + frame.h > top + 0.5;
}
