// 练习字字形组件（阶段 1 P1-E2；decisions D33 8a 方案 B、D43、D44；审查 G04 / V02）。
//
// 规则：所有「练习字」（要写的字、参考字、衬底字、字墙 / 字帖 / 详情 / 图片里的标准字形）统一用 hanzi-writer 轮廓渲染；
// ShiziKai 只用于「轮廓缺失时的回退」和非练习字的楷体文字（书家「拾」占位、题跋、落款等，scripts/verify_tokens.mjs 的 glyph 规则登记）。
//
// 为什么是 SVG 而不是 canvas：轮廓路径（data/<字>.json 的 strokes，1024 单位、y 向上、基线 900）直接放进 <path>，缩放由浏览器做、不随尺寸 / 字号倍率 /
// 深浅主题重画；颜色是 currentColor（调用方用 CSS 的 color 给令牌色：--ref / --under / --hand / --wall1…4 / --danzhu），主题切换零成本；
// 一个字一棵小树（每笔一个 <path>，平均 11 笔），墙 / 全部字 / 字帖按「视口附近才取」懒加载，数百格也只实例化可见那一屏。
// canvas 留给本人笔迹（brush 管线）与图片导出（core/images/render.js 的 paintOutline，同一份轮廓数据、同一个几何）。
//
// 几何：与 ui/canvas/glyph.js glyphTransform / render.js paintOutline 同一个仿射——1024 方框落到格里占 face × 1.1（face = 字面占格比例，
// 令牌 typography.glyph.*Face：墙 0.8、字帖位 0.76、对照卡 0.84；face 0.8 ⇒ 方框占 0.88 ⇒ 内边 0.06，与旧版 PAD = .06 一致）；
// x' = x，y' = 900 − y，viewBox 取方框外扩的那一圈。
//
// 状态（data-glyph-src）：
//   loading   数据还没到：什么都不画（不闪 ShiziKai）；尺寸固定，不触发布局抖动
//   outline   轮廓已画（SVG）
//   fallback  题库 / 数据里没有这个字、或取数失败（10.13 语义）：ShiziKai 楷体整字文本
//   text      不是汉字（标点 / 字母 / 数字，没有轮廓可取）：同回退的楷体文本，不发请求
// 读屏：轮廓 / 加载中时放一份视觉隐藏（.sz-pg__sr，clip-path 而非 overflow:hidden，免得版式检查把它当成被裁切的文字）的字（textContent 与原来的文字格一致；调用方若是装饰性的用 hidden 整个藏起来）。
//
// 取数（src/data/strokes.js，内嵌 → LRU → 网络；3s 超时 + 重试 1 次；永不 reject）：
//   - 每个实例挂载当帧先同步窥视（peekStrokes）：LRU 里有就当帧画出，不闪；
//   - 没有就等到视口附近（components/near.js，与 InkMini 同一个观察器）再排队；全局并发 ≤ 6，保证 3s 超时从「真正发请求」起算；
//   - 404 / 数据损坏记入「确无数据」集合，之后同一个字直接回退、不再请求；超时 / 断网只是这次回退，联网恢复（online）后重试。

import { html, useEffect, useRef, useState } from '../../../vendor/ui.js';
import { loadStrokesDetailed, peekStrokes } from '../../data/strokes.js';
import { isPracticable } from '../../data/deck.js';
import { injectStyles, T } from './styles.js';
import { useNearViewport } from './near.js';

export const GLYPH_UNITS = 1024;
export const GLYPH_BASELINE = 900;
/** 字面占格比例（tokens.json typography.glyph.faceRatioOfCell）。 */
export const DEFAULT_FACE = 0.8;
/** 字面比例 → 1024 方框占格比例（0.8 → 0.88，内边 0.06）。 */
export const FACE_TO_BOX = 1.1;
/** 1024 方框占满元素的字面比例（元素本身就是字的方框：题面 40pt 字面、列表行字、空态占位字）。 */
export const FACE_FULL = 1 / FACE_TO_BOX;
/** 同时在途的取数请求上限（浏览器对同源并发本来就是 6；排队里的不计 3s 超时）。 */
export const MAX_INFLIGHT = 6;
/** 双钩（hollow）描边宽，css px（旧版空心字 text-stroke 1px）。 */
export const HOLLOW_STROKE = 1;

const HAN_RE = /^\p{Script=Han}$/u;

/** 只有单个汉字才有轮廓可取。 */
export function isPracticeChar(char) {
  return typeof char === 'string' && HAN_RE.test(char);
}

