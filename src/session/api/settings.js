// App API · 提醒（B3.10；计划 §3.4、§3.7）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/settings.js），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-settings.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.10 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
//   view.remind {}              → {ok, view}：views/settings.js 的 remindView（= 网页提醒页渲染用的同一个模型）
//                                 同回包还有 lines（网页量出的折行点，原生照它断行；见 src/platform/text-lines.js）
//   remind.enabled {on}         开关（网页 commitRemindEnabled）：开着时补上缺省时间（P18）
//   remind.time {hour, minute}  改时间（网页 commitRemindTime）
//   reminder.status {permission} 原生回报的通知权限 → settings.remind.permission（网页 applyReminderStatus 的写入那一半）
//   reminder.plan {}            接下来几天要发的通知（题目 + 时间）：网页 syncReminder 发的同一份内容，改成文案引用，原生自己排
//
// 提醒内容与「什么时候该发」由 core/reminder.js 算（网页路径与原生路径同一份实现）；原生页拿 reminder.plan 的结果调
// UNUserNotificationCenter 排期，权限由原生自己查（UNUserNotificationCenter），开关与时间仍写 store（网页同一批函数）。

import { remindView, commitRemindEnabled, commitRemindTime, applyReminderStatus } from '../views/settings.js';
import { reminderPayloadRefs } from '../../core/reminder.js';
import { localDay } from '../../core/dates.js';
import { deckAdapter } from '../../data/deck.js';
import { now as envNow } from '../../platform/env.js';
import { tRef } from '../../config/copy/index.js';
import { textLineStarts } from '../../platform/text-lines.js';

/** store 提交结果 → 回包（D07：失败回 {ok:false, error:{kind}}）。 */
function replyOf(r) {
  if (r && r.ok === false) {
    const error = r.error && typeof r.error === 'object' ? r.error : {};
    return { ok: false, error: { kind: String(error.kind || 'generic') } };
  }
  return { ok: true };
}

export const OPS = Object.freeze({
  'view.remind': (args, ctx) => {
    const view = remindView(ctx.getStore().getState().settings);
    // 网页量出的折行点（原生要跟网页折在同一处）：开关行的小字是 text-wrap: pretty，WebKit 的折法不是贪心折行。
    // 量法在网页侧登记（src/ui/screens/mine/remind.js），这里只取结果；没有 DOM 时为 null（原生按自己的宽度折）。
    const sub = view.denied ? view.remindPage.sub.denied : view.remindPage.sub.on;
    return {
      ok: true,
      view,
      lines: { sub: textLineStarts('remind.sub', tRef(sub), { title: tRef(view.remindPage.label) }) },
    };
  },
  'remind.enabled': (args, ctx) => replyOf(commitRemindEnabled(ctx.getStore(), args.on === true)),
  'remind.time': (args, ctx) => replyOf(commitRemindTime(ctx.getStore(), args.hour, args.minute)),
  'reminder.status': (args, ctx) => replyOf(applyReminderStatus(ctx.getStore(), { permission: args.permission })),
  'reminder.plan': (args, ctx) => {
    const now = envNow();
    const plan = reminderPayloadRefs(ctx.getStore().getState(), { today: localDay(now), now, deck: deckAdapter });
    return { ok: true, plan };
  },
});
