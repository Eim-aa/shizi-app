// 提示量（决定-D25 方案① / R-W05 / R-W06；01-架构设计 §6.4）。纯函数。
//
// - 每字最多 policy.hintMax 次（P17，过渡 2）。
// - 有笔顺数据、且有部件分组数据的字：每次 q = max(1, round(N/4)) 笔，从 from = min(已写笔数, N − q) 起
//   （P01 policy.hintStartRule='written-count'：按已写笔数）。policy.hintUseGroups=false（P29）表示不按分组内容切笔。
// - 没有部件分组数据的字：第 1 次前 1 笔、第 2 次前 2 笔（交接备注 L62，已定）。
// - 没有笔顺数据（R-W08 / 10.13）：没有分步提示，按钮灰字「暂时没有提示」。
// 按钮文案序列：「提示 · 还有 2 次」→「提示 · 还有 1 次」→「提示已用完」（改动 L85）。文案在 copy/write.js（R-W05）。

import * as defaultPolicy from '../config/policy.js';

/** 每次提示的笔数：max(1, round(N/4))。 */
export function hintQuota(totalStrokes) {
  const n = Number(totalStrokes);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('totalStrokes must be a positive integer');
  return Math.max(1, Math.round(n / 4));
}

/** 提示模式：'none'（无笔顺数据）| 'quarter'（1/4 规则）| 'prefix'（无分组：前 1 / 前 2 笔）。 */
export function hintMode({ hasStrokeData = true, hasGroups = true } = {}) {
  if (!hasStrokeData) return 'none';
  return hasGroups ? 'quarter' : 'prefix';
}

/** 还能给几次提示。 */
export function hintsRemaining(used, policy = defaultPolicy) {
  const max = Number(policy.hintMax);
  if (!Number.isInteger(max) || max < 0) throw new RangeError('policy.hintMax must be a non-negative integer');
  return Math.max(0, max - (Number(used) || 0));
}

/**
 * 下一次提示给哪几笔。没有可给的（无数据 / 已用完）返回 null。
 * @param {{totalStrokes:number, writtenStrokes:number, used:number, hasStrokeData?:boolean, hasGroups?:boolean}} input
 * @returns {null | {from:number, count:number, index:number}} 笔序号 0 起，给 [from, from+count)；index 为第几次提示（1 起）
 */
export function nextHintRange(input, policy = defaultPolicy) {
  const { totalStrokes, writtenStrokes = 0, used = 0 } = input;
  const mode = hintMode(input);
  if (mode === 'none') return null;
  if (hintsRemaining(used, policy) === 0) return null;
  const n = Number(totalStrokes);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('totalStrokes must be a positive integer');
  const index = (Number(used) || 0) + 1;
  if (mode === 'prefix') {
    return { from: 0, count: Math.min(index, n), index };
  }
  if (policy.hintStartRule !== 'written-count') {
    throw new RangeError('unsupported policy.hintStartRule: ' + String(policy.hintStartRule));
  }
  const q = hintQuota(n);
  const written = Math.max(0, Math.trunc(Number(writtenStrokes) || 0));
  const from = Math.min(written, n - q);
  return { from, count: q, index };
}

/**
 * 提示按钮状态。
 * @returns {{state:'available', remaining:number} | {state:'exhausted'} | {state:'unavailable'}}
 */
export function hintButtonState({ used = 0, hasStrokeData = true } = {}, policy = defaultPolicy) {
  if (!hasStrokeData) return { state: 'unavailable' };
  const remaining = hintsRemaining(used, policy);
  return remaining > 0 ? { state: 'available', remaining } : { state: 'exhausted' };
}

/** 按钮状态 → copy 键与占位值（R-W05）。 */
export function hintButtonCopy(buttonState) {
  switch (buttonState.state) {
    case 'available':
      return { key: 'R-W05.hintRemaining', vars: { n: buttonState.remaining } };
    case 'exhausted':
      return { key: 'R-W05.hintUsedUp', vars: {} };
    case 'unavailable':
      return { key: 'R-W05.hintUnavailable', vars: {} };
    default:
      throw new RangeError('unknown hint button state');
  }
}
