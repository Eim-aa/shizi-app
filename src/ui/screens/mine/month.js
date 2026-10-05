// 月字帖（阶段 1 P1-E7；交接 §7；D31 / D42 / D46 ⑦ / D47；设计稿「作品出口」§三）。自注册 registerScreen('month')，params {month:'YYYY-MM'}；
// 年报的月段点进来，练习记录页的「{月}字帖」也用同一块（MonthBody）。
//
// 版式（402 宽）：页头返回 + 右侧分享 → 标题「{n}月字帖」t28 → 副标题「按第一次写下的先后排列」t13 ink3 → 字帖（6 列，Pro Max 7、AX 4；
//   格 ⌊(W − 40) / 列⌋，笺面纸 + 外框 + 格间线；每天第一个字在格内左上角有日期角标 11pt，不压格线）→ 落款（宋 13 + 印 24）→ 说明句
//   「浅色的字，这个月没有留下笔迹。点一个字看详情。」（整月全部有墨时不出现）→ 底栏「分享」/「保存图片」。
// 每个字取这个月里留有墨迹的第一次（D42）；整个月一份墨迹都没有的字照样在，画 under 衬底参考字（不写「没有笔迹」）；
// 纸上记录不进（D46-13）。导出 = 同一组格子，3:4 默认、超过 80 字按日期分张（分享弹层，images-entry.js）。
//
// data-testid：month-screen、month-body（data-month / data-n / data-under / data-days）、month-title、month-sub、month-paper（data-cols / data-cell）、
//   month-cell（data-char / data-mode / data-day / data-tag / data-record / data-ink）、month-tag、month-kuan、month-seal、month-note、month-empty、
//   month-share、month-save。
import { html, useMemo } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { MonthPaper, builtInk, useAxSize, useScreenWidth } from '../../components/work.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { localDay, monthDayParts, monthOf } from '../../../core/dates.js';
import { monthColumns, monthCell } from '../../../core/images/layout.js';
import { monthCells } from '../../../core/images/pick.js';
import { now as envNow } from '../../../platform/env.js';
import { openDetail } from '../detail/index.js';
import { inkOf, recordHasInk } from '../detail/records.js';
import { kuan } from '../../work-text.js';
import { useStoreState } from './records.js';

export const MONTH_SCREEN = 'month';

injectStyles('mine-month', `
.sz-monthpage{display:flex;flex-direction:column;gap:12px}
.sz-monthpage__head{display:flex;flex-direction:column;gap:2px}
.sz-monthpage__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1}}
.sz-monthpage__sub{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-monthpage__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-monthpage__blank{min-height:120px;box-sizing:border-box;display:grid;place-items:center;padding:12px;
  text-align:center;font-size:${T.fs15};color:${T.ink2}}
.sz-monthfoot{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
:root[data-ax] .sz-monthfoot{grid-template-columns:minmax(0,1fr)}
`);

function currentStore() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

// ---------------------------------------------------------------- 模型

/**
 * 一格的读屏名称：有墨「疆 · 9 月 2 日」，没墨「疆，这个月没有留下笔迹」。日期是排序 / 角标用的日子（第一次写下）；
 * 取到的墨迹在另一天时补一句「9 月 28 日 的笔迹」（N2-07）。
 */
export function cellLabel(cell) {
  if (cell.mode === 'under') return t('X-WORK.monthCellNoInk', { char: cell.ch });
  const date = cell.day ? t('R-H02.dateFormat', monthDayParts(cell.day)) : '';
  const inkDay = cell.record && cell.record.localDay;
  if (inkDay && cell.day && inkDay !== cell.day) {
    return t('X-WORK.cellInkDay', { char: cell.ch, date, inkDate: t('R-H02.dateFormat', monthDayParts(inkDay)) });
  }
  return t('X-MINE.cellLabel', { char: cell.ch, date });
}

/**
 * 月字帖模型（纯函数 + 取墨由调用方注入）。
 * @param {object} state
 * @param {string} month  YYYY-MM
 * @param {{store?:object|null, policy?:object}} [o]
 * @returns {{month, monthNum:number, cells:Array, n:number, days:number, under:boolean, kuan:string}}
 */
