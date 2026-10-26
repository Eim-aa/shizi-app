// 年报（阶段 1 P1-E7；交接 §8；设计稿「作品出口」§四；原 02 M4-2 / 04 R-M06）。自注册 registerScreen('annual')（params {}）；「我的」菜单「年度报告」按屏名 push。
//
// 年报是一卷（交接 §8.1，滚动）：页头「年报」+ 右侧「调整图片 ›」→ 卷首（「二〇二六」t34 宋、「这一年，你拾回两百一十八个字。」t17（与册页卷首同一句、同样用汉字数字，D53 / N2-14）、今年第一个字：单格 132 +
//   「今年第一个字」/「{M月D日} 的笔迹」，D45）→ 每月一段（顶 hairline；月名 t22 + 右侧「{n} 字」；8 列、格 45、无格线、墨内边 9%，没墨的画衬底；
//   点一段进该月字帖）→ 卷尾「同一个字，两次」（第一次与最近一次墨迹两格并排 140，格下各自日期；D27）。只有一个数（年字数）；不出统计小节。
// 底栏「保存图片」一次点击直接存册页（I3 · P1-23）；页头「调整图片 ›」→ 弹层「保存年报」：默认册页（卷首 + 每月 + 卷尾，每张 3:4，超 80 字的月份分张），文字按钮「存成一张长图」（images-annual.js）。
// 纸上记录不进、不计入年字数（D46-13）。界面里的数字用阿拉伯数字，但卷首的年份与这一句属于作品，页面与册页统一用汉字数字（work-text.js 填入）。
// 空态（原型 annualEmpty）：虚线框「年」+「今年还没有记录」+「写字并判断对错后，这里会汇总你今年的记录。」。
//
// data-testid（前缀 annual-；页面根 annual-screen）：
//   annual-body（data-state=empty|report、data-year、data-today、data-count、data-days、data-months）、annual-adjust、annual-save（data-state）、annual-save-note、annual-year、annual-head、
//   annual-first（data-char / data-day / data-record / data-ink）、annual-first-cell、annual-first-label、annual-first-date、
//   annual-month（按钮，data-month / data-n）、annual-month-name、annual-month-count、annual-month-grid、annual-month-cell（data-char / data-mode）、
//   annual-twice（data-char）、annual-twice-first / annual-twice-last（data-record / data-day）、annual-twice-date、
//   annual-empty、annual-empty-glyph、annual-empty-title、annual-empty-body。

import { html, useMemo, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { useSaveFlow } from '../../image-quick.js';
import { Icons } from '../../components/icons.js';
import { Button, pressFeedbackHandlers } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LiveRegion } from '../../components/LiveRegion.js';
import { CellCanvas, useAxSize, useScreenWidth } from '../../components/work.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t, tRef } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { monthDayParts } from '../../../core/dates.js';
import { inkOf, recordHasInk } from '../detail/records.js';
import { hasInkOfStore, useStoreState, useToday } from './records.js';
import { annualDefaultYear } from '../../../session/views/annual.js';
import { annualView } from '../../../session/views/mine-sub.js';
import { setMineSubActions } from '../../../session/api/mine-sub.js';
import { openMonth } from './month.js';
import { registerMineSubLineBreaker } from './line-starts.js';

export const ANNUAL_SCREEN = 'annual';

