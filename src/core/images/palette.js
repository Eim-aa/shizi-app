// 导出图的调色板（阶段 1 P1-E7；交接 §0.2 / §6.3：一切导出图片永远是浅纸，`color.light` 一套，不随系统）。
//
// 取值唯一来源是设计令牌（docs/design/design-system-v1/tokens.json ↔ src/config/tokens.css）。本文件里没有颜色字面量：
//   - 浏览器里：`readLightPalette()` 在文档根下临时放一个 `.t-light` 元素，读它上面解析出来的 `--sheet` / `--hand` …
//     （tokens.css 的 .t-light 局部强制浅色，令牌在子树内取浅色，不管页面当前是不是深色）。导出图用平涂笺色，不带纹理（D51 ⑥、V2-07、T2-16：
//     纸纹占位在手机相册里像脏，真实扫描纸纹资产到位前导出图不烘纹理），所以 textures 恒为空；
//   - 测试 / 无 DOM：`paletteFromTokens(tokensJson)` 直接从 tokens.json 的 color.light 转出同一结构。
// P1-E1a 遗留：render.js 旧的 #FBF8F2 / #3B2F28 / #A6533F 等写死色值就此删除。

/** 调色板键 → tokens.css 变量名。 */
export const PALETTE_VARS = Object.freeze({
  paper: '--paper',
  sheet: '--sheet',
  line: '--line',
  frame: '--frame',
  guide: '--guide',
  ink1: '--ink1',
  ink2: '--ink2',
  ink3: '--ink3',
  hand: '--hand',
  ref: '--ref',
  under: '--under',
  zhu: '--zhu',
  seal: '--seal',
  onSeal: '--on-seal',
});

/** 纸纹瓦片尺寸（tokens.css --tex-size：240px，对 402 宽屏）；导出图现在不带纹理，只在以后换真实扫描资产时用。 */
export const TEXTURE_TILES = Object.freeze([240]);

let cached = null;

/** 从 tokens.json 的 color.light 转出调色板（无纹理）。 */
export function paletteFromTokens(tokens) {
  const light = tokens && tokens.color && tokens.color.light;
  if (!light) throw new Error('PALETTE_UNAVAILABLE');
  const colors = {};
  for (const key of Object.keys(PALETTE_VARS)) {
    if (typeof light[key] !== 'string') throw new Error(`PALETTE_UNAVAILABLE: ${key}`);
    colors[key] = light[key];
  }
  return Object.freeze({ ...colors, textures: Object.freeze([]), tiles: TEXTURE_TILES });
}

/** 解析 `url("…"), url("…")` → data URL 列表（现在 --tex-light / --tex-dark 只有颗粒一层）。 */
export function parseTextureUrls(value) {
  const out = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;
  let m;
  while ((m = re.exec(String(value || '')))) out.push(m[1] || m[2] || m[3]);
  return out;
}

/**
 * 读浏览器里的浅色令牌（只读一次，缓存）。没有 document 抛 PALETTE_UNAVAILABLE。
 * @returns {{paper,sheet,line,frame,guide,ink1,ink2,ink3,hand,ref,under,zhu,seal,onSeal, textures:string[], tiles:number[]}}
 */
export function readLightPalette(doc = typeof document !== 'undefined' ? document : null) {
  if (cached) return cached;
  if (!doc || !doc.documentElement || typeof getComputedStyle !== 'function') throw new Error('PALETTE_UNAVAILABLE');
  const probe = doc.createElement('div');
  probe.className = 't-light';
  probe.setAttribute('aria-hidden', 'true');
  probe.hidden = true; // display:none 也能读到自定义属性
  doc.documentElement.appendChild(probe);
  try {
    const cs = getComputedStyle(probe);
    const colors = {};
    for (const [key, name] of Object.entries(PALETTE_VARS)) {
      const v = cs.getPropertyValue(name).trim();
      if (!v) throw new Error(`PALETTE_UNAVAILABLE: ${name}`);
      colors[key] = v;
    }
    const textures = []; // 平涂笺色（D51 ⑥）
    cached = Object.freeze({ ...colors, textures: Object.freeze(textures), tiles: TEXTURE_TILES });
    return cached;
  } finally {
    probe.remove();
  }
}

/** 测试用：清掉缓存。 */
export function resetPaletteCache() {
  cached = null;
}
