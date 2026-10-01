// 长文本 fixture（02 §8 M6 矩阵「长文本 fixture」；需求 §6 反例 8「短屏、大字、长文本、键盘」）。不是 spec：run.mjs 只加载
// *.spec.js。60-matrix.spec.js 用它把每个页面放进「最长」的状态再量几何：
//
//   longTextCatalog(page)   在页面里扫一遍题库（getDeck + write/prompt.js promptCells，与写字页同一口径）：
//                           longest   题面最长的卡（格数最多，其次提示行最长）—— 写字页 / 判断页用；
//                           longWords 按词长降序的前 LONG_WORD_COUNT 张卡（最长词：「皑如山上雪」这类五字词排在最前）——
//                                     写错过清单行、单字详情、结果页格子、查字弹层逐字行用；
//                           chars300  题库前 300 个能练的字（排除 35-all 用来做「自选未写」的 馨 / 鼎）—— 300 字 seed。
//   yearSeed(chars)         300 字一年量级种子（与 35-all.spec.js 的 yearSeed 同一造法：第 i 个字最近一次记录在
//                           floor(i*365/n) 天前、每 6 个字先写错后写对、每 7 个字最近一次写错、自选 馨 / 鼎 + 第 3 个字、
//                           最近写对且 > 100 天前的前 5 个到期）。records / sched / custom 三个域。
//   seedLongText(page, o)   reset → setClock(CLOCK) → 300 字种子 + 今天写错的最长词（真实 mutator judgeInDraft，进写错过、
//                           单字详情「写错过」行）+ A 槽今天的练习（队首 = 题面最长的卡；o.phase='compare' 时停在判断页、
//                           带两笔墨迹）+ B 槽已提前结束的「这次选的字」（写对 / 写错 / 看过答案 / 跳过 / 没写都有 → 结果页
//                           说明句最长的那一种，R-R05 / P62）→ __shiziTest.seed（走形状校验 + writeAll，不绕过 storage.js）。
//                           返回 {ok, resultSessionId, detailChar, longestKey, queryText}。
//   QUERY_TEXT_COUNT        查字弹层里一次输入的字数（逐字行 + 底栏 + 键盘同时出现）。
//
// 最长文案：各页取文案最长的那一态——结果页「先写到这里」+ 看过答案 / 跳过两句 +「还有 N 个字没写」；写错过行「N 月 N 日写错 ·
// 一共写错 N 次」配五字词；单字详情有记录 + 写错过 + 快忘了；查字弹层多字逐字行 + 过滤提示。

export const TODAY = '2026-09-24';
export const CLOCK = `${TODAY}T09:00:00`;
export const LONG_WORD_COUNT = 24;
export const QUERY_TEXT_COUNT = 8;
export const HOLLOW = ['馨', '鼎'];

// 书写格 0–3000 坐标里的一横一竖（与 15-recover.spec.js 同一编码：[n, x, y, t, …]）。
export const ROW_H = [3, 700, 1720, 0, 1200, 1722, 16, 1720, 1725, 16, 2240, 1722, 16, 2760, 1720, 16];
export const ROW_V = [3, 1725, 700, 0, 1722, 1200, 16, 1725, 1720, 16, 1722, 2240, 16, 1720, 2760, 16];

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

