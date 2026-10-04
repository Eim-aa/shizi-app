// 参考字形：静态绘制（Path2D → canvas）与笔顺动画（vendor/hanzi-writer.min.js 全局 HanziWriter）。
// 依据：01-架构设计 §6.4–6.5；02 M1-2；reference/C-ink.md §3.2、I-proto-write.md §3.3。
//
// 坐标：数据是 1024 单位、y 向上、基线 900（hanzi-writer Positioner 常量 {x:0,y:-124}→{x:1024,y:900}）。
// 落到边长 size 的格子：padding = size × 0.06（原型 PAD=.06、旧版 round(S*.06)），k = (size − 2·padding)/1024，
//   x' = ox + padding + x·k，   y' = oy + padding + (900 − y)·k
// 与 hanzi-writer 自己的 SVG 变换完全一致，所以静态字形、提示中线、hanzi-writer 动画三者重合。
//
// 给后续卡的接口（M1-3 提示 / M1-4 看答案·描一遍 / M1-5 判断页）：
//   drawGlyph(ctx, strokesData, {color, alpha, size, padding, x, y, from, to, outline})
//   drawMedians(ctx, strokesData, {from, to, color, alpha, width, size, padding, x, y})
//   mediansInBox(strokesData, {size, padding, x, y})  → [[ [x,y]… ]…]（书写格坐标）
//   animate(container, strokesData, {mode:'play'|'preview', char, size, color, reducedMotion, …}) → controller
//   glyphColor(name, fallback)                       → 读设计令牌（--ref / --danzhu / --hand），给 canvas 与 hanzi-writer 用
// 本模块不取数据（src/data/strokes.js 负责），不写存储，不含文案。

import * as policy from '../../config/policy.js';

export const GLYPH_UNITS = 1024;
export const GLYPH_BASELINE = 900;
export const GLYPH_PAD_RATIO = 0.06;
// 提示中线宽度（1024 单位；原型 strokeWidth 18，01 §6.4「宽约 18/1024 单位」）。
export const MEDIAN_WIDTH_UNITS = 18;

// 动画节奏（工程取值；原型没有看答案播放与「先播一遍」，旧版提示用 speed 5 / 间隔 60ms 太快，
// hanzi-writer 默认 speed 1 / 间隔 1000ms 太慢）。过渡值在 policy.motion（P70，待设计走查）；
// animate() 可经 opts.speed / opts.delay / opts.fade 覆盖。
export const ANIMATION = Object.freeze({
  strokeAnimationSpeed: policy.motion.answerSpeed,
  delayBetweenStrokes: policy.motion.answerStrokeGapMs,
  strokeFadeDuration: policy.motion.answerFadeMs,
});

// 令牌回退值：浅色取值（与 src/config/tokens.css 同源；只在读不到 DOM 的单测环境用）。
const TOKEN_FALLBACK = Object.freeze({
  '--ref': '#4E4741',
  '--danzhu': '#C06D57',
  '--hand': '#221D19',
});

/** 格子到数据坐标的仿射参数。 */
export function glyphTransform({ size = 345, padding, x = 0, y = 0 } = {}) {
  const pad = Number.isFinite(padding) ? padding : size * GLYPH_PAD_RATIO;
  const k = (size - 2 * pad) / GLYPH_UNITS;
  return { k, pad, ox: x + pad, oy: y + pad + GLYPH_BASELINE * k };
}

/** 数据点 [x,y] → 格子坐标 [x',y']。 */
export function mapPoint(p, t) {
  return [t.ox + p[0] * t.k, t.oy - p[1] * t.k];
}

/** 全部中线落到格子坐标（M1-3 提示、M1-5 对照可用）。 */
export function mediansInBox(data, opts = {}) {
  if (!data || !Array.isArray(data.medians)) return [];
  const t = glyphTransform(opts);
  return data.medians.map(m => m.map(p => mapPoint(p, t)));
}

function strokeRange(data, from, to) {
  const n = data.strokes.length;
  const a = Math.max(0, Math.min(n, Number.isInteger(from) ? from : 0));
  const b = Math.max(a, Math.min(n, Number.isInteger(to) ? to : n));
  return [a, b];
}

function hasPath2D() {
  return typeof Path2D === 'function';
}

/**
 * 把参考字形（或其中 [from, to) 笔）画到 ctx。ctx 的当前变换决定单位：书写格内部坐标是 345，
 * DPR 缩放由调用方先 setTransform。返回是否画了。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{strokes:string[]}} data  src/data/strokes.js 返回的数据
 * @param {object} [opts]
 * @param {string} [opts.color]  填充色；缺省 --ref
 * @param {number} [opts.alpha=1]
 * @param {number} [opts.size=345] [opts.padding] [opts.x=0] [opts.y=0]
 * @param {number} [opts.from=0] [opts.to=N]
 * @param {boolean} [opts.fill=true]
 * @param {{color:string, width:number}} [opts.outline]  外描线（描一遍：--tl，宽按格子单位，原型 4）
 */
