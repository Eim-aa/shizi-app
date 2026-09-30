// 首页墨迹行（决定-D12；R-H07；原型首页壳 L73–L77、L178–L194：26×26 一格一字，间距 6）。
//
// 每一项是今天一条 judged 记录（同字只留最近一次，按 id 先后，最多 8 项——today.js homeModel）。
// - 逐判断笔迹打开（P31 policy.features.perRecordInk）且这条记录有墨迹：画那一次的笔迹（write/compare.js InkMini）。
// - 否则按 10.12「有记录无笔迹」：小于 36pt 的格子只画字（系统黑体、次文字色），不拿别次笔迹补位（R-D07 / K 报告 noInk）。
// 墨迹行点进「今天的记录」（R-H08 / 走查-M07，边开发边改）：去处由拥有那一页的卡用 setTodayRecordsAction 注册；没注册时整行
// 不是按钮（不放点了没反应的控件），只作读屏图片。
//
// data-testid：home-ink-row（data-count；注册了去处时是 <button>）、home-ink-item（data-char / data-record / data-judgment /
//   data-ink='ink'|'none'）。

import { html, useMemo } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import * as defaultPolicy from '../../../config/policy.js';
import { t } from '../../../config/copy/index.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { InkMini } from '../write/compare.js';
import { quoteChars } from '../session/s02.js';

let todayRecordsAction = null;

/** 注册「今天的记录」去处（R-H08；M4-1 练习记录 / 今天的记录页的拥有卡调用）；传 null 取消。 */
export function setTodayRecordsAction(fn) {
  todayRecordsAction = typeof fn === 'function' ? fn : null;
}

export function getTodayRecordsAction() {
  return todayRecordsAction;
}

/** 一条记录的墨迹点列（管线点列，绝对宽）；逐判断笔迹关闭或没有墨迹时 null。 */
export function recordInkPoints(record, getInk, policy = defaultPolicy) {
  if (!record || !policy.features || !policy.features.perRecordInk || typeof getInk !== 'function') return null;
  let ink = null;
  try {
    ink = getInk(record);
  } catch (error) {
    ink = null;
  }
  const decoded = ink ? decodeInk(ink) : null;
  if (!decoded || !decoded.length) return null;
  return resampleForReplay(decoded);
}

function InkItem({ record, getInk }) {
  const points = useMemo(() => recordInkPoints(record, getInk), [record, getInk]);
  const has = !!(points && points.length);
  return html`<span class="sz-inkrow__item" data-testid="home-ink-item" data-char=${record.char} data-record=${record.id}
    data-judgment=${record.judgment} data-ink=${has ? 'ink' : 'none'}>
    ${has
      ? html`<${InkMini} points=${points} testid="home-ink-mine" emptyText="" />`
      : html`<span class="sz-inkrow__glyph" aria-hidden="true">${record.char}</span>`}
  </span>`;
}

/**
 * @param {{records:object[], count:number, getInk?:Function, inline?:boolean}} props
 *   inline：紧凑版与计数合成一行（A09）时的格子尺寸（30）。
 */
export function InkRow({ records, count, getInk, inline = false }) {
  if (!records || !records.length) return null;
  const action = todayRecordsAction;
  const label = t('X-HOME.inkRowLabel', { chars: quoteChars(records.map(r => r.char)) });
  const items = records.map(r => html`<${InkItem} key=${r.id} record=${r} getInk=${getInk} />`);
  const cls = inline ? 'sz-inkrow sz-inkrow--inline' : 'sz-inkrow';
  if (action) {
    return html`<${Button} variant="plain" class=${cls} data-testid="home-ink-row" data-count=${count} aria-label=${label}
      onClick=${() => action()}>${items}</${Button}>`;
  }
  return html`<div class=${cls} role="img" data-testid="home-ink-row" data-count=${count} aria-label=${label}>${items}</div>`;
}

export const INK_ROW_CSS = `
.sz-inkrow{display:flex;justify-content:center;align-items:center;gap:6px;min-height:44px;padding:9px 0;box-sizing:border-box}
.sz-inkrow__item{width:calc(26px * var(--k, 1));height:calc(26px * var(--k, 1));flex:none;display:grid;place-items:center}
.sz-inkrow--inline{padding:7px 0}
.sz-inkrow--inline .sz-inkrow__item{width:calc(30px * var(--k, 1));height:calc(30px * var(--k, 1))}
.sz-inkrow__glyph{font-family:var(--sans);font-size:calc(19px * var(--k, 1));line-height:1;color:var(--i3, #6A645B)}
.sz-inkrow--inline .sz-inkrow__glyph{font-size:calc(22px * var(--k, 1))}
.sz-inkrow__item .sz-compare__card{width:100%;height:100%;border:0;border-radius:0;background:transparent;padding:0}
`;