/** 字面比例 → SVG viewBox（方框外扩的一圈，数值取两位小数）。 */
export function glyphViewBox(face = DEFAULT_FACE) {
  const f = Number.isFinite(face) && face > 0 ? face : DEFAULT_FACE;
  const box = Math.max(0.1, Math.min(1.5, f * FACE_TO_BOX));
  const side = GLYPH_UNITS / box;
  const off = (side - GLYPH_UNITS) / 2;
  const r = n => Math.round(n * 100) / 100 + 0; // + 0：不要 −0
  return { x: r(-off), y: r(-off), w: r(side), h: r(side), box };
}

// ---------------------------------------------------------------- 取数调度（纯逻辑，可注入 loader）

const PERMANENT = new Set(['bad-char', 'not-found', 'invalid', 'no-fetch']);

/**
 * 建一个取数调度器。request(char, cb) 排队取字（同一个字合并），cb(outcome) 的 outcome ∈ 'ready' | 'missing' | 'transient'；
 * 返回取消函数（所有订阅者都取消、还没开始的请求就丢掉）。永不抛。
 */
export function createGlyphScheduler({ load = loadStrokesDetailed, maxInflight = MAX_INFLIGHT } = {}) {
  const entries = new Map(); // char → { char, cbs:Set, started }
  const queue = [];
  const missing = new Set();
  let active = 0;
  const stats = { started: 0, dropped: 0, peak: 0 };

  function finish(entry, outcome) {
    entries.delete(entry.char);
    for (const cb of [...entry.cbs]) {
      try {
        cb(outcome);
      } catch (error) {
        setTimeout(() => {
          throw error;
        }, 0);
      }
    }
  }

  function pump() {
    while (active < maxInflight && queue.length) {
      const entry = queue.shift();
      if (!entry.cbs.size) {
        entries.delete(entry.char);
        stats.dropped += 1;
        continue;
      }
      entry.started = true;
      active += 1;
      stats.started += 1;
      stats.peak = Math.max(stats.peak, active);
      let p;
      try {
        p = Promise.resolve(load(entry.char));
      } catch (error) {
        p = Promise.resolve({ data: null, reason: 'network' });
      }
      p.then(
        detail => detail || { data: null, reason: 'network' },
        () => ({ data: null, reason: 'network' }),
      ).then(detail => {
        active -= 1;
        let outcome = 'ready';
        if (!detail.data) {
          outcome = PERMANENT.has(detail.reason) ? 'missing' : 'transient';
          if (outcome === 'missing') missing.add(entry.char);
        }
        finish(entry, outcome);
        pump();
      });
    }
  }

  return {
    request(char, cb) {
      let entry = entries.get(char);
      if (!entry) {
        entry = { char, cbs: new Set(), started: false };
        entries.set(char, entry);
        queue.push(entry);
      }
      entry.cbs.add(cb);
      pump();
      return () => {
        entry.cbs.delete(cb);
      };
    },
    isMissing: char => missing.has(char),
    forget: char => missing.delete(char),
    stats: () => ({ ...stats, active, queued: queue.length }),
  };
}

let defaultScheduler = null;
export function getGlyphScheduler() {
  if (!defaultScheduler) defaultScheduler = createGlyphScheduler();
  return defaultScheduler;
}
/** 仅供测试：换 / 复原默认调度器。 */
export function setGlyphScheduler(s) {
  defaultScheduler = s || null;
}

/**
 * 这个字有没有轮廓数据可取：题库里的字（data/<字>.json 与题库 7294 字一一对应）才发请求；题库外的字（迁移来的旧记录、自选历史）
 * 直接回退，免得为它们发一串 404（e2e 与线上都不该有失败请求；与 components/work.js 的取舍一致）。
 */
const defaultGate = char => {
  try {
    return isPracticable(`base:${char}`);
  } catch (error) {
    return true; // 题库还没就绪：照常取，取不到再回退
  }
};
let gate = defaultGate;
/** 仅供测试：换 / 复原「能不能取」判断。 */
export function setGlyphGate(fn) {
  gate = typeof fn === 'function' ? fn : defaultGate;
}

/** 同步状态：{status:'text'|'outline'|'fallback'|'loading', data?}。 */
export function glyphStatus(char, { scheduler = getGlyphScheduler(), peek = peekStrokes } = {}) {
  if (!isPracticeChar(char)) return { status: 'text', data: null };
  const data = peek(char);
  if (data) return { status: 'outline', data };
  if (scheduler.isMissing(char) || !gate(char)) return { status: 'fallback', data: null };
  return { status: 'loading', data: null };
}

// ---------------------------------------------------------------- 视图

