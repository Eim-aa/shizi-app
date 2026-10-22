// r7-S1：出题与复习调度的不变量（只读调用 src/core 与字库页模型，不改源码）。
// 做法：用 scripts/sim 的模拟引擎跑几个短场景（虚拟用户按天练习，选字 / 判断 / 跳过 / 撤销全走真实代码），
// 再逐条断言不变量。当前就不成立的不变量用 { todo } 标注（测试照跑，失败不算红），并在 docs/qa/调度问题清单.md 里登记；
// 修好以后 todo 测试会自动变绿，到时去掉 todo 标记即可。
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../../scripts/sim/lib/engine.mjs';
import { INVARIANTS } from '../../scripts/sim/lib/invariants.mjs';
import { bootDeck } from '../../scripts/sim/lib/env.mjs';
import { reviewCard } from '../../src/core/fsrs.js';
import { addDays, dayStartMs } from '../../src/core/dates.js';
import { memoryZones, skippedZone } from '../../src/session/views/library.js';
import { makeRecord } from '../../src/core/records.js';

bootDeck();

const HOUR = 3600000;
const only = (res, ids) => res.violations.filter(v => ids.includes(v.id));
const show = (list) => list.slice(0, 5).map(v => `${v.id} ${v.day}: ${v.detail}`).join('\n');

// 同一批场景只跑一次，各测试共用。这些场景按 5 字一组（「我的 › 每组字数」选 5，D65 #2）；缺省 20 字一组的另见 BIG。
const G5 = { groupSize: 5 };
const MIXED = runScenario({ id: 't-mixed', days: 45, seed: 3, probeRate: 0.15, ...G5 });
const THREE = runScenario({ id: 't-three', days: 25, groupsPerDay: 3, seed: 4, probeRate: 0.1, ...G5 });
const SWITCH = runScenario({
  id: 't-switch', days: 30, seed: 5, ...G5,
  events: [{ day: 10, type: 'library', library: 'adv3000' }, { day: 20, type: 'library', library: 'core3500' }],
});
const PICKED = runScenario({ id: 't-picked', days: 20, seed: 6, ...G5, events: Array.from({ length: 20 }, (_, i) => ({ day: i, type: 'pick', n: 2, offset: 6 + i * 2 })) });
const SEEN = runScenario({ id: 't-seen', days: 8, groupsPerDay: 2, seed: 7, ...G5, user: { answerRate: 0.4, skipRate: 0.3 } });
const WRONG = runScenario({ id: 't-wrong', days: 10, seed: 8, ...G5, user: { accuracy: 0.02, newAccuracy: 0.02, hintRate: 0, answerRate: 0, skipRate: 0, difficultyPenalty: 0 } });
const AWAY = runScenario({ id: 't-away', days: 36, seed: 9, ...G5, restDays: [{ from: 15, to: 24 }], user: { hintRate: 0, answerRate: 0, skipRate: 0 } });
// 缺省（没选过每组字数 = 20）；第 20 天改成 30、第 30 天改成 10（改了只影响之后开的组）
const BIG = runScenario({ id: 't-big', days: 40, seed: 10, probeRate: 0.1, events: [{ day: 20, type: 'groupSize', groupSize: 30 }, { day: 30, type: 'groupSize', groupSize: 10 }] });

test('模拟引擎本身跑得动，且每天都有字可写', () => {
  for (const r of [MIXED, THREE, SWITCH, PICKED, SEEN, WRONG]) {
    assert.ok(r.days.length > 0);
    assert.equal(r.days.filter(d => d.empty).length, 0, r.cfg.id);
  }
});

// ---------------------------------------------------------------- 一组怎么选

