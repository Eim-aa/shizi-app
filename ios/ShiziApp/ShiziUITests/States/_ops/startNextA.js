// 开 A 槽的下一组（首练 3 字 / 今天的练习）：core/session-start.startNextA。
const m = ctx.mods;
const r = m.core.startNextA(m.store, { now: m.env.now, deck: m.deckAdapter, source: { view: 'home' } });
if (!r || !r.ok || !r.started) return { ok: false, error: 'startNextA ' + JSON.stringify(r) };
