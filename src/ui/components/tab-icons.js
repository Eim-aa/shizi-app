// 底部 Tab 栏的图标（阶段 1 E9a，D49；设计稿 减法修稿.html 的 i-home / i-book / i-me 及 -f 实心版）。
// 选中 = 实心图标 + ink1，未选 = 线描 + ink3，不画小圆点。每次调用现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
// 24 × 24 画布；实心版的描边与填色同为 currentColor。

import { html } from '../../../vendor/ui.js';

const svg = body => html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const LINE = {
  home: () => svg(html`<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>`),
  library: () => svg(html`<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>`),
  mine: () => svg(html`<circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>`),
};

const SOLID = {
  home: () => svg(html`<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>`),
  library: () => svg(html`<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path><path d="M12 7v12" stroke="var(--paper)" stroke-width="1.5"></path>`),
  mine: () => svg(html`<circle cx="12" cy="8.5" r="3.8" fill="currentColor"></circle><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>`),
};

/** 这个 Tab 有没有登记实心 / 线描图标对（没有的 Tab 用它自己注册的图标，选中不变形）。 */
export function hasTabIcon(id) {
  return Object.prototype.hasOwnProperty.call(LINE, id);
}

/** @param {string} id 'home' | 'library' | 'mine'  @param {boolean} selected */
export function tabIcon(id, selected) {
  if (!hasTabIcon(id)) return null;
  return (selected ? SOLID : LINE)[id]();
}
