// 单字间隔表：直接调用 core/fsrs.reviewCard，看一个字在各种写法下下次间隔怎么变。
import { reviewCard } from '../../../src/core/fsrs.js';
import { addDays, dayStartMs, diffDays, localDay } from '../../../src/core/dates.js';
import { bootDeck } from './env.mjs';

const HOUR = 3600000;
const DAY = 86400000;

/**
 * steps: [{ wait?: number（比到期日晚/早几天写，负数 = 提前；默认 0 = 到期当天）, judgment, hints }]
 * 第一步总是第 0 天的第一次判断（新字）。
 */
function ladder(title, steps, { cardKey = 'base:鲜' } = {}) {
  const start = '2026-03-02';
  let card = null;
  let due = start;
  const rows = [];
  steps.forEach((s, i) => {
    const day = i === 0 ? start : addDays(due, s.wait || 0);
    const at = dayStartMs(day) + 20 * HOUR;
    const r = reviewCard(card, { judgment: s.judgment, at, help: { hints: s.hints || 0 }, cardKey });
    card = r.card;
    due = r.due;
    rows.push({
      n: i + 1,
      day: diffDays(start, day),
      how: (s.judgment === 'correct' ? '写对' : '写错') + (s.hints ? `（提示 ${s.hints} 次）` : '') + (s.wait ? `（${s.wait > 0 ? '晚' : '早'} ${Math.abs(s.wait)} 天）` : ''),
      rating: r.rating,
      stability: Math.round(card.stability * 100) / 100,
      difficulty: Math.round(card.difficulty * 100) / 100,
      interval: diffDays(day, due),
    });
  });
  return { title, rows };
}

const C = (n, extra = {}) => Array.from({ length: n }, () => ({ judgment: 'correct', ...extra }));

export function intervalLadders() {
  bootDeck();
  return [
    ladder('A. 新字一次写对（无提示，记 Easy），之后每次按时、无提示写对', C(8)),
    ladder('B. 新字第一次带 1 次提示写对（记 Good），之后按时、无提示写对', [{ judgment: 'correct', hints: 1 }, ...C(7)]),
    ladder('C. 每一次都带提示写对（按时）', C(8, { hints: 2 })),
    ladder('D. 第一次写错，之后每次按时写对', [{ judgment: 'wrong' }, ...C(7)]),
    ladder('E. 一直写对，第 5 次写错一次，再按时写对', [...C(4), { judgment: 'wrong' }, ...C(3)]),
    ladder('F. 连续写错 4 次（每次都是第二天回来）', [{ judgment: 'wrong' }, ...Array.from({ length: 5 }, () => ({ judgment: 'wrong' }))]),
    ladder('G. 一直写对，但第 4 次拖了 30 天才来（逾期很久），写对', [...C(3), { judgment: 'correct', wait: 30 }, ...C(2)]),
    ladder('H. 一直写对，但第 4 次拖了 30 天才来，写错', [...C(3), { judgment: 'wrong', wait: 30 }, ...C(2)]),
    ladder('I. 提前复习：第 3 次比到期日早 3 天写对', [...C(2), { judgment: 'correct', wait: -3 }, ...C(2)]),
    ladder('J. 热身字（春）：第一次写对记 Easy，之后按时写对', C(6), { cardKey: 'base:春' }),
    ladder('K. 第 1 次写对、第 2 次起每次都带提示写对（按时）', [{ judgment: 'correct' }, ...C(6, { hints: 1 })]),
  ];
}
