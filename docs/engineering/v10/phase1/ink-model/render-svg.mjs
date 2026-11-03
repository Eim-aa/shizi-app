// 把 vectors.json 的每条向量与演示字渲染成 SVG（浅色纸 / 夜间纸各一），供人看。
// 几何直接用 reference.mjs 的 geometry()（三角带并集，非零规则），质感（纸纹、飞白、洇墨）是规格 §5 的 SVG 近似：
// 原生端用 Metal 片元着色器实现同一组参数，不要求像素一致。
// 用法：node render-svg.mjs  → out/light/*.svg、out/night/*.svg、out/sheet-*.svg（总览；node svg-to-png.mjs 转 PNG 后删掉总览 SVG）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, geometry, params, sizeComp } from './reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const doc = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));

/** 两套纸墨（规格 §5.1；取 src/config/tokens.css 的 --c / --i1 / --g 现值，D33 视觉重建后跟随新 token）。 */
export const THEMES = {
  light: { paper: '#FBF8F2', ink: '#3B2F28', guide: 'rgba(166,83,63,0.28)', label: '#6A645B', grain: 0.07 },
  night: { paper: '#2D2823', ink: '#DCCFB8', guide: 'rgba(200,110,85,0.34)', label: '#A09A8E', grain: 0.09 },
};

