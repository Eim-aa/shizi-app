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
//   month-adjust（页头「调整图片 ›」→ 预览弹层）、month-share-btn（直接分享）、month-save（直接保存；data-state = idle|busy|saved|failed）、month-save-note。
import { html, useMemo } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LiveRegion } from '../../components/LiveRegion.js';
import { quickShare, useSaveFlow } from '../../image-quick.js';
import { MonthPaper, useScreenWidth } from '../../components/work.js';
import { injectStyles, T } from '../../components/styles.js';
import { t, tRef } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { localDay, monthOf } from '../../../core/dates.js';
import { MINE_SHEET_MAX_CHARS } from '../../../core/images/layout.js';
import { now as envNow } from '../../../platform/env.js';
import { openDetail } from '../detail/index.js';
import { inkOf, recordHasInk } from '../detail/records.js';
import { monthView as sessionMonthView } from '../../../session/views/mine-sub.js';
import { useStoreState } from './records.js';
import { cellLabelRef, trimSheetCells } from '../../../session/views/mine-page.js'; // B3.5c：格的读屏名与「我的」页字帖的取舍在会话层（网页与 App API 同一个）
import { registerMineSubLineBreaker } from './line-starts.js';

export const MONTH_SCREEN = 'month';
// 标签（原生页的标题兜底）：单独取出来，注册行里不写带占位符的 t(...)（B3.2 的屏名 ↔ Swift 类对应扫描按字面量扫）。
export const MONTH_LABEL = t('X-WORK.monthTitle', { month: '' });

