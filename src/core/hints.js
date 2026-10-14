// 提示量（决定-D25 方案① / R-W05 / R-W06；01-架构设计 §6.4；决定-D64 ①）。纯函数。
//
// - 每点一次提示，在**已经给出过的提示笔之后**再多给一段，可以一直点到整字都给出为止（D64 ①，取代原「每字最多 2 次」P17）；
//   被本人笔收掉的提示笔仍算已给出。「已给出几笔」只由「已点几次」推出（不再看已写笔数，所以第二次不会再给出同样几笔）。
// - 有笔顺数据、且有部件分组数据的字：每段 q = max(1, round(N/4)) 笔，最后一段可能不足 q 笔。policy.hintUseGroups=false（P29）表示不按分组内容切笔。
// - 没有部件分组数据的字：每次多 1 笔。
// - 没有笔顺数据（R-W08 / 10.13）：没有分步提示，按钮灰字「暂时没有提示」。
// - 整字都给出后按钮不可点（「提示已用完」），写字页同时把这个字按「看过答案」记录（answer.js commitAnswerSeen，与看答案同一口径）。
// 读屏名称「提示，还有 n 次」的 n = 还剩几段。文案在 copy/write.js（R-W05）。

/** 每段提示的笔数：max(1, round(N/4))。 */
export function hintQuota(totalStrokes) {
  const n = Number(totalStrokes);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('totalStrokes must be a positive integer');
  return Math.max(1, Math.round(n / 4));
}

/** 提示模式：'none'（无笔顺数据）| 'quarter'（1/4 规则）| 'prefix'（无分组：每次多 1 笔）。 */
export function hintMode({ hasStrokeData = true, hasGroups = true } = {}) {
  if (!hasStrokeData) return 'none';
  return hasGroups ? 'quarter' : 'prefix';
}

function perSegment(totalStrokes, mode) {
  return mode === 'quarter' ? hintQuota(totalStrokes) : 1;
}

function count(used) {
  return Math.max(0, Math.trunc(Number(used) || 0));
}

/** 点了 used 次之后，已经给出的笔数（0 .. N）。 */
export function hintsGiven(input) {
  const mode = hintMode(input);
  if (mode === 'none') return 0;
  const n = Number(input.totalStrokes);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('totalStrokes must be a positive integer');
  return Math.min(n, count(input.used) * perSegment(n, mode));
}

/** 整字一共分几段（没有笔顺数据 / 数据未到 → 0）。 */
export function hintSegments(input) {
  const mode = hintMode(input);
  if (mode === 'none') return 0;
  const n = Number(input.totalStrokes);
  if (!Number.isInteger(n) || n < 1) return 0;
  return Math.ceil(n / perSegment(n, mode));
}

/** 还能再点几次（= 还剩几段）。 */
export function hintsRemaining(input) {
  return Math.max(0, hintSegments(input) - count(input.used));
}

/**
 * 点了 used 次之后，整字是不是都给出了（提示用完，记为看过答案）。笔顺数据没到 / 没有时为 false。
 */
export function hintsAllGiven(input) {
  const n = Number(input.totalStrokes);
  if (hintMode(input) === 'none' || !Number.isInteger(n) || n < 1) return false;
  return hintsGiven(input) >= n;
}

/**
 * 下一次提示给哪几笔：从已给出的最后一笔之后接着给一段。没有可给的（无数据 / 整字已给完）返回 null。
 * @param {{totalStrokes:number, used:number, hasStrokeData?:boolean, hasGroups?:boolean}} input
 * @returns {null | {from:number, count:number, index:number}} 笔序号 0 起，给 [from, from+count)；index 为第几次提示（1 起）
 */
export function nextHintRange(input) {
  const mode = hintMode(input);
  if (mode === 'none') return null;
  const n = Number(input.totalStrokes);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('totalStrokes must be a positive integer');
  const from = hintsGiven(input);
  if (from >= n) return null;
  return { from, count: Math.min(perSegment(n, mode), n - from), index: count(input.used) + 1 };
}

/**
 * 提示按钮状态。totalStrokes 未知（笔顺还在加载）时 remaining 为 null。
 * @returns {{state:'available', remaining:number|null} | {state:'exhausted'} | {state:'unavailable'}}
 */
export function hintButtonState({ used = 0, hasStrokeData = true, totalStrokes = 0, hasGroups = true } = {}) {
  if (!hasStrokeData) return { state: 'unavailable' };
  if (!(Number(totalStrokes) >= 1)) return { state: 'available', remaining: null };
  const remaining = hintsRemaining({ used, totalStrokes, hasStrokeData, hasGroups });
  return remaining > 0 ? { state: 'available', remaining } : { state: 'exhausted' };
}

/** 按钮状态 → copy 键与占位值（R-W05）。 */
export function hintButtonCopy(buttonState) {
  switch (buttonState.state) {
    case 'available':
      return buttonState.remaining === null
        ? { key: 'R-W05.hintLabel', vars: {} }
        : { key: 'R-W05.hintRemaining', vars: { n: buttonState.remaining } };
    case 'exhausted':
      return { key: 'R-W05.hintUsedUp', vars: {} };
    case 'unavailable':
      return { key: 'R-W05.hintUnavailable', vars: {} };
    default:
      throw new RangeError('unknown hint button state');
  }
}