export function monthModel(state, month, { store = currentStore(), policy = defaultPolicy } = {}) {
  const r = monthCells(state, month, {
    inkOf: record => builtInk(inkOf(store, record)),
    hasInk: record => recordHasInk(store, record),
    policy,
  });
  const cells = r.cells.map((cell, i) => ({
    key: `${cell.ch}-${i}`,
    ch: cell.ch,
    ink: cell.ink ? { points: cell.ink } : null,
    mode: cell.mode,
    tag: cell.tag,
    day: cell.day || '',
    record: cell.record ? cell.record.id : '',
    label: cellLabel(cell),
  }));
  return {
    month: r.month,
    monthNum: Number(r.month.slice(5)),
    cells,
    n: cells.length,
    days: r.days,
    under: cells.some(c => c.mode === 'under'),
    kuan: cells.length ? kuan({ month: r.month, n: cells.length }) : '',
  };
}

// ---------------------------------------------------------------- 视图

function openChar(cell) {
  if (!getScreen('detail')) return;
  openDetail(cell.ch);
}

/** 字帖本体（月字帖页与练习记录页共用）：纸 + 说明句；这个月没有字时是虚线框。 */
export function MonthBody({ model, onOpen = openChar, testid = 'month-paper', cellTestid = 'month-cell', emptyTestid = 'month-empty' }) {
  const sw = useScreenWidth();
  const ax = useAxSize();
  const cols = monthColumns(sw, { ax });
  const c = monthCell(sw, cols);
  if (!model.n) return html`<div class="sz-monthpage__blank" data-testid=${emptyTestid}>${t('X-MINE.sheetEmpty')}</div>`;
  return html`<${MonthPaper} cells=${model.cells} cols=${cols} c=${c} kuan=${model.kuan} onOpen=${onOpen} testid=${testid} cellTestid=${cellTestid}
      label=${t('X-WORK.monthTitle', { month: model.monthNum })} />
    ${model.under ? html`<p class="sz-monthpage__note" data-testid="month-note">${t('X-WORK.monthUnderNote')}</p>` : null}`;
}

/** 分享弹层（images-entry.js 与本页互相依赖：这里按需动态加载，避免模块环里 records.js 的顶层变量还没初始化）。 */
async function shareMonth(month) {
  const { openMonthImage } = await import('../../images-entry.js');
  openMonthImage({ month });
}

/** 打开月字帖页（目标屏没注册时不跳转）。 */
export function openMonth({ month } = {}) {
  if (!getScreen(MONTH_SCREEN)) return false;
  nav.push(MONTH_SCREEN, month ? { month } : {});
  return true;
}

const SHARE_ICON = () => html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 14V3.5M7.2 7 11 3.2 14.8 7M6 10H5v8h12v-8h-1"></path></svg>`;

function MonthScreen({ params }) {
  const state = useStoreState();
  const month = params && typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthOf(localDay(envNow()));
  const model = useMemo(() => monthModel(state, month), [state, month]);
  const share = model.n ? () => shareMonth(month) : null;
  const trailing = share
    ? html`<${Button} variant="icon" data-testid="month-share" aria-label=${t('X-WORK.shareAria')} onClick=${share}>${SHARE_ICON()}</${Button}>`
    : null;
  const footer = share
    ? html`<div class="sz-monthfoot">
        <${Button} variant="secondary" data-testid="month-share-btn" onClick=${share}>${t('R-B10.share')}</${Button}>
        <${Button} variant="primary" data-testid="month-save" onClick=${share}>${t('X-IMAGES.save')}</${Button}>
      </div>`
    : null;
  return html`<${Page} title="" trailing=${trailing} footer=${footer} testid="month-screen">
    <div class="sz-monthpage" data-testid="month-body" data-month=${month} data-n=${model.n} data-under=${model.under ? 'true' : 'false'} data-days=${model.days}>
      <div class="sz-monthpage__head">
        <h2 class="sz-monthpage__title" data-testid="month-title">${t('X-WORK.monthTitle', { month: model.monthNum })}</h2>
        <p class="sz-monthpage__sub" data-testid="month-sub">${t('X-MINE.sheetOrder')}</p>
      </div>
      <${MonthBody} model=${model} />
    </div>
  </${Page}>`;
}

registerScreen(MONTH_SCREEN, MonthScreen, { label: t('X-WORK.monthTitle', { month: '' }) });
