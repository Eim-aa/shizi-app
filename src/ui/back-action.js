// 页面的「返回」动作登记（R4-G1，P270）：左缘右滑返回与页头左上的返回 / 关闭键做同一件事。
//
// - 根组件给每个页面图层提供 EntryContext（该层的页面条目 id）；Page 骨架用 useBackAction(goBack) 把页头左上键的动作登记到这一层。
//   页头左上不是返回 / 关闭键（判断页的「接着写」、leading='none'）时登记 null：这一层不能滑动返回（原生门控也关）。
// - 没有用 Page 骨架、也没登记的页面（演示页等）：getBackAction 返回 undefined，手势退回 router.back（与旧行为相同）。
// - 跟手提交时根组件调 runBackAction(entryId, fallback)：结果页的「×」先收起撤销条再回来源、写字页照常 nav.back()（现场已在抬笔时存好）……
//   点左上键会怎样，滑动返回就怎样。
// 纯逻辑 + 一个 Preact context，不碰 DOM；单测 test/ui/back-action.test.mjs。
import { createContext, useContext, useEffect, useRef } from '../../vendor/ui.js';

/** 当前页面图层的条目 id（root.js 的 Layer 提供）。 */
export const EntryContext = createContext(null);

const actions = new Map(); // entryId -> fn | null
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

/** 登记某一层的返回动作；fn 不是函数时登记 null（这一层不能滑动返回）。可用性变化才通知订阅者。 */
export function setBackAction(entryId, fn) {
  if (typeof entryId !== 'string' || !entryId) return;
  const next = typeof fn === 'function' ? fn : null;
  const had = actions.has(entryId);
  const prevEnabled = had && actions.get(entryId) !== null;
  actions.set(entryId, next);
  if (!had || prevEnabled !== (next !== null)) notify(entryId);
}

/** 撤销登记（只撤自己登记的那一个：同一层先挂新的再卸旧的时不误删）。 */
export function clearBackAction(entryId, fn) {
  if (!actions.has(entryId)) return;
  const cur = actions.get(entryId);
  const mine = typeof fn === 'function' ? fn : null;
  if (cur !== mine) return;
  actions.delete(entryId);
  notify(entryId);
}

/** undefined = 没登记（退回 router.back）；null = 这一层不能滑动返回；函数 = 页头左上键的动作。 */
export function getBackAction(entryId) {
  return actions.has(entryId) ? actions.get(entryId) : undefined;
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
}

/**
 * Page 骨架用：把页头左上键的动作登记给所在图层。fn 每次渲染可以换（闭包），可用性（有没有 fn）变化才重新登记。
 * 不在图层里（没有 EntryContext，例如单测直接渲染 Page）时什么都不做。
 */
export function useBackAction(fn) {
  const entryId = useContext(EntryContext);
  const ref = useRef(fn);
  ref.current = fn;
  const enabled = typeof fn === 'function';
  useEffect(() => {
    if (!entryId) return undefined;
    const handler = enabled ? () => ref.current() : null;
    setBackAction(entryId, handler);
    return () => clearBackAction(entryId, handler);
  }, [entryId, enabled]);
}
