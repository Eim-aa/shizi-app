// 自测夹具（B4.8 预备）：用 core-diff 的生成器与 JS 参考引擎造一份「像样的」合成库——
// 一年多的每日练习（带墨迹与调度）、早于 400 天的月份被折叠、自加字（custom）、设置 / 会话 / 照片 / v1 导入报告，
// 并且这份库是「一次备份导入」的结果（先导出、再在新库里恢复）。随后给出两种输入形态：备份 JSON 与 SQLite 库。
// 里面没有任何真实数据；照片与报告字串是故意放进去的假「个人内容」，用来检验脱敏。
import { makeCtx, rng } from '../core-diff/lib/gen.mjs';
import { openEngine } from '../core-diff/lib/engines.mjs';

export const DAY = 86400000;
const CHARS = Array.from('人口水山大小日月火木土金天地上下中学字拾永明好行生来是不我你他的了在有和这个国');

const call = async (e, op, args = {}, state = false) => {
  const r = JSON.parse(await e.send(JSON.stringify({ op, args, state })));
  if (!r.ok) throw new Error(`fixture ${op}: ${JSON.stringify(r.error)}`);
  return r;
};

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function stroke(g, n) {
  const pts = [];
  let x = g.int(20, 300);
  let y = g.int(20, 300);
  let t = g.int(0, 2000);
  for (let i = 0; i < n; i += 1) {
    pts.push({ x, y, t });
    x += g.int(-9, 9) + 0.5;
    y += g.int(-9, 9) + 0.25;
    t += g.pick([8, 16, 17, 33]);
  }
  return pts;
}

/**
 * @param {{seed?: number, days?: number, endAt?: number}} o
 * @returns {Promise<{disk: Record<string,string>, backupText: string, endAt: number, expect: {records: number, folded: number}}>}
 */
export async function buildFixture({ seed = 20261101, days = 460, endAt = Date.UTC(2026, 9, 2, 2, 0, 0) } = {}) {
  const g = makeCtx(rng(seed));
  const e = openEngine('js');
  try {
    await call(e, 'reset');
    // 小预算：让一年多的数据在练习过程中真的触发折叠（早于 400 天的月份）与墨迹分层
    const t0 = endAt - days * DAY;
    await call(e, 'store.open', { backend: 'native', clock: t0, budgets: { inkBudgetBytes: 400000 } });
    const sched = {};
    for (let d = 0; d < days; d += 1) {
      const t = t0 + d * DAY + 9 * 3600000;
      await call(e, 'clock.set', { t });
      if (g.chance(0.12)) continue; // 偶尔断一天
      const day = dayOf(t);
      const month = day.slice(0, 7);
      const ops = [];
      const n = g.int(4, 8);
      for (let i = 0; i < n; i += 1) {
        const ch = g.pick(CHARS);
        const kind = g.weighted([['judged', 8], ['answer-seen', 1.5], ['skipped', 0.5]]);
        const rec = { cardKey: `base:${ch}`, char: ch, sessionId: `s${1 + (d % 9)}`, kind, at: t + i * 60000, localDay: day, help: { hints: g.pick([0, 0, 1, 2]), answerSeen: kind === 'answer-seen', traced: g.chance(0.2) } };
        if (kind === 'judged') rec.judgment = g.pick(['correct', 'correct', 'wrong']);
        ops.push({ op: 'append', month, record: rec });
        if (kind === 'judged' && g.chance(0.7)) ops.push({ op: 'judgeInk', record: '$last', strokes: [stroke(g, g.int(3, 7)), stroke(g, g.int(3, 6))] });
        if (kind === 'judged') {
          sched[`base:${ch}`] = { fsrs: { stability: g.int(1, 60) + 0.5, difficulty: 3 + g.int(0, 60) / 10 }, due: dayOf(t + g.int(1, 40) * DAY), lastJudgedAt: rec.at };
          ops.push({ op: 'patch', domain: 'sched', key: `base:${ch}`, value: sched[`base:${ch}`] });
        }
      }
      await call(e, 'store.commit', { label: 'write:judge', ops });
    }
    await call(e, 'store.commit', { label: 'settings', ops: [
      { op: 'set', domain: 'custom', value: { added: [{ char: '哈', at: t0 + 30 * DAY }, { char: '嗨', at: t0 + 90 * DAY }] } },
      { op: 'set', domain: 'settings', value: { library: 'common', sound: true, groupSize: 20, appearance: 'auto' } },
      { op: 'set', domain: 'wordOff', value: { 'base:人': t0 + DAY } },
      // 故意放进去的「个人内容」：脱敏必须换掉它们
      { op: 'set', domain: 'photos', value: { 永: { day: dayOf(t0 + 40 * DAY), at: t0 + 40 * DAY, dataURL: 'data:image/jpeg;base64,' + 'QUJDREVGRw=='.repeat(60) } } },
      { op: 'set', domain: 'legacy', value: { importedAt: t0, fromKeys: ['shizi.memory.v1'], days: [dayOf(t0 - 5 * DAY)], report: { note: '这是一条私人备注 private note', counts: { chars: 12 }, list: ['alice', 'bob'] } } },
    ] });
    const exported = (await call(e, 'backup.export', {})).reply;

    // 「备份导入」：在一块全新的库里恢复刚导出的文件，再接着练几天；这块库的磁盘就是夹具
    await call(e, 'reset');
    const later = endAt + 3 * DAY;
    await call(e, 'store.open', { backend: 'native', clock: later });
    const restored = await call(e, 'backup.restore', { input: exported });
    if (!restored.reply.result || !restored.reply.result.ok) throw new Error('fixture: backup restore failed');
    for (let d = 0; d < 3; d += 1) {
      const t = later + d * DAY + 3600000;
      await call(e, 'clock.set', { t });
      await call(e, 'store.commit', { label: 'write:judge', ops: [
        { op: 'append', month: dayOf(t).slice(0, 7), record: { cardKey: 'base:拾', char: '拾', sessionId: 's20', kind: 'judged', judgment: 'correct', at: t, localDay: dayOf(t), help: { hints: 0, answerSeen: false, traced: false } } },
        { op: 'judgeInk', record: '$last', strokes: [stroke(g, 5), stroke(g, 4)] },
        { op: 'patch', domain: 'sched', key: 'base:拾', value: { fsrs: { stability: 2.5, difficulty: 5 }, due: dayOf(t + 2 * DAY), lastJudgedAt: t } },
      ] });
    }
    const snap = (await call(e, 'state', {}, true)).state;
    const state = snap.store.state;
    const disk = snap.store.disk;
    const backupText = (await call(e, 'backup.export', {})).reply;
    const folded = Object.values(state.records).filter((v) => v && !Array.isArray(v) && v.folded).length;
    const records = Object.values(state.records).reduce((s, v) => s + (Array.isArray(v) ? v.length : (v.kept || []).length), 0);
    return { disk, backupText, endAt: later + 3 * DAY, expect: { records, folded } };
  } finally {
    await e.close();
  }
}
