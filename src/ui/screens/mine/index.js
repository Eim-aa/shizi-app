// 我的 tab 根页（D63：Claude Design「我的方向」丙·极简；02 M4-1；04 R-M01–R-M05；原型 ShiziScreen-第十稿交接版 L24–L31 的旧版式已换）。自注册，无中心路由表。
//
// 版式（自上而下，一屏就是整个页面；内容区超出时只在内容区竖向滚动，N7）：
//   1 大标题「我的」（右上不放任何东西）
//   2 概览三个数（不可点）：连续练习 N 天 · 累计练习 N 天 · 已练汉字 N 字。连续 / 累计都把 v1 旧版练习日（legacy.days）算进去；已练汉字 = 字库首页「已练汉字」同一个函数
//     （model.js overviewModel；今天还没写不算断连续）
//   3 「{月}字帖」块：标题行（宋 22 墨一「{月}字帖」+ 右「全部 N 字 ›」）**整行就是练习记录入口**（点进练习记录本月，没有别的练习记录入口）；下面是字帖（D57 · C1：一层框、
//     有几个字几格、日期骑在格线上），只放最近两行（列数按整月字数定）：整月放得下就整张带落款与印，放不下只放最近的、不画落款和印，完整的在「全部」里；格子点进单字详情。
//     「保存图片」不放在这里：设计稿把它放在月字帖页 / 练习记录页（那里本来就有），这里的标题行整行是入口，放不下第二个可点的东西。
//     没有记录时：只写空态（「还没有记录」+ 一句话，R-M04），不加插画；有记录但这个月还没写字时：标题行照常（全部那一格不写数）、字帖位置是月字帖的空框。
//   4 一组（块）：提醒（右值 = 提醒时间或「关」›，进提醒页 remind.js）、练习范围（右值 = 库名 ›，进换库页，同字库首页那一行、同一个值）、外观（行内三段，appearance.js）、
//     每组字数（D65 ②：行内四段 5｜10｜20｜30，AX 档「20 个 ›」点开弹层；与外观同一种选择方式，group-size.js / choice.js）
//   5 一组：备份（右值「上次备份 {date}」/「还没有备份」；D66 ⑱ ≥ 30 天没备份写「N 天没有备份」，笔迹存储接近上限写「快存满了，建议导出备份」›）、年度报告（右值 = 年份：今年没有记录而往年有时是最近有记录的一年 ›）、关于拾字 ›
//   6 页底一行版本号（X-ABOUT.version，取 build-info.js；与关于页同一句，13 墨三居中）
// 行与字库首页同一套（components/Rows.js）：名称 17 / 500 墨一 · 值 17 墨二 · 小字 13 墨三。目标屏由各自的模块自注册，本页只 nav.push。
// 数字全部按记录算（model.js mineModel；R-M01、K27）。
//
// data-testid（前缀 mine-；页面根 screen-mine）：
//   mine-home（data-state=empty|records / data-today / data-month）、mine-empty、mine-empty-title、mine-empty-body、
//   mine-overview（data-streak / data-total / data-chars）、mine-stat-streak / mine-stat-total / mine-stat-chars（data-n；mine-stat-num、mine-stat-label）、
//   mine-sheet（data-month / data-count / data-shown / data-truncated / data-days）、mine-sheet-head（标题行按钮，进练习记录）、mine-sheet-title、mine-sheet-all、
//   mine-sheet-grid、mine-sheet-cell（data-char / data-day / data-tag / data-record / data-ink）、mine-sheet-sign、mine-sheet-seal、
//   mine-remind（mine-remind-value，data-on）、mine-library（mine-library-value）、mine-appearance（appearance.js）、mine-group-size（group-size.js）、
//   mine-menu-backup（mine-backup-value，data-last=YYYY-MM-DD|''、data-hint=''|stale|pressure）/ mine-menu-annual（mine-annual-year = 最近有记录的一年）/ mine-menu-about、mine-version。

import { html, useMemo } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { Chevron } from '../../components/Chevron.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Row, RowBlock } from '../../components/Rows.js';
import { useAxLevel } from '../../components/ax.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { sheetColumns } from '../../../core/images/layout.js';
import { mineModel } from './model.js';
import { annualDefaultYear } from './annual-model.js';
import {
  dayText, go, hasInkOfStore, MINE_ROUTES, openRecords, useStoreState, useToday,
} from './records.js'; // 练习记录页自注册（records）；首页墨迹行「今天的记录」也在那里注册
import { MonthBody, mineSheetModel, monthModel } from './month.js';
import { AppearanceRow } from './appearance.js';
import { GroupSizeRow } from './group-size.js';
import { settingsView, timeText } from './prefs.js';
import { VersionText } from './about.js';

export { MINE_ROUTES, openRecords, openTodayRecords, setMineImageActions, RECORDS_SCREEN } from './records.js';