export function dayAgo(n, today = TODAY) {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 35-all.spec.js yearSeed 的同一造法（见文件头）。返回 {state:{records, sched, custom?}, latest}。 */
export function yearSeed(chars, { custom = true } = {}) {
  const rows = [];
  chars.forEach((c, i) => {
    const ago = Math.floor((i * 365) / chars.length);
    const day = dayAgo(ago);
    const last = { c, day, at: new Date(`${day}T08:00:00`).getTime() + (chars.length - i) * 1000, judgment: i % 7 === 3 ? 'wrong' : 'correct', i, ago };
    if (i % 6 === 1 && ago < 360) {
      const d0 = dayAgo(ago + 5);
      rows.push({ c, day: d0, at: new Date(`${d0}T07:00:00`).getTime(), judgment: 'wrong', i, early: true });
    }
    rows.push(last);
  });
  rows.sort((a, b) => a.at - b.at);
  const records = {};
  rows.forEach((row, k) => {
    const r = {
      id: `r${k + 1}`, cardKey: `base:${row.c}`, char: row.c, sessionId: 's900', kind: 'judged', judgment: row.judgment,
      at: row.at, localDay: row.day, help: { hints: 0, answerSeen: false, traced: false },
    };
    (records[row.day.slice(0, 7)] || (records[row.day.slice(0, 7)] = [])).push(r);
  });
  const latest = rows.filter(r => !r.early);
  const state = { records, sched: {} };
  for (const r of latest.filter(x => x.judgment === 'correct' && x.ago > 100).slice(0, 5)) {
    state.sched[`base:${r.c}`] = { fsrs: { stability: 3 }, due: dayAgo(20), lastJudgedAt: r.at };
  }
  if (custom) state.custom = { added: [...HOLLOW, chars[2]].map((char, i) => ({ char, at: 1000 + i })) };
  return { state, latest };
}

/** 题库扫描（页面里执行；见文件头）。 */
export async function longTextCatalog(page) {
  return page.evaluate(async ({ nWords, hollow }) => {
    const { getDeck } = await import('/src/data/deck.js');
    const { promptCells } = await import('/src/ui/screens/write/prompt.js');
    const d = getDeck();
    const rows = [];
    for (const key of d.keys) {
      if (!key.startsWith('base:')) continue;
      const card = d.index.get(key);
      const m = promptCells(card);
      rows.push({ key, char: key.slice(5), word: card.word || '', cells: m.count, hint: m.hint || '' });
    }
    // 题面最长 = 提示行最长（多行提示最占高度），其次格数多。
    const byPrompt = [...rows].sort((a, b) => b.hint.length - a.hint.length || b.cells - a.cells || a.key.localeCompare(b.key));
    const byWord = [...rows].sort((a, b) => b.word.length - a.word.length || b.hint.length - a.hint.length || a.key.localeCompare(b.key));
    const chars300 = [];
    for (const r of rows) {
      if (hollow.includes(r.char)) continue;
      chars300.push(r.char);
      if (chars300.length >= 300) break;
    }
    return { longest: byPrompt[0], longWords: byWord.slice(0, nWords), chars300, total: rows.length };
  }, { nWords: LONG_WORD_COUNT, hollow: HOLLOW });
}

/**
 * 造「最长」状态并 seed（见文件头）。catalog = longTextCatalog 的结果。
 * @param {{phase?:'recall'|'compare'}} [o]
 */
export async function seedLongText(page, catalog, { phase = 'recall' } = {}) {
  // 300 字种子里不放最长词的字（它们另按「今天写错」造），避免同一个字两套记录互相覆盖。
  const longChars = new Set(catalog.longWords.map(r => r.char).concat(catalog.longest.char));
  const chars = catalog.chars300.filter(c => !longChars.has(c));
  const { state: year } = yearSeed(chars);
  const res = await page.evaluate(async o => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { skipInDraft } = await import('/src/ui/screens/write/skip.js');
    const { appendRecordToDraft } = await import('/src/ui/screens/write/answer.js');
    const { makeRecord } = await import('/src/core/records.js');
    const { advance, createSession, endSlot } = await import('/src/core/sessions.js');
    const t = window.__shiziTest;
    t.reset();
    t.setClock(o.clock);
    const now = t.now();
    const draft = { ...o.year, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => `${p}${7000 + (n += 1)}`;
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    const words = o.longWords;
    // 1) 最长词的前 8 个：今天写错（写错过清单 / 单字详情）；其中前 2 个一周前还写错过一次（「一共写错 2 次」）。
    const wrongKeys = words.slice(0, 8).map(r => r.key);
    const judgeOne = (key, judgment, at) => {
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: [key], at });
      judgeInDraft(draft, { slot: 'A', cardKey: key, judgment, strokes: stroke, at, nextId, perRecordInk: false });
      draft.sessions.A = null;
    };
    wrongKeys.slice(0, 2).forEach((key, i) => judgeOne(key, 'wrong', now - 7 * 86400000 + i * 1000));
    wrongKeys.forEach((key, i) => judgeOne(key, 'wrong', now - 3600000 + i * 1000));
    // 2) B：这次选的字，提前结束（结果页「先写到这里」，说明句含看过答案 / 跳过 / 还有 N 个字没写）。
    const bKeys = words.slice(8, 18).map(r => r.key);
    let b = createSession({ id: 's6001', kind: 'picked', source: { view: 'home' }, queue: bKeys, at: now - 600000 });
    draft.sessions.B = b;
    const steps = ['correct', 'wrong', 'seen', 'skip', 'correct', 'seen', 'skip', 'wrong'];
    steps.forEach((step, i) => {
      const cur = draft.sessions.B;
      const key = cur.queue[cur.cursor];
      const at = now - 500000 + i * 1000;
      if (step === 'correct' || step === 'wrong') judgeInDraft(draft, { slot: 'B', cardKey: key, judgment: step, strokes: stroke, at, nextId, perRecordInk: false });
      else if (step === 'skip') skipInDraft(draft, { slot: 'B', cardKey: key, at, nextId });
      else {
        const r = makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'answer-seen', at, help: { hints: 0, answerSeen: true, traced: false } });
        appendRecordToDraft(draft, r);
        draft.sessions.B = advance(cur, { cardKey: key, recordId: r.id, kind: 'answer-seen', at });
      }
    });
    draft.sessions = endSlot(draft.sessions, 'B', { at: now - 400000, early: true });
    b = draft.sessions.lastEnded.B;
    // 3) A：今天的练习，队首是题面最长的卡，后面接最长词。
    const aQueue = [o.longestKey, ...words.slice(18, 22).map(r => r.key)].filter((k, i, all) => all.indexOf(k) === i);
    const a = createSession({ id: 's6002', kind: 'daily', source: { view: 'home' }, queue: aQueue, at: now - 60000 });
    if (o.phase === 'compare') a.current = { ...a.current, phase: 'compare', strokes: [o.rowH, o.rowV] };
    draft.sessions.A = a;
    const r = t.seed(draft);
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: !!(r && r.ok), r, resultSessionId: b ? b.id : null };
  }, {
    clock: CLOCK, year, longWords: catalog.longWords, longestKey: catalog.longest.key, phase, rowH: ROW_H, rowV: ROW_V,
  });
  return {
    ...res,
    detailChar: catalog.longWords[0].char,
    longestKey: catalog.longest.key,
    queryText: catalog.longWords.slice(0, QUERY_TEXT_COUNT).map(r => r.char).join(''),
  };
}
