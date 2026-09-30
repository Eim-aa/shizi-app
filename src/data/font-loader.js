// 字体加载（决定-D13；01-架构设计 §8.4；02 M5-2）。
//
// fonts/fonts.css 声明三个 face（font-display: swap）：ShiziKai 400、ShiziSerifSC 400、ShiziSerifSC 500。
// DOM 文字靠 CSS 自己加载（swap：回退期显示系统字体）；canvas 不会等 @font-face，所以画之前 await requireFont。
//
// requireFont(face, text) → Promise（从 #180 handoff/r8-foundation/fonts/assets/font-loader.mjs 抽取改造）：
//   1. 查 fonts/coverage-manifest.json：文本先 NFC 归一化，缺字 → reject FONT_MISSING_GLYPHS；
//      含未经视觉复核的组合符（\p{M}）→ reject FONT_COMBINING_UNREVIEWED（#180 GPOS 归因：ê̌ / m̌ 叠放不可靠）。
//      manifest 取不到（离线首启、SW 尚未缓存）→ 降级：跳过覆盖检查，只做下面的 document.fonts.load（degraded:true）。
//   2. document.fonts.load('<weight> 32px "<family>"', text)，并要求返回的每个 FontFace 都是
//      精确的 family / weight / normal / loaded——不把 400 的回退命中当 500 已载入。否则 reject FONT_UNAVAILABLE / FONT_LOAD_FAILED。
//   3. resolve {face, family, weight, text(NFC，调用方按它绘制), normalized, degraded}。
// requireCanvasFont(fontStack, text)：给 core/images/render.js 的 requireFont 注入口用（ui/images-entry.js 传入）。
//   取字体栈第一个 family；不是本包字体（如系统黑体栈）直接 resolve；是本包字体则 await requireFont，
//   失败时记一条 warn 并 resolve {ok:false}——图片仍按字体栈的系统回退画出来（与 DOM swap 同一取舍），不因字体失败做不出图。
// 本模块不写存储、不含文案。

export const FONT_DIR = 'fonts/';
export const MANIFEST_URL = 'fonts/coverage-manifest.json';

export const FACES = Object.freeze({
  'ShiziKai:400': Object.freeze({ key: 'ShiziKai:400', family: 'ShiziKai', weight: 400, file: 'ShiziKai-Regular.woff2' }),
  'ShiziSerifSC:400': Object.freeze({ key: 'ShiziSerifSC:400', family: 'ShiziSerifSC', weight: 400, file: 'ShiziSerifSC-Regular.woff2' }),
  'ShiziSerifSC:500': Object.freeze({ key: 'ShiziSerifSC:500', family: 'ShiziSerifSC', weight: 500, file: 'ShiziSerifSC-Medium.woff2' }),
});

const FAMILIES = new Set(Object.values(FACES).map(f => f.family));

