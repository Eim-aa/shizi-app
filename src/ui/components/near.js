// 「视口附近才画 / 才取」的共用判断（从 write/compare.js 抽出，P1-E2：练习字字形组件与作品格、笔迹小卡共用）。
import { useLayoutEffect, useState } from '../../../vendor/ui.js';

// M6-3（61-perf）：视口附近才画。练习记录 300 格、完整页、墙都是一屏几十格的长网格，一次画完全部 canvas 使首屏超 200ms；
// 离视口一屏以内的格子挂载当帧就画（与原来相同），更远的先登记到全页共用的一个 IntersectionObserver，滚到附近再画。
// 隐藏图层（下层页面）里的格子尺寸为 0，同样等露出时再画。
const NEAR_SCREENS = 1;
let nearObserver = null;
const nearCallbacks = new WeakMap();

function isNearViewport(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const h = window.innerHeight || document.documentElement.clientHeight || 0;
  return r.bottom > -h * NEAR_SCREENS && r.top < h * (1 + NEAR_SCREENS);
}

function observeNear(el, onNear) {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fn = nearCallbacks.get(entry.target);
        nearCallbacks.delete(entry.target);
        nearObserver.unobserve(entry.target);
        if (fn) fn();
      }
    }, { rootMargin: `${NEAR_SCREENS * 100}% 100%` }); // 横向放宽一屏：推入转场中的图层还在右侧屏外
  }
  nearCallbacks.set(el, onNear);
  nearObserver.observe(el);
  return () => {
    nearCallbacks.delete(el);
    if (nearObserver) nearObserver.unobserve(el);
  };
}

/** 元素是否已到视口附近（一旦为真不再变回）。没有 IntersectionObserver 时恒为真。作品格（components/work.js）也用它做懒绘制（P1-E7）。 */
export function useNearViewport(ref) {
  const [near, setNear] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver !== 'function' || isNearViewport(el)) {
      setNear(true);
      return undefined;
    }
    return observeNear(el, () => setNear(true));
  }, []);
  return near;
}

// 视口外的「附近」格子分批再画（练习记录 200 格首屏 P-perf）：挂载当帧只画真正在视口里的格子，离视口一屏以内、还看不见的
// 排进共用队列，每个宏任务放行一小批——画面静止时与一次画完相同（它们本来就在屏外），首屏少花这几十格的绘制。
const TURN_BATCH = 12;
let turnQueue = [];
let turnTimer = null;

function pumpTurns() {
  turnTimer = null;
  const batch = turnQueue.splice(0, TURN_BATCH);
  for (const job of batch) if (!job.dead) job.go();
  if (turnQueue.length) turnTimer = setTimeout(pumpTurns, 0);
}

function inViewportNow(el) {
  const r = el.getBoundingClientRect();
  const h = window.innerHeight || document.documentElement.clientHeight || 0;
  return r.bottom > 0 && r.top < h; // 只比纵向：推入转场中的图层还在右侧屏外，但纵向已在视口
}

/**
 * 轮到画了没有（near 为真后才有意义）：视口里的格子立即为真；还在屏外（只是离得近）的排队分批为真。一旦为真不再变回。
 * @param {{current: Element|null}} ref
 * @param {boolean} near  useNearViewport 的结果
 */
export function usePaintTurn(ref, near) {
  const [turn, setTurn] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!near || turn || !el) return undefined;
    if (inViewportNow(el)) {
      setTurn(true);
      return undefined;
    }
    const job = { dead: false, go: () => setTurn(true) };
    turnQueue.push(job);
    if (turnTimer === null) turnTimer = setTimeout(pumpTurns, 0);
    return () => { job.dead = true; };
  }, [near]);
  return turn;
}
