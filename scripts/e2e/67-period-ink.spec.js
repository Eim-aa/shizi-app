// 决定-D42（解 03 P122）：按时间段取「某一次」笔迹的页面，在该时间段内按偏好顺序找留有墨迹的那一次。
//
// 造数（真实 mutator judgeInDraft，perRecordInk 开：D27 每字只留第一次与最近一次的墨迹，中间几次在写下一次时回收）：
//   「静」8-05 首次、9-01、9-08、9-22 各写一次（墨迹都存了，随后 9-01 / 9-08 被回收，留 8-05 与 9-22）；
//   「谁」9-08 一次；「数」9-10 一次但没存墨迹；
//   「题」1-10 首次（没存墨迹）、3-05、4-02（3-05 被回收）——年报第四节用。
// 断言：
//   1. 练习记录 9 月字帖：静 取 9-22 的本人笔迹（data-day / 角标 = 9-22、data-ink=true、record 是 9-22 那条），不再是 9-01「没有笔迹」；
//      数 本月没有任何墨迹 → 如实「没有笔迹」；练习记录 8 月字帖：静 取 8 月 5 日那次。
//   2. 我的首页本月字帖与练习记录同一取法（同一条记录）。
//   3. 9 月月图片：静 取 9-22、数 缺墨且说明句是「这个月没有」；8 月月图片 静 取 8-05（时间段外的墨迹不冒充）。
//   4. 这天写的字：9-08 那天 静 的唯一一次已回收 → 没有笔迹（不借 9-22），说明句「这天没有」；谁 有笔迹。
//   5. 年报第四节：字 = 今年最早记录的字 题（1-10 没存墨迹）→ 取今年里最早留有墨迹的 4-02，说明行是 4-02 的日子。
//   6. 浏览与做图不写任何东西（写日志为空）。
import { bootTestHost, tid, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const TOP = '.sz-layer[data-top="true"]';

const STEPS = [
  { char: '题', judgment: 'correct', day: '2026-01-10', ink: false },
  { char: '题', judgment: 'wrong', day: '2026-03-05', ink: true },
  { char: '题', judgment: 'correct', day: '2026-04-02', ink: true },
  { char: '静', judgment: 'correct', day: '2026-08-05', ink: true },
  { char: '静', judgment: 'correct', day: '2026-09-01', ink: true },
  { char: '静', judgment: 'wrong', day: '2026-09-08', ink: true },
  { char: '谁', judgment: 'correct', day: '2026-09-08', ink: true },
  { char: '数', judgment: 'correct', day: '2026-09-10', ink: false },
  { char: '静', judgment: 'correct', day: '2026-09-22', ink: true },
];

async function seed(page) {
  const res = await page.evaluate(async s => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(s.clock);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    s.steps.forEach((st, i) => {
      const at = new Date(`${st.day}T08:00:00`).getTime() + i * 1000;
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + st.char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: !!st.ink });
      draft.sessions.A = null;
    });
    if (!Object.keys(draft.ink).length) delete draft.ink;
    const r = window.__shiziTest.seed(draft);
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: !!(r && r.ok), r };
  }, { clock: `${TODAY}T09:00:00`, steps: STEPS });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

async function push(page, name, params) {
  await page.evaluate(async ({ n, p }) => (await import('/src/ui/router.js')).nav.push(n, p), { n: name, p: params });
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page, { settleMs: 450 });
}

async function back(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page, { settleMs: 450 });
}