export function drawGlyph(ctx, data, opts = {}) {
  if (!ctx || !data || !Array.isArray(data.strokes) || !hasPath2D()) return false;
  const t = glyphTransform(opts);
  const [from, to] = strokeRange(data, opts.from, opts.to);
  if (from >= to) return false;
  const fill = opts.fill !== false;
  const alpha = Number.isFinite(opts.alpha) ? Math.max(0, Math.min(1, opts.alpha)) : 1;
  ctx.save();
  try {
    ctx.globalAlpha *= alpha;
    ctx.translate(t.ox, t.oy);
    ctx.scale(t.k, -t.k);
    const paths = [];
    for (let i = from; i < to; i++) paths.push(new Path2D(data.strokes[i]));
    if (opts.outline && opts.outline.color) {
      ctx.strokeStyle = opts.outline.color;
      ctx.lineWidth = (Number.isFinite(opts.outline.width) ? opts.outline.width : 4) / t.k;
      ctx.lineJoin = 'round';
      for (const p of paths) ctx.stroke(p);
    }
    if (fill) {
      ctx.fillStyle = opts.color || glyphColor('--ref');
      for (const p of paths) ctx.fill(p);
    }
  } finally {
    ctx.restore();
  }
  return true;
}

/**
 * 画 [from, to) 笔的中线（提示笔画的静态终态；M1-3 的逐笔描画动画在它之上做）。
 * width 按 1024 单位（缺省 18）。
 */
export function drawMedians(ctx, data, opts = {}) {
  if (!ctx || !data || !Array.isArray(data.medians)) return false;
  const t = glyphTransform(opts);
  const n = data.medians.length;
  const from = Math.max(0, Math.min(n, Number.isInteger(opts.from) ? opts.from : 0));
  const to = Math.max(from, Math.min(n, Number.isInteger(opts.to) ? opts.to : n));
  if (from >= to) return false;
  ctx.save();
  try {
    ctx.globalAlpha *= Number.isFinite(opts.alpha) ? opts.alpha : 1;
    ctx.strokeStyle = opts.color || glyphColor('--danzhu');
    ctx.lineWidth = (Number.isFinite(opts.width) ? opts.width : MEDIAN_WIDTH_UNITS) * t.k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = from; i < to; i++) {
      const pts = data.medians[i].map(p => mapPoint(p, t));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------- 颜色

function hexToRgba(hex) {
  const h = hex.slice(1);
  const full = h.length === 4 || h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * 把颜色规整成 hanzi-writer 能解析的形状（#RGB / #RRGGBB / rgb[a](r,g,b[,a])）；解析不了返回 null。
 */
export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(v)) return hexToRgba(v);
  const m = v.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*(\d*\.?\d+)(%?))?\s*\)$/i);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4]);
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
  }
  return null;
}

/** 读设计令牌（深浅色随 data-theme / 系统变化，每次调用现读）。 */
export function glyphColor(name, fallback, el) {
  let raw = '';
  try {
    const target = el || (typeof document !== 'undefined' ? document.documentElement : null);
    if (target && typeof getComputedStyle === 'function') raw = getComputedStyle(target).getPropertyValue(name);
  } catch (error) {
    raw = '';
  }
  return normalizeColor(raw) || normalizeColor(fallback) || TOKEN_FALLBACK[name] || '#4E4741';
}

