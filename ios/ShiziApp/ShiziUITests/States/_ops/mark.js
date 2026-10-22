// 把某槽当前会话的 id / 总字数记进 ctx.vars（之后的步骤里 "$名字" 取用）。a: {slot, sid?, total?}
const m = ctx.mods;
const snap = ctx.writeSnapshot(m.store.getState(), a.slot || 'B');
if (a.sid) ctx.vars[a.sid] = snap.sessionId;
if (a.total) ctx.vars[a.total] = snap.total;
