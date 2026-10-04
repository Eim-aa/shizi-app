// 首练结果页专属的纯函数与写入（阶段 1 P1-E5；D28 / D35 / D41 / D46 ③；设计稿「首练与首页」§三）。
// 不访问 DOM / 路由；时钟、store 都由调用方注入。UI 在 src/ui/screens/result/first.js。
//
// 一、复现预告（reviewPreview）：用 FSRS 实际到期日（sched[cardKey].due）与今天的距离分三档，只说口语，不写日期（D41）：
//     到期 ≤ 1 天 →「明天」；2–3 天 →「过两天」；≥ 4 天 →「过几天」。同档的字合并成一个分句，档位从近到远。
//     没有 sched 的字（跳过、看过答案：不是有效记录，不动 FSRS，D18 / D23）不进复现句——设计稿 #162/#170 同意；
//     一个都没有（三个字全是跳过 / 看过答案）时没有预告句，不说假话。
// 一b、每字「N 天后再见」（D48，P185）：reviewDays 给每个有 FSRS 调度的字算「距到期还有几天」（已到期按 1），daysLaterText 出文案；
//     与预告句同一个来源（sched[cardKey].due）。E9c（D49 减法修稿，设计稿没有为它单画位置）起接入结果页的复现句处：daysLaterLine 把天数相同的字
//     并成一个分句（近 → 远），「「求」明天再见，「据」「类」3 天后再见。」；所有字同一天只写「3 天后再见。」；三档口语预告（reviewPreview / previewText）保留在这里、结果页不再用（两种说法 T3 再比较）。
// 二、提醒邀请（inviteDecision / inviteTime / commitInvite*）：不弹窗（D35）；最多邀请两次（D46 ③）：
//     首练结果页一次；这次没回应（直接「再写一组」/ 关闭）→ 下一次「今天的练习」结果页再问一次；之后不再问。
//     「不用了」、系统通知权限被拒、已经打开了提醒，都永不再问。状态在 settings.remindInvite（schema.js），写入经 store.commit。
//     「邀请次数」按邀请真的显示出来那一刻记（commitInviteShown），同一个会话的结果页刷新不重复计数。

import { diffDays } from './dates.js';

// ---------------------------------------------------------------- 复现预告

/** 档位（近 → 远）。 */
export const TIERS = Object.freeze(['tomorrow', 'soon', 'later']);

/** 到期日 → 档位。到期日不晚于今天（已到期）也算「明天」。 */
export function tierOfDue(due, today) {
  const n = diffDays(today, due);
  if (n <= 1) return 'tomorrow';
  if (n <= 3) return 'soon';
  return 'later';
}

/**
 * 复现预告的分组。
 * @param {{chars: Array<{char:string, cardKey:string}>, sched: object, today: string}} o  chars 按组内顺序
 * @returns {{groups: Array<{tier:string, chars:string[]}>, same: boolean}}
 *   groups 按档位从近到远、同档的字按组内顺序；same = 只有一档且至少两个字（句式「过两天，它们再来找你。」）。
 */
export function reviewPreview({ chars, sched, today }) {
  const by = { tomorrow: [], soon: [], later: [] };
  const seen = new Set();
  for (const item of chars || []) {
    if (!item || seen.has(item.cardKey)) continue;
    const entry = sched ? sched[item.cardKey] : null;
    if (!entry || typeof entry.due !== 'string' || entry.stoppedAt !== undefined) continue;
    seen.add(item.cardKey);
    by[tierOfDue(entry.due, today)].push(item.char);
  }
  const groups = TIERS.filter((tier) => by[tier].length).map((tier) => ({ tier, chars: by[tier] }));
  const total = groups.reduce((n, g) => n + g.chars.length, 0);
  return { groups, same: groups.length === 1 && total >= 2 };
}

/** 预告句文案。translate = copy.t；没有可预告的字返回 ''。 */
export function previewText(preview, translate) {
  const { groups, same } = preview;
  if (!groups.length) return '';
  const tier = (g) => translate(`X-FIRST.tier.${g.tier}`);
  if (same) return translate('X-FIRST.reviewSame', { tier: tier(groups[0]) });
  const quote = (g) => g.chars.map((c) => `「${c}」`).join('');
  const parts = groups.map((g, i) => translate(i === 0 ? 'X-FIRST.reviewFirst' : 'X-FIRST.reviewNext', { chars: quote(g), tier: tier(g) }));
  return parts.join(translate('X-FIRST.reviewJoin')) + translate('X-FIRST.reviewEnd');
}

/**
 * 每字「N 天后再见」的天数（D48，P185）。
 * @param {{chars: Array<{char:string, cardKey:string}>, sched: object, today: string}} o  chars 按组内顺序
 * @returns {Array<{char:string, cardKey:string, days:number}>}  没有调度（跳过 / 看过答案，D18 / D23）或已停的字不列；重复的字只列一次；已到期按 1 天。
 */
export function reviewDays({ chars, sched, today }) {
  const out = [];
  const seen = new Set();
  for (const item of chars || []) {
    if (!item || seen.has(item.cardKey)) continue;
    const entry = sched ? sched[item.cardKey] : null;
    if (!entry || typeof entry.due !== 'string' || entry.stoppedAt !== undefined) continue;
    seen.add(item.cardKey);
    out.push({ char: item.char, cardKey: item.cardKey, days: Math.max(1, diffDays(today, entry.due)) });
  }
  return out;
}

/** 「N 天后再见」；1 天（含已到期）说「明天再见」。translate = copy.t。 */
export function daysLaterText(days, translate) {
  const n = Math.max(1, Math.round(Number(days) || 0));
  return n <= 1 ? translate('X-FIRST.daysLaterTomorrow') : translate('X-FIRST.daysLater', { n });
}

