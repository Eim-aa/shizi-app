// 我的 tab 根页（02 M4-1；04 R-M01–R-M05；03 P02；原型 ShiziScreen-第十稿交接版 L24–L31（mine / mineEmpty）、L382–L388；
// reference/J-proto-screen.md §2.3.1–§2.3.2）。自注册，无中心路由表。
//
// 版式（R-M01：这一周 → {月}字帖 → 菜单；去掉需要再练块、去掉这一周空心小圈）：
//   标题「我的」→ [没有记录：「还没有记录」+「写一个字并判断对错，这里就会有记录。」（R-M04）]
//   → 这一周：标题行（左「这一周」，右「练习记录 ›」→ 练习记录 records）+ 周一到周日 7 格（星期 / 日期 / 墨点；今天红字；
//     今天以后浅字；墨点 = 那天有记录，K27 无补记）
//   → {月}字帖（本月有字才画，原型 mineSheet；R-M01 / P02 取墨 policy.monthSheetPick）：标题行（右「保存图片 ›」——与练习记录
//     同一入口，M4-5 用 setMineImageActions 注册后才显示）+ 纸卡（7 列 1px 缝；最多放最近 3 行，多了给「全部 ›」→ 练习记录本月，
//     R-M05）+ 落款（R-I01.monthSignature）+ 红印；格子点进单字详情（R-M01）
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
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { mineModel, MINE_SHEET_COLS } from './model.js';
import {
  dayText, getMineImageActions, go, MINE_ROUTES, openRecords, Seal, SheetGrid, signatureText, useStoreState, useToday,
} from './records.js'; // 练习记录页自注册（records）；首页墨迹行「今天的记录」也在那里注册

export { MINE_ROUTES, openRecords, openTodayRecords, setMineImageActions, RECORDS_SCREEN } from './records.js';

// tab 名取自文案表（copy/common.js X-TABS）。
export const MINE_LABEL = t('X-TABS.mine');
export const MINE_TAB = 'mine';

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="7" r="3.6"></circle><path d="M4.2 19.4v-3a6.8 6.8 0 0 1 13.6 0v3"></path></svg>`;

injectStyles('mine', `
.sz-mine{display:flex;flex-direction:column;gap:26px}
.sz-mine__empty{display:flex;flex-direction:column;gap:8px}
.sz-mine__emptyt{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:1.5;font-weight:500;color:${T.i1}}
.sz-mine__emptyb{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-mine__block{display:flex;flex-direction:column;gap:8px}
.sz-mine__sheetblock{display:flex;flex-direction:column;gap:10px}
.sz-mine__bhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.sz-mine__btitle{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});font-weight:500;
  letter-spacing:.04em;color:${T.i2}}
.sz-mine__link.sz-btn{flex:none;min-height:44px;font-size:calc(15px * ${T.k});letter-spacing:.04em;color:${T.i2};white-space:nowrap}
.sz-mine__week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));font-variant-numeric:tabular-nums}
.sz-mine__wd{display:flex;flex-direction:column;align-items:center;gap:6px;padding:4px 0}
.sz-mine__wdname{font-size:calc(11px * ${T.k});color:${T.i3}}
.sz-mine__wdnum{width:34px;height:34px;display:grid;place-items:center;font-size:calc(15px * ${T.k});color:${T.i1}}
.sz-mine__wd[data-today="true"] .sz-mine__wdnum{color:${T.ar};font-weight:600}
.sz-mine__wd[data-future="true"] .sz-mine__wdnum{color:${T.i3}}
.sz-mine__wddot{display:flex;height:6px;align-items:center}
.sz-mine__dot{width:6px;height:6px;border-radius:50%;background:${T.i1}}
.sz-mine__paper{box-sizing:border-box;background:${T.c};border:.5px solid ${T.i5};box-shadow:0 12px 28px rgba(59,47,40,.08);
  padding:14px 14px 12px;display:flex;flex-direction:column;gap:12px}