injectStyles('mine-annual', `
.sz-ann{display:flex;flex-direction:column;gap:0;margin:0 -4px}
.sz-ann__fail{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink1}}
.sz-ann__yhead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sz-ann__arrows{display:flex;gap:4px;margin-right:-4px}
.sz-ann__arrow.sz-btn{width:44px;height:44px;display:grid;place-items:center;color:${T.ink2}}
.sz-ann__arrowbg{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:${T.field}}
.sz-ann__arrow.sz-btn[disabled]{color:${T.ink4};cursor:default}
.sz-ann__arrow.sz-btn[disabled] .sz-ann__arrowbg{background:transparent;box-shadow:inset 0 0 0 1px ${T.line}}
.sz-ann__year{margin:0;font-family:${T.song};font-size:${T.fs34};line-height:${T.lh34};font-weight:400;color:${T.ink1}}
.sz-ann__line{margin:8px 0 0;font-size:${T.fs17};line-height:${T.lh17};color:${T.ink2}}
.sz-ann__first{display:flex;gap:20px;align-items:flex-end;margin-top:24px;padding-bottom:16px}
.sz-ann__fcell{position:relative;width:132px;height:132px;flex:none;box-sizing:border-box;${TEX};box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-ann__fcell canvas{position:absolute;left:0;top:0}
.sz-ann__fside{display:grid;gap:4px;padding-bottom:4px;min-width:0}
.sz-ann__flabel{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-ann__fdate{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink1}}
.sz-ann__month{display:block;width:100%;box-sizing:border-box;margin:0;padding:14px 0 0;border:0;border-top:${T.hair} solid ${T.line};border-radius:${T.rWork};
  background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
.sz-ann__month[data-pressed]{background:${T.field}}
.sz-ann__month:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-ann__mhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:10px}
.sz-ann__mname{font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1}}
.sz-ann__mcount{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-ann__mgrid{display:grid;margin-bottom:28px}
.sz-ann__mcell{position:relative;display:block}
.sz-ann__mcell canvas{position:absolute;left:0;top:0}
.sz-ann__twice{display:grid;gap:14px;padding-top:14px;border-top:${T.hair} solid ${T.line};margin-bottom:24px}
.sz-ann__twicetitle{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1}}
.sz-ann__twicerow{display:flex;gap:12px;flex-wrap:wrap}
:root[data-ax] .sz-ann__twicerow{flex-direction:column}
.sz-ann__twiceitem{display:grid;gap:8px;justify-items:center}
.sz-ann__tcell{position:relative;width:140px;height:140px;box-sizing:border-box;${TEX};box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-ann__tcell canvas{position:absolute;left:0;top:0}
.sz-ann__tdate{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

function currentStore() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 打开年度报告（「我的」菜单同名屏）。year：看哪一年（缺省 = 今年有记录看今年，否则最近有记录的一年，D66 ⑪）。目标屏没注册时只 console.warn。 */
export function openAnnual({ year } = {}) {
  if (!getScreen(ANNUAL_SCREEN)) {
    console.warn(`[shizi] screen "${ANNUAL_SCREEN}" is not registered yet`);
    return false;
  }
  nav.push(ANNUAL_SCREEN, Number.isInteger(year) ? { year } : {});
  return true;
}

/** localDay →「9 月 1 日」（R-H02.dateFormat）。 */
export function annualDateText(day) {
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 今年第一个字的说明行：有墨「{date} 的笔迹」（R-M06.inkDate；D45：日期是留有墨迹那一次的日子，不说「今年第一次」）；没墨只写日期。 */
export function firstLine(day, hasInk) {
  const date = annualDateText(day);
  return hasInk ? t('R-M06.inkDate', { date }) : date;
}

const CELL_PRESS = pressFeedbackHandlers(() => false);

/** 年报每月的格子：B3.9 起由会话层 annualView 给（src/session/views/mine-sub.js），网页与原生同一组模型。 */


function MonthSection({ section, cols, c }) {
  return html`<button type="button" class="sz-ann__month" ...${CELL_PRESS} data-testid="annual-month" data-month=${section.month} data-n=${section.cells.length}
    aria-label=${t('X-WORK.annualMonthAria', { month: section.monthNum, n: section.cells.length })} onClick=${() => openMonth({ month: section.month })}>
    <span class="sz-ann__mhead">
      <span class="sz-ann__mname" data-testid="annual-month-name">${t('X-WORK.annualMonthName', { month: section.monthNum })}</span>
      <span class="sz-ann__mcount" data-testid="annual-month-count">${t('X-WORK.annualMonthCount', { n: section.cells.length })}</span>
    </span>
    <span class="sz-ann__mgrid" data-testid="annual-month-grid" aria-hidden="true" style=${{ gridTemplateColumns: `repeat(${cols}, ${c}px)` }}>
      ${section.cells.map(cell => html`<span key=${cell.key} class="sz-ann__mcell" data-testid="annual-month-cell" data-char=${cell.ch} data-mode=${cell.mode}
        style=${{ width: `${c}px`, height: `${c}px` }}><${CellCanvas} ch=${cell.ch} ink=${cell.ink} mode=${cell.mode} size=${c} pad=${0.09} testid="annual-month-canvas" /></span>`)}
    </span>
  </button>`;
}

function AnnualEmpty() {
  // 全 App 唯一的空状态（components/EmptyState.js，规范 S2，审计 P2-22）
  return EmptyState({ title: t('R-M06.emptyTitle'), body: t('R-M06.emptyBody'), glyph: t('X-ANNUAL.emptyGlyph'), titleTag: 'p',
    testids: { root: 'annual-empty', cell: 'annual-empty-glyph', title: 'annual-empty-title', body: 'annual-empty-body' } });
}

function Report({ model, onYear }) {
  const sw = useScreenWidth();
  const ax = useAxSize();
  const sections = model.months;
  const cols = ax ? 6 : 8;
  const c = ax ? Math.floor((sw - 40) / 6) : Math.min(45, Math.floor((sw - 40) / 8));
  const first = model.first;
  const firstInk = first ? first.ink : null;
  const firstBuilt = !!firstInk;
  const twice = model.twice;
  return html`
    <div class="sz-ann__yhead">
      <h2 class="sz-ann__year" data-testid="annual-year" data-year=${model.year}>${model.coverYear}</h2>
      ${model.years.length > 1
        ? html`<span class="sz-ann__arrows" data-testid="annual-years" data-years=${model.years.join(' ')}>
            <${Button} variant="plain" class="sz-ann__arrow" data-testid="annual-prev" disabled=${model.prevYear == null}
              aria-label=${t('X-ANNUAL.prevYear')} onClick=${() => onYear(model.prevYear)}><span class="sz-ann__arrowbg">${Icons.prev()}</span></${Button}>
            <${Button} variant="plain" class="sz-ann__arrow" data-testid="annual-next" disabled=${model.nextYear == null}
              aria-label=${t('X-ANNUAL.nextYear')} onClick=${() => onYear(model.nextYear)}><span class="sz-ann__arrowbg">${Icons.next()}</span></${Button}>
          </span>`
        : null}
    </div>
    <p class="sz-ann__line" data-testid="annual-head" data-n=${model.count}>${tRef(model.coverLine)}</p>
    ${first
      ? html`<div class="sz-ann__first" data-testid="annual-first" data-char=${first.char} data-day=${first.day}
          data-record=${first.recordId || ''} data-ink=${firstBuilt ? 'true' : 'false'}>
          <span class="sz-ann__fcell" data-testid="annual-first-cell" role="img"
            aria-label=${firstBuilt ? t('X-ANNUAL.firstInk', { char: first.char }) : t('X-ANNUAL.firstNoInk', { char: first.char })}>
            <${CellCanvas} ch=${first.char} ink=${firstInk} mode=${firstBuilt ? 'hand' : 'under'} size=${132} testid="annual-first-canvas" />
          </span>
          <span class="sz-ann__fside">
            <span class="sz-ann__flabel" data-testid="annual-first-label">${t('X-WORK.annualFirstLabel')}</span>
            <span class="sz-ann__fdate" data-testid="annual-first-date">${tRef(first.date)}</span>
          </span>
        </div>`
      : null}
    ${sections.map(section => html`<${MonthSection} key=${section.month} section=${section} cols=${cols} c=${c} />`)}
    ${twice
      ? html`<section class="sz-ann__twice" data-testid="annual-twice" data-char=${twice.char}>
          <h3 class="sz-ann__twicetitle">${t('X-WORK.annualTwiceTitle')}</h3>
          <div class="sz-ann__twicerow">
            ${[['first', twice.first], ['last', twice.last]].map(([key, side]) => html`<div key=${key} class="sz-ann__twiceitem">
              <span class="sz-ann__tcell" data-testid=${`annual-twice-${key}`} data-record=${side.recordId} data-day=${side.day} role="img"
                aria-label=${tRef(side.label)}>
                <${CellCanvas} ch=${twice.char} ink=${side.ink} mode="hand" size=${140} testid=${`annual-twice-${key}-canvas`} />
              </span>
              <span class="sz-ann__tdate" data-testid="annual-twice-date">${tRef(side.date)}</span>
            </div>`)}
          </div>
        </section>`
      : null}`;
}

/** 分享弹层（images-annual.js 在年报页之外没有别的入口，按需动态加载，与 images-entry.js 的加载顺序无关）。只在「调整图片」（分享、存成长图）时进入。 */
async function shareAnnual(year) {
  const { openAnnualImage } = await import('../../images-annual.js');
  openAnnualImage({ year });
}

/** 年报的导出任务（同上，按需加载）。 */
async function annualJob(year) {
  const { buildAnnualJob } = await import('../../images-annual.js');
  return buildAnnualJob({ year });
}

function AnnualScreen({ params }) {
  const state = useStoreState();
  const today = useToday();
  // D66 ⑪：看哪一年——params.year（刷新 / 返回能恢复）；没有就取缺省（今年有记录看今年，否则最近有记录的一年）。多于一年时页内用「‹ ›」逐年切换，只有一年不出任何切换。
  const [picked, setPicked] = useState(() => (params && Number.isInteger(params.year) ? params.year : null));
  const year = picked != null ? picked : annualDefaultYear(state, today);
  const model = useMemo(() => annualView(state, today, {
    year, policy: defaultPolicy,
    hasInk: hasInkOfStore(), inkOf: record => inkOf(currentStore(), record),
  }), [state, today, year]);
  // 切年写回 params（本页在顶层时），刷新 / 从月字帖返回都停在这一年
  const onYear = next => {
    if (!Number.isInteger(next)) return;
    setPicked(next);
    try {
      nav.setParams({ year: next });
    } catch (error) {
      // 本页不在顶层时忽略
    }
  };
  // 与月字帖同一布局（I3 · P1-23）：页头右侧「调整图片 ›」进预览，底栏「保存图片」一次点击直接存（册页每张 3:4）
  const flow = useSaveFlow(() => annualJob(year));
  const trailing = model.empty
    ? null
    : html`<${Button} variant="text" data-testid="annual-adjust" aria-label=${t('X-WORK.adjustAria')} onClick=${() => shareAnnual(year)}>${t('X-WORK.adjustImage')}</${Button}>`;
  const footer = model.empty
    ? null
    : [html`<${LiveRegion} key="live" text=${flow.note} testid="annual-save-live" />`,
      flow.note ? html`<p key="note" class="sz-ann__fail" data-testid="annual-save-note">${flow.note}</p>` : null,
      html`<${Button} key="save" variant="primary" data-testid="annual-save" data-state=${flow.state} disabled=${flow.disabled}
        aria-busy=${flow.state === 'busy' ? 'true' : undefined} onClick=${flow.save}>${flow.label}</${Button}>`];
  return html`<${Page} title=${t('X-MINE.annual')} trailing=${trailing} footer=${footer} testid="annual-screen">
    <div class="sz-ann" data-testid="annual-body" data-state=${model.empty ? 'empty' : 'report'} data-year=${model.year}
      data-today=${today} data-count=${model.count} data-days=${model.days} data-months=${model.months.length} style=${model.empty ? { flex: '1' } : null}>
      ${model.empty ? html`<${AnnualEmpty} />` : html`<${Report} model=${model} onYear=${onYear} />`}
    </div>
  </${Page}>`;
}

// 折行点（网页量的）：原生按网页的折行排版（原生排版算法不同，AX 档会折行）。
registerMineSubLineBreaker();

registerScreen(ANNUAL_SCREEN, AnnualScreen, { label: t('X-MINE.annual'), native: true });

// 原生页的「调整图片 / 保存图片」按钮（B3.11 做原生预览；这里让网页开预览弹层）：登记给 App API 的 mine.image。
setMineSubActions({
  annual: async ({ year }) => {
    await shareAnnual(year);
    return { ok: true };
  },
});