// tab 名取自文案表（copy/common.js X-TABS）。
export const MINE_LABEL = t('X-TABS.mine');
export const MINE_TAB = 'mine';

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="7" r="3.6"></circle><path d="M4.2 19.4v-3a6.8 6.8 0 0 1 13.6 0v3"></path></svg>`;

injectStyles('mine', `
.sz-tabpage[data-testid="screen-mine"]{gap:${T.s2}}
.sz-mine{display:flex;flex-direction:column;min-height:0}
.sz-mine__ov{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:${T.s3};border-top:${T.hair} solid ${T.line};border-bottom:${T.hair} solid ${T.line}}
.sz-mine__stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:${T.s4} 0 ${T.s3} ${T.s3};border-left:${T.hair} solid ${T.line}}
.sz-mine__stat:first-child{padding-left:0;border-left:0}
.sz-mine__val{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:${T.s1};font-variant-numeric:tabular-nums;color:${T.ink1}}
.sz-mine__num{font-size:${T.fs34};line-height:${T.lh34};font-weight:500}
.sz-mine__unit{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3}}
.sz-mine__cap{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
:root[data-ax] .sz-mine__ov{grid-template-columns:minmax(0,1fr);margin-top:${T.s2}}
:root[data-ax] .sz-mine__stat{flex-direction:column-reverse;gap:0;padding:${T.s2} 0;border-left:0;border-top:${T.hair} solid ${T.line}}
:root[data-ax] .sz-mine__stat:first-child{border-top:0}
:root[data-ax] .sz-mine__cap{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
:root[data-ax] .sz-mine__num{font-size:${T.fs17};line-height:${T.lh17s};font-weight:400;color:${T.ink2}}
:root[data-ax] .sz-mine__unit{font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2}}
.sz-mine__sheetblock{display:flex;flex-direction:column;gap:${T.s1};margin-top:26px}
.sz-mine__shead.sz-btn{box-sizing:border-box;width:100%;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:${T.s3};text-align:left;color:${T.ink1}}
.sz-mine__stitle{margin:0;min-width:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1}} /* D57：字帖标题宋 22 墨一 */
.sz-mine__sall{flex:none;display:inline-flex;align-items:center;gap:${T.s2};font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:nowrap}
:root[data-ax] .sz-mine__shead.sz-btn{flex-wrap:wrap;align-items:flex-start;padding:${T.s2} 0}
:root[data-ax] .sz-mine__sheetblock{margin-top:10px}
.sz-mine__gap{margin-top:26px}
.sz-mine__ver{margin:26px 0 0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
:root[data-ax] .sz-mine__ver{margin-top:10px}
`);

// ---------------------------------------------------------------- 视图

const STATS = Object.freeze([
  { id: 'streak', label: 'X-MINE.ovStreak', unit: 'X-MINE.ovDay' },
  { id: 'total', label: 'X-MINE.ovTotal', unit: 'X-MINE.ovDay' },
  { id: 'chars', label: 'X-MINE.ovChars', unit: 'X-MINE.ovChar' },
]);

function Overview({ overview }) {
  return html`<div class="sz-mine__ov" data-testid="mine-overview" data-streak=${overview.streak} data-total=${overview.total} data-chars=${overview.chars}>
    ${STATS.map(s => html`<div key=${s.id} class="sz-mine__stat" data-testid=${`mine-stat-${s.id}`} data-n=${overview[s.id]}>
      <span class="sz-mine__val"><span class="sz-mine__num" data-testid="mine-stat-num">${overview[s.id]}</span><span class="sz-mine__unit">${t(s.unit)}</span></span>
      <span class="sz-mine__cap" data-testid="mine-stat-label">${t(s.label)}</span>
    </div>`)}
  </div>`;
}

/** 整月字数 → 「我的」页放几个字：两行（列数按整月字数定，月字帖页同一个规则 sheetColumns；AX 档四列，格子随字号放大，设计稿 AX5）。 */
export function mineSheetRows(n, ax = 0) {
  const cols = ax > 0 && n > 0 ? Math.min(4, sheetColumns(n)) : sheetColumns(n);
  return { cols, max: cols * 2 };
}

function Sheet({ model, state }) {
  const { sheet } = model;
  const monthNum = Number(model.month.slice(5));
  const title = t('R-P02.sheetTitle', { month: monthNum });
  // D57 · C1：字帖就是月字帖页那一块（MonthBody → MonthPaper：一层框、有几个字几格、日期骑线）；这里只放最近两行，整个标题行进练习记录本月。
  const monthView = useMemo(() => monthModel(state, model.month), [state, model.month]);
  const ax = useAxLevel();
  const { cols, max } = mineSheetRows(monthView.n, ax);
  const { model: shown, truncated } = useMemo(() => mineSheetModel(monthView, max || 1), [monthView, max]);
  return html`<section class="sz-mine__sheetblock" data-testid="mine-sheet" data-month=${sheet.month} data-count=${monthView.n}
    data-shown=${shown.n} data-truncated=${truncated ? 'true' : 'false'} data-days=${sheet.days}>
    <${Button} variant="plain" class="sz-mine__shead" data-testid="mine-sheet-head" onClick=${() => openRecords({ month: model.month })}>
      <h2 class="sz-mine__stitle" data-testid="mine-sheet-title">${title}</h2>
      <span class="sz-mine__sall" data-testid="mine-sheet-all">${monthView.n ? t('R-M05.sheetAll', { n: monthView.n }) : null}<${Chevron} /></span>
    </${Button}>
    <${MonthBody} model=${shown} testid="mine-sheet-grid" cellTestid="mine-sheet-cell" emptyTestid="mine-sheet-empty"
      kuanTestid="mine-sheet-sign" sealTestid="mine-sheet-seal" sign=${!truncated} cols=${truncated || ax > 0 ? cols : 0} />
  </section>`;
}

function remindValue(remind, on) {
  return on ? timeText(remind.hour, remind.minute) : t('R-M03.remindOff');
}

function MineScreen() {
  const state = useStoreState();
  const today = useToday();
  const model = useMemo(() => mineModel(state, today, { policy: defaultPolicy, hasInk: hasInkOfStore() }), [state, today]);
  const view = settingsView(state && state.settings);
  const last = model.lastBackup;
  const annualYear = useMemo(() => annualDefaultYear(state, today), [state, today]); // D66 ⑪：今年没有记录而往年有时指向最近有记录的一年
  const hint = model.backupHint; // D66 ⑱：≥ 30 天没备份 / 笔迹存储接近上限时写在「备份」行右值里（不加红点、不弹窗）
  const backupValue = hint
    ? (hint.kind === 'pressure' ? t('X-MINE.backupNearFull') : t('X-MINE.backupStale', { n: hint.days }))
    : last ? t('R-M03.lastBackup', { date: dayText(last) }) : t('R-M03.noBackup');
  return html`<${TabPage} title=${MINE_LABEL} testid="screen-mine">
    <div class="sz-mine" data-testid="mine-home" data-state=${model.empty ? 'empty' : 'records'} data-today=${today} data-month=${model.month}>
      <${Overview} overview=${model.overview} />
      ${model.empty
        ? html`<div class="sz-mine__gap">${EmptyState({ layout: 'inline', title: t('R-M04.emptyTitle'), body: t('R-M04.emptyBody'), titleTag: 'p',
            testids: { root: 'mine-empty', title: 'mine-empty-title', body: 'mine-empty-body' } })}</div>`
        : html`<${Sheet} model=${model} state=${state} />`}
      <${RowBlock}>
        <${Row} testid="mine-remind" name=${t('R-M03.remind')} value=${remindValue(view.remind, view.on)} valueTestid="mine-remind-value"
          extra=${{ 'data-on': view.on ? 'true' : 'false' }} onClick=${() => go(MINE_ROUTES.remind)} />
        <${Row} testid="mine-library" name=${t('R-S01.library')} value=${view.libraryName} valueTestid="mine-library-value"
          extra=${{ 'data-library': view.library }} onClick=${() => go(MINE_ROUTES.library)} />
        ${view.appearanceSwitch ? html`<${AppearanceRow} current=${view.appearance} />` : null}
        <${GroupSizeRow} current=${view.groupSize} />
      </${RowBlock}>
      <${RowBlock}>
        <${Row} testid="mine-menu-backup" name=${t('R-M03.backup')} onClick=${() => go(MINE_ROUTES.backup)}
          value=${backupValue} valueTestid="mine-backup-value"
          extra=${{ 'data-to': MINE_ROUTES.backup, 'data-last': last || '', 'data-hint': hint ? hint.kind : '' }} />
        <${Row} testid="mine-menu-annual" name=${t('X-MINE.annual')} onClick=${() => go(MINE_ROUTES.annual, annualYear === model.year ? undefined : { year: annualYear })}
          value=${String(annualYear)} valueTestid="mine-annual-year" extra=${{ 'data-to': MINE_ROUTES.annual }} />
        <${Row} testid="mine-menu-about" name=${t('X-MINE.about')} onClick=${() => go(MINE_ROUTES.about)} extra=${{ 'data-to': MINE_ROUTES.about }} />
      </${RowBlock}>
      <p class="sz-mine__ver" data-testid="mine-version"><${VersionText} /></p>
    </div>
  </${TabPage}>`;
}

registerScreen(MINE_TAB, MineScreen, { tab: true, order: 2, label: MINE_LABEL, icon: ICON });
