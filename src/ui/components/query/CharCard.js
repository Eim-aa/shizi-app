// 查字卡片（R-Q05；决定-D21；原型 字库墨墙屏 L160–L173、L440–L445）。
//
// 能练的字（card）：左「你的书写」（最近一次 judged 的真实笔迹，P19 policy.queryCardInk='latest'；逐判断笔迹未启用
// （P31 perRecordInk=false）或没有笔迹时是虚线空格，有记录无笔迹时写「没有笔迹」，10.12）、右「参考字形」（笔顺数据；
// 取不到时楷体整字，10.13）；字 / 拼音 · N 画 / 词语 / 记录行；按钮「练这个字」、「加入自选的字」或禁用的
// 「已在自选的字里」、有记录时「查看记录」（单字详情 M3-6 之前没有 onDetail，按钮真禁用＝置灰）。
// 加入失败（三段式，01 §4 写入点表）：说明「没加进自选的字，输入的字还在。」+［先不加 / 再试一次］。
// 开始练失败（onPick / onPractice 返回 {ok:false}，R-H06）：说明「没保存上，输入的字还在。」+［先不保存 / 再试一次］。
// 不能练（bad）：「「X」暂时不能练。」+ 原因 + 来源说明；有记录时仍给「查看记录」（原型 L171）。
//
// data-testid：query-card（data-char / data-custom）、query-card-mine / query-card-mine-empty、query-card-ref、
//   query-card-meta、query-card-word、query-card-stat、query-card-practice、query-card-add、query-card-in-custom、
//   query-card-detail、query-card-add-fail（+ -cancel / -retry）、query-card-practice-fail（+ -cancel / -retry）、
//   query-bad（+ -title / -reason / -source）。

import { html, useMemo } from '../../../../vendor/ui.js';
import { Button } from '../Button.js';
import { FailBlock as SharedFailBlock } from '../FailBlock.js';
import { PracticeGlyph, FACE_FULL } from '../PracticeGlyph.js';
import { injectStyles, T } from '../styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { cardStat } from '../../../core/query.js';
import { monthDayParts } from '../../../core/dates.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { InkMini, RefMini } from '../../screens/write/compare.js';

injectStyles('query-card', `
.sz-qcard-wrap{display:flex;flex-direction:column;gap:${T.s4}}
.sz-qcard{box-sizing:border-box;padding:${T.s4};border-radius:${T.rCtl};background:${T.field};display:flex;
  flex-direction:column;gap:${T.s4}}
.sz-qcard__pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${T.s4}}
.sz-qcard__col{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}
.sz-qcard__cell{width:100%;max-width:124px}
.sz-qcard__empty{width:100%;aspect-ratio:1/1;box-sizing:border-box;border:${T.frameW} dashed ${T.frame};border-radius:${T.rWork};
  display:grid;place-items:center;font-size:${T.fs13};color:${T.ink2}}
.sz-qcard__label{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink2}}
.sz-qcard__info{display:flex;flex-direction:column;gap:4px}
.sz-qcard__head{display:flex;align-items:center;gap:10px}
.sz-qcard__char{width:${T.fs28};height:${T.fs28};flex:none;color:${T.ink1}} /* 标准字形用轮廓（P1-E2） */
.sz-qcard__meta{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-qcard__word{font-family:${T.kai};font-size:${T.fs22};line-height:${T.lh22};color:${T.ink1}}
.sz-qcard__stat{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-qcard__acts{display:flex;flex-direction:column;gap:${T.s3}}
.sz-qcard__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-qcard__one{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.sz-qcard__two .sz-btn{padding:0 8px}
.sz-qcard__fail{display:flex;flex-direction:column;gap:${T.s3}}
.sz-qcard__failnote{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-qbad{display:flex;flex-direction:column;gap:${T.s3}}
.sz-qbad__box{display:flex;flex-direction:column;gap:4px;padding:${T.s3} ${T.s4};border-radius:${T.rCtl};background:${T.field}}
.sz-qbad__title{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink1}}
.sz-qbad__line{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink2}}
`);

