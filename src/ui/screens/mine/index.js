// 我的 tab 根页（02 M4-1；04 R-M01–R-M05；03 P02；原型 ShiziScreen-第十稿交接版 L24–L31（mine / mineEmpty）、L382–L388；
// reference/J-proto-screen.md §2.3.1–§2.3.2）。自注册，无中心路由表。
//
// 版式（R-M01：这一周 → {月}字帖 → 菜单；去掉需要再练块、去掉这一周空心小圈）：
//   标题「我的」→ [没有记录：「还没有记录」+「写一个字并判断对错，这里就会有记录。」（R-M04）]
//   → 这一周：标题行（左「这一周」，右「练习记录 ›」→ 练习记录 records）+ 周一到周日 7 格（星期 / 日期 / 墨点；今天红字；
//     今天以后浅字；墨点 = 那天有记录，K27 无补记）
//   → {月}字帖（本月有字才画；D57 · 方案 C1「字帖格 · 按字数排」；R-M01 / P02 取墨 policy.monthSheetPick）：标题行（宋 22 墨一，右「保存图片」15 墨二，
//     同一行，M4-5 用 setMineImageActions 注册后才显示）+ 字帖（month.js MonthBody：一层框、有几个字几格、没有空格、日期骑在格线上、落款与印紧跟末字）；
//     超过一张（80 字）只放最近的，不画落款和印，给「全部 ›」→ 练习记录本月（R-M05）；格子点进单字详情（R-M01）
//   → 菜单：设置 / 备份与恢复（小字「记录只存在这台手机上」；右「上次备份 {date} ›」/「还没有备份」，R-M03）/ 年度报告（小字 = 今年）/
//     关于拾字（原型 L28 顺序）。目标屏由并行卡自注册（M4-3 settings、M4-4 backup、M4-2 annual、M4-6 about），本页只 nav.push；
//     还没注册时按钮不跳转（console.warn）。
// 数字全部按记录算（model.js mineModel；R-M01、K27）。
//
// data-testid（前缀 mine-；页面根 screen-mine）：
//   mine-home（data-state=empty|records / data-today / data-month）、mine-empty、mine-empty-title、mine-empty-body、
//   mine-week、mine-week-title、mine-records（练习记录 ›）、mine-week-day（data-day / data-has / data-today / data-future）、
//   mine-week-dot、mine-sheet（data-month / data-count / data-shown / data-truncated / data-days）、mine-sheet-title、mine-sheet-save、
//   mine-sheet-grid、mine-sheet-cell（data-char / data-day / data-tag / data-record / data-ink）、mine-sheet-all、mine-sheet-sign、
//   mine-sheet-seal、mine-menu、mine-menu-settings / mine-menu-backup / mine-menu-annual / mine-menu-about（data-to=目标屏）、
//   mine-backup-sub、mine-backup-value（data-last=YYYY-MM-DD|''）、mine-annual-year。

import { html, useMemo } from '../../../../vendor/ui.js';
import { registerScreen } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useAxLevel } from '../../components/ax.js';
import { Chevron } from '../../components/Chevron.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { mineModel } from './model.js';
import {
  dayText, getMineImageActions, go, hasInkOfStore, MINE_ROUTES, openRecords, useStoreState, useToday,
} from './records.js'; // 练习记录页自注册（records）；首页墨迹行「今天的记录」也在那里注册
import { MonthBody, mineSheetModel, monthModel, openMonth } from './month.js';

export { MINE_ROUTES, openRecords, openTodayRecords, setMineImageActions, RECORDS_SCREEN } from './records.js';