.sz-mine__all.sz-btn{align-self:center;min-height:44px;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-mine__menu{display:flex;flex-direction:column;border-top:1px solid ${T.i5}}
.sz-mine__row.sz-btn{min-height:52px;padding:8px 0;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;
  gap:12px;border-bottom:1px solid ${T.i5};text-align:left;width:100%}
.sz-mine__rowl{display:flex;flex-direction:column;gap:3px;min-width:0}
.sz-mine__rowt{font-size:calc(15px * ${T.k});color:${T.i1}}
.sz-mine__rows{font-size:calc(15px * ${T.k});line-height:1.5;color:${T.i2}}
.sz-mine__rowr{flex:none;display:flex;align-items:center;gap:8px;font-size:calc(13px * ${T.k});color:${T.i3}}
.sz-mine__rowr--value{font-size:calc(15px * ${T.k});color:${T.i2}}
`);

// ---------------------------------------------------------------- 视图

function Week({ week }) {
  const names = t('X-MINE.weekdays');
  return html`<div class="sz-mine__block" data-testid="mine-week">
    <div class="sz-mine__bhead">
      <h2 class="sz-mine__btitle" data-testid="mine-week-title">${t('R-M01.week')}</h2>
      <${Button} variant="text" class="sz-mine__link" data-testid="mine-records" onClick=${() => openRecords()}
        >${t('R-M01.practiceLog')} <span aria-hidden="true">${t('X-MINE.chevron')}</span></${Button}>
    </div>
    <div class="sz-mine__week" role="list">
      ${week.map(d => html`<span key=${d.day} class="sz-mine__wd" role="listitem" data-testid="mine-week-day" data-day=${d.day}
        data-has=${d.has ? 'true' : 'false'} data-today=${d.today ? 'true' : 'false'} data-future=${d.future ? 'true' : 'false'}
        aria-label=${d.has ? t('X-MINE.dayRecorded', { date: dayText(d.day) }) : dayText(d.day)}>
        <span class="sz-mine__wdname" aria-hidden="true">${names[d.weekday]}</span>
        <span class="sz-mine__wdnum" aria-hidden="true">${d.n}</span>
        <span class="sz-mine__wddot" aria-hidden="true">${d.has ? html`<span class="sz-mine__dot" data-testid="mine-week-dot"></span>` : null}</span>
      </span>`)}
    </div>
  </div>`;
}

function Sheet({ model }) {
  const { sheet, preview } = model;
  const monthNum = Number(model.month.slice(5));
  const title = t('R-P02.sheetTitle', { month: monthNum });
  const actions = getMineImageActions();
  return html`<section class="sz-mine__sheetblock" data-testid="mine-sheet" data-month=${sheet.month} data-count=${sheet.chars}
    data-shown=${preview.cells.length} data-truncated=${preview.truncated ? 'true' : 'false'} data-days=${sheet.days}>
    <div class="sz-mine__bhead">
      <h2 class="sz-mine__btitle" data-testid="mine-sheet-title">${title}</h2>
      ${actions.month
        ? html`<${Button} variant="text" class="sz-mine__link" data-testid="mine-sheet-save"
            onClick=${() => { const fn = getMineImageActions().month; if (fn) fn({ month: sheet.month, sheet }); }}>${t('R-M01.saveImage')}</${Button}>`
        : null}
    </div>
    <div class="sz-mine__paper">
      <${SheetGrid} cells=${preview.cells} cols=${MINE_SHEET_COLS} variant="gap" testid="mine-sheet-grid" cellTestid="mine-sheet-cell"
        label=${title} />
      ${preview.truncated
        ? html`<${Button} variant="text" class="sz-mine__all" data-testid="mine-sheet-all"
            onClick=${() => openRecords({ month: sheet.month })}>${t('R-M05.sheetAll')}</${Button}>`
        : null}
      <div class="sz-msign">
        <span class="sz-msign__text"><span class="sz-msign__line" data-testid="mine-sheet-sign">${signatureText(sheet)}</span></span>
        <${Seal} small=${true} testid="mine-sheet-seal" />
      </div>
    </div>
  </section>`;
}

function MenuRow({ to, testid, title, sub = null, value = null, valueTestid, subTestid }) {
  return html`<${Button} variant="plain" class="sz-mine__row" data-testid=${testid} data-to=${to} onClick=${() => go(to)}>
    <span class="sz-mine__rowl">
      <span class="sz-mine__rowt">${title}</span>
      ${sub !== null ? html`<span class="sz-mine__rows" data-testid=${subTestid}>${sub}</span>` : null}
    </span>
    ${value !== null
      ? html`<span class="sz-mine__rowr sz-mine__rowr--value" data-testid=${valueTestid}>${value}</span>`
      : html`<span class="sz-mine__rowr" aria-hidden="true">${t('X-MINE.chevron')}</span>`}
  </${Button}>`;
}

function Menu({ model }) {
  const last = model.lastBackup;
  const backupValue = last
    ? t('R-M03.lastBackup', { date: dayText(last) })
    : html`${t('R-M03.noBackup')} <span aria-hidden="true">${t('X-MINE.chevron')}</span>`;
  return html`<nav class="sz-mine__menu" data-testid="mine-menu" aria-label=${MINE_LABEL}>
    <${MenuRow} to=${MINE_ROUTES.settings} testid="mine-menu-settings" title=${t('R-M03.settings')} />
    <${MenuRow} to=${MINE_ROUTES.backup} testid="mine-menu-backup" title=${t('R-M03.backup')} sub=${t('R-M03.backupSub')}
      subTestid="mine-backup-sub" value=${html`<span data-testid="mine-backup-value" data-last=${last || ''}>${backupValue}</span>`} />
    <${MenuRow} to=${MINE_ROUTES.annual} testid="mine-menu-annual" title=${t('X-MINE.annual')}
      sub=${html`<span data-testid="mine-annual-year">${model.year}</span>`} />
    <${MenuRow} to=${MINE_ROUTES.about} testid="mine-menu-about" title=${t('X-MINE.about')} />
  </nav>`;
}

function MineScreen() {
  const state = useStoreState();
  const today = useToday();
  const model = useMemo(() => mineModel(state, today, { policy: defaultPolicy }), [state, today]);
  return html`<${TabPage} title=${MINE_LABEL} testid="screen-mine">
    <div class="sz-mine" data-testid="mine-home" data-state=${model.empty ? 'empty' : 'records'} data-today=${today} data-month=${model.month}>
      ${model.empty
        ? html`<div class="sz-mine__empty" data-testid="mine-empty">
            <p class="sz-mine__emptyt" data-testid="mine-empty-title">${t('R-M04.emptyTitle')}</p>
            <p class="sz-mine__emptyb" data-testid="mine-empty-body">${t('R-M04.emptyBody')}</p>
          </div>`
        : null}
      <${Week} week=${model.week} />
      ${model.sheetOn ? html`<${Sheet} model=${model} />` : null}
      <${Menu} model=${model} />
    </div>
  </${TabPage}>`;
}

registerScreen(MINE_TAB, MineScreen, { tab: true, order: 2, label: MINE_LABEL, icon: ICON });
