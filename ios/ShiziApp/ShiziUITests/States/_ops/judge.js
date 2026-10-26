// 经写字会话 API 连判几个字（与原生页同一批提交函数）。a: {slot, judgments:[…循环取], n:数字|'all', strokes:'one'|'two', tick:数字}
// tick（R16）：判之前把钉住的时钟拨到第 tick 次读数（prologue.js ctx.repin）——这一段同步、读数次数确定，复习时刻因此与前面谁读过时钟无关。
if (a.tick !== undefined) ctx.repin(a.tick);
const m = ctx.mods;
const slot = a.slot || 'B';
const api = ctx.api(slot);
const S = ctx.strokeSet(a.strokes || 'two');
const js = a.judgments || ['correct'];
const n = a.n === 'all' ? ctx.writeSnapshot(m.store.getState(), slot).total : (a.n === undefined ? js.length : a.n);
for (let i = 0; i < n; i += 1) {
  const k = ctx.writeSnapshot(m.store.getState(), slot).cardKey;
  const p = api.call('phase', { slot, cardKey: k, phase: 'compare', strokes: S });
  if (slot === 'B' && (!p || !p.ok)) return { ok: false, error: 'phase ' + JSON.stringify(p && p.error) };
  const r = api.call('judge', { slot, cardKey: k, judgment: js[i % js.length], strokes: S, hints: 0 });
  if (!r || !r.ok) return { ok: false, error: 'judge ' + JSON.stringify(r && r.error) };
}
