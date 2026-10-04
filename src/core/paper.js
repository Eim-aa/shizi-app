// 「在纸上写，回来自判」的写字方式（阶段 1 P1-E8；D46 ⑬ / D47；实现交接 §10；03 P165 / P168）。纯函数，不访问存储。
//
// - 设置 settings.writeMode：'screen'（缺省）| 'paper'——「设置 › 写字方式」。
// - 本字临时切换 session.current.paper（布尔，可缺省）：写字页格下「在纸上写 / 改回在屏幕上写」只改当前这一个字；
//   推进到下一字时 current 重置（core/sessions.advance → freshCurrent），回到设置的写字方式。进判断页时把 paper:true 写进 current，
//   刷新后仍是纸上的判断页（core/sessions.recoverSession 不把它当成「判断页却没有笔画」退回 recall）。
// - 只管回忆 / 判断两步（recall / compare）：看答案、描一遍、自己写仍在屏幕上（「题面、提示、看答案照常」）。
// - 读屏开启后第一次进写字页的建议（P168）：settings.paperSuggested = true 表示已经出现过，不再出现。
// 记录侧的判定（recordSource / isPaperRecord / isWorkRecord / withoutPaper）在 core/records.js。

export const WRITE_MODES = Object.freeze(['screen', 'paper']);
const PAPER_PHASES = Object.freeze(['recall', 'compare']);

/** 设置里的写字方式（不合法 / 缺省 → 'screen'）。 */
export function writeModeOf(settings) {
  return settings && settings.writeMode === 'paper' ? 'paper' : 'screen';
}

/**
 * 当前这一个字是不是在纸上写：本字的临时切换（current.paper）优先，否则跟设置；只在 recall / compare 两步。
 * @param {{settings?:object|null, current?:object|null}} o
 */
export function paperOf({ settings = null, current = null } = {}) {
  const phase = current && current.phase ? current.phase : 'recall';
  if (PAPER_PHASES.indexOf(phase) < 0) return false;
  if (current && typeof current.paper === 'boolean') return current.paper;
  return writeModeOf(settings) === 'paper';
}

/** 读屏开启时的「改为在纸上写」建议要不要出现：读屏在运行、设置仍是屏幕、还没出现过（只出现一次，P168）。 */
export function paperSuggestDue({ settings = null, assistive = false } = {}) {
  if (!assistive) return false;
  if (writeModeOf(settings) === 'paper') return false;
  return !(settings && settings.paperSuggested === true);
}
