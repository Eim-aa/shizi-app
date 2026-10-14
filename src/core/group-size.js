// 每组字数（决定 D65 #2；policy.groupSize P03 / policy.groupSizeOptions P314）。纯函数。
//
// - 用户在「我的 › 每组字数」选 5 / 10 / 20 / 30，存 settings.groupSize（经 store.commit，ui/screens/mine/group-size.js）；
//   没选过（含所有老用户、v1 迁移来的用户）按 policy.groupSize（20）。
// - 今日计划（session-start.planDaily）、首页主按钮与字库「今日练习」（都读 planDaily）、再写一组（startNextA → planDaily）都从这里取同一个值。
// - 改了只影响之后开的组：已经开着的组（sessions.A / B 的 queue）不变。
// - 每日复习上限、回来的第一组、配比份数按 size / groupMix.baseSize 等比例换算（core/mix.js scaledCount）。

import * as defaultPolicy from '../config/policy.js';
import { scaledCount } from './mix.js';

/** 一个值是不是可选的组大小。 */
export function isGroupSizeOption(value, policy = defaultPolicy) {
  return Array.isArray(policy.groupSizeOptions) && policy.groupSizeOptions.indexOf(value) >= 0;
}

/** 规整：可选值原样返回，其余（缺省 / 未知）按 policy.groupSize。 */
export function validGroupSize(value, policy = defaultPolicy) {
  return isGroupSizeOption(value, policy) ? value : policy.groupSize;
}

/** settings → 每组字数。 */
export function groupSizeOf(settings, policy = defaultPolicy) {
  return validGroupSize(settings ? settings.groupSize : undefined, policy);
}

/** 按组大小换算后的每日到期复习上限（dailyReviewCap 是按 5 字一组写的 30）。 */
export function dailyReviewCapOf(size, policy = defaultPolicy) {
  return scaledCount(policy.dailyReviewCap, validGroupSize(size, policy), policy.groupMix);
}
