// 年度报告（02 M4-2；04 R-M06；走查-M01；边改 M07 / L57「导出放以后版本」；原型 ShiziScreen-第十稿交接版 L133–L144、逻辑 L494–L498；
// reference/J-proto-screen.md §2.3.16）。自注册 registerScreen('annual')（params {}）；「我的」菜单「年度报告」按屏名 push（M4-1 MINE_ROUTES.annual）。
//
// 版式（原型 annual）：页头「年度报告」→ 年份（13px / .2em）→ 四节（20px 宋体标题 + 内容 + 15px 说明）→ 页底说明。
//   一 · 今年有记录的字      「{N} 个字」（数字 34px）+「写完并判断过对错的字，写对写错都算。」
//   二 · 有记录天数最多的月份 「{month} 月有记录 {n} 天」+「只看哪天有记录，不分对错。」
//   三 · 较少见的字          96px 格子里标准字形（原型 ref()，RefMini）+ 字 + 拼音 +「今年有记录的字里，它最不常用。」；
//                            没有字频可比时整节不画（原型 annRareOn）。
//   四 · 这一年第一个有记录的字 96px 格子里的真实笔迹（InkMini）+ 字 +「{date} 的笔迹」；D42（解 P122）：笔迹取今年这个字
//                            从早到晚第一份留有墨迹的那一次，{date} 是那一次的日子；
//                            今年里一份笔迹都没有（P31 perRecordInk 关 / 折叠月份 / 都被回收）：格子画标准字 +「没有笔迹」（R-D07 / 10.12，
//                            不拿去年的笔迹冒充，I03），说明行只写日期（最早那条记录的日子；不说「的笔迹」——过渡口径，报告登记待定）。
//   页底「只算今年的记录。这一页不能保存成图片。」——本页没有保存 / 分享入口（R-M06 不导出，P21-04 放以后版本）。
// 空态（原型 annualEmpty）：虚线框「年」+「今年还没有记录」+「写字并判断对错后，这里会汇总你今年的记录。」。
// 数字全部按记录算（annual-model.js，与 M4-1 recordIndex 同一索引）；界面一律阿拉伯数字（T10）。本页不写任何东西、没有可点的格子。
//
// data-testid（前缀 annual-；页面根 annual-screen）：
//   annual-body（data-state=empty|report、data-year、data-today、data-count、data-days）、annual-year、
//   annual-empty、annual-empty-glyph、annual-empty-title、annual-empty-body、
//   annual-section（data-key=count|month|rare|first）、annual-section-title、annual-section-note、
//   annual-count（data-n）、annual-count-unit、annual-month（data-month / data-days）、
//   annual-rare（data-char / data-rank）、annual-rare-glyph、annual-rare-char、annual-rare-py、
//   annual-first（data-char / data-day / data-record / data-ink）、annual-first-ink、annual-first-noink、annual-first-char、annual-first-line、
//   annual-footer。

import { html, useMemo } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { monthDayParts } from '../../../core/dates.js';
import { hasInkPoints, inkOf } from '../detail/records.js';
import { InkMini, RefMini } from '../write/compare.js';
import { useStrokeData } from '../write/hint-layer.js';
import { hasInkOfStore, useStoreState, useToday } from './records.js';
import { annualModel } from './annual-model.js';

export const ANNUAL_SCREEN = 'annual';

