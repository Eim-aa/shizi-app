// 系统字号（阶段 1 P1-E6；已决定 D29：字号跟随系统 Dynamic Type，覆盖 X08 与 03 P59；03 P130 / P131 / P133）。
//
// 原生壳（WebViewController.swift）读 traitCollection.preferredContentSizeCategory，在 pageReady 之后和
// UIContentSizeCategory.didChangeNotification 时调用 window.shiziContentSize({category, scale})：
//   category = 'xS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL' | 'AX1' … 'AX5'（将来 iOS 新增的档位原样传 rawValue）；
//   scale    = iOS 正文字号 / 17（连续值，只在表里没有该档位时用）。
// bridge.js 顶层同步定义该全局、就绪前入队只留最后一次。本模块注册实现，并把结果写到 <html>：
//   style --k            连续倍率（policy.contentSizeScale，P130）；= 1 时去掉行内值，用 tokens.css 的缺省 1。
//                        写法是 CSSOM style.setProperty（CSP 只拦 style 属性字符串与 <style>，不拦 CSSOM，见 components/styles.js）。
//   data-text-size       档位名（诊断 / e2e 用）。
//   data-ax="1".."5"     AX 档（AX 专用防溢出规则挂在 :root[data-ax] 上，见 ui/components/ax.js）。
//   data-text-large      --k ≥ policy.compactTextScale（P131）：写字页 / 首页等用紧凑排布（与视口高 ≤ 760 同一套，P69 / D36）。
// 书写格边长与字号无关（P118 / D36，write/compact.js writeGridSize 不读这些属性）。
//
// 网页（PWA / 浏览器，无原生桥）：没有人调用 shiziContentSize，--k 保持 1（P133：不读浏览器默认字号，理由见 03 P133）。
//
// 冷启动无字号跳动（P1-E6b）：原生在创建 WKWebView 时用 WKUserScript(.atDocumentStart) 把**当前**档位注入成
//   window.__shiziInitialContentSize = {category, scale}（载荷同 shiziContentSize；每次加载 / 重载前都按当前档位重建脚本）。
//   本模块在**模块求值时**（app.js 顶部静态导入，早于 DOMContentLoaded 与任何 UI 挂载）读到它就立即写 <html>，之后 pageReady 时
//   原生再发同一档位 → publish 的 same() 为真，不重复写、不通知订阅者、不重排。档位 → --k 的换算仍只有 policy 一份（原生不抄表）。
//   注入脚本只写一个 window 变量，不碰 DOM；页面这边写 --k 用 CSSOM（style.setProperty）+ setAttribute('data-…')，
//   CSP 的 style-src 只拦 style 属性字符串与 <style>，不拦这两种（与 components/styles.js 同一依据）；WKUserScript 本身也不受页面 CSP 约束。
//   网页没有注入变量 → 行为不变（--k 保持 1）。

import { registerNativeHandler } from './bridge.js';
import * as policy from '../config/policy.js';

/** 档位名（小到大），与 policy.contentSizeScale 的键同序。 */
export const CONTENT_SIZE_CATEGORIES = Object.freeze(['xS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'AX1', 'AX2', 'AX3', 'AX4', 'AX5']);

const DEFAULT_VIEW = Object.freeze({ category: null, k: 1, ax: 0, large: false });

function tableRange(table) {
  const values = CONTENT_SIZE_CATEGORIES.map(c => table[c]).filter(v => Number.isFinite(v));
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * 档位 → 倍率。表里有的档位一律用表值（policy 是唯一来源）；表里没有的退回原生量到的 scale，夹在表的最小 / 最大值之间；都不行 → 1。
 */
export function scaleFor(category, nativeScale, { table = policy.contentSizeScale } = {}) {
  if (typeof category === 'string' && Object.prototype.hasOwnProperty.call(table, category)) return table[category];
  if (typeof nativeScale === 'number' && Number.isFinite(nativeScale) && nativeScale > 0) {
    const { min, max } = tableRange(table);
    return Math.round(Math.min(max, Math.max(min, nativeScale)) * 100) / 100;
  }
  return 1;
}

/** 'AX1'…'AX5' → 1…5；其余 → 0。 */
export function axLevelOf(category) {
  const m = typeof category === 'string' ? /^AX([1-5])$/.exec(category) : null;
  return m ? Number(m[1]) : 0;
}

/** 原生载荷 → {category, k, ax, large}（坏载荷按系统默认）。 */
export function textSizeOf(info, { p = policy } = {}) {
  if (!info || typeof info !== 'object') return { ...DEFAULT_VIEW };
  const category = typeof info.category === 'string' && info.category ? info.category : null;
  const k = scaleFor(category, info.scale, { table: p.contentSizeScale });
  return { category, k, ax: axLevelOf(category), large: k >= p.compactTextScale };
}

function globalDoc() {
  return typeof document !== 'undefined' ? document : null;
}

function toggle(root, name, on, value = '') {
  if (on) {
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  } else if (root.hasAttribute(name)) {
    root.removeAttribute(name);
  }
}

/** 把 {k, ax, large, category} 写到 <html>。返回写入的视图；没有 document 时返回 null。 */
export function applyTextSize(view, { doc = globalDoc() } = {}) {
  const root = doc && doc.documentElement ? doc.documentElement : null;
  if (!root) return null;
  const v = view || DEFAULT_VIEW;
  if (root.style) {
    if (v.k === 1) root.style.removeProperty('--k');
    else root.style.setProperty('--k', String(v.k));
  }
  toggle(root, 'data-text-size', !!v.category, v.category || '');
  toggle(root, 'data-ax', v.ax > 0, String(v.ax));
  toggle(root, 'data-text-large', !!v.large);
  return v;
}

let current = { ...DEFAULT_VIEW };
const listeners = new Set();

/** 当前字号视图的副本（网页里一直是 k = 1）。 */
export function getTextSize() {
  return { ...current };
}

/** 订阅字号变化（fn(view)）；返回取消订阅。 */
export function onTextSize(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function same(a, b) {
  return a.category === b.category && a.k === b.k && a.ax === b.ax && a.large === b.large;
}

function publish(next, { doc } = {}) {
  if (same(next, current)) return;
  current = next;
  applyTextSize(current, doc === undefined ? {} : { doc });
  for (const fn of [...listeners]) {
    try {
      fn(getTextSize());
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] text size listener failed:', error);
    }
  }
}

/** 原生 shiziContentSize({category, scale}) 的实现：换算、写 <html>、变化时通知订阅者。返回 true（已接收）。 */
export function receiveContentSize(info) {
  publish(textSizeOf(info));
  return true;
}

/** 测试用：回到系统默认（k = 1，去掉属性）。 */
export function resetTextSize() {
  publish({ ...DEFAULT_VIEW });
}

/** 原生在文档开始时注入的档位（window.__shiziInitialContentSize = {category, scale}）；没有注入或载荷不是对象 → null。 */
export function readInjectedContentSize(win = typeof window !== 'undefined' ? window : null) {
  try {
    const info = win ? win.__shiziInitialContentSize : null;
    return info && typeof info === 'object' ? info : null;
  } catch (error) {
    return null;
  }
}

/** 有注入值就立即应用（返回 true），没有就什么都不做（返回 false）。同值的桥调用随后到达时不会再触发重排。 */
export function applyInjectedContentSize({ win, doc } = {}) {
  const info = readInjectedContentSize(win);
  if (!info) return false;
  publish(textSizeOf(info), { doc });
  return true;
}

registerNativeHandler('shiziContentSize', receiveContentSize);
applyInjectedContentSize();