/**
 * 结果页复现句（E9c：D48「N 天后再见」落在复现句处）：天数相同的字合并成一个分句，天数从近到远，分句内按组内顺序；
 * 所有字天数相同且至少两个字时只写「3 天后再见。」。没有调度的字（跳过 / 看过答案 / 已停）不进；一个都没有返回 ''。translate = copy.t。
 */
export function daysLaterLine({ chars, sched, today }, translate) {
  const list = reviewDays({ chars, sched, today });
  if (!list.length) return '';
  const byDays = new Map();
  for (const item of list) {
    if (!byDays.has(item.days)) byDays.set(item.days, []);
    byDays.get(item.days).push(item.char);
  }
  const groups = [...byDays.entries()].sort((a, b) => a[0] - b[0]);
  if (groups.length === 1 && list.length >= 2) {
    return translate('X-FIRST.laterSame', { text: daysLaterText(groups[0][0], translate) }) + translate('X-FIRST.reviewEnd');
  }
  const parts = groups.map(([days, cs]) => translate('X-FIRST.laterGroup', { chars: cs.map((c) => `「${c}」`).join(''), text: daysLaterText(days, translate) }));
  return parts.join(translate('X-FIRST.reviewJoin')) + translate('X-FIRST.reviewEnd');
}

// ---------------------------------------------------------------- 提醒邀请

/** 邀请次数上限（D46 ③）。 */
export const INVITE_MAX = 2;

/** settings → 邀请状态（补缺省）。 */
export function inviteOf(settings) {
  const r = (settings && settings.remindInvite) || {};
  return {
    shown: Number.isInteger(r.shown) && r.shown > 0 ? r.shown : 0,
    last: typeof r.last === 'string' ? r.last : null,
    answered: r.answered === 'yes' || r.answered === 'no' || r.answered === 'denied' ? r.answered : null,
  };
}

/**
 * 这一页要不要显示提醒邀请块。
 * @param {{settings:object|null, variant:'first'|'daily'|'picked', sessionId:string}} o
 * @returns {'show'|'hidden'}
 *   hidden：已经回应过（好 / 不用了 / 系统拒绝）；提醒已经开着；自己选字的结果页（variant picked）；邀请已满两次且不是当时那一页。
 *   show：首练结果页（还没邀请过，或本页就是邀请过的那一页）；「今天的练习」结果页且首练那次没有回应（第二次机会）。
 *   本页就是已经邀请过的那一页（刷新 / 回到结果页）→ 继续显示，次数不变。
 */
export function inviteDecision({ settings, variant, sessionId }) {
  const remind = (settings && settings.remind) || {};
  if (remind.enabled === true) return 'hidden';
  const s = inviteOf(settings);
  if (s.answered) return 'hidden';
  if (s.last !== null && s.last === sessionId) return 'show';
  if (s.shown >= INVITE_MAX) return 'hidden';
  if (variant === 'first') return s.shown === 0 ? 'show' : 'hidden';
  if (variant === 'daily') return s.shown === 1 ? 'show' : 'hidden';
  return 'hidden';
}

/**
 * 邀请的提醒时间：现在向下取整到半点；落在 7:00–22:00 之外取 20:30（设计稿 §三「提醒邀请规则」）。
 * @returns {{hour:number, minute:number, evening:boolean}}  evening = 取了 20:30（标题换成「明天晚上八点半」）
 */
export function inviteTime(nowMs) {
  const d = new Date(nowMs);
  const hour = d.getHours();
  const minute = d.getMinutes() < 30 ? 0 : 30;
  const total = hour * 60 + minute;
  if (total < 7 * 60 || total >= 22 * 60) return { hour: 20, minute: 30, evening: true };
  return { hour, minute, evening: false };
}

/** 'H:MM'（设计稿「好，明天 9:30 给你一个词。」：小时不补零）。 */
export function inviteTimeText(hour, minute) {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

export const LABELS = Object.freeze({
  inviteShown: 'invite:shown',
  inviteAnswer: 'invite:answer',
});

function writeInvite(draft, patch) {
  const settings = draft.settings || {};
  draft.settings = { ...settings, remindInvite: { ...(settings.remindInvite || {}), ...patch } };
}

/**
 * 邀请显示出来时记一次（同一会话不重复；已满两次不再记）。
 * @returns {{ok:true, keys, skipped?:true} | {ok:false, error}}
 */
export function commitInviteShown(store, { sessionId }) {
  const cur = inviteOf(store.getState().settings);
  if (cur.last === sessionId) return { ok: true, keys: [], skipped: true };
  if (cur.shown >= INVITE_MAX) return { ok: true, keys: [], skipped: true };
  return store.commit(LABELS.inviteShown, (draft) => {
    const now = inviteOf(draft.settings);
    writeInvite(draft, { shown: Math.min(INVITE_MAX, now.shown + 1), last: sessionId });
  });
}

/** 记下用户的回应（'yes' 点了「好」/ 'no'「不用了」/ 'denied' 系统通知权限被拒）。同一回应不重复写。 */
export function commitInviteAnswer(store, answer) {
  if (answer !== 'yes' && answer !== 'no' && answer !== 'denied') throw new RangeError(`unknown invite answer: ${String(answer)}`);
  if (inviteOf(store.getState().settings).answered === answer) return { ok: true, keys: [], skipped: true };
  return store.commit(LABELS.inviteAnswer, (draft) => writeInvite(draft, { answered: answer }));
}