export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : null) {
  try {
    return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------- 动画（hanzi-writer）

function getHanziWriter(win) {
  const w = win || (typeof window !== 'undefined' ? window : globalThis);
  return w && typeof w.HanziWriter === 'function' ? w.HanziWriter : null;
}

/**
 * 在 container 里用 hanzi-writer 播笔顺。container 由调用方定位并与书写格同尺寸重叠；本函数在里面加一个 SVG
 * （pointer-events:none），destroy() 时拿掉。
 *
 * 模式：
 * - 'play'    看答案页：按笔画播放，终态 = 完整字形留在格里（01 §6.5）。
 * - 'preview' 描一遍开始先播一遍（走查-W19，可跳过）：播完或跳过后把播的笔画收起，只剩调用方画的描红轮廓。
 * 减少动态效果（prefers-reduced-motion 或 opts.reducedMotion）：不播，直接给终态，done 立即以 'static' 结束。
 * hanzi-writer 不可用或出错：'play' 退回静态 Path2D 字形（仍是终态），done 以 'failed' 结束。
 *
 * @param {HTMLElement} container
 * @param {{strokes:string[], medians:number[][][]}} data
 * @param {object} [opts]
 * @param {'play'|'preview'} [opts.mode='play']
 * @param {string} [opts.char]         只用于 hanzi-writer 的内部键；数据由 data 直接给
 * @param {number} [opts.size]         CSS px 边长；缺省 container.clientWidth，再缺省 345
 * @param {number} [opts.padding]
 * @param {string} [opts.color]        笔画色；缺省 --ref
 * @param {boolean} [opts.reducedMotion]
 * @param {number} [opts.speed] [opts.delay]
 * @param {Window} [opts.win]
 * @returns {{done: Promise<'completed'|'skipped'|'static'|'cancelled'|'failed'>, skip():void, cancel():void,
 *   destroy():void, replay():Promise, readonly state:string, readonly writer:any}}
 */
export function animate(container, data, opts = {}) {
  const mode = opts.mode === 'preview' ? 'preview' : 'play';
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  const reduced = typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : prefersReducedMotion(win);
  const size = Number.isFinite(opts.size) && opts.size > 0 ? opts.size : (container && container.clientWidth) || 345;
  const padding = Number.isFinite(opts.padding) ? opts.padding : size * GLYPH_PAD_RATIO;
  const color = normalizeColor(opts.color) || glyphColor('--ref');
  const fadeMs = Number.isFinite(opts.fade) ? opts.fade : ANIMATION.strokeFadeDuration;
  const doc = container && container.ownerDocument;

  let state = 'running';
  let resolveDone;
  let done = new Promise(resolve => {
    resolveDone = resolve;
  });
  let writer = null;
  let host = null; // 我们加进 container 的节点
  const settle = result => {
    if (state !== 'running') return;
    state = result;
    resolveDone(result);
  };

  function mountHost() {
    if (!doc) return null;
    const el = doc.createElement('div');
    el.setAttribute('data-glyph-anim', mode);
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none`;
    container.appendChild(el);
    return el;
  }

  function staticFallback() {
    if (mode !== 'play' || !doc) return;
    try {
      const dpr = (win && win.devicePixelRatio) || 1;
      const canvas = doc.createElement('canvas');
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.cssText = `width:${size}px;height:${size}px;display:block`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawGlyph(ctx, data, { color, size, padding });
      }
      if (!host) host = mountHost();
      if (host) host.replaceChildren(canvas);
    } catch (error) {
      // 静态回退也不行就什么都不画：调用方还有 10.13 的 DOM 楷体
    }
  }

  const HW = getHanziWriter(win);
  if (!container || !data || !Array.isArray(data.strokes) || !data.strokes.length) {
    settle('failed');
    return controller();
  }
  if (reduced && mode === 'preview') {
    settle('static');
    return controller();
  }
  if (!HW) {
    staticFallback();
    settle('failed');
    return controller();
  }
  host = mountHost();
  try {
    writer = HW.create(host, opts.char || '字', {
      width: size,
      height: size,
      padding,
      showCharacter: mode === 'play' && reduced,
      showOutline: false,
      strokeColor: color,
      radicalColor: null,
      strokeAnimationSpeed: Number.isFinite(opts.speed) ? opts.speed : ANIMATION.strokeAnimationSpeed,
      delayBetweenStrokes: Number.isFinite(opts.delay) ? opts.delay : ANIMATION.delayBetweenStrokes,
      strokeFadeDuration: reduced ? 0 : fadeMs,
      charDataLoader: (_char, onLoad) => onLoad(data),
      onLoadCharDataError: () => {
        staticFallback();
        settle('failed');
      },
    });
  } catch (error) {
    writer = null;
    if (host) host.replaceChildren();
    staticFallback();
    settle('failed');
    return controller();
  }
  if (reduced) {
    settle('static'); // 'play' 的终态已由 showCharacter:true 给出
    return controller();
  }
  play();
  return controller();

  function play() {
    let p;
    try {
      p = writer.animateCharacter();
    } catch (error) {
      staticFallback();
      settle('failed');
      return Promise.resolve();
    }
    return Promise.resolve(p).then(
      res => {
        if (state !== 'running' || (res && res.canceled)) return;
        if (mode === 'preview') {
          safe(() => writer.hideCharacter({ duration: fadeMs }));
        }
        settle('completed');
      },
      () => {
        staticFallback();
        settle('failed');
      },
    );
  }

  function safe(fn) {
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (error) {
      // hanzi-writer 内部状态异常时不打断页面
    }
  }

  function controller() {
    return {
      get done() {
        return done;
      },
      get state() {
        return state;
      },
      get writer() {
        return writer;
      },
      /** 跳过：直接到终态（play：完整字形；preview：收起播放的笔画）。 */
      skip() {
        if (state !== 'running') return;
        if (writer) {
          if (mode === 'play') safe(() => writer.showCharacter({ duration: 0 }));
          else safe(() => writer.hideCharacter({ duration: 0 }));
        }
        settle('skipped');
      },
      /** 取消（换字、离开）：停动画，不改终态约定；随后通常 destroy()。 */
      cancel() {
        if (writer) safe(() => writer.pauseAnimation());
        settle('cancelled');
      },
      /** 停动画并把我们加的节点拿掉。 */
      destroy() {
        if (writer) {
          safe(() => writer.hideCharacter({ duration: 0 })); // 取消进行中的 mutation 链（同 scope 会被取消）
        }
        settle('cancelled');
        if (host && host.parentNode) host.parentNode.removeChild(host);
        host = null;
        writer = null;
      },
      /** 再播一遍（看答案页「再看一遍」之类；减少动态效果时什么都不做）。 */
      replay() {
        if (!writer || reduced) return Promise.resolve(state);
        state = 'running';
        done = new Promise(resolve => {
          resolveDone = resolve;
        });
        safe(() => writer.hideCharacter({ duration: 0 }));
        play();
        return done;
      },
    };
  }
}
