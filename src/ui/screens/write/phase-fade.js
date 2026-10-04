// 写字页内的阶段切换：150ms 交叉淡化（网页阶段的最小过渡；D51 ②⑦、P227；第二轮审查 I2-01；实现交接 §0.4「页面状态之间一律用 150ms 交叉淡化」）。
//
// 同一页里换状态——回忆 → 判断 → 接着写 → 看答案 → 描一遍 → 自己写 → 判断后换下一字——旧状态不再「一帧硬切」：
//   1. 渲染期（DOM 还是旧状态）给整页（页头 + 正文 + 底栏）拍一张快照：cloneNode(true) 加上每张 canvas 的像素（笔迹、提示层、描红层）；
//   2. 新状态提交后（useLayoutEffect，绘制之前）把快照作为 .sz-phasefade 盖在页上：不透明度 1 → 0，150ms 线性，只淡化（没有位移 / 缩放），
//      新状态在它下面；快照 aria-hidden、不可点、里面的按钮 / 链接 / 输入全部 tabindex=-1（不进键盘焦点；不用 inert，iOS 15.5 才认）、不带 data-testid / id（不和真页面重名）；动画结束后移除，终态与没有过渡时逐像素相同；
//   3. 减少动态效果（prefers-reduced-motion）：直接切换，不拍快照。
// 墨迹与笔画现场不受影响：快照只是一张盖在上面的图，真页面的状态机、写回、落笔接受都照常。
//
// 纯函数 / 小工具（node:test 可直接测）：FADE_MS、reducedMotion(win)、makeSnapshot(page, doc)、removeSnapshots(page)。hook：usePhaseFade(writeRef, key)。

import { useLayoutEffect, useRef } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../../components/styles.js';

/** 交叉淡化时长（ms；P227，取实现交接 §0.4）。 */
export const FADE_MS = 150;
export const SNAPSHOT_TESTID = 'write-phase-snapshot';
const FOCUSABLE_TAGS = Object.freeze(['button', 'a', 'input', 'select', 'textarea']);

injectStyles('write-fade', `
@keyframes szPhaseOut{from{opacity:1}to{opacity:0}}
.sz-phasefade{position:absolute;left:0;top:0;right:0;bottom:0;z-index:6;overflow:hidden;pointer-events:none;background:${T.paper};
  animation:szPhaseOut ${FADE_MS}ms linear both}
.sz-phasefade>.sz-page{height:100%}
.sz-phasefade *{animation:none !important} /* 克隆出来的元素会重新起动画（参考格淡入、判断键出现…）：快照要的是「旧状态此刻的样子」，一律取终态 */
@media (prefers-reduced-motion: reduce){.sz-phasefade{display:none}}
`);

/** 系统是否开了「减少动态效果」。 */
export function reducedMotion(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  try {
    return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return false;
  }
}

/** 移掉页上还在淡出的旧快照（连续切换时先收掉上一张）。 */
export function removeSnapshots(page) {
  if (!page || !page.querySelectorAll) return;
  for (const el of page.querySelectorAll(':scope > .sz-phasefade')) el.remove();
}

/**
 * 给整页拍快照：返回包好的 .sz-phasefade 元素（还没挂进页面）。page = .sz-page 元素。
 * canvas 的像素逐张复制（cloneNode 只复制属性）；data-testid / id / data-page-title / tabindex 全部去掉。
 */
export function makeSnapshot(page, doc = page && page.ownerDocument) {
  if (!page || !doc) return null;
  removeSnapshots(page);
  const clone = page.cloneNode(true);
  const from = page.querySelectorAll('canvas');
  const to = clone.querySelectorAll('canvas');
  for (let i = 0; i < from.length && i < to.length; i += 1) {
    try {
      const ctx = to[i].getContext('2d');
      if (ctx && from[i].width > 0 && from[i].height > 0) ctx.drawImage(from[i], 0, 0);
    } catch (error) {
      // 画不上去（canvas 被污染 / 尺寸为 0）：那一层在快照里是空的，只影响 150ms
    }
  }
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    for (const name of ['data-testid', 'id', 'data-page-title', 'tabindex', 'autofocus']) el.removeAttribute(name);
  }
  for (const el of clone.querySelectorAll('*')) {
    const tag = String(el.tagName || '').toLowerCase();
    if (FOCUSABLE_TAGS.includes(tag)) el.setAttribute('tabindex', '-1'); // 快照里的控件不进键盘焦点
  }
  const wrap = doc.createElement('div');
  wrap.className = 'sz-phasefade';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.setAttribute('data-testid', SNAPSHOT_TESTID);
  wrap.appendChild(clone);
  return wrap;
}

/** 把快照挂进页面并在淡出结束时移除（animationend 为准，超时兜底）。 */
export function mountSnapshot(page, wrap, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  removeSnapshots(page);
  page.appendChild(wrap);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wrap.remove();
  };
  wrap.addEventListener('animationend', finish);
  if (w) w.setTimeout(finish, FADE_MS + 90);
  return finish;
}

/**
 * 写字页用的 hook：key（`${cardKey}|${phase}`，没有当前字时为 null）一变就做一次交叉淡化。
 * 在渲染期（DOM 还是旧状态）拍快照，在提交后的 layout effect 里挂上；减少动态效果时不拍。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素（用来找到所在的 .sz-page）
 * @param {string|null} key
 */
export function usePhaseFade(writeRef, key) {
  const committed = useRef(key);
  const pending = useRef(null); // {to, node}
  if (key !== committed.current && key !== null && committed.current !== null) {
    if (!pending.current || pending.current.to !== key) {
      const el = writeRef.current;
      const page = el && el.closest ? el.closest('.sz-page') : null;
      pending.current = { to: key, node: page && !reducedMotion() ? makeSnapshot(page) : null };
    }
  }
  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    const prev = committed.current;
    committed.current = key;
    if (!p || p.to !== key || prev === key || !p.node) return;
    const el = writeRef.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    if (page) mountSnapshot(page, p.node);
  }, [key]);
}
