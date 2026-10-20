// 场景集（r7-S1）。每个场景 = 虚拟用户配置 + 「产品直觉上应该怎样」的预期。
// 预期是先按直觉写的（不是照着跑出来的结果写的）；跑出来不符的会在报告里标「偏离」。
// check(summary, res) 返回 { ok, actual }。
import { addDays, localDay } from '../../src/core/dates.js';
import { convertV1 } from '../../src/store/migrate.js';
import { deckAdapter } from '../../src/data/deck.js';
import { isWarmupKey } from '../../src/core/new-order.js';

const NOTRIM = { hintRate: 0, answerRate: 0, skipRate: 0 };
const ok = (cond, actual) => ({ ok: !!cond, actual });
/** 与「时间 / 日期」相关的违反（排除各场景都有的 D6 / W1 / P4，它们另列）。 */
const timeViolations = (s) => Object.keys(s.violations).filter(id => !['D6-zone-due-matches-plan', 'W1-wrong-returns-next-day', 'P4-skip-seen-not-reoffered-today'].includes(id));
const pct = (x) => (x === null || x === undefined ? '—' : Math.round(x * 1000) / 10 + '%');

const wrongBack = (min) => ({
  text: `写错的字第二天要回来（至少 ${Math.round(min * 100)}% 的写错字，隔天就再见到）`,
  check: (s) => ok(s.wrongReturn && s.wrongReturn.nextDayShare >= min, s.wrongReturn ? `隔天回来 ${pct(s.wrongReturn.nextDayShare)}；平均隔 ${s.wrongReturn.mean} 天、中位数 ${s.wrongReturn.median} 天、90% 分位 ${s.wrongReturn.p90} 天（${s.wrongReturn.n} 次写错）` : '没有写错'),
});

/** 合成一份「v1 老用户」数据（旧版 memory + fsrsLog），换算成 v2 状态后装进 store。 */
function legacySetup(store, clock) {
  const now = clock.t;
  const today = localDay(now);
  const chars = deckAdapter.newCandidates('core3500').slice(0, 160);
  const events = [];
  const memory = {};
  let seq = 0;
  chars.forEach((key, i) => {
    const firstOffset = 70 - Math.floor(i * 0.42); // 70 天前 … 3 天前，陆续学了 160 个
    const wrongFirst = i % 3 === 0;
    const iso = (offset, hh = 12) => new Date(Date.parse(addDays(today, -offset) + 'T00:00:00') + hh * 3600000 + 8 * 3600000).toISOString();
    const dayOf = (offset) => addDays(today, -offset);
    const push = (offset, rating, reason, hint = 0) => {
      seq += 1;
      events.push({ eventId: `e${seq}:fsrs`, attemptId: `e${seq}`, cardKey: key, target: key.slice(-1), reviewedAt: iso(offset), localDay: localDay(Date.parse(iso(offset))), rating, reason, hintCount: hint, traced: false, teaching: false, plannedDue: dayOf(offset) });
    };
    if (wrongFirst) push(firstOffset, 'Again', 'wrong');
    push(Math.max(1, firstOffset - (wrongFirst ? 1 : 0) - 1), 'Good', 'independent');
    if (firstOffset > 12) push(Math.max(1, firstOffset - 9), 'Good', 'independent');
    const lastOffset = Math.max(1, firstOffset > 12 ? firstOffset - 9 : firstOffset - 1);
    const stab = 4 + (i % 7) * 3;
    const dueOffset = lastOffset - stab; // 负 = 还没到
    memory[key] = {
      seen: 3, fast: 2, slow: wrongFirst ? 1 : 0, last: Date.parse(iso(lastOffset)), lastOutcome: 'fast', lastHints: 0, traced: false,
      fsrsCard: { due: iso(dueOffset), stability: stab, difficulty: 5 + (i % 5) * 0.8, elapsed_days: 2, scheduled_days: stab, learning_steps: 0, reps: 3, lapses: wrongFirst ? 1 : 0, state: 2, last_review: iso(lastOffset) },
      dueDay: addDays(today, -dueOffset), pendingLearning: false,
    };
  });
  // 与 store/migrate.runMigration 同一套做法：convertV1 + idFor 取 store 的记录序号 + replace 提交
  store.commit('sim:import-legacy', (d, ctx) => {
    const { state } = convertV1({ memory, fsrsLog: { version: 2, events } }, { now, dueBase: now, idFor: () => ctx.nextId('r') });
    d.records = state.records;
    d.sched = state.sched;
    d.legacy = state.legacy;
    d.meta = Object.assign({}, state.meta, { migratedAt: now });
  }, { reclaim: false, replace: true });
}