injectStyles('mine-annual', `
.sz-ann{display:flex;flex-direction:column;gap:30px}
.sz-ann__year{font-size:calc(13px * ${T.k});letter-spacing:.2em;color:${T.i3};font-variant-numeric:tabular-nums}
.sz-ann__sec{display:flex;flex-direction:column;gap:10px;min-width:0}
.sz-ann__title{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:1.4;font-weight:500;letter-spacing:.04em;color:${T.i2}}
.sz-ann__note{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-ann__count{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.sz-ann__num{font-family:${T.serif};font-size:calc(34px * ${T.k});line-height:1;font-weight:500;color:${T.i1};font-variant-numeric:tabular-nums}
.sz-ann__unit{font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-ann__month{font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:1.4;font-weight:500;color:${T.i1}}
.sz-ann__row{display:flex;gap:16px;align-items:center;min-width:0}
.sz-ann__box{position:relative;width:96px;height:96px;flex:none;box-sizing:border-box;border:1px solid var(--g, rgba(166,83,63,.28));
  background:${T.c};container-type:inline-size}
.sz-ann__box .sz-compare__card{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;background:transparent;padding:0}
.sz-ann__glyph{position:absolute;left:0;right:0;top:42%;transform:translateY(-50%);text-align:center;font-family:var(--kai, ${T.serif});
  font-size:34cqw;line-height:1;color:${T.i3}}
.sz-ann__noink{position:absolute;left:0;right:0;top:80%;transform:translateY(-50%);text-align:center;font-family:${T.sans};
  font-size:clamp(9px, 13cqw, 12px);line-height:1;color:${T.i3};white-space:nowrap}
.sz-ann__side{display:flex;flex-direction:column;gap:4px;min-width:0}
.sz-ann__charline{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sz-ann__char{font-family:var(--kai, ${T.serif});font-size:calc(20px * ${T.k});color:${T.i1}}
.sz-ann__py{font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-ann__empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px 0 48px}
.sz-ann__eglyph{width:88px;height:88px;box-sizing:border-box;border:1px dashed var(--g, rgba(166,83,63,.28));display:grid;place-items:center;
  font-family:var(--kai, ${T.serif});font-size:52px;line-height:1;color:${T.i4}}
.sz-ann__etitle{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});font-weight:500;color:${T.i1}}
.sz-ann__ebody{margin:0;max-width:290px;font-size:calc(13px * ${T.k});line-height:1.75;color:${T.i3}}
`);

