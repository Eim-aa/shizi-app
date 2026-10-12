// 动效令牌的 JS 侧唯一来源（交互与动效规范 T2 / §8a，D58）。
// 取值唯一来源：docs/design/design-system-v1/tokens.json 的 motion / gesture / timing / haptic（单测 test/ui/motion-tokens.test.mjs 逐值核对）；
// CSS 侧是 src/config/tokens.css 的 --dur-* / --ease-*（同一组值，单测核对）。
// 代码里的动画时长、延迟与曲线只能取这里（CSS 写 var(--dur-*) var(--ease-*)，或模板里的 ${M.*}）；手势阈值只能取 gesture；
// 非动画的计时只能取 timing。verify:tokens 的 motion 规则强制，偏离逐条登记在 scripts/verify_tokens.mjs 的 EXCEPTIONS（rule 'motion'）并写明理由。
// 纯数据，无副作用；浏览器与 node:test 都能直接 import。

/** motion.duration（ms）。 */
export const duration = Object.freeze({
  instant: 0,
  xs: 75,
  press: 120,
  reduce: 150,
  fade: 150,
  s: 180,
  m: 200,
  release: 220,
  l: 260,
  sheet: 280,
  push: 300,
  paperClose: 360,
  paperOpen: 420,
});

/** motion.role：用途 → 时长（tokens.json 里写的是 duration 的键名，这里已解析成 ms）。 */
const ROLE_KEYS = Object.freeze({
  pressIn: 'press', pressOut: 'release', fadeIn: 'fade', fadeOut: 'fade', textOut: 'xs', inkFlip: 'm', phaseReverse: 280,
  pushIn: 'push', pushOut: 'push', pushGestureMin: 'fade', paperIn: 'paperOpen', paperOut: 'paperClose', paperGestureFull: 'push', paperGestureMin: 'press',
  quietIn: 'release', quietOut: 's', gestureCancel: 'release', gestureSnap: 'm', sheetIn: 'sheet', sheetOut: 'release', sheetOutKeyboard: 'l', confirmIn: 'm', confirmOut: 's',
  scrimIn: 'm', scrimOut: 's', toastIn: 'fade', toastOut: 'fade', hintIn: 'fade', hintStrokeOut: 'l', switchToggle: 'fade', reduceCrossfade: 'reduce',
});
export const roleKeys = ROLE_KEYS;
export const role = Object.freeze(Object.fromEntries(Object.entries(ROLE_KEYS).map(([k, v]) => [k, typeof v === 'number' ? v : duration[v]])));

/** motion.moment：页内时刻的特定取值（ms）。 */
export const moment = Object.freeze({
  judgeAppear: 320,
  judgeReady: 440,
  answerReveal: 400,
  workCellIn: 180,
  workStagger: 50,
  sealDrop: 220,
  resultLateIn: 150,
  inviteDelay: 600,
  handoffHold: 600,
  max: 750,
  resultMax: 1200,
  stepPlayMax: 1600,
});

/** motion.easing（CSS 写法）。 */
export const easing = Object.freeze({
  linear: 'linear',
  out: 'cubic-bezier(.2,.7,.2,1)',
  in: 'cubic-bezier(.4,0,1,1)',
  inout: 'cubic-bezier(.4,0,.2,1)',
  paperOpen: 'cubic-bezier(.3,0,.1,1)',
  gather: 'cubic-bezier(.5,0,.15,1)',
});

/** 曲线的四个控制点（JS 逐帧求值用；linear = [0, 0, 1, 1]）。由 easing 解析，不另写一份。 */
export const bezier = Object.freeze(Object.fromEntries(Object.entries(easing).map(([k, v]) => {
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(v);
  const pts = m ? m[1].split(',').map(Number) : [0, 0, 1, 1];
  return [k, Object.freeze(pts)];
})));

export const spring = Object.freeze({
  standard: Object.freeze({ response: 0.42, dampingFraction: 0.88 }),
  soft: Object.freeze({ response: 0.5, dampingFraction: 0.82 }),
});

export const scale = Object.freeze({ press: 0.97, quietFrom: 0.96, confirmFrom: 0.96, sealFrom: 1.25 });

export const distance = Object.freeze({ parallax: 0.3, paperDragLean: 60, paperDragRadius: 24, quietDrag: 40, textShift: 4 });

/**
 * gesture：手势阈值（pt = CSS px）。commitRatio 在 tokens.json 写作 0.3333（JSON 写不出 1/3），这里取精确的 1/3，单测核对两者差 < 5e-4；
 * Swift BackGestureThreshold 由 test/ios-back-gesture.test.mjs 逐值核对。
 */
export const gesture = Object.freeze({
  edgeZoneNative: 20,
  edgeZoneWeb: 12,
  directionSlop: 10,
  commitRatio: 1 / 3,
  commitVelocity: 500,
  returnVelocity: -200,
  marginSlope: 0.5,
  sheetCommitRatio: 1 / 3,
});

/** timing：非动画的计时（ms）。 */
export const timing = Object.freeze({
  pressGuard: 400,
  toast: 3200,
  toastWithAction: 5000,
  undoWindow: 5000,
  undone: 2400,
  loadingQuiet: 400,
  loadingText: 2000,
  sourceFresh: 2000,
  savedFlash: 1500,
});

/** haptic：五档触觉（F1，D58 ③）。style 对应原生 UIImpactFeedbackGenerator.FeedbackStyle；select = UISelectionFeedbackGenerator。 */
export const haptic = Object.freeze({
  judge: Object.freeze({ native: 'UIImpactFeedbackGenerator', style: 'soft', intensity: 0.7 }),
  seal: Object.freeze({ native: 'UIImpactFeedbackGenerator', style: 'rigid', intensity: 0.8 }),
  light: Object.freeze({ native: 'UIImpactFeedbackGenerator', style: 'light', intensity: 0.5 }),
  select: Object.freeze({ native: 'UISelectionFeedbackGenerator' }),
  none: Object.freeze({}),
});

const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** CSS 变量名：dur('paperOpen') → 'var(--dur-paper-open)'；ease('out') → 'var(--ease-out)'。 */
export const css = Object.freeze({
  dur: key => {
    if (!Object.prototype.hasOwnProperty.call(duration, key)) throw new Error(`motion.css.dur: unknown duration "${key}"`);
    return `var(--dur-${kebab(key)})`;
  },
  ease: key => {
    if (!Object.prototype.hasOwnProperty.call(easing, key)) throw new Error(`motion.css.ease: unknown easing "${key}"`);
    return `var(--ease-${kebab(key)})`;
  },
});

/** CSS 变量名表（tokens.css 的声明顺序；单测核对）。 */
export const cssVars = Object.freeze({
  ...Object.fromEntries(Object.keys(duration).map(k => [`--dur-${kebab(k)}`, `${duration[k]}ms`])),
  ...Object.fromEntries(Object.keys(easing).map(k => [`--ease-${kebab(k)}`, easing[k]])),
});

/** 读系统「减少动态效果」（全 App 唯一的判断，P2-13）。没有 window / matchMedia 时为 false。 */
export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : null) {
  try {
    return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return false;
  }
}

/** 汇总：import { M } from '../config/motion.js'；M.dur.fade、M.role.sheetIn、M.ease.out、M.gesture.commitRatio …… */
export const M = Object.freeze({ dur: duration, role, moment, ease: easing, bezier, spring, scale, distance, gesture, timing, haptic, css });
