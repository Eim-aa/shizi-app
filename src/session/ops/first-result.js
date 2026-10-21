// 结果页复现句与「N 天后再见」数据（D48；从 src/ui/screens/result/first.js 原样挪来，B2.1；行为不变）。

import { t } from '../../config/copy/index.js';
import { daysLaterLine, daysLaterText, reviewDays } from '../../core/first-result.js';

// ---------------------------------------------------------------- 纯函数

/**
 * 复现句（纯函数；单测直接调用）：「「求」明天再见，「据」「类」3 天后再见。」（D48，天数同 FSRS 到期日）。
 * 首练结果页（variant === 'first'）在它前面多一句关于「拾」的话（C3-H / N3-01、D53 ④，03 P245）——首页那个品牌字就是首练的第三个字：
 *   写成了（作品里有「拾」）→「你写下的第一个「拾」。」（与首页格下同一句）；
 *   没写成（有「拾」这一格，但没进作品：写错 / 看过答案 / 跳过）→「「拾」就是首页那个字。」，说一次。
 * @param {{cells:Array, sched:object, today:string, work?:object|null, variant?:string}} o  cells = resultModel().cells，work = resultModel().work
 * @returns {{preview:string}}  没有可预告的字（都是跳过 / 看过答案）且没有「拾」那句时 preview 为 ''
 */
export function firstExtras({ cells, sched, today, work = null, variant = '' }) {
  const judged = (cells || []).filter(c => c.kind === 'judged');
  const later = daysLaterLine({ chars: judged.map(c => ({ char: c.char, cardKey: c.cardKey })), sched: sched || {}, today }, t);
  let shi = null;
  if (variant === 'first') {
    const mark = t('X-HOME.shiLabel');
    const inWork = !!work && (work.cells || []).some(c => c.char === mark);
    const inGroup = inWork || (cells || []).some(c => c.char === mark);
    if (inWork) shi = 'written';
    else if (inGroup) shi = 'missed';
  }
  const lead = shi === 'written' ? t('X-FIRST.shiWritten') : shi === 'missed' ? t('X-FIRST.shiHome') : '';
  return { preview: lead + later };
}

/**
 * 每字「N 天后再见」的数据与文案（D48，P185；结果页的复现句用它的合并版 firstExtras）。
 * @param {{cells:Array, sched:object, today:string}} o  cells = resultModel().cells
 * @returns {Array<{char:string, cardKey:string, days:number, text:string}>}  只有 judged 的字（有 FSRS 调度），按组内顺序
 */
export function daysLaterOf({ cells, sched, today }) {
  const judged = (cells || []).filter(c => c.kind === 'judged');
  return reviewDays({ chars: judged.map(c => ({ char: c.char, cardKey: c.cardKey })), sched: sched || {}, today })
    .map(d => ({ ...d, text: daysLaterText(d.days, t) }));
}
