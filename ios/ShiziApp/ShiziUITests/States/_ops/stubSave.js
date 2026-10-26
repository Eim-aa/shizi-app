// 桩掉「存相册」（取证时不能弹相册权限框）：postNative 的 savePracticeCard 记下来后按 a 立刻回 shiziCardSaved。
// 只在原生壳里生效（网页版用 stubNative + 步骤里的 js 回包，取证口径不变）。
// a: {success: true|false（回包里的 success）；reply: false = 不回包（保存中一直等着）}
if (!window.__shiziNative) return { ok: true, skipped: true };
const bridge = window.__shiziBridge;
if (!bridge) return { ok: false, error: { kind: 'no-bridge' } };
const orig = bridge.postNative;
const success = !!(a && a.success);
const reply = !(a && a.reply === false);
window.__qaPosted = window.__qaPosted || [];
bridge.postNative = (type, payload) => {
  if (type === 'savePracticeCard') {
    window.__qaPosted.push({ type, payload });
    if (reply) setTimeout(() => { if (typeof window.shiziCardSaved === 'function') window.shiziCardSaved({ success }); }, 0);
    return true;
  }
  return orig(type, payload);
};
(window.__qaCleanups = window.__qaCleanups || []).push(() => { bridge.postNative = orig; });
