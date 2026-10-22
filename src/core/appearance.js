// 外观设置的纯取值（无 DOM；视图模型 session/views/settings.js 与 platform/appearance.js 共用）。
// settings.appearance：'auto'（缺省）| 'light' | 'dark'；policy.features.appearanceSwitch 关闭时一律按 'auto'。
// 把它写到 <html> 的 data-theme 在 platform/appearance.js（有 DOM）。

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
