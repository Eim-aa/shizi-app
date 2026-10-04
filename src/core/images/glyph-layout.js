// 单字手写图片版式 glyphLayout（A05，备注 L146；原型 ShiziScreen charEl L352–L362）。
//
// 阶段 1 P1-E7 之前它和字帖版式同在 layout.js；作品版式（layout.js）换成 §6 的新函数后，单字详情的「手写字图片」仍用这套：
//   不画格子；墨迹外框缩放到宽约画面 60%（放不下按高），居中；字下一行「拼音 · 日期」33/39px；右下「拾字」26px + 78px 小印。
// 画布：1080 × 1440（portrait）/ 1080 × 1080（square），四周留白 72px。

export const SIZES = Object.freeze({
  portrait: Object.freeze({ width: 1080, height: 1440 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
});
export const GLYPH_RATIOS = Object.freeze(['portrait', 'square']);
/** 界面上的比例标签（3:4 / 1:1）对应的版式名。 */
export const RATIO_OF_LABEL = Object.freeze({ '3:4': 'portrait', '1:1': 'square' });

export const MARGIN = 72; // 24pt × 3
export const SEAL = 78; // 26pt × 3

export const GLYPH_GAP = 48;
export const GLYPH_INFO_LINE = 39;
export const GLYPH_INFO_FONT = 33;
export const GLYPH_WIDTH_RATIO = 0.6;
export const SIGNATURE_FONT = 26; // 26/3 pt × 3
export const SIGNATURE_TRACKING = 0.16; // letter-spacing .16em
export const SIGNATURE_SEAL_GAP = 36; // 12pt × 3（charEl 落款与印之间的 gap）

function assertRatio(ratio) {
  if (typeof ratio !== 'string' || !Object.prototype.hasOwnProperty.call(SIZES, ratio)) throw new Error('INVALID_RATIO');
}

/**
 * 笔迹外框（345 单位；每点按半宽外扩）。没有点返回 null。
 * @param {Array<Array<{x:number,y:number,w?:number}>>} points
 */
export function inkBounds(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of points || []) {
    for (const p of stroke || []) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const r = Number.isFinite(p.w) && p.w > 0 ? p.w / 2 : 0;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  }
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * 单字手写图片版式（A05）。bounds = inkBounds(points)；没有笔迹（bounds 为 null）→ status 'noInk'（最近一次没有笔迹就不生成）。
 * 返回导出 px 下：墨迹变换 {k, ox, oy}（x_px = ox + x·k）、信息行、落款与印的位置。
 */
export function glyphLayout(bounds, ratio = 'portrait') {
  assertRatio(ratio);
  const { width, height } = SIZES[ratio];
  const base = { ratio, width, height, margin: MARGIN };
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return { status: 'noInk', ...base };
  const top0 = MARGIN;
  const bot0 = height - MARGIN - SEAL - GLYPH_GAP;
  const maxH = bot0 - top0 - GLYPH_GAP - GLYPH_INFO_LINE;
  const k = Math.min((width * GLYPH_WIDTH_RATIO) / bounds.width, maxH / bounds.height);
  const glyphWidth = bounds.width * k;
  const glyphHeight = bounds.height * k;
  const glyphTop = top0 + (bot0 - top0 - (glyphHeight + GLYPH_GAP + GLYPH_INFO_LINE)) / 2;
  const glyphLeft = (width - glyphWidth) / 2;
  const sealX = width - MARGIN - SEAL;
  const sealY = height - MARGIN - SEAL;
  return {
    status: 'ready',
    ...base,
    k,
    ox: glyphLeft - bounds.x * k,
    oy: glyphTop - bounds.y * k,
    glyph: { x: glyphLeft, y: glyphTop, width: glyphWidth, height: glyphHeight },
    info: { top: glyphTop + glyphHeight + GLYPH_GAP, line: GLYPH_INFO_LINE, font: GLYPH_INFO_FONT, centerX: width / 2 },
    seal: { x: sealX, y: sealY, size: SEAL, rotate: 0 },
    signature: { right: sealX - SIGNATURE_SEAL_GAP, baseline: sealY + SEAL - 6, font: SIGNATURE_FONT, tracking: SIGNATURE_TRACKING },
  };
}