function currentStore() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 打开年度报告（「我的」菜单同名屏）。目标屏没注册时只 console.warn。 */
export function openAnnual() {
  if (!getScreen(ANNUAL_SCREEN)) {
    console.warn(`[shizi] screen "${ANNUAL_SCREEN}" is not registered yet`);
    return false;
  }
  nav.push(ANNUAL_SCREEN);
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

/**
 * 「{n} 个字」拆成数字与其余文字（原型 L135：数字 34px 宋体，「个字」15px）。模板里没有 {n} 时整句当单位。
 * @returns {{before:string, num:string, after:string}}
 */
export function countParts(n) {
  const marker = '\u0000';
  const text = t('R-M06.charCount', { n: marker });
  const at = text.indexOf(marker);
  if (at < 0) return { before: '', num: String(n), after: text };
  return { before: text.slice(0, at), num: String(n), after: text.slice(at + marker.length) };
}

/** 四 · 说明行：有笔迹「{date} 的笔迹」（R-M06.inkDate；D45：日期是留有墨迹那一次的日子，不说「今年第一次」）；没有笔迹只写日期（过渡口径，待定）。 */
export function firstLine(day, hasInk) {
  const date = annualDateText(day);
  return hasInk ? t('R-M06.inkDate', { date }) : date;
}

function Section({ k, title, note, children }) {
  return html`<section class="sz-ann__sec" data-testid="annual-section" data-key=${k}>
    <h2 class="sz-ann__title" data-testid="annual-section-title">${title}</h2>
    ${children}
    ${note ? html`<p class="sz-ann__note" data-testid="annual-section-note">${note}</p>` : null}
  </section>`;
}

function RareBlock({ rare }) {
  const strokeData = useStrokeData(rare.char);
  return html`<div class="sz-ann__row" data-testid="annual-rare" data-char=${rare.char} data-rank=${rare.rank}>
    <div class="sz-ann__box">
      <${RefMini} char=${rare.char} strokeData=${strokeData} testid="annual-rare-glyph" label=${t('X-ANNUAL.rareGlyph', { char: rare.char })} />
    </div>
    <span class="sz-ann__side">
      <span class="sz-ann__charline">
        <span class="sz-ann__char" data-testid="annual-rare-char">${rare.char}</span>
        ${rare.py ? html`<span class="sz-ann__py" data-testid="annual-rare-py">${rare.py}</span>` : null}
      </span>
      <p class="sz-ann__note" data-testid="annual-section-note">${t('R-M06.rareNote')}</p>
    </span>
  </div>`;
}

function FirstBlock({ first }) {
  const store = currentStore();
  const ink = useMemo(() => inkOf(store, first.record), [store, first.record]);
  const has = hasInkPoints(ink);
  return html`<div class="sz-ann__row" data-testid="annual-first" data-char=${first.char} data-day=${first.day}
    data-record=${first.record ? first.record.id : ''} data-ink=${has ? 'true' : 'false'}>
    <div class="sz-ann__box">
      ${has
        ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="annual-first-ink" label=${t('X-ANNUAL.firstInk', { char: first.char })} />`
        : html`<span role="img" aria-label=${t('X-ANNUAL.firstNoInk', { char: first.char })}>
            <span class="sz-ann__glyph" aria-hidden="true">${first.char}</span>
            <span class="sz-ann__noink" aria-hidden="true" data-testid="annual-first-noink">${t('R-D07.noInkLabel')}</span>
          </span>`}
    </div>
    <span class="sz-ann__side">
      <span class="sz-ann__char" data-testid="annual-first-char">${first.char}</span>
      <p class="sz-ann__note" data-testid="annual-first-line">${firstLine(first.day, has)}</p>
    </span>
  </div>`;
}

function EmptyState() {
  return html`<div class="sz-ann__empty" data-testid="annual-empty">
    <span class="sz-ann__eglyph" aria-hidden="true" data-testid="annual-empty-glyph">${t('X-ANNUAL.emptyGlyph')}</span>
    <p class="sz-ann__etitle" data-testid="annual-empty-title">${t('R-M06.emptyTitle')}</p>
    <p class="sz-ann__ebody" data-testid="annual-empty-body">${t('R-M06.emptyBody')}</p>
  </div>`;
}

function Report({ model }) {
  const parts = countParts(model.count);
  return html`
    <span class="sz-ann__year" data-testid="annual-year">${model.year}</span>
    <${Section} k="count" title=${t('R-M06.section1')} note=${t('R-M06.section1Note')}>
      <span class="sz-ann__count" data-testid="annual-count" data-n=${model.count}>
        ${parts.before ? html`<span class="sz-ann__unit">${parts.before}</span>` : null}
        <span class="sz-ann__num">${parts.num}</span>
        <span class="sz-ann__unit" data-testid="annual-count-unit">${parts.after.trim()}</span>
      </span>
    </${Section}>
    <${Section} k="month" title=${t('X-ANNUAL.section2')} note=${t('R-M06.monthNote')}>
      <span class="sz-ann__month" data-testid="annual-month" data-month=${model.month ? model.month.month : ''}
        data-days=${model.month ? model.month.days : 0}>
        ${model.month ? t('R-M06.monthDays', { month: model.month.monthNum, n: model.month.days }) : t('R-M06.monthNone')}
      </span>
    </${Section}>
    ${model.rare
      ? html`<${Section} k="rare" title=${t('X-ANNUAL.section3')}><${RareBlock} rare=${model.rare} /></${Section}>`
      : null}
    ${model.first
      ? html`<${Section} k="first" title=${t('X-ANNUAL.section4')}><${FirstBlock} first=${model.first} /></${Section}>`
      : null}
    <p class="sz-ann__note" data-testid="annual-footer">${t('R-M06.footer')}</p>`;
}

function AnnualScreen() {
  const state = useStoreState();
  const today = useToday();
  const model = useMemo(() => annualModel(state, today, { hasInk: hasInkOfStore() }), [state, today]);
  return html`<${Page} title=${t('X-MINE.annual')} testid="annual-screen">
    <div class="sz-ann" data-testid="annual-body" data-state=${model.empty ? 'empty' : 'report'} data-year=${model.year}
      data-today=${today} data-count=${model.count} data-days=${model.days} style=${model.empty ? { flex: '1' } : null}>
      ${model.empty ? html`<${EmptyState} />` : html`<${Report} model=${model} />`}
    </div>
  </${Page}>`;
}

registerScreen(ANNUAL_SCREEN, AnnualScreen, { label: t('X-MINE.annual') });
