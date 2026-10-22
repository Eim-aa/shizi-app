// 把页面发给原生的消息截下来（不真的存相册 / 分享 / 弹系统权限框，取证时不能被系统弹窗挡住）：bridge.postNative 换成只记录、返回 true。
// 记录在 window.__qaPosted（[{type, payload}]）；之后用步骤里的 js 调 window.shiziCardSaved({success}) 等回调模拟原生的回包。还原进 window.__qaCleanups。a: {}
const bridge = window.__shiziBridge;
if (!bridge) return { ok: false, error: 'no window.__shiziBridge' };
const orig = bridge.postNative;
window.__qaPosted = [];
bridge.postNative = (type, payload) => { window.__qaPosted.push({ type, payload }); return true; };
(window.__qaCleanups = window.__qaCleanups || []).push(() => { bridge.postNative = orig; });
