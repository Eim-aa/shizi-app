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