export const SCENARIOS = [
  {
    id: 'S1-week1-perfect',
    name: '新用户第一周，每天一组，全对',
    days: 7,
    user: { accuracy: 1, newAccuracy: 1, difficultyPenalty: 0, ...NOTRIM },
    expect: [
      { text: '第 1 天只有首练 3 个字（尴、赢、拾）', check: (s, r) => ok(r.days[0].cards === 3, `第 1 天 ${r.days[0].cards} 个字：${r.groups[0].queue.map(q => q.char).join('')}`) },
      { text: '第 2–7 天每天一组 5 个字', check: (s, r) => ok(r.days.slice(1).every(d => d.cards === 5), r.days.slice(1).map(d => d.cards).join('、')) },
      { text: '写对的字一周内要回来巩固：第 2–7 天里复习字（到期 + 提前复习）至少占 20%', check: (s, r) => { const d = r.days.slice(1); const rv = d.reduce((a, x) => a + x.dueCards + x.earlyCards, 0); const all = d.reduce((a, x) => a + x.cards, 0); return ok(rv / all >= 0.2, `复习字 ${rv}/${all}（${pct(rv / all)}）`); } },
      { text: '全对时每天新字不多于 3 个（别把人压垮）', check: (s, r) => ok(r.days.slice(1).every(d => d.newCards <= 3), r.days.slice(1).map(d => d.newCards).join('、')) },
      { text: '一周下来三档里没有「待复习」堆积（全对，不该有一大堆待复习）', check: (s, r) => ok(r.days[6].zoneDue <= 5, `第 7 天结束：待复习 ${r.days[6].zoneDue}、未熟悉 ${r.days[6].zoneShaky}、已熟悉 ${r.days[6].zoneKnown}`) },
    ],
  },
  {
    id: 'S2-all-wrong',
    name: '每天一组，全错（14 天）',
    days: 14,
    user: { accuracy: 0.02, newAccuracy: 0.02, hintRate: 0, answerRate: 0, skipRate: 0, difficultyPenalty: 0 },
    expect: [
      { text: '每天仍是 5 个字，负担不涨', check: (s, r) => ok(r.days.every((d, i) => i === 0 || d.cards === 5), r.days.map(d => d.cards).join('、')) },
      { text: '写错的字第二天回来（第 2 天起每天有「写错重练」的字）', check: (s, r) => ok(r.days.slice(1).every(d => d.wrongRetry >= 1), r.days.map(d => d.wrongRetry).join('、')) },
      { text: '一直写错时，新字越来越少（后 5 天平均每天新字 ≤ 1.5 个），别让待复习越堆越高', check: (s, r) => { const t = r.days.slice(-5); const m = t.reduce((a, d) => a + d.newCards, 0) / t.length; return ok(m <= 1.5, `后 5 天新字：${t.map(d => d.newCards).join('、')}（平均 ${m.toFixed(1)}）`); } },
      { text: '没有字逾期超过 7 天（天天来，全错的字应当天天回来）', check: (s, r) => ok(s.overdueMax <= 7, `最长逾期 ${s.overdueMax} 天；待复习积压最多 ${s.backlogMax}`) },
      { text: '14 天后积压（一天开始时到期未写的字）不超过 20 个', check: (s, r) => ok(s.backlogMax <= 20, `积压最多 ${s.backlogMax}，结束时 ${r.days[13].backlogEnd}`) },
    ],
  },
  {
    id: 'S3-mixed-90d',
    name: '混合：80% 写对，10% 用提示，少量看答案 / 跳过，90 天每天一组',
    days: 90,
    expect: [
      { text: '每天 5 个字（首练日除外）', check: (s, r) => ok(r.days.slice(1).every(d => d.cards === 5), `每天字数范围 ${Math.min(...r.days.slice(1).map(d => d.cards))}–${Math.max(...r.days.map(d => d.cards))}`) },
      { text: '积压稳定：最后 30 天，一天开始时到期未写的字平均 ≤ 12 个', check: (s) => ok(s.backlogTailMean <= 12, `最后 30 天平均积压 ${s.backlogTailMean}，最多 ${s.backlogTailMax}`) },
      { text: '90 天累计学到至少 120 个新字', check: (s) => ok(s.recorded >= 120, `已练汉字 ${s.recorded}`) },
      { text: '字库里有「已熟悉」的字（稳定度三周以上）', check: (s) => ok(s.zones.known > 0, `三档 ${s.zones.due}/${s.zones.shaky}/${s.zones.known}`) },
      wrongBack(0.8),
      { text: '没有字逾期超过 30 天', check: (s) => ok(s.overdueMax <= 30, `最长逾期 ${s.overdueMax} 天`) },
    ],
  },
  {
    id: 'S4-away-10d',
    name: '练 20 天后连续 10 天不练，再回来练 12 天',
    days: 42,
    restDays: [{ from: 20, to: 29 }],
    expect: [
      { text: '回来的第一组缩短为 3 个字（D48 ⑧）', check: (s, r) => ok(r.days[30].cards === 3, `回来第一天 ${r.days[30].cards} 个字`) },
      { text: '回来后每组仍有新字（不能全是复习，把人吓跑）', check: (s, r) => ok(r.days[30].newCards >= 1, `回来第一组新字 ${r.days[30].newCards} 个`) },
      { text: '回来 12 天后，积压回到离开前的水平附近（≤ 离开前 + 5）', check: (s, r) => { const before = r.days[19].backlogEnd; const after = r.days[41].backlogEnd; return ok(after <= before + 5, `离开前结束时积压 ${before}，回来后第 12 天 ${after}，回来第一天积压 ${r.days[30].backlogStart}`); } },
      { text: '回来后没有一天的字数超过 5', check: (s, r) => ok(r.days.slice(30).every(d => d.cards <= 5), r.days.slice(30).map(d => d.cards).join('、')) },
    ],
  },
  {
    id: 'S5-three-groups',
    name: '每天写三组（60 天，80% 写对）',
    days: 60,
    groupsPerDay: 3,
    expect: [
      wrongBack(0.8),
      { text: '每天最多 15 个字（3 组 × 5）', check: (s) => ok(s.cardsPerDayMax <= 15, `每天最多 ${s.cardsPerDayMax}`) },
      { text: '到期复习不超过每日上限 30（没有违反）', check: (s) => ok(!s.violations['G10-daily-cap'], JSON.stringify(s.violations['G10-daily-cap'] || '无')) },
      { text: '积压不失控：最后 30 天一天开始时积压平均 ≤ 12', check: (s) => ok(s.backlogTailMean <= 12, `平均 ${s.backlogTailMean}，最多 ${s.backlogTailMax}`) },
      { text: '同一天内没有字重复出现（写过的当天不再出）', check: (s, r) => ok(s.sameDayRepeats === 0, `同一天重复出现的（字，天）${s.sameDayRepeats} 个`) },
      { text: '三组之间复习与新字都有，不会第 2、3 组全是新字', check: (s, r) => { const g = r.groups.filter(x => x.slot === 'A' && x.group > 0 && x.kind === 'daily'); const allNew = g.filter(x => x.queue.every(q => q.src === 'new' || q.src === 'warm-new')).length; return ok(allNew / g.length < 0.2, `第 2、3 组共 ${g.length} 个，其中全是新字 ${allNew} 个`); } },
    ],
  },
  {
    id: 'S6-switch-library',
    name: '中途切换练习范围：常用字 → 次常用字（第 15 天）→ 切回常用字（第 30 天）',
    days: 45,
    events: [{ day: 15, type: 'library', library: 'adv3000' }, { day: 30, type: 'library', library: 'core3500' }],
    expect: [
      { text: '切换后新字全部来自新的练习范围（不变量 G4 无违反）', check: (s) => ok(!s.violations['G4-new-in-library'], JSON.stringify(s.violations['G4-new-in-library'] || '无')) },
      { text: '切换后旧范围里到期的字照常复习（产品直觉：范围只管新字）', check: (s, r) => { const d = r.days.slice(15, 30); return ok(d.some(x => x.dueCards + x.earlyCards > 0), `第 16–30 天复习字：${d.map(x => x.dueCards + x.earlyCards).join('、')}`); } },
      { text: '切回常用字后，新字接着上次的位置往下（不重复学已练过的）', check: (s) => ok(!s.violations['G5-new-never-judged'], JSON.stringify(s.violations['G5-new-never-judged'] || '无')) },
      { text: '切换当天新字数量不变（仍 ≤ 3）', check: (s, r) => ok(r.days[15].newCards <= 3 && r.days[30].newCards <= 3, `第 16 天新字 ${r.days[15].newCards}，第 31 天新字 ${r.days[30].newCards}`) },
    ],
  },
  {
    id: 'S7-lots-of-seen-skip',
    name: '大量看答案 / 跳过：35% 看答案、25% 跳过，每天两组（20 天）',
    days: 20,
    groupsPerDay: 2,
    user: { answerRate: 0.35, skipRate: 0.25, hintRate: 0.05 },
    expect: [
      { text: '刚跳过 / 刚看过答案的字，当天不会立刻又出现（P4）', check: (s) => ok(!s.violations['P4-skip-seen-not-reoffered-today'], `违反 ${(s.violations['P4-skip-seen-not-reoffered-today'] || { count: 0 }).count} 次`) },
      { text: '跳过、看答案不改调度表也不计入已练（P3 / D3）', check: (s) => ok(!s.violations['P3-skip-seen-no-sched'] && !s.violations['D3-skipped-not-practiced'], '见不变量表') },
      { text: '已练汉字只数真正写过判断的字', check: (s, r) => ok(!s.violations['D2-recorded-eq-judged'], `已练 ${s.recorded}，跳过档 ${s.skippedZone}`) },
      { text: '即便大量看答案，每天也有字可写、不会空', check: (s) => ok(s.emptyDays === 0, `空的天数 ${s.emptyDays}`) },
      { text: '看过答案的新字应能很快进入调度（20 天后，看过答案的字里至少一半已有判断）', check: (s, r) => { const seen = new Set(r.events.filter(e => e.action === 'seen').map(e => e.char)); const judged = new Set(r.events.filter(e => e.action === 'judged').map(e => e.char)); const both = [...seen].filter(c => judged.has(c)).length; return ok(seen.size === 0 || both / seen.size >= 0.5, `看过答案的字 ${seen.size} 个，其中后来写过判断的 ${both} 个`); } },
    ],
  },
  {
    id: 'S8-year-memory',
    name: '一年长跑（365 天，每天一组，按真实遗忘曲线作答）',
    days: 365,
    user: { hintRate: 0.05, answerRate: 0.03, skipRate: 0.01 },
    memory: { s0: 2.2, gain: 12, fail: 0.4 },
    seed: 11,
    expect: [
      { text: '到期字不堆积：最后 30 天，一天开始时到期未写的字平均 ≤ 15', check: (s) => ok(s.backlogTailMean <= 15, `最后 30 天平均 ${s.backlogTailMean}，最多 ${s.backlogTailMax}`) },
      wrongBack(0.8),
      { text: '每天负担恒定 5 个字（不会越来越重）', check: (s, r) => ok(s.cardsPerDayMax <= 5, `每天最多 ${s.cardsPerDayMax}`) },
      { text: '复习写对率接近设定的 90%（85–95%）——间隔设得对，用户在到期时应该大致 9 成记得', check: (s) => ok(s.reviewCorrectRate >= 0.85 && s.reviewCorrectRate <= 0.95, `实际 ${pct(s.reviewCorrectRate)}（用户模型预测 ${pct(s.memStats && s.memStats.predicted)}）`) },
      { text: '没有字逾期超过 60 天', check: (s) => ok(s.maxOverdueSeen <= 60, `最长逾期 ${s.maxOverdueSeen} 天`) },
      { text: '一年累计学到至少 500 个字', check: (s) => ok(s.recorded >= 500, `已练汉字 ${s.recorded}`) },
      { text: '字库里「已熟悉」占比随时间上升（年末已熟悉 > 已练的 30%）', check: (s) => ok(s.zones.known / s.recorded > 0.3, `三档 ${s.zones.due}/${s.zones.shaky}/${s.zones.known}，已练 ${s.recorded}`) },
    ],
  },
  {
    id: 'S9-year-three-groups',
    name: '一年长跑 · 每天三组（120 天，按真实遗忘曲线作答）',
    days: 120,
    groupsPerDay: 3,
    memory: { s0: 2.2, gain: 12, fail: 0.4 },
    seed: 5,
    expect: [
      { text: '每天最多 15 个字', check: (s) => ok(s.cardsPerDayMax <= 15, `每天最多 ${s.cardsPerDayMax}`) },
      { text: '积压不失控（最后 30 天平均 ≤ 15）', check: (s) => ok(s.backlogTailMean <= 15, `平均 ${s.backlogTailMean}，最多 ${s.backlogTailMax}`) },
      { text: '复习写对率 85–95%', check: (s) => ok(s.reviewCorrectRate >= 0.85 && s.reviewCorrectRate <= 0.95, `实际 ${pct(s.reviewCorrectRate)}`) },
      { text: '不出现「待复习」比已练多一半以上的情况（档位不失衡）', check: (s) => ok(s.zones.due <= s.recorded * 0.5, `三档 ${s.zones.due}/${s.zones.shaky}/${s.zones.known}`) },
    ],
  },
  {
    id: 'S10-legacy-import',
    name: 'v1 老用户迁移后接着练（160 个旧字，70 天旧记录 → 练 30 天）',
    days: 30,
    setup: legacySetup,
    seed: 21,
    expect: [
      { text: '迁移过来的字按旧到期日正常出现（一开始就有一批到期字，第 1 组里有复习）', check: (s, r) => ok(r.days[0].dueCards + r.days[0].earlyCards >= 1, `第 1 天复习字 ${r.days[0].dueCards + r.days[0].earlyCards}，开始时积压 ${r.days[0].backlogStart}`) },
      { text: '迁移后第 1 天不应重新走「首练 3 字」（用户已有大量记录）', check: (s, r) => ok(r.groups[0].kind === 'daily', `第 1 组类型：${r.groups[0].kind}`) },
      { text: '迁移后的积压要在一个月内消化一半以上（最后 10 天积压平均 ≤ 第 1 天的一半）', check: (s, r) => { const tail = r.days.slice(-10); const m = tail.reduce((a, d) => a + d.backlogStart, 0) / tail.length; return ok(m <= r.days[0].backlogStart / 2, `第 1 天积压 ${r.days[0].backlogStart}，最后 10 天平均 ${m.toFixed(1)}`); } },
      { text: '旧数据不让一天的字数超过 5', check: (s) => ok(s.cardsPerDayMax <= 5, `每天最多 ${s.cardsPerDayMax}`) },
      { text: '迁移的旧字不应在 30 天内被积压压住（最后 10 天积压平均不高于第 1 天）', check: (s, r) => { const tail = r.days.slice(-10); const m = tail.reduce((a, d) => a + d.backlogStart, 0) / tail.length; return ok(m <= r.days[0].backlogStart + 2, `第 1 天积压 ${r.days[0].backlogStart}，最后 10 天平均 ${m.toFixed(1)}`); } },
      { text: '字库三档合计仍 = 已练汉字（迁移记录没有会话 id 也不影响）', check: (s) => ok(!s.violations['D1-zones-sum'] && !s.violations['D2-recorded-eq-judged'], '见不变量表') },
    ],
  },
  {
    id: 'S11-budget-fold',
    name: '折叠月份：把记录预算压到很小，逼最旧月份折叠，对比不折叠的同一用户（150 天）',
    days: 150,
    budgets: { recordsBudgetBytes: 60000 },
    seed: 8,
    baseline: { budgets: null },
    expect: [
      { text: '折叠不应改变后续选字：逐天逐组与不折叠的同一用户完全一致', check: (s, r, base) => { if (!base) return ok(false, '无基线'); let diff = 0; let first = null; for (let i = 0; i < r.groups.length; i += 1) { const a = r.groups[i].queue.map(q => q.char).join(''); const b = base.groups[i] ? base.groups[i].queue.map(q => q.char).join('') : null; if (a !== b) { diff += 1; if (!first) first = `第 ${r.groups[i].dayIdx + 1} 天 折叠:${a} / 不折叠:${b}`; } } return ok(diff === 0, diff ? `${diff} 组不同，首个：${first}` : '全部一致'); } },
      { text: '折叠后已练汉字数不变', check: (s, r, base) => ok(base && s.recorded === base.summary.recorded, `折叠 ${s.recorded} / 不折叠 ${base ? base.summary.recorded : '?'}`) },
    ],
  },
  {
    id: 'S12-clock-back',
    name: '改系统时间：练 20 天后把时间拨回 5 天，再练 10 天',
    days: 30,
    events: [{ day: 20, type: 'clock', shiftDays: -5 }],
    expect: [
      { text: '拨回后不崩溃，每天仍有字可写', check: (s) => ok(s.emptyDays === 0, `空的天数 ${s.emptyDays}`) },
      { text: '拨回后，已写过的字不会因为「日期倒退」被当成新字重复出现', check: (s) => ok(!s.violations['G5-new-never-judged'], JSON.stringify(s.violations['G5-new-never-judged'] || '无')) },
      { text: '拨回后的那几天，已经写过（判断记录日期更晚）的字不被当作「今天写过」而漏掉复习，也不报错', check: (s, r) => ok(r.days.slice(20).every(d => d.cards > 0), r.days.slice(18, 28).map(d => d.day + ':' + d.cards).join(' ')) },
      { text: '拨回后三档合计仍 = 已练', check: (s) => ok(!s.violations['D1-zones-sum'], '见不变量表') },
      { text: '拨回后每一次「写对 / 写错」都能存上（不出现提交失败）', check: (s) => ok(!s.violations['X1-judge-commit-fails'], s.violations['X1-judge-commit-fails'] ? s.violations['X1-judge-commit-fails'].samples.join('；') : '无') },
    ],
  },
  {
    id: 'S13-clock-forward',
    name: '改系统时间：练 15 天后把时间拨快 40 天，再拨回，各练 5 天',
    days: 30,
    events: [{ day: 15, type: 'clock', shiftDays: 40 }, { day: 20, type: 'clock', shiftDays: -40 }],
    expect: [
      { text: '拨快 40 天后，字全部到期但一组仍是 3 个字（D48 ⑧ 回来的第一组）', check: (s, r) => ok(r.days[15].cards === 3, `拨快当天 ${r.days[15].cards} 个字；积压 ${r.days[15].backlogStart}`) },
      { text: '拨快、拨回后不产生重复判断 / 提交失败等违反（D6 / W1 / P4 是各场景通有的，另计）', check: (s) => ok(timeViolations(s).length === 0, JSON.stringify(timeViolations(s))) },
      { text: '拨回后，拨快时写过的字（判断日期在「未来」）不应让今天的组少于 5 个字', check: (s, r) => ok(r.days.slice(20).every(d => d.cards >= 5), r.days.slice(20).map(d => d.cards).join('、')) },
    ],
  },
  {
    id: 'S14-timezone',
    name: '换时区：每天固定同一绝对时刻练，第 10 天从上海飞到夏威夷（日期倒退一天），第 20 天飞回',
    days: 30,
    fixedUtcHour: 20, // 上海次日 04:00 / 夏威夷当日 10:00
    events: [{ day: 10, type: 'tz', tz: 'Pacific/Honolulu' }, { day: 20, type: 'tz', tz: 'Asia/Shanghai' }],
    expect: [
      { text: '换时区后每天仍有字可写', check: (s) => ok(s.emptyDays === 0, `空的天数 ${s.emptyDays}`) },
      { text: '日期倒退一天、同一个日期练了两次时，同一个字当天不会被判断两次', check: (s, r) => { const seen = new Map(); let dup = 0; for (const e of r.events) { if (e.action !== 'judged') continue; const k = e.day + e.char; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) === 2) dup += 1; } const byDay = {}; for (const d of r.days) byDay[d.day] = (byDay[d.day] || 0) + 1; const rep = Object.entries(byDay).filter(([, n]) => n > 1).map(([d]) => d); return ok(dup === 0, `同一日期练了两次：${rep.join('、') || '无'}；同一天被判断两次的字 ${dup} 个`); } },
      { text: '换时区不引起违反不变量（D6 / W1 / P4 另计）', check: (s) => ok(timeViolations(s).length === 0, JSON.stringify(timeViolations(s))) },
    ],
  },
  {
    id: 'S15-cross-midnight',
    name: '跨午夜：每天 23:58 开始写一组，写到过了 0 点（14 天）',
    days: 14,
    hour: 23,
    minute: 58,
    expect: [
      { text: '过了 0 点的字记在新的一天，但这一组仍写完（不被「跨天过期」切掉）', check: (s, r) => ok(r.days.slice(1).every(d => d.cards >= 5), r.days.map(d => d.cards).join('、')) },
      { text: '第二天不会因为「昨天的组跨天」出现重复或遗漏（D6 / W1 / P4 另计）', check: (s) => ok(timeViolations(s).length === 0, JSON.stringify(timeViolations(s))) },
    ],
  },
  {
    id: 'S16-quit-midway',
    name: '每天写到一半就退出（一半的天数），第二天重来（30 天）',
    days: 30,
    user: { partialRate: 0.6 },
    expect: [
      { text: '没写完的组第二天直接作废，第二天重新选一组完整的字（每组都是 5 个字，首练除外）', check: (s, r) => ok(r.groups.every(g => g.size === 5 || g.kind === 'first' || g.size === 3), `各组大小：${[...new Set(r.groups.map(g => g.size))].join('、')}`) },
      { text: '没写的字不算记录也不算跳过（D22）：没写的字在那一组里没有任何记录', check: (s, r) => { const recs = Object.values(r.state.records).flatMap(m => (Array.isArray(m) ? m : m.kept || [])); let bad = 0; let n = 0; for (const g of r.groups) for (const c of g.unwritten) { n += 1; if (recs.some(x => x.sessionId === g.sessionId && x.char === c)) bad += 1; } return ok(bad === 0, `共 ${n} 个没写的字，其中被记了记录的 ${bad} 个`); } },
      { text: '没写的字后来还会出现（它们仍是新字 / 到期字）：没写的新字，一周内被写到的比例 ≥ 70%', check: (s, r) => { const written = new Map(); for (const e of r.events) { if (!written.has(e.char)) written.set(e.char, []); written.get(e.char).push(e.dayIdx); } const lastDay = r.days.length - 1; let n = 0; let back = 0; for (const g of r.groups) { for (const c of g.unwritten) { if (g.dayIdx + 7 > lastDay) continue; const days = written.get(c) || []; if (days.some(d => d > g.dayIdx)) { /* 之后出现 */ } n += 1; if (days.some(d => d > g.dayIdx && d <= g.dayIdx + 7)) back += 1; } } return ok(n === 0 || back / n >= 0.7, `${n} 个没写的字，一周内又写到的 ${back} 个（${n ? pct(back / n) : '—'}）`); } },
    ],
  },
  {
    id: 'S17-picked-daily',
    name: '每天写一组 + 每天自己再选 2 个新字来写（「练这个字」B 组，30 天）',
    days: 30,
    events: Array.from({ length: 30 }, (_, i) => ({ day: i, type: 'pick', n: 2, offset: 6 + i * 2 })),
    expect: [
      { text: '自选写过的字当天不再进今天的练习（同一天不重复）', check: (s) => ok(!s.violations['G3-not-judged-today'], '见不变量表') },
      { text: '自选字也计入已练汉字与三档', check: (s) => ok(!s.violations['D1-zones-sum'] && !s.violations['D2-recorded-eq-judged'], '见不变量表') },
      { text: '自选不应让日常的新字配比失衡：自选后，日常一天的新字仍 ≤ 3', check: (s, r) => ok(r.groups.filter(g => g.slot === 'A' && g.kind === 'daily').every(g => g.queue.filter(q => q.src === 'new' || q.src === 'warm-new').length <= 3), '日常组新字数 ≤ 3') },
    ],
  },
  {
    id: 'S18-always-hint',
    name: '每个字（新字和复习）都点提示、都写对，对比只在新字时点提示的同一用户（30 天）',
    days: 30,
    user: { hintRate: 1, hintCorrect: 1, accuracy: 1, newAccuracy: 1, difficultyPenalty: 0, answerRate: 0, skipRate: 0 },
    expect: [
      { text: '同样是复习、同样按时写对（新字第一次都带提示）：复习时带提示的，下次间隔比不带提示的短（产品直觉：要提示才写出来，记得没那么牢；热身字另有规则，已排除）', check: (s, r, base) => { const m = (rr) => { const xs = rr.events.filter(e => e.slot === 'A' && e.action === 'judged' && e.judgment === 'correct' && e.reps === 2 && ['due', 'early'].includes(e.src) && !isWarmupKey('base:' + e.char) && e.intervalDays !== '').map(e => e.intervalDays); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }; const a = m(r); const b = base ? m(base) : null; return ok(a !== null && b !== null && a < b, `第一次复习（第 2 次判断）后的平均下次间隔（不含热身字）：复习时也带提示 ${a === null ? '—' : a.toFixed(1)} 天 / 复习时不带提示（基线）${b === null ? '—' : b.toFixed(1)} 天`); } },
    ],
    baseline: { user: { hintRate: 1, hintRateReview: 0, hintCorrect: 1, accuracy: 1, newAccuracy: 1, difficultyPenalty: 0, answerRate: 0, skipRate: 0 } },
  },
  {
    id: 'S19-away-90d',
    name: '停用 90 天回来：练 60 天后 90 天不打开 App，再回来练 60 天（每天一组，按真实遗忘曲线作答）',
    days: 210,
    restDays: [{ from: 60, to: 149 }],
    user: { hintRate: 0.05, answerRate: 0.03, skipRate: 0.01 },
    memory: { s0: 2.2, gain: 12, fail: 0.4 },
    seed: 13,
    expect: [
      { text: '回来当天「待复习」不是几百个（一天的量附近，≤ 每组字数的 1.5 倍）', check: (s, r) => { const d = r.days[150]; return ok(d.zoneDue <= 30, `回来当天结束：待复习 ${d.zoneDue}、开始时积压 ${d.backlogStart}`); } },
      { text: '回来后第一个月有新字（不是一个月全复习）：回来后 30 天新字 ≥ 60 个', check: (s, r) => { const w = r.days.slice(150, 180); const n = w.reduce((a, d) => a + d.newCards, 0); return ok(n >= 60, `回来后 30 天新字 ${n} 个（每天 ${w.map(d => d.newCards).join('、')}）`); } },
      { text: '回来 12 天后积压回到一天的量以内（≤ 20）', check: (s, r) => ok(r.days[161].backlogStart <= 20, `回来第 1 / 12 / 30 天开始时积压 ${r.days[150].backlogStart} / ${r.days[161].backlogStart} / ${r.days[179].backlogStart}`) },
    ],
  },
  {
    id: 'S20-library-exhausted',
    name: '练习范围学完：少见字、每组 30 字、每天三组（120 天）',
    days: 120,
    library: 'rare',
    groupSize: 30,
    groupsPerDay: 3,
    seed: 17,
    expect: [
      { text: '范围学完后不再用提前复习凑满一组：学完之后提前复习占字次 ≤ 10%', check: (s, r) => { const x = r.days.findIndex(d => d.exhausted); if (x < 0) return ok(false, '120 天内没学完'); const after = r.days.slice(x).filter(d => d.practiced); const all = after.reduce((a, d) => a + d.cards, 0); const early = after.reduce((a, d) => a + d.earlyCards, 0); return ok(all === 0 || early / all <= 0.1, `第 ${x + 1} 天学完；之后提前复习 ${early}/${all} 字次（${all ? pct(early / all) : '—'}）；有字可写的天 ${after.filter(d => d.cards > 0).length}、「没有要写的字」的天 ${after.filter(d => d.empty).length}`); } },
    ],
  },
];
