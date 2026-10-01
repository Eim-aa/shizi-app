// 练习记录（02 M4-1；04 R-P01–R-P05、R-M02；03 P02 / P64 / P25 / P50；原型 ShiziScreen-第十稿交接版 L88–L110、L320–L324、
// L408–L429；reference/J-proto-screen.md §2.3.6–§2.3.9）。自注册 registerScreen('records')，params {month?:'YYYY-MM', day?:'YYYY-MM-DD'}
// （页面自己用 nav.setParams 写回，刷新 / 从详情返回都能恢复）。
//
// 版式（自上而下）：页头「练习记录」→ 月份行（「9 月」+ 年份；右「‹ ›」：加底，到头变灰 = disabled + aria-disabled，R-P05）
//   → 标题「{month} 月有记录 N 天」+「墨点表示这天有记录，不分对错。」（R-P01；这个月没有记录：「{month} 月还没有记录」+ R-P04）
//   → 月历（周一开头；有记录的日子画墨点、是按钮；点了在月历下列出那天写的字，再点收起，R-P05；无补记：没有虚线圈 / 空心点，K27）
//   → [那天写的字]（「{date}写的字」+ 格子，点格子进单字详情）
//   → 「{month} 月字帖」（字帖跟月份走，R-P05；本月右侧「保存图片 ›」——M4-5 用 setMineImageActions 注册后才显示）
//     纸卡：5 列格子（角标 = 那天的日期，R-P02）+ 落款（R-I01.monthSignature 汉字数字）+「按第一次写下的先后排列」+ 红印；
//     卡下说明：本月 R-P02.sheetNote / 历史月 R-P02.historyNote；这个月没有字：虚线框「这个月还没有可以放进图片的字」
//   → 本月且今天有记录：「{今天}写的字 / 这次的图片 · 保存图片 ›」（R-P03；同样由 M4-5 注册后才显示）。
// 数字全部按记录算（model.js recordsModel，R-M01 / K27）；格子只画那一次真实笔迹，没有就「没有笔迹」（10.12，不借别次，I03）。
//
// 本模块另外给我的首页（index.js）用的共用件：useStoreState / useToday / go / MINE_ROUTES / SheetGrid / Signature / Seal /
//   setMineImageActions；并在加载时给首页墨迹行注册「今天的记录」去处（R-H08 / 走查-M07：home setTodayRecordsAction）。
//
// data-testid（前缀 records-；页面根 records-screen）：
//   records-body（data-month / data-current / data-record-days / data-selected / data-today）、records-month（data-month）、
//   records-year、records-prev / records-next（disabled 时 aria-disabled=true）、records-title、records-legend、records-calendar、
//   records-weekday、records-day（data-day / data-has / data-today / data-future；有记录的是 button，aria-pressed）、records-day-dot、
//   records-daylist（data-day / data-count）、records-daylist-title、records-daylist-grid、records-daylist-cell（同 records-sheet-cell）、
//   records-sheet（data-month / data-count / data-days / data-current / data-folded）、records-sheet-title、records-sheet-save、
//   records-sheet-grid、records-sheet-cell（data-char / data-day / data-tag / data-record / data-ink）、records-sheet-sign、
//   records-sheet-order、records-sheet-seal、records-sheet-note、records-sheet-empty、records-today（data-day / data-n）。