const f = x => (Math.round(x * 10) / 10).toString(); // 显示精度 0.1 单位（400pt@3x 下 ≈0.35px）
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pathD(polys) {
  return polys.map(p => 'M' + p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z').join('');
}

// 确定性哈希噪声（飞白条纹用；原生端同一种子 = 同一笔在各处一模一样）
function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function noise1(s, lane, seed) {
  const i = Math.floor(s);
  const u = s - i;
  const a = hash(i * 131 + lane * 7919 + seed);
  const b = hash((i + 1) * 131 + lane * 7919 + seed);
  const w = u * u * (3 - 2 * u);
  return a + (b - a) * w;
}

function strokeSeed(raw) {
  let h = 17;
  for (const q of raw.slice(0, 8)) h = Math.imul(h ^ Math.round(q.x * 10 + q.y * 1000), 16777619);
  return h >>> 0;
}

/** 一笔的 SVG 片段。widthMul：尺寸补偿（规格 §6）。 */
export function strokeSvg(raw, theme, { id = 's', widthMul = 1, reduceMotion = false } = {}) {
  const profile = analyze(raw, { reduceMotion });
  if (widthMul !== 1) {
    for (const q of profile.samples) {
      q.w *= widthMul;
      q.hwL *= widthMul;
      q.hwR *= widthMul;
    }
  }
  const geom = geometry(profile);
  const d = pathD(geom.polys);
  const k = params();
  const seed = strokeSeed(raw);
  let s = '';
  // 洇墨（墨晕）：在笔下方，半径 = 半宽 + spread·strength，径向渐变到透明
  for (const [bi, b] of profile.blooms.entries()) {
    const q = profile.samples.reduce((best, c) => (Math.abs(c.s - b.s) < Math.abs(best.s - b.s) ? c : best), profile.samples[0]);
    const r = q.w / 2 + 0.6 + k.bloomSpread * 2.2 * b.strength;
    const gid = `${id}-bl${bi}`;
    s += `<radialGradient id="${gid}"><stop offset="${f((q.w / 2) / r)}" stop-color="${theme.ink}" stop-opacity="${f(k.bloomAlpha * (0.5 + b.strength))}"/><stop offset="1" stop-color="${theme.ink}" stop-opacity="0"/></radialGradient>`;
    s += `<circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(r)}" fill="url(#${gid})"/>`;
  }
  s += `<clipPath id="${id}-clip"><path d="${d}"/></clipPath>`;
  s += `<path d="${d}" fill="${theme.ink}" fill-rule="nonzero" filter="url(#grain)"/>`;
  // 飞白：沿笔向的断续细缝（纸色），强度 = dry，按车道与弧长哈希噪声决定断续；裁在本笔轮廓内
  const S = profile.samples;
  if (S.some(q => q.dry > 0.02)) {
    let lines = '';
    const lanes = [-0.62, -0.38, -0.12, 0.16, 0.4, 0.66];
    lanes.forEach((off, li) => {
      let run = [];
      const flush = () => {
        if (run.length > 1) lines += `<polyline points="${run.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}" stroke-width="${f(run.w / run.length)}"/>`;
        run = [];
      };
      for (let i = 1; i < S.length - 1; i += 1) {
        const q = S[i];
        const nz = noise1(q.s / 7.5, li, seed);
        const on = q.dry > 0.02 && nz < q.dry * 1.1;
        if (!on) {
          flush();
          continue;
        }
        const tx = S[i + 1].x - S[i - 1].x;
        const ty = S[i + 1].y - S[i - 1].y;
        const L = Math.hypot(tx, ty) || 1;
        const nx = -ty / L;
        const ny = tx / L;
        const o = off + (noise1(q.s / 9, li + 11, seed) - 0.5) * 0.12;
        const hw = o >= 0 ? q.hwL : q.hwR;
        if (!run.length) run.w = 0;
        run.push([q.x + nx * o * hw * 2 * 0.5, q.y + ny * o * hw * 2 * 0.5]);
        run.w += Math.max(0.15, q.w * 0.045) * (0.6 + q.dry);
      }
      flush();
    });
    if (lines) s += `<g clip-path="url(#${id}-clip)" fill="none" stroke="${theme.paper}" stroke-linecap="butt" stroke-linejoin="round" stroke-opacity="0.6">${lines}</g>`;
  }
  return { svg: s, profile, geom };
}

function defs(theme) {
  // 纸纹：分形噪声调制墨的不透明度（±grain），并把轮廓边缘做 ≤0.35 单位的不规则位移（规格 §5.3）
  return `<defs><filter id="grain" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="0.7" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="1.6 0.35" numOctaves="2" seed="3" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${f(-theme.grain * 2)} 0 0 0 ${f(1 + theme.grain * 0.6)}" result="ga"/>
<feComposite in="d" in2="ga" operator="in"/></filter></defs>`;
}

function guides(theme, x = 0, y = 0, S = 345) {
  const c = S / 2;
  const dash = `stroke-dasharray="${f(S / 60)} ${f(S / 60)}"`;
  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${S - 1}" height="${S - 1}" rx="${f(S * 0.046)}" fill="${theme.paper}" stroke="${theme.guide}" stroke-width="1"/>`
    + `<line x1="${x + c}" y1="${y + 6}" x2="${x + c}" y2="${y + S - 6}" stroke="${theme.guide}" stroke-width="0.8" ${dash}/>`
    + `<line x1="${x + 6}" y1="${y + c}" x2="${x + S - 6}" y2="${y + c}" stroke="${theme.guide}" stroke-width="0.8" ${dash}/>`;
}

function cellSvg(strokes, theme, id, label, opt = {}) {
  let body = '';
  strokes.forEach((raw, i) => {
    body += strokeSvg(raw, theme, { id: `${id}-${i}`, ...opt }).svg;
  });
  const cap = label ? `<text x="8" y="337" font-family="-apple-system, PingFang SC, sans-serif" font-size="11" fill="${theme.label}">${esc(label)}</text>` : '';
  return guides(theme) + body + cap;
}

function wrap(inner, w, h, theme, vb) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb || `0 0 ${w} ${h}`}" style="background:${theme.paper}">${defs(theme)}${inner}</svg>\n`;
}

