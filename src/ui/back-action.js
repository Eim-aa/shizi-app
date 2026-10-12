// 页面的「返回」动作登记（R4-G1，P270；R5-I2 / 交互规范 N3）：左缘右滑返回与页头左上元素做同一件事。
//
// - 根组件给每个页面图层提供 EntryContext（该层的页面条目 id）；Page 骨架用 useBackAction(fn, kind) 把页头左上元素的动作登记到这一层。
//   N3-2：页面只能登记函数，不得登记 null（「这一层不能滑」）；null 只留给 L0 / 阻断页（它们不用 Page 骨架）与 leading='none'。
//   种类（N3-3）：'page' = 出页（跟手画面是该页进来时的转场倒放）；'phase' = 页内回退（判断 → 回忆：「‹ 接着写」，
//   跟手画面是 T-phase 倒放、页面不出栈）。
// - 弹层也可以登记自己的「取消」（OverlayContext + useOverlayBack，P2-17）：Esc / 两指 Z 形 / 左缘右滑关弹层时执行它，没登记时 router.back。
// - 没有用 Page 骨架、也没登记的页面（演示页等）：getBackAction 返回 undefined，手势退回 router.back（与旧行为相同）。
// - 跟手提交时根组件调 runBackAction(entryId, fallback)：结果页的「×」先收起撤销条再回来源、写字页照常 nav.back()（现场已在抬笔时存好）……
//   点左上键会怎样，滑动返回就怎样。
// 纯逻辑 + 一个 Preact context，不碰 DOM；单测 test/ui/back-action.test.mjs。
import { createContext, useContext, useEffect, useRef } from '../../vendor/ui.js';

/** 当前页面图层的条目 id（root.js 的 Layer 提供）。 */
export const EntryContext = createContext(null);
/** 当前弹层的条目 id（root.js 的 OverlayHost 提供）。 */
export const OverlayContext = createContext(null);

const actions = new Map(); // entryId -> fn | null
const kinds = new Map(); // entryId -> 'page' | 'phase'
const listeners = new Set();

function notify(entryId) {
  for (const fn of [...listeners]) {
    try {
      fn(entryId);
    } catch (error) {
      console.error('[shizi] back-action listener:', error);
    }
  }
}

/** 登记某一层的返回动作与种类（'page' 出页 | 'phase' 页内回退）；fn 不是函数时登记 null（只给 L0 / 阻断页）。可用性或种类变化才通知订阅者。 */
export function setBackAction(entryId, fn, kind = 'page') {
  if (typeof entryId !== 'string' || !entryId) return;
  const next = typeof fn === 'function' ? fn : null;
  const nextKind = kind === 'phase' ? 'phase' : 'page';
  const had = actions.has(entryId);
  const prevEnabled = had && actions.get(entryId) !== null;
  const prevKind = kinds.get(entryId) || 'page';
  actions.set(entryId, next);
  kinds.set(entryId, nextKind);
  if (!had || prevEnabled !== (next !== null) || prevKind !== nextKind) notify(entryId);
}

/** 撤销登记（只撤自己登记的那一个：同一层先挂新的再卸旧的时不误删）。 */
export function clearBackAction(entryId, fn) {
  if (!actions.has(entryId)) return;
  const cur = actions.get(entryId);
  const mine = typeof fn === 'function' ? fn : null;
  if (cur !== mine) return;
  actions.delete(entryId);
  kinds.delete(entryId);
  notify(entryId);
}

/** undefined = 没登记（退回 router.back）；null = 这一层不能滑动返回；函数 = 页头左上键的动作。 */
export function getBackAction(entryId) {
  return actions.has(entryId) ? actions.get(entryId) : undefined;
}

/** 这一层的返回是出页还是页内回退（没登记的按出页算）。 */
export function getBackKind(entryId) {
  return actions.has(entryId) && kinds.get(entryId) === 'phase' ? 'phase' : 'page';
}

/** 这一层能不能滑动返回（没登记的按能返回算）。 */
export function backActionAllowed(entryId) {
  return getBackAction(entryId) !== null;
}

/** 执行这一层的返回动作；没登记时执行 fallback。返回是否执行了任何动作。 */
export function runBackAction(entryId, fallback) {
  const fn = getBackAction(entryId);
  if (fn === null) return false;
  if (typeof fn === 'function') {
    fn();
    return true;
  }
  if (typeof fallback === 'function') {
    fallback();
    return true;
  }
  return false;
}

export function subscribeBackActions(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 仅供单测清理。 */
export function resetBackActions() {
  actions.clear();
  kinds.clear();
}

/**
 * Page 骨架用：把页头左上元素的动作登记给所在图层。fn 每次渲染可以换（闭包），可用性（有没有 fn）或种类变化才重新登记。
 * 不在图层里（没有 EntryContext，例如单测直接渲染 Page）时什么都不做。
 */
export function useBackAction(fn, kind = 'page') {
  const entryId = useContext(EntryContext);
  useRegister(entryId, fn, kind);
}

/**
 * 弹层组件用（P2-17）：把弹层自己的「取消」登记给所在弹层条目；Esc / 两指 Z 形 / 左缘右滑关弹层时执行它（与点遮罩、点取消同一个函数）。
 * 不在弹层里时什么都不做。
 */
export function useOverlayBack(fn) {
  const overlayId = useContext(OverlayContext);
  useRegister(overlayId, fn, 'page');
}

function useRegister(id, fn, kind) {
  const ref = useRef(fn);
  ref.current = fn;
  const enabled = typeof fn === 'function';
  useEffect(() => {
    if (!id) return undefined;
    const handler = enabled ? () => ref.current() : null;
    setBackAction(id, handler, kind);
    return () => clearBackAction(id, handler);
  }, [id, enabled, kind]);
}