test('G1 同一组内不重复；G2 组不超过上限（首练 3、其后 = 每组字数）', () => {
  for (const r of [MIXED, THREE, SWITCH, PICKED, SEEN, WRONG, AWAY, BIG]) {
    assert.deepEqual(only(r, ['G1-no-dup-in-group', 'G2-group-size']), [], show(only(r, ['G1-no-dup-in-group', 'G2-group-size'])));
    for (const g of r.groups) {
      if (g.slot !== 'A') continue;
      const chars = g.queue.map(q => q.char);
      assert.equal(new Set(chars).size, chars.length);
      const limit = g.kind === 'first' ? 3 : r === BIG ? (g.dayIdx >= 30 ? 10 : g.dayIdx >= 20 ? 30 : 20) : 5;
      assert.ok(chars.length <= limit, `${g.day} 第 ${g.group + 1} 组 ${chars.join('')}`);
    }
  }
});

test('G3 今天已判断过的字，今天不会再被选进新的一组（含一天三组、自选后）', () => {
  for (const r of [THREE, PICKED, MIXED]) assert.deepEqual(only(r, ['G3-not-judged-today']), [], show(only(r, ['G3-not-judged-today'])));
});

test('G4 新字都在当前练习范围内；G5 新字之前没有判断记录；G11 新字按既定顺序', () => {
  const ids = ['G4-new-in-library', 'G5-new-never-judged', 'G11-new-in-order'];
  for (const r of [MIXED, SWITCH, PICKED, THREE]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
  // 切到次常用字以后，新字真的来自次常用字（而不是一直停在常用字）
  const fresh = SWITCH.groups.filter(g => g.slot === 'A' && g.dayIdx >= 11 && g.dayIdx < 20).flatMap(g => g.queue.filter(q => q.src === 'new').map(q => q.char));
  assert.ok(fresh.length > 0);
});

test('G6 到期字确实到期；G7 提前复习的字确实未到期；G8 热身字至多 1 个', () => {
  const ids = ['G6-due-really-due', 'G7-early-not-due', 'G8-one-warmup'];
  for (const r of [MIXED, THREE, AWAY, WRONG]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
});

test('G9 有到期字时不会被完全挤出；G10 每日复习不超上限', () => {
  const ids = ['G9-due-not-starved', 'G10-daily-cap'];
  for (const r of [MIXED, THREE, AWAY, WRONG]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
});

test('每天负担有上限：每组 ≤ 每组字数，每天 ≤ 组数 × 每组字数；缺省 20 字一组时日常组就是 20 个字，改了每组字数下一组就按新值', () => {
  for (const r of [MIXED, WRONG, AWAY]) assert.ok(r.days.every(d => d.cards <= 5 || d.dayIdx === 0), r.cfg.id);
  assert.ok(THREE.days.every(d => d.cards <= 15));
  const daily = BIG.groups.filter(g => g.slot === 'A' && g.kind !== 'first' && !g.special);
  // 第 2、3 天是新用户新字封顶（D66 ⑫：每组新字至多 8 个，组可以不满），第 4 天起每组 20 字
  assert.ok(daily.filter(g => g.dayIdx > 2 && g.dayIdx < 20).every(g => g.queue.length === 20), daily.slice(0, 5).map(g => g.queue.length).join(','));
  assert.ok(daily.filter(g => g.dayIdx >= 1 && g.dayIdx <= 2).every(g => g.queue.filter(q => q.src === 'new' || q.src === 'warm-new').length <= 8));
  assert.ok(daily.filter(g => g.dayIdx >= 20 && g.dayIdx < 30).every(g => g.queue.length === 30));
  assert.ok(daily.filter(g => g.dayIdx >= 30).every(g => g.queue.length === 10));
  const ids = ['G1-no-dup-in-group', 'G2-group-size', 'G3-not-judged-today', 'G4-new-in-library', 'G5-new-never-judged', 'G6-due-really-due', 'G7-early-not-due', 'G9-due-not-starved', 'G10-daily-cap', 'G11-new-in-order', 'D1-zones-sum', 'D2-recorded-eq-judged', 'P1-skip-undo-restores', 'P2-correction-roundtrip', 'P3-skip-seen-no-sched', 'P4-skip-seen-not-reoffered-today', 'X1-judge-commit-fails'];
  assert.deepEqual(only(BIG, ids), [], show(only(BIG, ids)));
  const { share } = wrongNextDayShare(BIG);
  assert.ok(share >= 0.9, `20 字一组：写错后第二天再见到 ${share}`);
});

test('离开 ≥ 7 天回来的第一组缩短为 3 个字，之后恢复 5 个', () => {
  const back = AWAY.days[25];
  assert.equal(back.cards, 3, `回来第一天 ${back.cards}`);
  assert.ok(AWAY.days.slice(26).every(d => d.cards === 5));
});

// ---------------------------------------------------------------- 字库三档 / 已练 / 跳过

test('D1 三档合计 = 已练汉字；D2 已练 = 有判断的不同汉字；D3 已跳过不计入已练；D4 / D5 调度表自洽', () => {
  const ids = ['D1-zones-sum', 'D2-recorded-eq-judged', 'D3-skipped-not-practiced', 'D4-sched-has-judged', 'D5-due-after-judged-day'];
  for (const r of [MIXED, THREE, SEEN, PICKED, SWITCH]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
});

test('跳过不计入已练：只有跳过记录的字 recorded = 0，且出现在「已跳过」里', () => {
  const rec = makeRecord({ id: 'r1', cardKey: 'base:鲜', sessionId: 's1', kind: 'skipped', at: Date.parse('2026-03-02T12:00:00Z'), help: { hints: 0 } });
  const state = { records: { '2026-03': [rec] }, sched: {}, sessions: { A: null, B: null, lastEnded: {} } };
  const z = memoryZones(state, rec.localDay);
  assert.equal(z.recorded, 0);
  assert.equal(z.zones.due.n + z.zones.shaky.n + z.zones.known.n, 0);
  assert.equal(skippedZone(state).n, 1);
});

test('D7 用户每天都练时，没有字逾期超过 60 天', () => {
  for (const r of [MIXED, THREE, WRONG]) assert.deepEqual(only(r, ['D7-due-not-starved-long']), []);
});

// ---------------------------------------------------------------- 撤销 / 更正 / 跳过 / 看答案

test('P1 撤销跳过后状态与没跳过一致；P2 结果页改过去再改回来，调度表不变；P3 跳过 / 看答案不改调度表', () => {
  const ids = ['P1-skip-undo-restores', 'P2-correction-roundtrip', 'P3-skip-seen-no-sched'];
  for (const r of [MIXED, THREE, SEEN]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
  const probes = [MIXED, THREE, SEEN].reduce((a, r) => ({ undo: a.undo + r.probes.skipUndo.n, corr: a.corr + r.probes.correction.n }), { undo: 0, corr: 0 });
  assert.ok(probes.undo >= 3 && probes.corr >= 3, `探针次数太少：撤销 ${probes.undo}、更正 ${probes.corr}`);
});

test('跳过 / 看答案的字不产生判断记录，也不进入调度表（只读核对）', () => {
  const recs = Object.values(SEEN.state.records).flatMap(m => (Array.isArray(m) ? m : m.kept || []));
  const judgedKeys = new Set(recs.filter(r => r.kind === 'judged').map(r => r.cardKey));
  for (const key of Object.keys(SEEN.state.sched)) assert.ok(judgedKeys.has(key), key + ' 在调度表里却没有判断记录');
});

// ---------------------------------------------------------------- 提醒

test('R1 提醒题目在对应那天已到期且能练；R2 写错过的先于只是到期的', () => {
  const ids = ['R1-reminder-target-due', 'R2-reminder-wrong-first'];
  for (const r of [MIXED, WRONG, AWAY]) assert.deepEqual(only(r, ids), [], show(only(r, ids)));
});

// ---------------------------------------------------------------- 当前不成立的不变量（todo：已在问题清单登记，修好后去掉 todo）

test('P4 刚跳过 / 刚看过答案的字，当天再开一组时不会立刻又出现；跳过的新字推迟几天、不总排在最前（D65 #5）', () => {
  assert.deepEqual(only(SEEN, ['P4-skip-seen-not-reoffered-today']), [], show(only(SEEN, ['P4-skip-seen-not-reoffered-today'])));
  assert.deepEqual(only(THREE, ['P4-skip-seen-not-reoffered-today']), [], show(only(THREE, ['P4-skip-seen-not-reoffered-today'])));
  // 跳过的新字：跳过那天起 skipNewDeferDays 天内不再被当作新字选出（之后才回来）
  const skipped = new Map(); // char → 第一次跳过的 dayIdx（当时是新字）
  for (const e of SEEN.events) if (e.slot === 'A' && e.action === 'skip' && e.src === 'new' && !skipped.has(e.char)) skipped.set(e.char, e.dayIdx);
  assert.ok(skipped.size > 0, '场景里应有跳过的新字');
  for (const [ch, d] of skipped) {
    const again = SEEN.events.find(e => e.char === ch && e.dayIdx > d && e.src === 'new');
    if (again) assert.ok(again.dayIdx - d >= 7, `「${ch}」第 ${d} 天跳过，第 ${again.dayIdx} 天又作新字出现`);
  }
});

// W1（D65 #1）：严格的「每一个写错的字第二天都回来」做不到（成熟的字写错，FSRS 给的下次可能是 9 天后；一天全错时写错的字比一组还多），
// 所以断言比例：第二天也练时，写错的字第二天就再见到的比例。修之前（只按逾期天数排）：混合 29%、一天三组 38%、天天全错 21%。
function wrongNextDayShare(r) {
  const byDay = new Map();
  for (const e of r.events) {
    if (!byDay.has(e.dayIdx)) byDay.set(e.dayIdx, []);
    byDay.get(e.dayIdx).push(e);
  }
  let n = 0;
  let back = 0;
  for (const e of r.events) {
    if (e.action !== 'judged' || e.judgment !== 'wrong' || e.slot !== 'A') continue;
    const next = byDay.get(e.dayIdx + 1);
    if (!next) continue;
    n += 1;
    if (next.some(x => x.char === e.char)) back += 1;
  }
  return { n, share: n ? back / n : 1 };
}

test('W1 写错的字，第二天（如果第二天也练）大多会再出现：写错优先 + 每组保底（D65 #1）', () => {
  for (const [r, min] of [[MIXED, 0.9], [THREE, 0.9], [WRONG, 0.7]]) {
    const { n, share } = wrongNextDayShare(r);
    assert.ok(n >= 10, `${r.cfg.id} 写错次数太少：${n}`);
    assert.ok(share >= min, `${r.cfg.id} 写错后第二天再见到 ${Math.round(share * 1000) / 10}%（要求 ≥ ${min * 100}%）\n` + show(only(r, ['W1-wrong-returns-next-day'])));
  }
});

test('D6 一天开始时，字库「待复习」档 = 首页今日练习的到期字', { todo: '问题清单 #6：待复习档按「最近一次写错」也算，写错但还没到期的字只在字库里显示为待复习' }, () => {
  assert.deepEqual(only(MIXED, ['D6-zone-due-matches-plan']), [], show(only(MIXED, ['D6-zone-due-matches-plan'])));
});

test('X1 系统时间被拨回很多天后，判断仍能存上，稳定度不会掉到接近 0（D65 #3：判断时刻夹到上次复习）', () => {
  const t0 = dayStartMs('2026-03-10') + 20 * HOUR;
  const first = reviewCard(null, { judgment: 'correct', at: t0, help: { hints: 0 }, cardKey: 'base:鲜' });
  const same = reviewCard(first.card, { judgment: 'correct', at: t0, help: { hints: 0 }, cardKey: 'base:鲜' });
  for (const back of [1, 5, 30, 400]) {
    const at = t0 - back * 24 * HOUR;
    const r = reviewCard(first.card, { judgment: 'correct', at, help: { hints: 0 }, cardKey: 'base:鲜' });
    assert.ok(r.card.stability >= 1, `拨回 ${back} 天后稳定度 ${r.card.stability}`);
    // 负间隔按 0：与「在上次复习的同一时刻再写对一次」得到同一张卡
    assert.equal(r.card.stability, same.card.stability, `拨回 ${back} 天`);
    assert.equal(r.clockBackMs, back * 24 * HOUR);
    assert.ok(r.due > addDays(new Date(at).toISOString().slice(0, 10), 0), '下次到期至少是判断那天的次日');
  }
  // 写错同样能存上
  const wrong = reviewCard(first.card, { judgment: 'wrong', at: t0 - 30 * 24 * HOUR, help: { hints: 0 }, cardKey: 'base:鲜' });
  assert.ok(wrong.card.stability > 0.1);
  // 模拟里「拨回 5 天」的场景不再有提交失败
  const BACK = runScenario({ id: 't-back', days: 30, seed: 1, events: [{ day: 20, type: 'clock', shiftDays: -5 }] });
  assert.deepEqual(only(BACK, ['X1-judge-commit-fails']), [], show(only(BACK, ['X1-judge-commit-fails'])));
});

test('P5 同一个字、同样按时复习：带提示写对的下次间隔比无提示写对的短，提示越多越短（D65 #4；D66 ② 复习 2 次起 Again）', () => {
  const t0 = dayStartMs('2026-03-10') + 20 * HOUR;
  const first = reviewCard(null, { judgment: 'correct', at: t0, help: { hints: 0 }, cardKey: 'base:鲜' });
  const at = Date.parse(first.card.due);
  const iv = (hints) => reviewCard(first.card, { judgment: 'correct', at, help: { hints }, cardKey: 'base:鲜' });
  const clean = iv(0);
  const [h1, h2, h3, h4] = [iv(1), iv(2), iv(3), iv(4)];
  assert.equal(clean.rating, 'Good');
  assert.ok(h1.card.scheduled_days < clean.card.scheduled_days, `带提示 1 次 ${h1.card.scheduled_days} 天 / 无提示 ${clean.card.scheduled_days} 天`);
  // D66 ②：复习时 2 次起（一半以上的笔画）就是 Again，与 3 次、写错同一档
  assert.ok(h2.card.scheduled_days < h1.card.scheduled_days, `2 次 ${h2.card.scheduled_days} / 1 次 ${h1.card.scheduled_days}`);
  assert.equal(h2.rating, 'Again');
  assert.equal(h3.rating, h2.rating, '3 次与 2 次同一档（Again）');
  assert.equal(h4.rating, h3.rating, '整字给完（4 段）与 3 段同一档：按看过答案口径，明天再来');
  assert.equal(h4.card.scheduled_days <= 1, true);
  // 新字第一次：带提示写对仍会再出现（不是「几乎不再出现」，也不是每次都按写错）：1 次 → 约 2 天、比无提示（Easy）短
  const fresh = (hints) => reviewCard(null, { judgment: 'correct', at: t0, help: { hints }, cardKey: 'base:鲜' });
  assert.equal(fresh(1).rating, 'Good');
  assert.ok(fresh(1).card.scheduled_days < first.card.scheduled_days);
  assert.ok(fresh(1).card.scheduled_days >= 1 && fresh(1).card.stability > 1, '第一次带 1 次提示写对：初始稳定度约 2 天');
  assert.ok(fresh(2).card.scheduled_days <= fresh(1).card.scheduled_days);
});

test('不变量清单与报告一致（每条都有编号与说明）', () => {
  assert.ok(INVARIANTS.length >= 20);
  for (const i of INVARIANTS) assert.ok(i.id && i.title);
  assert.equal(addDays('2026-03-02', 1), '2026-03-03');
});
