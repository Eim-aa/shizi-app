// 系统通知权限的回包钉成夹具写的值（R16）。App 里系统权限是权威的：页面一查（queryReminderStatus：启动时提醒开着、回到前台），原生就用
// 模拟器真实的授权状态回 shiziReminderStatus，把夹具种下的 settings.remind.permission 改掉——来不来、什么时候来随时序变，
// 取证里「通知被拒」时有时无（网页参考、原生取证各自碰运气）。这里把原生回包里的 permission 换成 a.value，其余照常走 applyReminderStatus。
// 还原进 window.__qaCleanups。a: {value: 'granted'|'denied'|'unknown'}
const orig = window.shiziReminderStatus;
if (typeof orig !== 'function') return { ok: false, error: 'no window.shiziReminderStatus' };
window.shiziReminderStatus = (payload) => orig({ ...(payload && typeof payload === 'object' ? payload : {}), permission: a.value });
(window.__qaCleanups = window.__qaCleanups || []).push(() => { window.shiziReminderStatus = orig; });
