// 汇总：从一次模拟结果里算出报告和「预期检查」用的指标。纯统计，不含调度规则。

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

export function summarize(res) {
  const days = res.days;
  const pr = days.filter(d => d.practiced);
  const last = days[days.length - 1] || {};
  const dailyGroups = res.groups.filter(g => g.slot === 'A');
  const newPerGroupHist = {};
  const sizeHist = {};
  for (const g of dailyGroups) {
    if (g.kind === 'first') continue;
    const n = g.queue.filter(q => q.src === 'new' || q.src === 'warm-new').length;
    newPerGroupHist[n] = (newPerGroupHist[n] || 0) + 1;
    sizeHist[g.queue.length] = (sizeHist[g.queue.length] || 0) + 1;
  }
  const reviews = res.events.filter(e => e.action === 'judged' && e.src !== 'new' && e.src !== 'warm-new' && e.src !== 'first' && e.slot === 'A');
  const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));
  const tail = lastN(pr, 30);
  const weeks = [];
  for (let w = 0; w * 7 < days.length; w += 1) {
    const ds = days.slice(w * 7, w * 7 + 7);
    const p = ds.filter(d => d.practiced);
    const end = ds[ds.length - 1];
    weeks.push({
      week: w + 1,
      practicedDays: p.length,
      cards: sum(p.map(d => d.cards)),
      newCards: sum(p.map(d => d.newCards)),
      dueCards: sum(p.map(d => d.dueCards)),
      earlyCards: sum(p.map(d => d.earlyCards)),
      correctRate: (() => { const j = sum(p.map(d => d.correct + d.wrong)); return j ? round(sum(p.map(d => d.correct)) / j, 2) : ''; })(),
      backlogStartMean: round(mean(p.map(d => d.backlogStart)), 1),
      backlogEnd: end.backlogEnd,
      recorded: end.recorded,
      zones: `${end.zoneDue}/${end.zoneShaky}/${end.zoneKnown}`,
    });
  }
  const remindDays = days.filter(d => d.remindSched);
  const judgedReviews = reviews.filter(e => e.rating);
  const meanInterval = (pred) => {
    const xs = judgedReviews.filter(pred).map(e => e.intervalDays).filter(x => x !== '');
    return xs.length ? round(mean(xs), 1) : null;
  };
  // 写错以后多久再见到这个字（日历天数；同一个字之后的下一次出现，不论动作）
  const gaps = [];
  const gapsDue1 = []; // 写错后 FSRS 给的下次到期就是第二天的那些（D65 #1：排序与保底管得到的只有这些；成熟的字写错可能隔几天才到期）
  const byChar = new Map();
  for (const e of res.events) {
    if (e.slot !== 'A') continue;
    if (!byChar.has(e.char)) byChar.set(e.char, []);
    byChar.get(e.char).push(e);
  }
  for (const list of byChar.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const e = list[i];
      if (e.action !== 'judged' || e.judgment !== 'wrong') continue;
      const nxt = list.slice(i + 1).find(x => x.dayIdx > e.dayIdx);
      if (nxt) {
        gaps.push(nxt.dayIdx - e.dayIdx);
        if (e.intervalDays === 1) gapsDue1.push(nxt.dayIdx - e.dayIdx);
      }
    }
  }
  gaps.sort((a, b) => a - b);
  const wrongReturn = gaps.length ? {
    n: gaps.length,
    mean: round(mean(gaps), 2),
    median: gaps[Math.floor(gaps.length / 2)],
    p90: gaps[Math.floor(gaps.length * 0.9)],
    nextDayShare: round(gaps.filter(g => g === 1).length / gaps.length, 3),
    nextDayShareDueTomorrow: gapsDue1.length ? round(gapsDue1.filter(g => g === 1).length / gapsDue1.length, 3) : null,
  } : null;
  const hintedReviews = judgedReviews.filter(e => e.judgment === 'correct');
  const hintGap = (() => {
    const a = hintedReviews.filter(e => e.hints > 0 && e.intervalDays !== '').map(e => e.intervalDays);
    const b = hintedReviews.filter(e => !e.hints && e.intervalDays !== '').map(e => e.intervalDays);
    return a.length && b.length ? { hinted: round(mean(a), 1), clean: round(mean(b), 1), nHinted: a.length, nClean: b.length } : null;
  })();
  return {
    wrongReturn,
    hintGap,
    daysTotal: days.length,
    daysPracticed: pr.length,
    groupsTotal: res.groups.filter(g => g.slot === 'A').length,
    cards: sum(pr.map(d => d.cards)),
    newCards: sum(pr.map(d => d.newCards)),
    dueCards: sum(pr.map(d => d.dueCards)),
    earlyCards: sum(pr.map(d => d.earlyCards)),
    wrongRetry: sum(pr.map(d => d.wrongRetry)),
    warmCards: sum(pr.map(d => d.warmCards)),
    specialCards: sum(pr.map(d => d.specialCards)),
    seen: sum(pr.map(d => d.seen)),
    skipped: sum(pr.map(d => d.skipped)),
    cardsPerDayMean: round(mean(pr.map(d => d.cards)), 1),
    cardsPerDayMax: Math.max(0, ...pr.map(d => d.cards)),
    correctRate: (() => { const j = sum(pr.map(d => d.correct + d.wrong)); return j ? round(sum(pr.map(d => d.correct)) / j, 3) : null; })(),
    backlogMax: Math.max(0, ...pr.map(d => d.backlogStart)),
    backlogTailMean: round(mean(tail.map(d => d.backlogStart)), 1),
    backlogTailMax: Math.max(0, ...tail.map(d => d.backlogStart)),
    overdueMax: Math.max(0, ...pr.map(d => d.overdueMaxStart)),
    dueTomorrowTailMean: round(mean(tail.map(d => d.dueTomorrow)), 1),
    recorded: last.recorded,
    zones: { due: last.zoneDue, shaky: last.zoneShaky, known: last.zoneKnown },
    skippedZone: last.skippedZone,
    emptyDays: days.filter(d => d.empty).length,
    newPerGroupHist,
    sizeHist,
    weeks,
    meanIntervalAfterReviewCorrect: meanInterval(e => e.judgment === 'correct'),
    meanIntervalAfterReviewWrong: meanInterval(e => e.judgment === 'wrong'),
    reviewCorrectRate: judgedReviews.length ? round(judgedReviews.filter(e => e.judgment === 'correct').length / judgedReviews.length, 3) : null,
    remindEligibleShare: remindDays.length ? round(mean(remindDays.map(d => d.remindEligible / d.remindSched)), 3) : null,
    remindNoneWhileBacklog: days.filter(d => d.practiced && d.remindQuestions === 0 && d.backlogEnd > 0).length,
    violations: countViolations(res.violations),
    probes: res.probes,
    memStats: res.memStats && res.memStats.reviews ? {
      reviews: res.memStats.reviews,
      predicted: round(res.memStats.pSum / res.memStats.reviews, 3),
      byBucket: Object.fromEntries(Object.entries(res.memStats.byBucket).map(([k, v]) => [k, { n: v.n, p: round(v.p / v.n, 3) }])),
    } : null,
    maxOverdueSeen: res.maxOverdueSeen,
    starveCardDays: res.starveCardDays,
    sameDayRepeats: res.sameDay,
  };
}

export function countViolations(list) {
  const out = {};
  for (const v of list) {
    const o = out[v.id] || (out[v.id] = { count: 0, samples: [] });
    o.count += 1;
    if (o.samples.length < 4) o.samples.push(`${v.day}: ${v.detail}`);
  }
  return out;
}

export function csvOf(rows, columns = null) {
  if (!rows.length) return '';
  const cols = columns || Object.keys(rows[0]);
  const esc = (x) => {
    const s = x === undefined || x === null ? '' : String(x);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}