injectStyles('practice-glyph', `
.sz-pg{position:relative;display:block;width:100%;height:100%;flex:none;line-height:1;color:inherit;user-select:none;-webkit-user-select:none}
.sz-pg__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip-path:inset(50%);white-space:nowrap}
.sz-pg__svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.sz-pg[data-glyph-src="fallback"],.sz-pg[data-glyph-src="text"]{container-type:inline-size}
.sz-pg__fb{position:absolute;left:0;top:0;width:100%;height:100%;display:grid;place-items:center;font-family:${T.kai};
  font-weight:400;line-height:1;font-synthesis:none;font-size:calc(var(--pg-face) * 100cqw);pointer-events:none}
.sz-pg[data-glyph-variant="hollow"] .sz-pg__fb{-webkit-text-fill-color:transparent;-webkit-text-stroke:1px currentColor}
`);

/** 一个字的轮廓：每笔一个 <path>（不合并成一条：笔画有重叠，同向 / 反向绕向混用时 nonzero 填充会挖洞）。 */
function Outline({ data, face, hollow }) {
  const vb = glyphViewBox(face);
  const attrs = hollow
    ? { fill: 'none', stroke: 'currentColor', 'stroke-width': HOLLOW_STROKE, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }
    : { fill: 'currentColor' };
  return html`<svg class="sz-pg__svg" viewBox=${`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} aria-hidden="true" focusable="false">
    <g transform=${`translate(0 ${GLYPH_BASELINE}) scale(1 -1)`}>${data.strokes.map((d, i) => html`<path key=${i} d=${d} ...${attrs}></path>`)}</g>
  </svg>`;
}

/**
 * 纯视图（无 hooks，node:test 可直接调用）。
 * @param {object} p
 * @param {string} p.char
 * @param {'text'|'outline'|'fallback'|'loading'} p.status
 * @param {{strokes:string[]}|null} [p.data]
 * @param {number} [p.face=0.8]
 * @param {'fill'|'hollow'} [p.variant='fill']  hollow = 双钩（只描轮廓，不填；自选未写）
 */
export function PracticeGlyphView({ char, status, data = null, face = DEFAULT_FACE, variant = 'fill', hidden = false, testid, color, class: cls, rootRef }) {
  const f = Number.isFinite(face) && face > 0 ? face : DEFAULT_FACE;
  const showFb = status === 'fallback' || status === 'text';
  const style = showFb ? { '--pg-face': String(f) } : {};
  if (color) style.color = color;
  return html`<span class=${cls ? `sz-pg ${cls}` : 'sz-pg'} ref=${rootRef} data-glyph-src=${status} data-glyph-variant=${variant}
    data-testid=${testid || null} aria-hidden=${hidden ? 'true' : null} lang=${showFb ? 'zh-CN' : null} style=${style}>
    ${status === 'outline' && data ? html`<${Outline} data=${data} face=${f} hollow=${variant === 'hollow'} />` : null}
    ${status === 'outline' || status === 'loading' ? html`<span class="sz-pg__sr">${char}</span>` : null}
    ${showFb ? html`<span class="sz-pg__fb">${char}</span>` : null}
  </span>`;
}

/**
 * 练习字字形。父元素给尺寸（本元素 100% × 100%，要方的由调用方的 CSS 给 aspect-ratio / 宽高）；颜色用 CSS color 或 color 属性（令牌 var()）。
 * @param {object} props
 * @param {string} props.char  单个汉字
 * @param {number} [props.face=0.8]  字面占格比例（typography.glyph.*Face）
 * @param {'fill'|'hollow'} [props.variant]
 * @param {boolean} [props.hidden]  装饰性（aria-hidden，连同读屏文字一起藏）
 * @param {string} [props.class] [props.testid] [props.color]
 */
export function PracticeGlyph(props) {
  const { char } = props;
  const rootRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [, setTick] = useState(0);
  const [transient, setTransient] = useState(null); // 这次取数失败（超时 / 断网）的字
  let st = glyphStatus(char);
  if (st.status === 'loading' && transient === char) st = { status: 'fallback', data: null };
  useEffect(() => {
    if (st.status !== 'loading' || !near) return undefined;
    return getGlyphScheduler().request(char, outcome => {
      if (outcome === 'transient') setTransient(char);
      else setTick(n => n + 1);
    });
  }, [char, near, st.status]);
  // 断网 / 超时的回退只是这一次：联网恢复后重试
  useEffect(() => {
    if (transient !== char || typeof window === 'undefined') return undefined;
    const on = () => setTransient(null);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [transient, char]);
  return PracticeGlyphView({ ...props, status: st.status, data: st.data, rootRef });
}
