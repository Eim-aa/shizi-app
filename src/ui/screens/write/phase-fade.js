// 写字页内的阶段切换（网页阶段的最小过渡；D51 ②⑦、P227；第二轮审查 I2-01；实现交接 §0.4「页面状态之间一律用 150ms 交叉淡化」）
// → R3-C3W（第三轮审查 I3-02，D53 ⑥，P257）：本人墨保持「一个」，文字先出后进、不叠字。
//
// 同一页里换状态——回忆 → 判断 → 接着写 → 看答案 → 描一遍 → 自己写 → 判断后换下一字——旧状态不再「一帧硬切」：
//   1. 渲染期（DOM 还是旧状态）给整页（页头 + 正文 + 底栏）拍一张快照：cloneNode(true) 加上每张 canvas 的像素（笔迹、提示层、描红层）；
//      同时记下旧状态里「本人墨」的来源（书写格的固化层 / 判断页上格的小卡）的尺寸位置与像素副本，和四个文字类区域（页头标题 / 题面 / 格下说明 / 底栏）的文字；
//   2. 新状态提交后（useLayoutEffect，绘制之前）把快照作为 .sz-phasefade 盖在页上：不透明度 1 → 0，150ms 线性（框线、背景同时淡化，没有位移 / 缩放），
//      新状态在它下面；快照 aria-hidden、不可点、里面的按钮 / 链接 / 输入全部 tabindex=-1（不进键盘焦点；不用 inert，iOS 15.5 才认）、不带 data-testid / id（不和真页面重名）；
//   3. 本人墨只出现一次（D53 ⑥）：
//      · 新状态里有本人墨（书写格有笔 / 判断页上格）且位置大小和旧的不同（回忆 ⇄ 判断）→ 快照里的墨 canvas 去掉，改用一张 FLIP canvas（旧墨像素的副本）做纯缩放：
//        以顶边中点为原点，旧边长 → 新边长，200ms，cubic-bezier(.2,.7,.2,1)（书写格顶边固定，P257，所以只有缩放没有平移）；新位置真实的墨 canvas 在缩放期间 visibility:hidden，结束再露出；
//      · 新状态里有墨且在同一位置同一大小（回忆 → 看答案）→ 快照里的墨去掉，只有真实的那一层；
//      · 新状态没有墨（看答案 → 描一遍、判断后换下一字…）→ 旧墨随快照 150ms 淡出（只有这一层）；
//   4. 文字类区域内容变了的（旧 / 新文字不同）：旧的 0–75ms 淡出、新的 75–150ms 淡入，两者不同时可见（不叠字）；内容没变的区域不动（「‹」、计数、不变的题面不闪）；
//   5. 减少动态效果（prefers-reduced-motion）：直接切换，不拍快照、不做 FLIP。
// 终态与没有过渡时逐像素相同。墨迹与笔画现场不受影响：快照 / FLIP canvas 只是盖在上面的图，真页面的状态机、写回、落笔接受都照常。
//
// 纯函数 / 小工具（node:test 可直接测）：FADE_MS、FLIP_MS、TEXT_OUT_MS、reducedMotion(win)、makeSnapshot(page, doc)、removeSnapshots(page)、
// regionTexts(root)、diffRegions(before, after)、flipTransform(from, to)、sameBox(a, b)、inkSource(root)。hook：usePhaseFade(writeRef, key)。

import { useLayoutEffect, useRef } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../../components/styles.js';

/** 交叉淡化时长（ms；P227，取实现交接 §0.4）。 */
export const FADE_MS = 150;
/** 本人墨 FLIP 缩放时长与缓动（ms；D53 ⑥，取 moments 规格 ① 的最小子集）。 */
export const FLIP_MS = 200;
export const FLIP_EASING = 'cubic-bezier(.2,.7,.2,1)';
/** 文字类区域：旧的先淡出（ms），新的在这之后 FADE_MS − TEXT_OUT_MS 内淡入。 */
export const TEXT_OUT_MS = 75;
export const SNAPSHOT_TESTID = 'write-phase-snapshot';
const FOCUSABLE_TAGS = Object.freeze(['button', 'a', 'input', 'select', 'textarea']);