import { html, useEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { cnNumber, localDay, monthDayParts, monthOf, signatureMonthParts } from '../../../core/dates.js';
import { setTodayRecordsAction } from '../home/ink-row.js';
import { openDetail } from '../detail/index.js';
import { hasInkPoints, inkOf } from '../detail/records.js';
import { InkMini } from '../write/compare.js';
import { RECORDS_SHEET_COLS, recordsModel } from './model.js';

export const RECORDS_SCREEN = 'records';

/**
 * 我的 tab 各去处的屏名（原型 ShiziScreen data-nav 键：records / settings / backup / annual / about；detail 为 M3-6）。
 * 目标屏由拥有它们的卡自注册（M4-2 年度报告、M4-3 设置、M4-4 备份与恢复、M4-6 关于）；还没注册时按钮不跳转（console.warn）。
 */
export const MINE_ROUTES = Object.freeze({
  records: RECORDS_SCREEN,
  annual: 'annual',
  settings: 'settings',
  backup: 'backup',
  about: 'about',
  detail: 'detail',
});

injectStyles('mine-records', `
.sz-rec{display:flex;flex-direction:column;gap:26px}
.sz-rec__mhead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.sz-rec__mtitle{display:flex;align-items:baseline;gap:10px;min-width:0}
.sz-rec__month{margin:0;font-family:${T.serif};font-size:calc(26px * ${T.k});line-height:calc(34px * ${T.k});font-weight:500;
  letter-spacing:.04em;color:${T.i1};white-space:nowrap}
.sz-rec__year{font-size:calc(13px * ${T.k});color:${T.i3};font-variant-numeric:tabular-nums}
.sz-rec__arrows{display:flex;gap:4px;margin-right:-8px}
.sz-rec__arrow.sz-btn{width:44px;height:44px;display:grid;place-items:center;color:${T.i2}}
.sz-rec__arrowbg{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:${T.off}}
.sz-rec__arrow.sz-btn[disabled]{color:${T.i4};cursor:default}
.sz-rec__arrow.sz-btn[disabled] .sz-rec__arrowbg{background:transparent;box-shadow:inset 0 0 0 1px ${T.i5}}
.sz-rec__head{display:flex;flex-direction:column;gap:6px}
.sz-rec__title{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:1.4;font-weight:500;letter-spacing:.04em;
  color:${T.i1}}
.sz-rec__legend{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-rec__cal{box-sizing:border-box;border-radius:18px;background:${T.c};border:.5px solid ${T.i5};padding:8px 6px 10px;display:grid;
  grid-template-columns:repeat(7,minmax(0,1fr));font-variant-numeric:tabular-nums}
.sz-rec__wd{height:26px;display:grid;place-items:center;font-size:calc(11px * ${T.k});color:${T.i3}}
.sz-rec__day{min-height:44px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:0;color:${T.i1}}
.sz-rec__day.sz-btn{min-height:44px}
.sz-rec__num{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;font-size:calc(15px * ${T.k});line-height:1}
.sz-rec__day[data-today="true"] .sz-rec__num{color:${T.ar};font-weight:600}
.sz-rec__day[data-future="true"] .sz-rec__num{color:${T.i3}}
.sz-rec__day[aria-pressed="true"] .sz-rec__num{background:${T.off}}
.sz-rec__dotrow{display:flex;height:5px;align-items:center}
.sz-rec__dot{width:5px;height:5px;border-radius:50%;background:${T.i1}}
.sz-rec__daylist{display:flex;flex-direction:column;gap:12px}
.sz-rec__subtitle{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:1.4;font-weight:500;letter-spacing:.04em;
  color:${T.i2}}
.sz-rec__sheet{display:flex;flex-direction:column;gap:12px}
.sz-rec__shead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.sz-rec__save.sz-btn{flex:none;font-size:calc(15px * ${T.k});letter-spacing:.04em;color:${T.i2}}
.sz-rec__paper{box-sizing:border-box;background:${T.c};border:.5px solid ${T.i5};box-shadow:0 12px 28px rgba(59,47,40,.08);
  padding:18px 16px 16px;display:flex;flex-direction:column;gap:14px}
.sz-rec__note{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-rec__blank{min-height:120px;box-sizing:border-box;border:1px dashed var(--g, rgba(166,83,63,.28));display:grid;place-items:center;
  padding:12px;text-align:center;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-rec__todaylist{display:flex;flex-direction:column;border-top:1px solid ${T.i5}}
.sz-rec__today.sz-btn{min-height:52px;padding:8px 0;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:3px;
  text-align:left;border-bottom:1px solid ${T.i5}}
.sz-rec__todayt{font-size:calc(15px * ${T.k});color:${T.i1}}
.sz-rec__todays{font-size:calc(15px * ${T.k});line-height:1.5;color:${T.i2}}

.sz-zt{display:grid;grid-template-columns:repeat(var(--cols, 5),minmax(0,1fr));box-sizing:border-box}
.sz-zt--lines{border-top:1px solid var(--g, rgba(166,83,63,.28));border-left:1px solid var(--g, rgba(166,83,63,.28));background:${T.c}}
.sz-zt--lines .sz-scell{border-right:1px solid var(--g, rgba(166,83,63,.28));border-bottom:1px solid var(--g, rgba(166,83,63,.28))}
.sz-zt--gap{gap:1px;background:var(--g, rgba(166,83,63,.28));border:1px solid var(--g, rgba(166,83,63,.28))}
.sz-zt--gap .sz-scell{background:${T.c}}
.sz-scell{position:relative;display:block;box-sizing:border-box;min-width:0;aspect-ratio:1/1;padding:0;margin:0;border:0;
  background:transparent;color:inherit;font:inherit;container-type:inline-size;cursor:pointer}
.sz-scell--pad{cursor:default}
.sz-scell:focus-visible{outline:2px solid ${T.ar};outline-offset:-2px}
.sz-scell__sq{position:absolute;inset:0;display:grid;place-items:center}
.sz-scell__sq--tag{transform:translate(6%,9%) scale(.78)}
.sz-scell__sq .sz-compare__card{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;background:transparent;padding:0}
.sz-scell__glyph{position:absolute;left:0;right:0;top:42%;transform:translateY(-50%);text-align:center;font-family:${T.sans};
  font-size:34cqw;line-height:1;color:${T.i3}}
.sz-scell__noink{position:absolute;left:0;right:0;top:80%;transform:translateY(-50%);text-align:center;font-family:${T.sans};
  font-size:clamp(9px, 16cqw, 12px);line-height:1;color:${T.i3};white-space:nowrap}
.sz-scell__tag{position:absolute;left:3px;top:2px;font-size:calc(11px * ${T.k});line-height:calc(13px * ${T.k});color:${T.ar};
  font-variant-numeric:tabular-nums;pointer-events:none}
.sz-msign{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.sz-msign__text{display:flex;flex-direction:column;gap:4px;min-width:0}
.sz-msign__line{font-size:calc(11px * ${T.k});line-height:calc(13px * ${T.k});letter-spacing:.16em;color:${T.i2}}
.sz-msign__order{font-size:calc(11px * ${T.k});color:${T.i3}}
.sz-mseal{width:26px;height:26px;flex:none;border-radius:3px;background:var(--seal, ${T.a});color:#FFF9F1;display:grid;place-items:center;
  font-family:var(--kai, serif);font-size:16px;line-height:1;transform:rotate(-3deg)}
.sz-mseal--small{width:24px;height:24px;font-size:15px}
`);

// ---------------------------------------------------------------- 状态订阅

function readState() {
  try {
    return getStore().getState();
  } catch (error) {
    return null;
  }
}

/** store 状态（订阅；store 没启动时 null → 按空状态算）。 */
export function useStoreState() {
  const [state, setState] = useState(readState);
  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      return undefined;
    }
    setState(store.getState());
    return store.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 今天（应用时钟）；回前台时重算（跨天后「这一周」、今天红字、今天那一行跟着变）。 */
export function useToday() {
  const [today, setToday] = useState(() => localDay(envNow()));
  useEffect(() => {
    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setToday(localDay(envNow()));
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, []);
  const now = localDay(envNow());
  return now !== today ? now : today;
}

function currentStore() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

// ---------------------------------------------------------------- 去处

/** 推入某个去处；目标屏还没注册（并行卡未合入）时不跳转，只 console.warn。返回是否跳转。 */
export function go(name, params) {
  if (!getScreen(name)) {
    console.warn(`[shizi] mine: screen "${name}" is not registered yet`);
    return false;
  }
  nav.push(name, params);
  return true;
}

/** 打开练习记录（{month?, day?}）。 */
export function openRecords(params = {}) {
  const p = {};
  if (params.month) p.month = params.month;
  if (params.day) p.day = params.day;
  return go(RECORDS_SCREEN, p);
}

/** 首页墨迹行「今天的记录」（R-H08 / 走查-M07）：练习记录停在本月、列出今天写的字。 */
export function openTodayRecords() {
  const today = localDay(envNow());
  return openRecords({ month: monthOf(today), day: today });
}

/** 格子 → 单字详情（M3-6 openDetail：栈顶已是同一个字的详情时不重复推入）。 */
function openCell(char) {
  if (!getScreen(MINE_ROUTES.detail)) {
    console.warn('[shizi] mine: screen "detail" is not registered yet');
    return;
  }
  openDetail(char);
}

// ---------------------------------------------------------------- 图片入口桩（M4-5）

let imageActions = { month: null, today: null };

/**
 * M4-5 注册「保存图片」的去处（没注册的入口不显示）：
 *   month({month, sheet})        「{month} 月字帖」右侧「保存图片 ›」（我的首页与练习记录同一入口，只有本月，R-M01 / R-P02）
 *   today({day, items})          练习记录页底「{今天}写的字 / 这次的图片 · 保存图片 ›」（今天判断过的字每字最近一次，R-P03）
 * 传 null 取消某一项；只传一项时另一项保持不变。要在点击处理里同步调用（iOS 分享）。
 */
export function setMineImageActions(actions = {}) {
  const next = Object.assign({}, imageActions);
  for (const key of ['month', 'today']) {
    if (Object.prototype.hasOwnProperty.call(actions || {}, key)) next[key] = typeof actions[key] === 'function' ? actions[key] : null;
  }
  imageActions = next;
}

export function getMineImageActions() {
  return imageActions;
}

// ---------------------------------------------------------------- 文案小件

/** localDay → 「{month} 月 {day} 日」（R-H02.dateFormat）。 */
export function dayText(day) {
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 格子角标「9·1」（原型 fmt）。 */
export function tagText(day) {
  try {
    return t('X-MINE.cellTag', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 月字帖落款「二〇二六年九月 · 有记录六天 · 二十六个字」（R-I01.monthSignature / signatureMonth；汉字数字，文案-D3）。 */
export function signatureText(sheet) {
  return t('R-I01.monthSignature', {
    month: t('R-I01.signatureMonth', signatureMonthParts(sheet.month)),
    n: cnNumber(sheet.days),
    m: cnNumber(sheet.chars),
  });
}

// ---------------------------------------------------------------- 格子与字帖

/** 一格：那一次的真实笔迹（InkMini），没有就标准字 +「没有笔迹」（R-D07 / 10.12）；角标日期（R-P02）。 */
export function SheetCell({ cell, store, testid, showTag = true }) {
  const ink = useMemo(() => inkOf(store, cell.record), [store, cell.record]);
  const has = hasInkPoints(ink);
  const tag = showTag && cell.tag ? tagText(cell.tag) : '';
  const label = t('X-MINE.cellLabel', { char: cell.char, date: dayText(cell.day) });
  return html`<button type="button" class="sz-scell" data-testid=${testid} data-char=${cell.char} data-day=${cell.day || ''}
    data-tag=${tag ? cell.tag : ''} data-record=${cell.record ? cell.record.id : ''} data-ink=${has ? 'true' : 'false'}
    aria-label=${label} onClick=${() => openCell(cell.char)}>
    <span class=${tag ? 'sz-scell__sq sz-scell__sq--tag' : 'sz-scell__sq'}>
      ${has
        ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid=${`${testid}-ink`} label=${cell.char} />`
        : html`<span class="sz-scell__glyph" aria-hidden="true">${cell.char}</span>
          <span class="sz-scell__noink" aria-hidden="true" data-testid=${`${testid}-noink`}>${t('R-D07.noInkLabel')}</span>`}
    </span>
    ${tag ? html`<span class="sz-scell__tag" aria-hidden="true">${tag}</span>` : null}
  </button>`;
}

/**
 * 格子网格。variant 'lines'（练习记录：外框只画上 / 左，每格画右 / 下，原型 L309 cells）/ 'gap'（我的：1px 缝，原型 L26）。
 * 末行补空格到整行。
 */
export function SheetGrid({ cells, cols = RECORDS_SHEET_COLS, variant = 'lines', testid, cellTestid, label, showTag = true }) {
  const store = currentStore();
  const pads = [];
  for (let i = cells.length; i % cols; i += 1) pads.push(i);
  return html`<div class=${`sz-zt sz-zt--${variant}`} data-testid=${testid} role="group" aria-label=${label || null}
    style=${{ '--cols': cols }}>
    ${cells.map(cell => html`<${SheetCell} key=${cell.char} cell=${cell} store=${store} testid=${cellTestid} showTag=${showTag} />`)}
    ${pads.map(i => html`<span key=${`pad${i}`} class="sz-scell sz-scell--pad" aria-hidden="true"></span>`)}
  </div>`;
}

export function Seal({ small = false, testid }) {
  return html`<span class=${small ? 'sz-mseal sz-mseal--small' : 'sz-mseal'} aria-hidden="true" data-testid=${testid}>${t('X-MINE.seal')}</span>`;
}

// ---------------------------------------------------------------- 练习记录页

function isTopEntry(entryId) {
  const router = getRouter();
  if (!router || !entryId) return false;
  const snap = router.getState();
  return !!(snap && snap.top && snap.top.id === entryId);
}

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const PREV_ICON = () => html`<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 4 6 9l5 5"></path></svg>`;
const NEXT_ICON = () => html`<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m7 4 5 5-5 5"></path></svg>`;

function Calendar({ model, selected, onPick }) {
  const weekdays = t('X-MINE.weekdays');
  return html`<div class="sz-rec__cal" data-testid="records-calendar" role="group" aria-label=${t('X-MINE.monthHead', { month: model.monthNum })}>
    ${weekdays.map(w => html`<span key=${`w${w}`} class="sz-rec__wd" data-testid="records-weekday" aria-hidden="true">${w}</span>`)}
    ${model.calendar.map(cell => {
      if (cell.blank) return html`<span key=${cell.key} class="sz-rec__day" aria-hidden="true"></span>`;
      const body = html`<span class="sz-rec__num">${cell.n}</span>
        <span class="sz-rec__dotrow">${cell.has ? html`<span class="sz-rec__dot" data-testid="records-day-dot" aria-hidden="true"></span>` : null}</span>`;
      if (cell.has) {
        return html`<${Button} key=${cell.key} variant="plain" class="sz-rec__day" data-testid="records-day" data-day=${cell.day}
          data-has="true" data-today=${cell.today ? 'true' : 'false'} data-future="false" aria-pressed=${selected === cell.day ? 'true' : 'false'}
          aria-label=${t('X-MINE.dayRecorded', { date: dayText(cell.day) })} onClick=${() => onPick(cell.day)}>${body}</${Button}>`;
      }
      return html`<span key=${cell.key} class="sz-rec__day" data-testid="records-day" data-day=${cell.day} data-has="false"
        data-today=${cell.today ? 'true' : 'false'} data-future=${cell.future ? 'true' : 'false'}>${body}</span>`;
    })}
  </div>`;
}

function DayList({ selected, listRef }) {
  return html`<section class="sz-rec__daylist" data-testid="records-daylist" data-day=${selected.day} data-count=${selected.items.length}
    ref=${listRef}>
    <h3 class="sz-rec__subtitle" data-testid="records-daylist-title">${t('R-P03.todayChars', { date: dayText(selected.day) })}</h3>
    <${SheetGrid} cells=${selected.items.map(it => ({ char: it.char, day: selected.day, record: it.record, tag: null }))}
      cols=${RECORDS_SHEET_COLS} variant="lines" testid="records-daylist-grid" cellTestid="records-daylist-cell" showTag=${false}
      label=${t('R-P03.todayChars', { date: dayText(selected.day) })} />
  </section>`;
}

function MonthSheet({ model }) {
  const { sheet } = model;
  const title = t('R-P02.sheetTitle', { month: model.monthNum });
  const save = model.current && sheet.cells.length && imageActions.month;
  return html`<section class="sz-rec__sheet" data-testid="records-sheet" data-month=${sheet.month} data-count=${sheet.chars}
    data-days=${sheet.days} data-current=${model.current ? 'true' : 'false'} data-folded=${sheet.folded ? 'true' : 'false'}>
    <div class="sz-rec__shead">
      <h2 class="sz-rec__subtitle" data-testid="records-sheet-title">${title}</h2>
      ${save
        ? html`<${Button} variant="text" class="sz-rec__save" data-testid="records-sheet-save"
            onClick=${() => { const fn = imageActions.month; if (fn) fn({ month: sheet.month, sheet }); }}>${t('R-M01.saveImage')}</${Button}>`
        : null}
    </div>
    ${sheet.cells.length
      ? html`<div class="sz-rec__paper">
          <${SheetGrid} cells=${sheet.cells} cols=${RECORDS_SHEET_COLS} variant="lines" testid="records-sheet-grid"
            cellTestid="records-sheet-cell" label=${title} />
          <div class="sz-msign">
            <span class="sz-msign__text">
              <span class="sz-msign__line" data-testid="records-sheet-sign">${signatureText(sheet)}</span>
              <span class="sz-msign__order" data-testid="records-sheet-order">${t('X-MINE.sheetOrder')}</span>
            </span>
            <${Seal} testid="records-sheet-seal" />
          </div>
        </div>
        <p class="sz-rec__note" data-testid="records-sheet-note">${t(model.current ? 'R-P02.sheetNote' : 'R-P02.historyNote')}</p>`
      : html`<div class="sz-rec__blank" data-testid="records-sheet-empty">${t('X-MINE.sheetEmpty')}</div>`}
  </section>`;
}

function TodayRow({ row }) {
  const fn = imageActions.today;
  if (!row || !fn) return null;
  return html`<div class="sz-rec__todaylist">
    <${Button} variant="plain" class="sz-rec__today" data-testid="records-today" data-day=${row.day} data-n=${row.n}
      onClick=${() => { const f = imageActions.today; if (f) f({ day: row.day, items: row.items }); }}>
      <span class="sz-rec__todayt">${t('R-P03.todayChars', { date: dayText(row.day) })}</span>
      <span class="sz-rec__todays">${t('R-P03.todayImage')}</span>
    </${Button}>
  </div>`;
}

function RecordsScreen({ params, entry }) {
  const p = params || {};
  const entryId = entry && entry.id;
  const state = useStoreState();
  const today = useToday();
  const [view, setView] = useState(() => ({ month: typeof p.month === 'string' ? p.month : '', day: typeof p.day === 'string' ? p.day : '' }));
  const model = useMemo(() => recordsModel(state, today, { month: view.month, day: view.day, policy: defaultPolicy }),
    [state, today, view.month, view.day]);
  const selected = model.selected;
  const listRef = useRef(null);
  const scrolled = useRef(false);

  // 视图参数写回 params（本页在顶层时），刷新 / 从详情返回都能恢复。
  useEffect(() => {
    if (!isTopEntry(entryId)) return;
    const next = { month: model.month, day: selected ? selected.day : null };
    if ((p.month || null) !== next.month || (p.day || null) !== next.day) nav.setParams(next);
  });

  // 从「今天的记录」进来（带 day）：第一次画出那天的字时把它滚进视野。
  useEffect(() => {
    if (scrolled.current || !selected || !listRef.current || !p.day) return;
    scrolled.current = true;
    try {
      listRef.current.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      // 旧 WebKit 不认 options：忽略
    }
  }, [selected]);

  const toMonth = month => {
    if (!month) return;
    setView({ month, day: '' });
  };
  const onPick = day => setView(cur => ({ month: model.month, day: cur.day === day ? '' : day }));

  const titleKey = model.recordDays ? 'R-P01.monthDays' : 'X-MINE.monthNone';
  return html`<${Page} title=${t('R-M01.practiceLog')} testid="records-screen">
    <div class="sz-rec" data-testid="records-body" data-month=${model.month} data-current=${model.current ? 'true' : 'false'}
      data-record-days=${model.recordDays} data-selected=${selected ? selected.day : ''} data-today=${today}>
      <div class="sz-rec__mhead">
        <span class="sz-rec__mtitle">
          <h2 class="sz-rec__month" data-testid="records-month" data-month=${model.month}>${t('X-MINE.monthHead', { month: model.monthNum })}</h2>
          <span class="sz-rec__year" data-testid="records-year">${model.year}</span>
        </span>
        <span class="sz-rec__arrows">
          <${Button} variant="plain" class="sz-rec__arrow" data-testid="records-prev" disabled=${!model.prev}
            aria-label=${t('X-MINE.prevMonth')} onClick=${() => toMonth(model.prev)}><span class="sz-rec__arrowbg">${PREV_ICON()}</span></${Button}>
          <${Button} variant="plain" class="sz-rec__arrow" data-testid="records-next" disabled=${!model.next}
            aria-label=${t('X-MINE.nextMonth')} onClick=${() => toMonth(model.next)}><span class="sz-rec__arrowbg">${NEXT_ICON()}</span></${Button}>
        </span>
      </div>
      <div class="sz-rec__head">
        <p class="sz-rec__title" data-testid="records-title">${t(titleKey, { month: model.monthNum, n: model.recordDays })}</p>
        <p class="sz-rec__legend" data-testid="records-legend">${t(model.recordDays ? 'R-P01.legend' : 'R-P04.empty')}</p>
      </div>
      <${Calendar} model=${model} selected=${selected ? selected.day : ''} onPick=${onPick} />
      ${selected ? html`<${DayList} selected=${selected} listRef=${listRef} />` : null}
      <${MonthSheet} model=${model} />
      <${TodayRow} row=${model.todayRow} />
    </div>
  </${Page}>`;
}

registerScreen(RECORDS_SCREEN, RecordsScreen, { label: t('R-M01.practiceLog') });

// 首页墨迹行点进「今天的记录」（M2-1 ink-row.js 的注册口）。
setTodayRecordsAction(openTodayRecords);