export function renderAll() {
  for (const [tn, theme] of Object.entries(THEMES)) {
    const dir = join(OUT, tn);
    mkdirSync(dir, { recursive: true });
    // 每条向量一张
    for (const v of doc.vectors) {
      const inner = cellSvg([v.points], theme, v.id, `${v.id} · ${v.name}`);
      writeFileSync(join(dir, `${v.id}.svg`), wrap(inner, 690, 690, theme, '0 0 345 345'));
    }
    // 总览
    const cols = 5;
    const cell = 345;
    const gap = 12;
    const rows = Math.ceil(doc.vectors.length / cols);
    let inner = '';
    doc.vectors.forEach((v, i) => {
      const x = (i % cols) * (cell + gap) + gap;
      const y = Math.floor(i / cols) * (cell + gap) + gap;
      inner += `<g transform="translate(${x} ${y})">${cellSvg([v.points], theme, `${tn}-${v.id}`, v.name)}</g>`;
    });
    const W = cols * (cell + gap) + gap;
    const H = rows * (cell + gap) + gap;
    writeFileSync(join(OUT, `sheet-vectors-${tn}.svg`), wrap(inner, W, H, theme));
    // 演示字 + 尺寸阶梯（同一模型按尺寸缩放，规格 §6）
    let chars = '';
    const names = Object.keys(doc.demoChars);
    names.forEach((ch, i) => {
      const x = i * (cell + gap) + gap;
      chars += `<g transform="translate(${x} ${gap})">${cellSvg(doc.demoChars[ch], theme, `${tn}-c${i}`, `演示字 ${ch}（345）`)}</g>`;
    });
    const sizes = [400, 258, 166.5, 96, 64];
    let x = gap;
    const y0 = cell + gap * 3;
    for (const S of sizes) {
      const k = sizeComp(S);
      const sc = S / 345;
      chars += `<g transform="translate(${x} ${y0}) scale(${f(sc)})">${cellSvg(doc.demoChars['永'], theme, `${tn}-z${S}`, '', { widthMul: k })}</g>`;
      chars += `<text x="${x}" y="${y0 + S + 16}" font-family="-apple-system, PingFang SC, sans-serif" font-size="12" fill="${theme.label}">${S}pt · 线宽×${k.toFixed(2)}</text>`;
      x += S + gap;
    }
    const CW = Math.max(names.length * (cell + gap) + gap, x);
    const CH = y0 + 400 + 30;
    writeFileSync(join(OUT, `sheet-chars-${tn}.svg`), wrap(chars, CW, CH, theme));
    // 减少动态效果：同字无飞白 / 洇墨，形状不变
    if (tn === 'light') {
      let rm = '';
      names.forEach((ch, i) => {
        const xx = i * (cell + gap) + gap;
        rm += `<g transform="translate(${xx} ${gap})">${cellSvg(doc.demoChars[ch], theme, `rm-c${i}`, `减少动态效果 ${ch}`, { reduceMotion: true })}</g>`;
      });
      writeFileSync(join(OUT, 'sheet-chars-reduce-motion.svg'), wrap(rm, names.length * (cell + gap) + gap, cell + gap * 2, theme));
    }
  }
  // 调试叠加：原始点（红）+ 中线（青）+ 宽度剖面轮廓，浅色
  {
    const theme = THEMES.light;
    const cols = 5;
    const cell = 345;
    const gap = 12;
    let inner = '';
    doc.vectors.forEach((v, i) => {
      const x = (i % cols) * (cell + gap) + gap;
      const y = Math.floor(i / cols) * (cell + gap) + gap;
      const { svg, profile } = strokeSvg(v.points, { ...theme, ink: 'rgba(59,47,40,0.55)' }, { id: `dbg-${v.id}`, reduceMotion: true });
      const center = profile.samples.map(q => `${f(q.x)},${f(q.y)}`).join(' ');
      const dots = v.points.map(q => `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="0.9" fill="#C0392B"/>`).join('');
      const cor = profile.corners.map(c => `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="4" fill="none" stroke="#2E86C1" stroke-width="0.8"/>`).join('');
      inner += `<g transform="translate(${x} ${y})">${guides(theme)}${svg}<polyline points="${center}" fill="none" stroke="#17A589" stroke-width="0.5"/>${dots}${cor}<text x="8" y="337" font-size="11" font-family="-apple-system, sans-serif" fill="#6A645B">${v.id} · ${profile.caps.start.type}/${profile.caps.end.type}${profile.hook ? ' · 钩' : ''}</text></g>`;
    });
    const rows = Math.ceil(doc.vectors.length / cols);
    writeFileSync(join(OUT, 'sheet-debug.svg'), wrap(inner, cols * (cell + gap) + gap, rows * (cell + gap) + gap, theme));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  renderAll();
  console.log('SVG →', OUT);
}
