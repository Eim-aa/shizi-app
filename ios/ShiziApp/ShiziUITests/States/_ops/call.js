// 调一次写字会话 API（当前字）。a: {slot, name, args:{…}}；args.strokes 可写 'one' | 'two' | 数组；args 里 "$名字" 取 ctx.vars。结果记在 ctx.vars.last。
const m = ctx.mods;
const slot = a.slot || 'B';
const args = ctx.subst(a.args || {});
if (typeof args.strokes === 'string') args.strokes = ctx.strokeSet(args.strokes);
const k = args.cardKey || ctx.writeSnapshot(m.store.getState(), slot).cardKey;
const r = ctx.api(slot).call(a.name, { slot, cardKey: k, ...args });
if (!r || !r.ok) return { ok: false, error: a.name + ' ' + JSON.stringify(r && r.error) };
ctx.vars.last = r;