// tab 名取自文案表（copy/common.js X-TABS）。
export const MINE_LABEL = t('X-TABS.mine');
export const MINE_TAB = 'mine';

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="7" r="3.6"></circle><path d="M4.2 19.4v-3a6.8 6.8 0 0 1 13.6 0v3"></path></svg>`;

injectStyles('mine', `
.sz-mine{display:flex;flex-direction:column;gap:${T.groupGap}}
.sz-mine__block{display:flex;flex-direction:column;gap:${T.s2}}
.sz-mine__sheetblock{display:flex;flex-direction:column;gap:${T.s1}}
.sz-mine__shead{display:flex;justify-content:space-between;align-items:center;gap:${T.s3};min-height:44px}
.sz-mine__stitle{margin:0;min-width:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1}} /* D57：字帖标题宋 22 墨一，与「保存图片」同一行 */
:root[data-ax] .sz-mine__shead{flex-wrap:wrap;align-items:flex-start}
.sz-mine__bhead{display:flex;justify-content:space-between;align-items:baseline;gap:${T.s3}}
.sz-mine__btitle{margin:0;font-family:${T.hei};font-size:${T.fs13};line-height:${T.lh13};font-weight:400;color:${T.ink3}} /* 分组标题：黑体 13 ink3，不画线（T2-14）；右侧「练习记录 ›」仍是 15 / ink2 的文字按钮 */
:root[data-ax] .sz-mine__bhead{flex-wrap:wrap;align-items:center} /* AX 档标题与右侧链接放不下一行时上下排，标题不再被挤成一字一行（A2-03） */
:root[data-ax] .sz-mine__btitle{flex:1 1 auto}
.sz-mine__weeksum{margin:0;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink1}}
.sz-mine__link.sz-btn{flex:none;min-height:44px;font-size:${T.fs15};color:${T.ink2};white-space:nowrap}
.sz-mine__week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));font-variant-numeric:tabular-nums}
.sz-mine__wd{display:flex;flex-direction:column;align-items:center;gap:${T.s1};padding:${T.s1} 0}
.sz-mine__wdname{font-size:${T.fs11};color:${T.ink3}}
.sz-mine__wdnum{width:34px;height:34px;display:grid;place-items:center;font-size:${T.fs15};color:${T.ink1}}
.sz-mine__wd[data-today="true"] .sz-mine__wdnum{color:${T.ink1};font-weight:600}
.sz-mine__wd[data-future="true"] .sz-mine__wdnum{color:${T.ink3}}
.sz-mine__wddot{display:flex;height:6px;align-items:center}
.sz-mine__dot{width:6px;height:6px;border-radius:50%;background:${T.ink1}}
.sz-mine__all.sz-btn{align-self:center;min-height:44px;font-size:${T.fs15};color:${T.ink2}}
.sz-mine__menu{display:flex;flex-direction:column;border-top:${T.hair} solid ${T.line}}
.sz-mine__row.sz-btn{min-height:52px;padding:${T.s3} 0;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border-bottom:${T.hair} solid ${T.line};text-align:left;width:100%}
.sz-mine__rowl{display:flex;flex-direction:column;gap:3px;min-width:0}
/* 列表行（设计系统 v1）：主文字 17 / 22 墨一，副文字 15 / 22 墨三，右侧值 15 墨三，chevron 8×13 墨四；最小高 52，上下 12 */
.sz-mine__rowt{font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink1}}
.sz-mine__rows{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3}}
.sz-mine__rowr{flex:none;display:flex;align-items:center;gap:${T.s2};font-size:${T.fs15};color:${T.ink3}}
.sz-mine__rowr--value{font-size:${T.fs15};color:${T.ink3}}
.sz-mine__bval{display:inline-flex;align-items:center;gap:${T.s2};white-space:nowrap}
:root[data-ax] .sz-mine__row.sz-btn{flex-wrap:wrap;row-gap:${T.s1}} /* AX 档菜单行：右侧的值 / 箭头放不下就换到标题下面，副标题不再被挤成一字一行（A2-03） */
:root[data-ax] .sz-mine__rowl{flex:1 1 60%}
:root[data-ax] .sz-mine__rowr{margin-left:auto}
`);

// ---------------------------------------------------------------- 视图

function Week({ week }) {
  const names = t('X-MINE.weekdays');
  const ax = useAxLevel();
  const days = week.filter(d => d.has).length;
  return html`<div class="sz-mine__block" data-testid="mine-week">
    <div class="sz-mine__bhead">
      <h2 class="sz-mine__btitle" data-testid="mine-week-title">${t('R-M01.week')}</h2>
      <${Button} variant="text" class="sz-mine__link" data-testid="mine-records" onClick=${() => openRecords()}
        >${t('R-M01.practiceLog')} <span aria-hidden="true">${t('X-MINE.chevron')}</span></${Button}>
    </div>
    ${ax > 0
    ? html`<p class="sz-mine__weeksum" data-testid="mine-week-summary" data-n=${days}>${days ? t('X-MINE.weekSummary', { n: days }) : t('X-MINE.weekSummaryNone')}</p>`
    : html`<div class="sz-mine__week" role="list">
      ${week.map(d => html`<span key=${d.day} class="sz-mine__wd" role="listitem" data-testid="mine-week-day" data-day=${d.day}
        data-has=${d.has ? 'true' : 'false'} data-today=${d.today ? 'true' : 'false'} data-future=${d.future ? 'true' : 'false'}
        aria-label=${d.has ? t('X-MINE.dayRecorded', { date: dayText(d.day) }) : dayText(d.day)}>
        <span class="sz-mine__wdname" aria-hidden="true">${names[d.weekday]}</span>
        <span class="sz-mine__wdnum" aria-hidden="true">${d.n}</span>
        <span class="sz-mine__wddot" aria-hidden="true">${d.has ? html`<span class="sz-mine__dot" data-testid="mine-week-dot"></span>` : null}</span>
      </span>`)}
    </div>`}
  </div>`;
}

function Sheet({ model, state }) {
  const { sheet } = model;
  const title = t('R-P02.sheetTitle', { month: Number(model.month.slice(5)) });
  const actions = getMineImageActions();
  // D57 · C1：字帖就是月字帖页那一块（MonthBody → MonthPaper：一层框、有几个字几格、日期骑线），不再是「我的」页自己的小格子；
  // 超过一张（80 字）只放最近的，点「全部」进月字帖页看全部。
  const monthView = useMemo(() => monthModel(state, model.month), [state, model.month]);
  const { model: shown, truncated } = useMemo(() => mineSheetModel(monthView), [monthView]);
  return html`<section class="sz-mine__sheetblock" data-testid="mine-sheet" data-month=${sheet.month} data-count=${monthView.n}
    data-shown=${shown.n} data-truncated=${truncated ? 'true' : 'false'} data-days=${sheet.days}>
    <div class="sz-mine__shead" data-testid="mine-sheet-head">
      <h2 class="sz-mine__stitle" data-testid="mine-sheet-title">${title}</h2>
      ${actions.month
        ? html`<${Button} variant="text" class="sz-mine__link" data-testid="mine-sheet-save"
            onClick=${() => { const fn = getMineImageActions().month; if (fn) fn({ month: sheet.month, sheet }); }}>${t('R-M01.saveImage')}</${Button}>`
        : null}
    </div>
    <${MonthBody} model=${shown} testid="mine-sheet-grid" cellTestid="mine-sheet-cell" emptyTestid="mine-sheet-empty"
      kuanTestid="mine-sheet-sign" sealTestid="mine-sheet-seal" sign=${!truncated} />
    ${truncated
      ? html`<${Button} variant="text" class="sz-mine__all" data-testid="mine-sheet-all"
          onClick=${() => openMonth({ month: sheet.month })}>${t('R-M05.sheetAll')}</${Button}>`
      : null}
  </section>`;
}

// 读屏（M6-1；M3/M4 验收遗留「菜单行无障碍名含副标题」）：按钮的名字只读标题（aria-label），
// 副标题与右侧值作为描述（aria-describedby）读在名字之后，不并进名字。
function MenuRow({ to, testid, title, sub = null, value = null, valueTestid, subTestid }) {
  const subId = `sz-${testid}-sub`;
  const valueId = `sz-${testid}-value`;
  const described = [sub !== null ? subId : null, value !== null ? valueId : null].filter(Boolean).join(' ') || undefined;
  return html`<${Button} variant="plain" class="sz-mine__row" data-testid=${testid} data-to=${to} onClick=${() => go(to)}
    aria-label=${title} aria-describedby=${described}>
    <span class="sz-mine__rowl">
      <span class="sz-mine__rowt">${title}</span>
      ${sub !== null ? html`<span class="sz-mine__rows" id=${subId} data-testid=${subTestid}>${sub}</span>` : null}
    </span>
    ${value !== null
      ? html`<span class="sz-mine__rowr sz-mine__rowr--value" id=${valueId} data-testid=${valueTestid}>${value}</span>`
      : html`<span class="sz-mine__rowr" aria-hidden="true"><${Chevron} /></span>`}
  </${Button}>`;
}

function Menu({ model }) {
  const last = model.lastBackup;
  // 行尾的「›」一律是装饰性的 Chevron（aria-hidden），不写进文案（I3 · P1-22）
  const backupValue = html`${last ? t('R-M03.lastBackup', { date: dayText(last) }) : t('R-M03.noBackup')} <${Chevron} />`;
  return html`<nav class="sz-mine__menu" data-testid="mine-menu" aria-label=${MINE_LABEL}>
    <${MenuRow} to=${MINE_ROUTES.settings} testid="mine-menu-settings" title=${t('R-M03.settings')} />
    <${MenuRow} to=${MINE_ROUTES.backup} testid="mine-menu-backup" title=${t('R-M03.backup')} sub=${t('R-M03.backupSub')}
      subTestid="mine-backup-sub" value=${html`<span class="sz-mine__bval" data-testid="mine-backup-value" data-last=${last || ''}>${backupValue}</span>`} />
    <${MenuRow} to=${MINE_ROUTES.annual} testid="mine-menu-annual" title=${t('X-MINE.annual')}
      sub=${html`<span data-testid="mine-annual-year">${model.year}</span>`} />
    <${MenuRow} to=${MINE_ROUTES.about} testid="mine-menu-about" title=${t('X-MINE.about')} />
  </nav>`;
}

function MineScreen() {
  const state = useStoreState();
  const today = useToday();
  const model = useMemo(() => mineModel(state, today, { policy: defaultPolicy, hasInk: hasInkOfStore() }), [state, today]);
  return html`<${TabPage} title=${MINE_LABEL} testid="screen-mine">
    <div class="sz-mine" data-testid="mine-home" data-state=${model.empty ? 'empty' : 'records'} data-today=${today} data-month=${model.month}>
      ${model.empty
        ? EmptyState({ layout: 'inline', title: t('R-M04.emptyTitle'), body: t('R-M04.emptyBody'), titleTag: 'p',
            testids: { root: 'mine-empty', title: 'mine-empty-title', body: 'mine-empty-body' } })
        : null}
      <${Week} week=${model.week} />
      ${model.sheetOn ? html`<${Sheet} model=${model} state=${state} />` : null}
      <${Menu} model=${model} />
    </div>
  </${TabPage}>`;
}

registerScreen(MINE_TAB, MineScreen, { tab: true, order: 2, label: MINE_LABEL, icon: ICON });
