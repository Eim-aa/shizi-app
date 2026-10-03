// 外观（M4-3；03 P51；M0-3 tokens.css 的 data-theme 语义）。
//
// settings.appearance：'auto'（缺省）| 'light' | 'dark' → document.documentElement 的 data-theme：
//   'auto' 去掉属性（tokens.css 按 prefers-color-scheme 跟随系统），'light' / 'dark' 写属性强制。
//   policy.features.appearanceSwitch 关闭时一律按 'auto'（不读存下的值）。
// 字号不在这里：D29（覆盖 P59）起字号跟随系统 Dynamic Type，由 platform/text-size.js 按原生 shiziContentSize 写 --k；
// settings.large（v1 迁移带来的旧「更大字体」）只保留读取兼容，不再生效，也不再写 :root[data-large]
// （迁移来的 large=true 由设置页 showTextSizeNoticeOnce 显示一次说明，P132）。
//
// 启动：app.js 在 store 建好、挂 UI 之前调用 startAppearance()（一行接入），先按存下的设置应用一次，
// 再订阅 store：只有 appearance 的值真变了才改属性——seed / reset 等不涉及它的通知不碰 <html>
// （测试里手动设的 data-theme 不会被冲掉）。设置页（ui/screens/mine/settings.js）只写 store，不碰 DOM。
import * as policy from '../config/policy.js';

export const APPEARANCES = Object.freeze(['light', 'dark', 'auto']);
export const DEFAULT_APPEARANCE = 'auto';

/** settings → {theme:'auto'|'light'|'dark'}（缺省与非法值按 'auto'）。 */
export function appearanceOf(settings, { features = policy.features } = {}) {
  const raw = settings && typeof settings.appearance === 'string' ? settings.appearance : DEFAULT_APPEARANCE;
  const allowed = !features || features.appearanceSwitch !== false;
  const theme = allowed && APPEARANCES.indexOf(raw) >= 0 ? raw : DEFAULT_APPEARANCE;
  return { theme };
}

function rootOf(doc) {
  return doc && doc.documentElement ? doc.documentElement : null;
}

/** 把 {theme} 写到 <html>。返回写入后的 {theme}；没有 document 时返回 null。 */
export function applyAppearance(settings, { doc = globalDoc(), features = policy.features } = {}) {
  const root = rootOf(doc);
  if (!root) return null;
  const view = appearanceOf(settings, { features });
  if (view.theme === 'auto') {
    if (root.hasAttribute('data-theme')) root.removeAttribute('data-theme');
  } else if (root.getAttribute('data-theme') !== view.theme) {
    root.setAttribute('data-theme', view.theme);
  }
  return view;
}

function globalDoc() {
  return typeof document !== 'undefined' ? document : null;
}

function sameView(a, b) {
  return !!a && !!b && a.theme === b.theme;
}

/**
 * 启动时应用一次并订阅 store。永不抛错（store 没建好时只警告）。
 * @param {object} [store]  缺省取 store/store.js 的 getStore()（动态取，避免 node 下加载 storage）
 * @returns {() => void} 取消订阅
 */
export function startAppearance(store = null, { doc = globalDoc(), features = policy.features, getStore = null } = {}) {
  let s = store;
  try {
    if (!s && typeof getStore === 'function') s = getStore();
  } catch (error) {
    s = null;
  }
  if (!s) {
    if (typeof console !== 'undefined') console.warn('[shizi] appearance: store unavailable, following the system');
    return () => {};
  }
  let last = null;
  const sync = state => {
    const settings = state ? state.settings : null;
    const next = appearanceOf(settings, { features });
    if (sameView(next, last)) return;
    last = applyAppearance(settings, { doc, features }) || next;
  };
  try {
    sync(s.getState());
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[shizi] appearance apply failed:', error);
  }
  return s.subscribe(state => {
    try {
      sync(state);
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] appearance apply failed:', error);
    }
  });
}

/** app.js 一行接入用：取已启动的 store（store/store.js getStore）后 startAppearance。 */
export async function bootAppearance(opts = {}) {
  const mod = await import('../store/store.js');
  return startAppearance(null, { ...opts, getStore: mod.getStore });
}
