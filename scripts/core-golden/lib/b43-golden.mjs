// B4.3 金标准的共用造例器：每个 op 用固定种子从随机差分的各域生成器里取 perOp 组参数，加上各域手选的向量，
// 期望值是参考引擎（js-engine.mjs）的回包。依赖时区的 op（makeRecord / storedInkPresent / inviteTime / fireDayOf / reminder.payload …）在另外两个时区再出一组。
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import datesDomain from '../../core-diff/domains/dates.mjs';
import recordsDomain from '../../core-diff/domains/records.mjs';
import queryDomain from '../../core-diff/domains/query.mjs';
import cardsDomain from '../../core-diff/domains/cards.mjs';
import membersDomain from '../../core-diff/domains/members.mjs';
import inkDomain from '../../core-diff/domains/ink.mjs';

export const B43_DOMAINS = { records: recordsDomain, query: queryDomain, cards: cardsDomain, members: membersDomain, ink: inkDomain };

/** 依赖进程时区的 op（金标准在多个时区各出一组）。 */
export const TZ_OPS = new Set(['records.makeRecord', 'inkPick.storedInkPresent', 'firstResult.inviteTime', 'reminder.fireDayOf', 'reminder.payload', 'firstResult.reviewPreview',
  'workMembers.members', 'records.recordsByMonth']);

/** 某个域的生成用例：{op, args}[]。 */
export function generatedCases(domainId, { seed, perOp = 12, only = null, skip = [] }) {
  const g = makeCtx(rng(seed));
  for (const d of [datesDomain, recordsDomain, queryDomain, cardsDomain, membersDomain, inkDomain]) if (d.prepare) d.prepare(g);
  const dom = B43_DOMAINS[domainId];
  const out = [];
  for (const [op, spec] of Object.entries(dom.ops)) {
    if (only && !only.test(op)) continue;
    if (skip.includes(op)) continue;
    const n = op.startsWith('deck.summary') || op === 'cards.libraries' || op === 'ink.params' ? 2 : perOp;
    for (let i = 0; i < n; i += 1) out.push({ op, args: JSON.parse(JSON.stringify(spec.args ? spec.args(g) : {})) });
  }
  return out;
}

/** 三个时区各一组：Asia/Shanghai 全量，另两个只出依赖时区的 op。 */
export function groupsFor(domainId, { seed, perOp, hand = [], withTZ, opCases }) {
  const all = [...hand, ...generatedCases(domainId, { seed, perOp })];
  const tzOnly = generatedCases(domainId, { seed: seed + 7, perOp: perOp * 3 }).filter((c) => TZ_OPS.has(c.op));
  const handTz = hand.filter((c) => TZ_OPS.has(c.op));
  return [
    withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases(all) })),
    withTZ('America/New_York', () => ({ tz: 'America/New_York', cases: opCases([...handTz, ...tzOnly]) })),
    withTZ('Australia/Lord_Howe', () => ({ tz: 'Australia/Lord_Howe', cases: opCases([...handTz, ...tzOnly]) })),
  ];
}