async function cells(page, testid) {
  return page.evaluate(({ sel, id }) => [...document.querySelectorAll(`${sel} [data-testid="${id}"]`)].map(el => ({
    char: el.dataset.char, day: el.dataset.day, record: el.dataset.record, ink: el.dataset.ink, tag: el.dataset.tag })), { sel: TOP, id: testid });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await seed(page);
  const facts = await page.evaluate(() => {
    const T = window.__shiziTest;
    const st = T.getState();
    const judged = [];
    for (const list of Object.values(st.records || {})) for (const r of Array.isArray(list) ? list : list.kept || []) if (r.kind === 'judged') judged.push(r);
    judged.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return { judged: judged.map(r => ({ id: r.id, char: r.char, day: r.localDay, ink: !!T.getInk(r) })) };
  });
  const rec = (char, day) => facts.judged.find(r => r.char === char && r.day === day);
  const jing = ['2026-08-05', '2026-09-01', '2026-09-08', '2026-09-22'].map(d => rec('静', d));
  const writes0 = await page.evaluate(() => window.__shiziTest.getWriteLog().length);

  step('seed sanity: D27 kept only the first and latest ink of 静 / 题');
  assert.deepEqual(jing.map(r => r.ink), [true, false, false, true], '静: 8-05 and 9-22 keep ink; 9-01 / 9-08 were recycled');
  assert.deepEqual(['2026-01-10', '2026-03-05', '2026-04-02'].map(d => rec('题', d).ink), [false, false, true], '题: 1-10 never stored, 3-05 recycled, 4-02 kept');
  assert.equal(rec('数', '2026-09-10').ink, false, '数: no ink stored at all');
  assert.equal(rec('谁', '2026-09-08').ink, true, '谁: its only record keeps ink');

  step('练习记录 9 月字帖: 静 = 9-22 own ink (D42), 数 honestly 没有笔迹; 8 月字帖: 静 = the August one');
  await push(page, 'records', { month: '2026-09' });
  await page.waitForSelector(`${TOP} ${tid('records-sheet-cell')}`);
  const sep = await cells(page, 'records-sheet-cell');
  assert.deepEqual(sep.map(c => [c.char, c.day, c.record, c.ink, c.tag]), [
    ['静', '2026-09-22', jing[3].id, 'true', '2026-09-22'],
    ['谁', '2026-09-08', rec('谁', '2026-09-08').id, 'true', '2026-09-08'],
    ['数', '2026-09-10', rec('数', '2026-09-10').id, 'false', '2026-09-10'],
  ], 'September: 静 takes the month\'s ink-bearing record (9-22) with its own date tag; 数 has none in the month → 没有笔迹');
  assert.ok(await page.evaluate(sel => !!document.querySelector(`${sel} [data-testid="records-sheet-cell-ink"]`), TOP), 'the 静 cell paints ink');
  assert.equal(await page.evaluate(sel => document.querySelectorAll(`${sel} [data-testid="records-sheet-cell-noink"]`).length, TOP), 1, 'only 数 says 没有笔迹');
  await page.click(`${TOP} ${tid('records-prev')}`);
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="records-body"]`)?.dataset.month === '2026-08', TOP);
  await page.waitForSelector(`${TOP} ${tid('records-sheet-cell')}`);
  const aug = await cells(page, 'records-sheet-cell');
  assert.deepEqual(aug.map(c => [c.char, c.day, c.record, c.ink]), [['静', '2026-08-05', jing[0].id, 'true']], 'August keeps its own record (nothing borrowed from September)');

  step('这天写的字 (9-08): 静\'s only record that day was recycled → 没有笔迹, 9-22\'s ink is not borrowed');
  await page.click(`${TOP} ${tid('records-next')}`);
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="records-body"]`)?.dataset.month === '2026-09', TOP);
  await page.click(`${TOP} [data-testid="records-day"][data-day="2026-09-08"]`);
  await page.waitForSelector(`${TOP} ${tid('records-daylist-cell')}`);
  const day = await cells(page, 'records-daylist-cell');
  assert.deepEqual(day.map(c => [c.char, c.record, c.ink]), [['静', jing[2].id, 'false'], ['谁', rec('谁', '2026-09-08').id, 'true']], 'day list: same-day records only');
  await back(page);

  step('我的首页本月字帖: same pick as the practice log');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  await page.waitForSelector(`${TOP} ${tid('mine-sheet-cell')}`);
  await waitNavIdle(page);
  const mine = await cells(page, 'mine-sheet-cell');
  assert.deepEqual(mine.map(c => [c.char, c.day, c.record, c.ink]), sep.map(c => [c.char, c.day, c.record, c.ink]), 'mine sheet = practice-log September sheet');

  step('月图片: 9 月 静 = 9-22, 数 missing with the month sentence; 8 月 静 = 8-05; 这天图片 shows the day sentence');
  const jobs = await page.evaluate(async () => {
    const { buildImageJob } = await import('/src/ui/images-entry.js');
    const { t } = await import('/src/config/copy/index.js');
    const pick = job => ({ status: job.plan.status, drawn: job.plan.drawn.map(c => c.char).join(''), recordIds: job.plan.recordIds, missing: job.plan.missing.join(''),
      tags: job.plan.drawn.map(c => c.tag).join('|'), note: job.note, signature: job.signature });
    return {
      sep: pick(buildImageJob({ kind: 'month', month: '2026-09' })),
      aug: pick(buildImageJob({ kind: 'month', month: '2026-08' })),
      day: pick(buildImageJob({ kind: 'day', day: '2026-09-08' })),
      imageNote: t('R-I01.imageNote'),
    };
  });
  assert.deepEqual([jobs.sep.status, jobs.sep.drawn, jobs.sep.recordIds, jobs.sep.missing, jobs.sep.tags],
    ['ready', '静谁', [jing[3].id, rec('谁', '2026-09-08').id], '数', '9·22|9·8'], 'September image: 静 from 9-22, tags follow the picked records');
  assert.equal(jobs.sep.note, '「数」这个月没有留下笔迹，不在图里。' + jobs.imageNote, 'month sentence: none in the whole month');
  assert.equal(jobs.sep.signature, '二〇二六年九月 · 有记录四天 · 两个字', 'signature follows the drawn chars');
  assert.deepEqual([jobs.aug.status, jobs.aug.drawn, jobs.aug.recordIds, jobs.aug.missing], ['ready', '静', [jing[0].id], ''], 'August image: 静 = 8-05');
  assert.deepEqual([jobs.day.status, jobs.day.drawn, jobs.day.missing], ['ready', '谁', '静'], 'day image: 静 has no ink that day (9-22 is another day)');
  assert.equal(jobs.day.note, '「静」这天没有留下笔迹，不在图里。' + jobs.imageNote, 'day sentence');

  step('年报第四节: 题 (1-10 never stored ink) → the year\'s earliest record that has ink (4-02), line shows 4-02');
  await push(page, 'annual', {});
  await page.waitForSelector(`${TOP} ${tid('annual-first')}`);
  const first = await page.evaluate(sel => {
    const el = document.querySelector(`${sel} [data-testid="annual-first"]`);
    return { char: el.dataset.char, day: el.dataset.day, record: el.dataset.record, ink: el.dataset.ink,
      line: el.querySelector('[data-testid="annual-first-line"]').innerText.replace(/\s+/g, ' ').trim(),
      canvas: !!el.querySelector('[data-testid="annual-first-ink"] canvas') };
  }, TOP);
  assert.deepEqual([first.char, first.day, first.record, first.ink, first.canvas], ['题', '2026-04-02', rec('题', '2026-04-02').id, 'true', true], 'first char of the year, ink from 4-02');
  assert.equal(first.line, '4 月 2 日 · 你当时的笔迹', 'the date line is the ink record\'s day');
  await back(page);

  step('browsing and making images wrote nothing');
  const writes1 = await page.evaluate(() => window.__shiziTest.getWriteLog().length);
  assert.equal(writes1, writes0, 'no storage writes');
}