/** localDay → 「{month} 月 {day} 日」（R-H02.dateFormat；copy-source placeholders 约定界面日期都用它）。 */
export function formatDay(day) {
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 卡片记录行文字（「记录了 N 次 · 最近一次 M 月 D 日」/「还没有记录」）。 */
export function cardStatText(summary) {
  const s = cardStat(summary);
  if (s.key === 'R-Q05.cardStat') return t(s.key, { n: s.vars.n, date: formatDay(s.vars.day) });
  return t(s.key);
}

/** 「{拼音} · N 画」；缺笔画数只写拼音。 */
export function cardMetaText(pinyin, strokeCount) {
  if (pinyin && strokeCount > 0) return t('X-QUERY.cardMeta', { pinyin, n: strokeCount });
  return pinyin || '';
}

/**
 * 「你的书写」取哪一条的笔迹（P19 policy.queryCardInk）：'latest' = 最近一次 judged 记录；逐判断笔迹关闭（P31）时没有。
 * @returns {Array|null} 管线点列（绝对宽），没有返回 null
 */
export function cardInkPoints(summary, getInk, policy = defaultPolicy) {
  if (!summary || !summary.latest || typeof getInk !== 'function') return null;
  if (policy.queryCardInk !== 'latest') return null;
  let ink = null;
  try {
    ink = getInk(summary.latest);
  } catch (error) {
    ink = null;
  }
  const decoded = ink ? decodeInk(ink) : null;
  if (!decoded || !decoded.length) return null;
  return resampleForReplay(decoded);
}

function MineCell({ summary, points }) {
  if (points && points.length) {
    return html`<div class="sz-qcard__cell"><${InkMini} points=${points} testid="query-card-mine" label=${t('R-W09.labelMine')}
      emptyTestid="query-card-mine-empty" emptyText="" /></div>`;
  }
  // 没有记录：虚线空格（原型 lkNone）；有记录没有笔迹：「没有笔迹」（10.12，R-D07.noInkLabel）。
  const text = summary.count ? t('R-D07.noInkLabel') : '';
  return html`<div class="sz-qcard__cell"><div class="sz-qcard__empty" data-testid="query-card-mine-empty">${text}</div></div>`;
}

/** 卡片里的三段式（S1）：全 App 同一个组件（components/FailBlock.js，dialog 排法：[先不 X | 再试一次]）。 */
function FailBlock({ testid, note, cancelLabel, retryLabel, onCancel, onRetry }) {
  return html`<div class="sz-qcard__fail">
    ${SharedFailBlock({ layout: 'dialog', testid: testid, text: note, cancelLabel: cancelLabel, retryLabel: retryLabel, onCancel: onCancel, onRetry: onRetry })}
  </div>`;
}

/**
 * 卡片按钮区（纯视图，test/ui/query.test.mjs 直接调用）：加入失败三段式 > 开始练失败三段式（R-H06）> 正常按钮。
 * 正常：「练这个字」；「加入自选的字」或禁用的「已在自选的字里」；有记录时「查看记录」（没有 onDetail → 禁用＝置灰）。
 */
export function CardActions({ summary, addFailed = false, practiceFailed = false, busy = false, canDetail = false, onPractice, onAdd,
  onAddCancel, onDetail, onPracticeCancel, onPracticeRetry }) {
  if (addFailed) {
    return html`${FailBlock({ testid: 'query-card-add-fail', note: t('R-Q05.addFailed'), cancelLabel: t('R-Q05.cancel'), retryLabel: t('R-Q05.retry'), onCancel: onAddCancel, onRetry: onAdd })}`;
  }
  if (practiceFailed) {
    return html`${FailBlock({ testid: 'query-card-practice-fail', note: t('R-H06.saveFailed'), cancelLabel: t('R-H06.cancel'), retryLabel: t('R-H06.retry'), onCancel: onPracticeCancel, onRetry: onPracticeRetry })}`;
  }
  const parts = cardActionParts({ summary, busy, canDetail, onPractice, onAdd, onDetail });
  return html`<div class="sz-qcard__acts">${parts.primary}${parts.rest}</div>`;
}

/**
 * 正常状态的按钮拆成两块（F5）：primary =「练这个字」（弹层里固定在底部，永远可见）、rest =「加入自选的字 / 已在自选的字里」+「查看记录」
 * （跟卡片一起在中间滚动区里）。失败三段式不在这里（CardActions / QuerySheet 另处理）。
 */
export function cardActionParts({ summary, busy = false, canDetail = false, onPractice, onAdd, onDetail }) {
  const addBtn = summary.custom
    ? html`<${Button} variant="secondary" disabled=${true} data-testid="query-card-in-custom">${t('R-Q05.alreadyAdded')}</${Button}>`
    : html`<${Button} variant="secondary" data-testid="query-card-add" disabled=${busy} onClick=${onAdd}>${t('R-Q05.btnAdd')}</${Button}>`;
  const detailBtn = summary.count > 0
    ? html`<${Button} variant="secondary" data-testid="query-card-detail" disabled=${!canDetail}
        onClick=${onDetail}>${t('R-Q05.viewRecords')}</${Button}>`
    : null;
  return {
    primary: html`<${Button} variant="primary" data-testid="query-card-practice" disabled=${busy} onClick=${onPractice}>${t('R-Q05.btnPractice')}</${Button}>`,
    rest: html`<div class=${detailBtn ? 'sz-qcard__two' : 'sz-qcard__one'}>${addBtn}${detailBtn}</div>`,
  };
}

/** 弹层底部固定的主操作区（F5）：加入失败 / 开始练失败时换成三段式，否则是「练这个字」。 */
export function CardFooter({ summary, addFailed = false, practiceFailed = false, busy = false, onPractice, onAdd, onAddCancel,
  onPracticeCancel, onPracticeRetry }) {
  if (addFailed || practiceFailed) {
    return CardActions({ summary, addFailed, practiceFailed, onAdd, onAddCancel, onPracticeCancel, onPracticeRetry });
  }
  return cardActionParts({ summary, busy, onPractice }).primary;
}

/** 弹层里卡片下面的次要按钮（滚动区内）：失败三段式时不画（失败块在固定底部）。 */
export function CardSecondary({ summary, addFailed = false, practiceFailed = false, busy = false, canDetail = false, onAdd, onDetail }) {
  if (addFailed || practiceFailed) return null;
  return cardActionParts({ summary, busy, canDetail, onAdd, onDetail }).rest;
}

/**
 * 能练的字的卡片。
 * @param {object} p
 * @param {object} p.summary  core/query charSummary（practicable 为真）
 * @param {string} [p.pinyin] @param {string} [p.word] @param {number} [p.strokeCount]
 * @param {{status:string, data:any}} p.strokeData  参考字形数据（hint-layer useStrokeData）
 * @param {Function} [p.getInk]  store.getInk
 * @param {boolean} p.adding / p.addFailed / p.practiceFailed / p.busy
 * @param {boolean} p.canDetail  有 onDetail（M3-6 之后）才可点「查看记录」
 */
export function CharCard(p) {
  const { summary, pinyin = '', word = '', strokeCount = 0, strokeData, getInk, addFailed = false, practiceFailed = false,
    busy = false, canDetail = false, onPractice, onAdd, onAddCancel, onDetail, onPracticeCancel, onPracticeRetry,
    withActions = true } = p;
  const c = summary.char;
  const points = useMemo(() => cardInkPoints(summary, getInk), [summary.latest && summary.latest.id, getInk]);
  const meta = cardMetaText(pinyin, strokeCount || (strokeData && strokeData.data ? strokeData.data.strokes.length : 0));
  const actions = !withActions ? null : html`<${CardActions} summary=${summary} addFailed=${addFailed} practiceFailed=${practiceFailed} busy=${busy}
    canDetail=${canDetail} onPractice=${onPractice} onAdd=${onAdd} onAddCancel=${onAddCancel} onDetail=${onDetail}
    onPracticeCancel=${onPracticeCancel} onPracticeRetry=${onPracticeRetry} />`;
  return html`<div class="sz-qcard-wrap">
    <div class="sz-qcard" data-testid="query-card" data-char=${c} data-custom=${summary.custom ? 'true' : 'false'}>
      <div class="sz-qcard__pair">
        <div class="sz-qcard__col">
          <${MineCell} summary=${summary} points=${points} />
          <span class="sz-qcard__label" aria-hidden="true">${t('R-W09.labelMine')}</span>
        </div>
        <div class="sz-qcard__col">
          <div class="sz-qcard__cell"><${RefMini} char=${c} strokeData=${strokeData} testid="query-card-ref" label=${t('R-W09.labelReference')} /></div>
          <span class="sz-qcard__label" aria-hidden="true">${t('R-W09.labelReference')}</span>
        </div>
      </div>
      <div class="sz-qcard__info">
        <span class="sz-qcard__head"><${PracticeGlyph} class="sz-qcard__char" char=${c} face=${FACE_FULL} />${meta
          ? html`<span class="sz-qcard__meta" data-testid="query-card-meta">${meta}</span>` : null}</span>
        ${word && word !== c ? html`<span class="sz-qcard__word" data-testid="query-card-word">${word}</span>` : null}
        <span class="sz-qcard__stat" data-testid="query-card-stat">${cardStatText(summary)}</span>
      </div>
    </div>
    ${actions}
  </div>`;
}

/** 不能练（R-Q05 不能练三句；原型 lkBad L173）。有记录时仍可「查看记录」。纯视图。 */
export function BadCard({ summary, canDetail = false, onDetail }) {
  const c = summary.char;
  return html`<div class="sz-qbad" data-testid="query-bad" data-char=${c}>
    <div class="sz-qbad__box" role="status">
      <span class="sz-qbad__title" data-testid="query-bad-title">${t('R-Q05.unavailableTitle', { char: c })}</span>
      <span class="sz-qbad__line" data-testid="query-bad-reason">${t('R-Q05.unavailableReason')}</span>
      <span class="sz-qbad__line" data-testid="query-bad-source">${t('R-Q05.unavailableSource')}</span>
    </div>
    ${summary.count > 0 ? html`<${Button} variant="secondary" data-testid="query-card-detail" disabled=${!canDetail}
      onClick=${onDetail}>${t('R-Q05.viewRecords')}</${Button}>` : null}
  </div>`;
}
