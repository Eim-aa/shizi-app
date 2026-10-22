// 开「这次选的字」（B 槽）：core/session-start.startPicked。a.keys 缺省 = 固定 5 字（永 和 春 日 月）。
// 开完让出一次事件循环（与 B2 原来的注入逐位一致：原来这里紧接着 await import 会话 API 模块）——页面（Preact）此时渲染一次，
// 钉住的时钟里这次渲染读的几次时钟是造数据数字的一部分（见 _runtime/epilogue.js 的说明）。
const m = ctx.mods;
const r = m.core.startPicked(m.store, { keys: a.keys || ctx.chars, source: { view: 'home' }, deck: m.deckAdapter });
if (!r || !r.ok) return { ok: false, error: 'startPicked ' + JSON.stringify(r) };
await import('/src/ui/screens/write/native-session.js');
await import('/src/session/write-api.js');