/** 文字类区域（页头标题 / 题面 / 格下说明 / 底栏）的选择器；内容没变的区域不做出 / 进。 */
export const TEXT_REGIONS = Object.freeze({
  title: '.sz-page__title:not(.sz-page__title--hidden)',
  prompt: '.sz-prompt',
  note: '.sz-write__note',
  foot: '.sz-page__foot',
});
/** 本人墨的 canvas（固化层、当前笔层、判断页上格小卡里的 canvas）。 */
const INK_CANVAS = '[data-testid="write-grid-ink"], [data-testid="write-grid-live"], [data-testid="write-compare-mine"] canvas';

injectStyles('write-fade', `
@keyframes szPhaseOut{from{opacity:1}to{opacity:0}}
@keyframes szTextOut{from{opacity:1}to{opacity:0}}
@keyframes szTextIn{0%,50%{opacity:0}100%{opacity:1}}
.sz-phasefade{position:absolute;left:0;top:0;right:0;bottom:0;z-index:6;overflow:hidden;pointer-events:none;background:${T.paper};
  animation:szPhaseOut ${FADE_MS}ms linear both}
.sz-phasefade>.sz-page{height:100%}
.sz-phasefade *{animation:none !important} /* 克隆出来的元素会重新起动画（参考格淡入、判断键出现…）：快照要的是「旧状态此刻的样子」，一律取终态 */
.sz-phasefade [data-fade-out]{animation:szTextOut ${TEXT_OUT_MS}ms linear both !important} /* 文字类区域旧的先淡出（只在内容变了的区域） */
.sz-page [data-fade-in]{animation:szTextIn ${FADE_MS}ms linear both} /* 新的 75ms 起淡入（0–75ms 全透明，不和旧的叠字） */
.sz-flipink{position:absolute;z-index:7;margin:0;pointer-events:none;transform-origin:50% 0;will-change:transform}
[data-flip-hide]{visibility:hidden}
@media (prefers-reduced-motion: reduce){.sz-phasefade,.sz-flipink{display:none}.sz-page [data-fade-in]{animation:none}[data-flip-hide]{visibility:visible}}
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

/** 移掉页上还在淡出的旧快照与上一次 FLIP 的残留（连续切换时先收掉上一张）。 */
export function removeSnapshots(page) {
  if (!page || !page.querySelectorAll) return;
  for (const el of page.querySelectorAll(':scope > .sz-phasefade')) el.remove();
  for (const el of page.querySelectorAll(':scope > .sz-flipink')) el.remove();
  for (const el of page.querySelectorAll('[data-flip-hide]')) el.removeAttribute('data-flip-hide');
  for (const el of page.querySelectorAll('[data-fade-in]')) el.removeAttribute('data-fade-in');
}

/** 每个文字类区域当前的文字（没有这个区域 → null）。 */
export function regionTexts(root) {
  const out = {};
  for (const [key, sel] of Object.entries(TEXT_REGIONS)) {
    const el = root && root.querySelector ? root.querySelector(sel) : null;
    out[key] = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  }
  return out;
}

/** 旧 / 新区域文字不同的区域名（两边都没有、文字一样的不算）。纯函数。 */
export function diffRegions(before, after) {
  const get = (o, k) => (o && o[k] !== undefined ? o[k] : null);
  return Object.keys(TEXT_REGIONS).filter(k => get(before, k) !== get(after, k));
}

/** 元素内框（不含边框）在视口里的位置与大小。 */
export function innerBox(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left + (el.clientLeft || 0), top: r.top + (el.clientTop || 0), width: el.clientWidth || r.width, height: el.clientHeight || r.height };
}

/** 两个盒子位置与边长（≤ tol）都一样 → 本人墨在同一位置，不需要 FLIP。纯函数。 */
export function sameBox(a, b, tol = 1) {
  return !!a && !!b && Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol && Math.abs(a.width - b.width) <= tol;
}

/**
 * 从 from 盒缩放到 to 盒的变换（以 from 的顶边中点为原点，transform-origin: 50% 0）：{scale, dx, dy}。
 * 书写格顶边固定、中线相同时 dx = dy = 0，只有缩放（D53 ⑥ / 规格 ①）；其余情况照实平移。纯函数。
 */
export function flipTransform(from, to) {
  const scale = from.width > 0 ? to.width / from.width : 1;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top - from.top;
  return { scale, dx: Math.abs(dx) < 0.5 ? 0 : dx, dy: Math.abs(dy) < 0.5 ? 0 : dy };
}

/** 页里「本人墨」的来源：书写格有笔 → 固化层；判断页有上格小卡 → 小卡里的 canvas；都没有 null。纯 DOM 读取。 */
export function inkSource(root) {
  if (!root || !root.querySelector) return null;
  const grid = root.querySelector('[data-testid="write-grid"]');
  if (grid && Number(grid.getAttribute('data-stroke-count')) > 0) {
    const canvas = grid.querySelector('[data-testid="write-grid-ink"]');
    if (canvas) return { kind: 'grid', el: grid, canvas, box: innerBox(grid) };
  }
  const mine = root.querySelector('[data-testid="write-compare-mine"]');
  const canvas = mine ? mine.querySelector('canvas') : null;
  if (mine && canvas) return { kind: 'card', el: mine, canvas, box: innerBox(mine) };
  return null;
}

/** 把一张 canvas 的像素复制成一张新的（同像素尺寸）；画不上去返回 null。 */
function copyCanvas(doc, src) {
  try {
    if (!(src.width > 0 && src.height > 0)) return null;
    const c = doc.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  } catch (error) {
    return null;
  }
}

/**
 * 给整页拍快照：返回 {wrap, ink, texts}——wrap 是包好的 .sz-phasefade 元素（还没挂进页面）；ink = 旧状态的本人墨来源（含像素副本）或 null；texts = 旧的文字类区域文字。
 * canvas 的像素逐张复制（cloneNode 只复制属性）；本人墨的 canvas 在快照里打上 data-flip-ink；data-testid / id / data-page-title / tabindex 全部去掉。
 */
export function makeSnapshot(page, doc = page && page.ownerDocument) {
  if (!page || !doc) return null;
  removeSnapshots(page);
  const texts = regionTexts(page);
  const src = inkSource(page);
  const inkCopy = src ? copyCanvas(doc, src.canvas) : null;
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
    if (from[i].matches && from[i].matches(INK_CANVAS)) to[i].setAttribute('data-flip-ink', '1');
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
  return { wrap, ink: src && inkCopy ? { kind: src.kind, box: src.box, copy: inkCopy } : null, texts };
}

/** 把快照里本人墨的 canvas 去掉（本人墨由真实的那一层 / FLIP canvas 来显示，不再有第二份）。 */
function dropSnapshotInk(wrap) {
  for (const cv of wrap.querySelectorAll('canvas[data-flip-ink]')) cv.remove();
}

/**
 * 把快照挂进页面，按文字区域差异做先出后进，按本人墨的去向做 FLIP；淡出结束时一并清理（animationend 为准，超时兜底）。
 * @param {Element} page  .sz-page
 * @param {{wrap, ink, texts}} snap  makeSnapshot 的结果
 * @param {Element|null} writeEl  新状态的 .sz-write（找新位置的墨 / 新文字区域用）
 * @returns {() => void} 立刻收尾（测试 / 卸载用）
 */
export function mountSnapshot(page, snap, writeEl, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const wrap = snap.wrap;
  removeSnapshots(page);
  const root = writeEl && writeEl.closest ? writeEl.closest('.sz-page') || page : page;
  // 文字类区域：内容变了的 → 旧的先淡出、新的后淡入
  const faded = [];
  for (const key of diffRegions(snap.texts, regionTexts(root))) {
    const sel = TEXT_REGIONS[key];
    const oldEl = wrap.querySelector ? wrap.querySelector(sel) : null;
    if (oldEl) oldEl.setAttribute('data-fade-out', '1');
    const newEl = [...root.querySelectorAll(sel)].find(e => !e.closest('.sz-phasefade'));
    if (newEl) {
      newEl.setAttribute('data-fade-in', '1');
      faded.push(newEl);
    }
  }
  // 本人墨：新状态里有墨 → 快照里的不要（FLIP 或同位置）；没有 → 随快照淡出
  let flip = null;
  let hidden = null;
  const dest = inkSource(writeEl || root);
  if (snap.ink && dest) {
    dropSnapshotInk(wrap);
    if (!sameBox(snap.ink.box, dest.box) && w && typeof page.getBoundingClientRect === 'function') {
      const pageRect = page.getBoundingClientRect();
      const el = snap.ink.copy;
      el.className = 'sz-flipink';
      el.setAttribute('aria-hidden', 'true');
      el.style.left = `${snap.ink.box.left - pageRect.left}px`;
      el.style.top = `${snap.ink.box.top - pageRect.top}px`;
      el.style.width = `${snap.ink.box.width}px`;
      el.style.height = `${snap.ink.box.height}px`;
      const ft = flipTransform(snap.ink.box, dest.box);
      if (typeof el.animate === 'function' && !reducedMotion(w)) {
        page.appendChild(el);
        hidden = dest.canvas;
        hidden.setAttribute('data-flip-hide', '1');
        const end = `translate(${ft.dx}px, ${ft.dy}px) scale(${ft.scale})`;
        flip = { el, anim: el.animate([{ transform: 'none' }, { transform: end }], { duration: FLIP_MS, easing: FLIP_EASING, fill: 'forwards' }) };
      }
    }
  }
  page.appendChild(wrap);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wrap.remove();
  };
  const finishFlip = () => {
    if (flip) {
      flip.el.remove();
      flip = null;
    }
    if (hidden) {
      hidden.removeAttribute('data-flip-hide');
      hidden = null;
    }
  };
  const finishText = () => {
    for (const el of faded) el.removeAttribute('data-fade-in');
  };
  wrap.addEventListener('animationend', e => { // 里面「旧文字先淡出」的 75ms 动画结束时也会冒泡到这里：只认快照自己的淡出
    if (!e || e.target === wrap) finish();
  });
  if (w) {
    w.setTimeout(finish, FADE_MS + 90);
    w.setTimeout(finishText, FADE_MS + 90);
    if (flip) {
      if (flip.anim && flip.anim.finished && typeof flip.anim.finished.then === 'function') flip.anim.finished.then(finishFlip, finishFlip);
      w.setTimeout(finishFlip, FLIP_MS + 120);
    }
  }
  return () => {
    finish();
    finishFlip();
    finishText();
  };
}

/**
 * 写字页用的 hook：key（`${cardKey}|${phase}`，没有当前字时为 null）一变就做一次过渡。
 * 在渲染期（DOM 还是旧状态）拍快照，在提交后的 layout effect 里挂上；减少动态效果时不拍。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素（用来找到所在的 .sz-page）
 * @param {string|null} key
 */
export function usePhaseFade(writeRef, key) {
  const committed = useRef(key);
  const pending = useRef(null); // {to, snap}
  if (key !== committed.current && key !== null && committed.current !== null) {
    if (!pending.current || pending.current.to !== key) {
      const el = writeRef.current;
      const page = el && el.closest ? el.closest('.sz-page') : null;
      pending.current = { to: key, snap: page && !reducedMotion() ? makeSnapshot(page) : null };
    }
  }
  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    const prev = committed.current;
    committed.current = key;
    if (!p || p.to !== key || prev === key || !p.snap) return;
    const el = writeRef.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    if (page) mountSnapshot(page, p.snap, el);
  }, [key]);
}