export class FontError extends Error {
  constructor(code, message, extra = {}) {
    super(`${code}: ${message}`);
    this.name = 'FontError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const unquote = s => String(s).trim().replace(/^(['"])(.*)\1$/, '$2').trim();

/** CSS 字体栈的第一个 family（去引号）。 */
export function firstFamily(stack) {
  if (typeof stack !== 'string') return '';
  const m = /^\s*("[^"]*"|'[^']*'|[^,]*)/.exec(stack);
  return m ? unquote(m[1]) : '';
}

function normWeight(w) {
  if (w === 'normal' || w == null || w === '') return 400;
  if (w === 'bold') return 700;
  const n = Number(w);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 各种写法 → face 键（'ShiziKai:400'）；不是本包字体返回 null。
 * 接受：'ShiziSerifSC:500'；{family, weight}；字体栈 '"ShiziKai","Kaiti SC",serif'（weight 取 opts 或 400）。
 */
export function faceKey(face, weight) {
  let family = '';
  let w = weight;
  if (face && typeof face === 'object') {
    family = unquote(face.family || '');
    if (w == null) w = face.weight;
  } else if (typeof face === 'string') {
    const m = /^\s*([A-Za-z][\w ]*):(\d{3})\s*$/.exec(face);
    if (m) {
      family = m[1].trim();
      if (w == null) w = Number(m[2]);
    } else {
      family = firstFamily(face);
    }
  }
  if (!FAMILIES.has(family)) return null;
  const key = `${family}:${normWeight(w)}`;
  return FACES[key] ? key : null;
}

function codepointLabel(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 覆盖检查（#180 inspectText 同义）：NFC 后逐码点查 manifest[key].codepoints；换行 / 制表不计。 */
export function inspectText(manifest, key, raw, { normalize = true } = {}) {
  const entry = manifest && manifest[key];
  if (!entry || !Array.isArray(entry.codepoints)) throw new FontError('FONT_UNKNOWN_FACE', `no coverage for ${key}`);
  const source = raw == null ? '' : String(raw);
  const text = normalize ? source.normalize('NFC') : source;
  const supported = new Set(entry.codepoints);
  const chars = Array.from(text);
  const missing = [...new Set(chars.filter(c => !/[\n\r\t]/u.test(c) && !supported.has(c.codePointAt(0))))];
  const unreviewedCombining = chars.filter(c => /\p{M}/u.test(c));
  return {
    text,
    normalized: text !== source,
    unreviewedCombining,
    missing: missing.map(char => ({ char, codepoint: codepointLabel(char) })),
  };
}

/** manifest 形状：三个 face 都在，codepoints 为整数数组。 */
export function validManifest(json) {
  if (!json || typeof json !== 'object') return false;
  return Object.keys(FACES).every(k => json[k] && Array.isArray(json[k].codepoints)
    && json[k].codepoints.every(Number.isInteger));
}

let manifestPromise = null;

function defaultFetch() {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

/**
 * 读 coverage manifest（模块内缓存一次成功结果；失败返回 null 且不缓存，下次再试）。
 * @param {{fetch?:Function, url?:string}} [o]
 * @returns {Promise<object|null>}
 */
export function loadCoverageManifest(o = {}) {
  if (o.manifest !== undefined) return Promise.resolve(validManifest(o.manifest) ? o.manifest : null);
  if (manifestPromise && !o.fetch) return manifestPromise;
  const doFetch = o.fetch || defaultFetch();
  const url = o.url || MANIFEST_URL;
  const p = (async () => {
    if (!doFetch) return null;
    try {
      const res = await doFetch(url);
      if (!res || !res.ok) return null;
      const json = await res.json();
      return validManifest(json) ? json : null;
    } catch (error) {
      return null;
    }
  })();
  if (!o.fetch) {
    manifestPromise = p.then(m => {
      if (!m) manifestPromise = null;
      return m;
    });
    return manifestPromise;
  }
  return p;
}

/** 测试用：清掉 manifest 缓存。 */
export function resetFontLoader() {
  manifestPromise = null;
}

function fontSet(o) {
  if (o && o.fonts) return o.fonts;
  return typeof document !== 'undefined' && document.fonts ? document.fonts : null;
}

function exactFace(f, spec) {
  return !!f && unquote(f.family) === spec.family && normWeight(f.weight) === spec.weight
    && (f.style === 'normal' || f.style == null) && f.status === 'loaded';
}

/**
 * 精确字重加载一个本包 face，并确认文字都有字形。
 * @param {string|{family:string, weight:number}} face  'ShiziKai:400' / 'ShiziSerifSC:500' / {family, weight} / 字体栈
 * @param {string} [text='']
 * @param {{weight?:number, fonts?:FontFaceSet, fetch?:Function, manifest?:object|null}} [o]
 * @returns {Promise<{face:string, family:string, weight:number, text:string, normalized:boolean, degraded:boolean}>}
 */
export async function requireFont(face, text = '', o = {}) {
  const key = faceKey(face, o.weight);
  if (!key) throw new FontError('FONT_UNKNOWN_FACE', `not a Shizi face: ${JSON.stringify(face)}`);
  const spec = FACES[key];
  const context = `${key}; file=${FONT_DIR}${spec.file}`;
  const manifest = await loadCoverageManifest(o);
  let check;
  if (manifest) {
    check = inspectText(manifest, key, text);
    if (check.missing.length) {
      throw new FontError('FONT_MISSING_GLYPHS', `${check.missing.map(m => m.codepoint).join(' ')} (${context})`, { missing: check.missing });
    }
    if (check.unreviewedCombining.length) {
      throw new FontError('FONT_COMBINING_UNREVIEWED', `${check.unreviewedCombining.map(codepointLabel).join(' ')} (${context})`);
    }
  } else {
    const source = text == null ? '' : String(text);
    check = { text: source.normalize('NFC'), normalized: source.normalize('NFC') !== source };
  }
  const fonts = fontSet(o);
  if (!fonts || typeof fonts.load !== 'function') throw new FontError('FONT_UNAVAILABLE', `no FontFaceSet (${context})`);
  let faces;
  try {
    faces = await fonts.load(`${spec.weight} 32px "${spec.family}"`, check.text || ' ');
  } catch (cause) {
    throw new FontError('FONT_LOAD_FAILED', `${context}; ${cause && cause.name ? cause.name : 'Error'}: ${cause && cause.message ? cause.message : String(cause)}`, { cause });
  }
  const list = Array.from(faces || []);
  // 字体匹配可能返回相近字重：要求每个返回的 face 都是精确的静态 normal face。
  if (!list.length || list.some(f => !exactFace(f, spec))) throw new FontError('FONT_UNAVAILABLE', context);
  if (fonts.ready && typeof fonts.ready.then === 'function') await fonts.ready;
  return { face: key, family: spec.family, weight: spec.weight, text: check.text, normalized: check.normalized, degraded: !manifest };
}

/** document.fonts.check 的精确字重版本（e2e / 诊断用）。 */
export function checkFont(face, o = {}) {
  const key = faceKey(face, o.weight);
  const fonts = fontSet(o);
  if (!key || !fonts || typeof fonts.check !== 'function') return false;
  const spec = FACES[key];
  return fonts.check(`${spec.weight} 16px "${spec.family}"`, o.text || ' ');
}

/**
 * core/images/render.js 的 requireFont 注入口：(fontStack, text) => Promise。
 * 系统字体栈 → 不等；本包字体 → await requireFont；失败只 warn，按字体栈回退绘制。
 * @returns {Promise<{ok:boolean, skipped?:boolean, face?:string, text?:string, error?:Error}>}
 */
export async function requireCanvasFont(fontStack, text = '', o = {}) {
  const key = faceKey(fontStack, o.weight);
  if (!key) return { ok: true, skipped: true };
  try {
    const r = await requireFont(key, text, o);
    return { ok: true, face: r.face, text: r.text, degraded: r.degraded };
  } catch (error) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[shizi] font not ready, drawing with fallback:', error && error.message ? error.message : error);
    return { ok: false, face: key, error };
  }
}