injectStyles('mine-month', `
.sz-monthpage{display:flex;flex-direction:column;gap:12px}
.sz-monthpage__head{display:flex;flex-direction:column;gap:2px}
.sz-monthpage__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1}}
.sz-monthpage__sub{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-monthpage__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-monthfoot{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
:root[data-ax] .sz-monthfoot{grid-template-columns:minmax(0,1fr)}
.sz-monthfail{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink1}}
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
  if (typeof cell.label === 'string') return cell.label;
  return tRef(cell.label || cellLabelRef(cell));
}

/**
 * 月字帖模型（纯函数 + 取墨由调用方注入）。
 * @param {object} state
 * @param {string} month  YYYY-MM
 * @param {{store?:object|null, policy?:object}} [o]
 * @returns {{month, monthNum:number, cells:Array, n:number, days:number, under:boolean, kuan:string}}
 */
export function monthModel(state, month, { store = currentStore(), policy = defaultPolicy } = {}) {
  const view = sessionMonthView(state, month, {
    policy,
    hasInk: record => recordHasInk(store, record),
    inkOf: record => inkOf(store, record),
  });
  // 网页格的形状不变：record 是记录 id，label 是渲染好的读屏名（会话层给的是引用）。
  return { ...view, cells: view.cells.map(c => ({ ...c, record: c.recordId, label: tRef(c.label) })) };
}

/** 模型里的格子 → 月字帖纸（MonthPaper）要的形状（读屏名渲染成句子；record 用 id）。 */
export function paperCells(model) {
  return (model && model.cells ? model.cells : []).map(cell => ({
    key: cell.key,
    ch: cell.ch,
    ink: cell.ink,
    mode: cell.mode,
    tag: cell.tag,
    day: cell.day,
    record: cell.recordId != null ? cell.recordId : cell.record,
    label: cellLabel(cell),
  }));
}

/**
 * 「我的」页字帖的成员：不超过一张（80 字，D39）时就是整月；超过只放最近的 80 个字，第一格重标日期（点进月字帖看全部）。
 * @returns {{model, truncated:boolean, hidden:number, total:number}}
 */
export function mineSheetModel(model, max = MINE_SHEET_MAX_CHARS) {
  const r = trimSheetCells(model.cells, max);
  if (!r.truncated) return { model, truncated: false, hidden: 0, total: model.n };
  return { model: { ...model, cells: r.cells, n: r.cells.length }, truncated: true, hidden: r.hidden, total: r.total };
}

// ---------------------------------------------------------------- 视图

function openChar(cell) {
  if (!getScreen('detail')) return;
  openDetail(cell.ch);
}

/** 字帖本体（月字帖页与练习记录页共用）：纸 + 说明句；这个月没有字时是虚线框。 */
export function MonthBody({ model, onOpen = openChar, testid = 'month-paper', cellTestid = 'month-cell', emptyTestid = 'month-empty', kuanTestid = 'month-kuan', sealTestid = 'month-seal', sign = true, cols = 0 }) {
  const sw = useScreenWidth();
  if (!model.n) return EmptyState({ layout: 'inline', body: t('X-MINE.sheetEmpty'), testids: { root: emptyTestid, body: `${emptyTestid}-body` } }); // 全 App 唯一的空状态（S2，审计 P2-22）
  return html`<${MonthPaper} cells=${paperCells(model)} width=${sw - 40} kuan=${model.kuan} sign=${sign} cols=${cols} onOpen=${onOpen} testid=${testid} cellTestid=${cellTestid}
      kuanTestid=${kuanTestid} sealTestid=${sealTestid} label=${t('X-WORK.monthTitle', { month: model.monthNum })} />
    ${model.under ? html`<p class="sz-monthpage__note" data-testid="month-note">${t('X-WORK.monthUnderNote')}</p>` : null}`;
}

/** 分享弹层（images-entry.js 与本页互相依赖：这里按需动态加载，避免模块环里 records.js 的顶层变量还没初始化）。只在「调整图片」（比例、分张）时进入。 */
async function shareMonth(month) {
  const { openMonthImage } = await import('../../images-entry.js');
  openMonthImage({ month });
}

/** 这个月的导出任务（同上，按需加载）。 */
async function monthJob(month) {
  const { buildImageJob } = await import('../../images-entry.js');
  return buildImageJob({ kind: 'month', month });
}

/** 打开月字帖页（目标屏没注册时不跳转）。 */
export function openMonth({ month } = {}) {
  if (!getScreen(MONTH_SCREEN)) return false;
  nav.push(MONTH_SCREEN, month ? { month } : {});
  return true;
}

function MonthScreen({ params }) {
  const state = useStoreState();
  const month = params && typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthOf(localDay(envNow()));
  const model = useMemo(() => monthModel(state, month), [state, month]);
  const adjust = () => shareMonth(month);
  // 保存图片：一次点击直接存（成功只在按钮上原地变「已存好」，I3 · P0-04）
  const flow = useSaveFlow(() => monthJob(month));
  // 分享：直接调系统分享；超过一张图（>80 字分张）时分享哪一张是个选择，进预览
  const shareNow = async () => {
    let res;
    try {
      res = await quickShare(await monthJob(month));
    } catch (error) {
      res = { ok: false };
    }
    if (res.needsPreview) adjust();
  };
  const trailing = model.n
    ? html`<${Button} variant="text" data-testid="month-adjust" aria-label=${t('X-WORK.adjustAria')} onClick=${adjust}>${t('X-WORK.adjustImage')}</${Button}>`
    : null;
  const footer = model.n
    ? [html`<${LiveRegion} key="live" text=${flow.note} testid="month-save-live" />`,
      flow.note ? html`<p key="note" class="sz-monthfail" data-testid="month-save-note">${flow.note}</p>` : null,
      html`<div key="btns" class="sz-monthfoot">
        <${Button} variant="secondary" data-testid="month-share-btn" onClick=${shareNow}>${t('R-B10.share')}</${Button}>
        <${Button} variant="primary" data-testid="month-save" data-state=${flow.state} disabled=${flow.disabled} aria-busy=${flow.state === 'busy' ? 'true' : undefined}
          onClick=${flow.save}>${flow.label}</${Button}>
      </div>`]
    : null;
  return html`<${Page} title=${t('X-WORK.monthTitle', { month: model.monthNum })} hideTitle=${true} trailing=${trailing} footer=${footer} testid="month-screen">
    <div class="sz-monthpage" data-testid="month-body" data-month=${month} data-n=${model.n} data-under=${model.under ? 'true' : 'false'} data-days=${model.days}>
      <div class="sz-monthpage__head">
        <h2 class="sz-monthpage__title" data-testid="month-title" aria-hidden="true">${t('X-WORK.monthTitle', { month: model.monthNum })}</h2>
        <p class="sz-monthpage__sub" data-testid="month-sub">${t('X-MINE.sheetOrder')}</p>
      </div>
      <${MonthBody} model=${model} />
    </div>
  </${Page}>`;
}

// 折行点（网页量的）：原生按网页的折行排版（原生排版算法不同，AX 档会折行）。
registerMineSubLineBreaker();

registerScreen(MONTH_SCREEN, MonthScreen, { label: MONTH_LABEL, native: true });

