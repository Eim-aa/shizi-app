// 结果页（M2-3；决定-D18 / D19 / D20 / D22；01 §3.2 / §3.3；04 R-R01–R-R07、R-W11；03 P11 / P14 / P15 / P50 / P62；
// 边改 S05；原型 ShiziScreen L116–L124（result / firstResult / endPicked）、L421–L457（数据与修改判断弹层）；
// reference/J-proto-screen.md §2.3.11–§2.3.13）。
//
// 进入：写字页最后一字处理完（判断 / 看答案后「下一个」/ 跳过）→ 会话移入 lastEnded[slot]（commitFinish）→ 写字页就地换成本页
// （nav.replace('result', {slot, sessionId})，决定-D20：无中间页）；「结束这组」有判断时同样换成本页（write/end.js）。
// 停在本页刷新：按 params 从 lastEnded[slot] 恢复（01 §3.3）；会话还在槽里（写完但结束写入失败）时照样显示并补写结束。
//
// 三态（按会话 kind）：
//   daily  「这次练习」：标题「这次记录了 N 个字」/「这次没有记下字」（R-R01，N 按本组 judged 记录算）；4 列格子；
//          「这次的图片」入口（R-R07，占位到 M4-5）；底栏「再写一组」+「回到首页」。
//   first  「第一次练习」：阶段 1 P1-E5 起标题「这三个字，很多人提笔就忘。」（不以计数作标题，D28）、格子、日期行（R-R03：只写日期）、
//          写错字的「放进去」入口、复现预告句（FSRS 实际到期，D41）、提醒邀请（内嵌，D35 / D46 ③）；底栏「再写一组」+「回到首页」。
//          首练专属的三块在 result/first.js（与 P1-E7 作品出口的分界：本文件的格子 / 日期行 / 图片入口属通用结果页，E7 改构图）。
//   picked 「这次选的字」：标题「这次选的字 / 写完了」或中途结束「这次选的字 / 先写到这里」（R-R05，P14）；3 列格子；
//          说明「「额」「鲜」都记下了。」…「还有 N 个字没写，没有记下。」；日期行「{日期} · 自己选的 / 从写错过 / 从快忘了」（S05）；
//          底栏离开按钮按来源（R-R06）。没有图片行。
//   难度块按 P11（features.difficultyFeedback=false）不做。
// 说明句（R-R01 / P62）：看过答案与跳过的字按字列出（只有一类时按示例拆成两句）；都没有时用默认说明；末尾「点一个格子…」。
// 格子（R-R02）：本人笔迹（有墨迹或本页面会话里刚判断时记下的笔画）/ 没有笔迹时标准字 +「没有笔迹」（10.12）/
//   看过答案、跳过为浅色楷体字；格下「字 + 写对 / 写错（红）/ 看过答案 / 跳过」。点格子 → 底部对照弹层：
//   判断过的字可「改为…」（同一记录只改 judgment、追加 corrections、以 fsrsBefore 重放更新 sched，不增加记录，决定-D19）；
//   看过答案 / 跳过的字只看不改（K25）。失败「没改成，还是原来的判断。」[先不改 / 再试一次]。
// 跳过的 5 秒撤销（走查-W16；D36）：最后一字跳过后写字页把撤销机会交给本页（handoffSkipUndo），底栏照样显示到 5 秒（计时在 SkipUndoDock 里）；
//   撤销 = 一次 commit：会话从 lastEnded 放回槽里、删掉 skipped 记录、字放回 cursor、笔画写回 current.strokes；
//   成功后本页就地换回写字页（回到那个字）。
// 离开：「回到首页 / 字库 / 我的」回对应 tab 根；其余来源（写错过 / 快忘了 / 有记录的字 / 某个字）按页面栈返回到下面的来源页。
//   本页被移出页面栈后清掉 lastEnded[slot]（01 §3.3）；清不掉不影响（下次开同槽时一并清）。
//
// 规则：所有写入只经 store.commit；文案只取 copy/。
//
// data-testid：result-screen、result-body（data-variant=daily|first|picked、data-early）、result-kicker、result-title、
//   result-sub、result-grid、result-cell（data-index / data-kind / data-judgment / data-changeable）、result-cell-ink、
//   result-cell-noink、result-cell-glyph、result-cell-char、result-cell-caption、result-date、result-image（「这次的图片」入口）、
//   result-image-note、result-remind-slot（首练 / 今天的练习的提醒邀请块，见 first.js）、result-again、result-leave、result-again-note / result-again-cancel /
//   result-again-retry（再写一组失败）、result-sheet（对照弹层面板，data-kind）、result-sheet-close（取消 / 关闭）、
//   result-sheet-mine / result-sheet-ref / result-sheet-noink、result-sheet-note、result-sheet-flip、
//   result-sheet-fail-cancel / result-sheet-fail-retry；撤销底栏沿用 write-skip-undo*（skip.js SkipUndoBar）。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange, pressFeedbackHandlers } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { PracticeGlyph, FACE_FULL } from '../../components/PracticeGlyph.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { installCommitFeedback } from '../../../platform/haptics.js'; // M5-5 触觉 / 按键音（按 commit label）
import { deckAdapter } from '../../../data/deck.js';
import { localDay, monthDayParts } from '../../../core/dates.js';
import { charOfCardKey, compareRecordIds, correctRecord, isJudged, sortById } from '../../../core/records.js';
import { canCorrect, clearLastEnded, endSlot, fsrsBeforeOf, isComplete } from '../../../core/sessions.js';
import { replay } from '../../../core/fsrs.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import * as sessionStart from '../../../core/session-start.js';
import { allRecords, replaceRecordInDraft } from '../write/answer.js';
import { InkMini, RefMini, recalledInk } from '../write/compare.js';
import { useStrokeData } from '../write/hint-layer.js';
import { SkipUndoDock, canUndoSkip, undoSkipInDraft } from '../write/skip.js';
import '../write/result-row.js'; // .sz-change* 弹层样式（与写字页修改判断弹层同一版式）
import { openWrite } from '../session/index.js';
import { openNonePage } from '../session/none.js';
import { ReminderInvite, ReviewPreview, firstExtras } from './first.js';
import { WorkRows, WorkSection, commitAdded } from './work.js';
import { addedOf, buildWork } from '../../../core/images/work.js';

export { commitAdded };

export const RESULT_SCREEN = 'result';
export const LABELS = Object.freeze({
  finish: 'result:finish',
  leave: 'result:leave',
  correct: 'result:correct',
  undoSkip: 'result:skip-undo',
});

/** 格子列数（原型：result 4 列、firstResult 5 列、endPicked 3 列，<3 个时按个数居中）。 */
export const GRID_COLS = Object.freeze({ daily: 4, first: 5, picked: 3 });

// 离开按钮（R-R06；04 §3.2 原型 LEAVE 映射；旧键 againList → wrongList，改动 L19）。
const LEAVE_KEYS = Object.freeze({
  wrongList: 'R-R06.leaveWrong',
  againList: 'R-R06.leaveWrong',
  forgetList: 'R-R06.leaveForget',
  allWritten: 'R-R06.leaveAll',
  mine: 'R-R06.leaveMine',
  library: 'R-R06.leaveLibrary',
  detail: 'R-R06.leaveDetail',
  home: 'X-RESULT.leaveHome',
});
// 来源说明（边改 S05）：从写错过 / 从快忘了 / 其余一律「自己选的」。
const FROM_KEYS = Object.freeze({
  wrongList: 'R-R06.fromWrong',
  againList: 'R-R06.fromWrong',
  forgetList: 'R-R06.fromForget',
});
/** 离开时直接回 tab 根的来源（其余来源按页面栈返回）。 */
const TAB_VIEWS = Object.freeze(['home', 'library', 'mine']);

injectStyles('result', `
.sz-result{display:flex;flex-direction:column;gap:28px}
.sz-result__head{display:flex;flex-direction:column;gap:8px}
.sz-result__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1};text-wrap:pretty}
.sz-result__title--lead{font-size:${T.fs22};line-height:${T.lh22}}
.sz-result__title:focus{outline:none}
.sz-result__kicker{display:block}
.sz-result__sub{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-result__grid{display:grid;box-sizing:border-box;border-top:${T.frameW} solid ${T.frame};
  border-left:${T.frameW} solid ${T.frame};${TEX}}
.sz-result__grid--few{align-self:center}
.sz-rcell{position:relative;display:flex;flex-direction:column;box-sizing:border-box;min-width:0;padding:0;margin:0;
  border:0;border-right:${T.frameW} solid ${T.frame};border-bottom:${T.frameW} solid ${T.frame};
  border-radius:0;background:transparent;color:inherit;font:inherit;text-align:center;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
.sz-rcell:disabled{cursor:default}
.sz-rcell:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-rcell[data-pressed]{background:${T.field}}
.sz-rcell__sq{position:relative;aspect-ratio:1/1;display:grid;place-items:center;overflow:hidden}
.sz-rcell__sq .sz-compare__card{position:absolute;inset:0;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
/* 格内字形是图，不随大字倍率放大（格子宽度不变，放大会压到「没有笔迹」）。衬底字用轮廓（P1-E2）：44 方框，字面约 35 */
.sz-rcell__glyph{width:44px;height:44px;color:${T.under}}
.sz-rcell__glyph--shape{transform:translateY(-6px)}
.sz-rcell__noink{position:absolute;left:0;right:0;bottom:4px;font-size:${T.fs11};line-height:${T.lh11};color:${T.ink3}}
.sz-rcell__cap{min-height:34px;box-sizing:border-box;padding:3px 2px;display:flex;flex-wrap:wrap;align-items:center;
  justify-content:center;gap:2px 4px;border-top:${T.frameW} solid ${T.frame};font-size:${T.fs11};
  line-height:${T.lh11};color:${T.ink2}}
.sz-rcell__char{width:${T.fs15};height:${T.fs15};color:${T.ink1}}
.sz-rcell--pad{cursor:default}
.sz-result__date{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-result[data-variant="daily"],.sz-result[data-variant="first"]{gap:16px}
.sz-result__remind{margin-top:12px}
.sz-result__remind:empty{display:none}
.sz-result__leave{align-self:center;justify-content:center}
.sz-result__fail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-result__failnote{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

// ---------------------------------------------------------------- 纯函数：读状态

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/**
 * 结果页要显示的会话：lastEnded[slot]（已结束）或 sessions[slot]（写完但还没移入 lastEnded）。
 * @returns {{session, where:'ended'|'slot'} | null}
 */
export function findResultSession(state, { slot, sessionId }) {
  const s = sessionsOf(state);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) return { session: ended, where: 'ended' };
  const live = s[slot];
  if (live && live.id === sessionId) return { session: live, where: 'slot' };
  return null;
}

/** 本组的记录（按 id 顺序）。 */
export function recordsOfSession(state, sessionId) {
  return sortById(allRecords(state).filter(r => r && r.sessionId === sessionId));
}

function quote(chars) {
  return chars.map(c => `「${c}」`).join('');
}

function uniq(list) {
  return [...new Set(list)];
}

function dayOfSession(session) {
  if (!session) return null;
  const at = Number.isFinite(session.endedAt) ? session.endedAt : session.updatedAt;
  return Number.isFinite(at) ? localDay(at) : session.startedDay || null;
}

function dateText(day) {
  if (!day) return '';
  return t('R-H02.dateFormat', monthDayParts(day));
}

/** 离开按钮：{view, label, char?}。 */
export function leaveOf(source) {
  const view = source && typeof source.view === 'string' ? source.view : 'home';
  const char = source && typeof source.char === 'string' ? source.char : null;
  if (view === 'detail' && char) return { view, char, label: t(LEAVE_KEYS.detail, { char }) };
  const key = view !== 'detail' ? LEAVE_KEYS[view] : null;
  if (key) return { view: view === 'againList' ? 'wrongList' : view, char, label: t(key) };
  return { view: 'home', char: null, label: t(LEAVE_KEYS.home) };
}

/** 来源说明（S05）。 */
export function fromOf(source) {
  const view = source && typeof source.view === 'string' ? source.view : 'home';
  return t(FROM_KEYS[view] || 'R-R06.fromPicked');
}

/**
 * 看过答案 / 跳过的说明句（R-R01；P62：只有一类时按示例拆成两句；都没有时默认说明）。
 */
export function seenSkippedNote(seen, skipped) {
  if (seen.length && skipped.length) return t('R-R01.noteSeenSkipped', { seen: quote(seen), skipped: quote(skipped) });
  if (seen.length) return t('X-RESULT.noteSeenOnly', { seen: quote(seen) });
  if (skipped.length) return t('X-RESULT.noteSkippedOnly', { skipped: quote(skipped) });
  return '';
}

function captionOf(kind, judgment) {
  if (kind === 'judged') return t(judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  if (kind === 'answer-seen') return t('R-R02.cellSaw');
  return t('X-RESULT.cellSkipped');
}

/**
 * 结果页模型（纯函数；单测直接调用）。
 * @param {object} state   store 状态
 * @param {{slot:'A'|'B', sessionId:string, hasInk?:(record)=>boolean, policy?:object}} o
 *   hasInk：这条 judged 记录有没有本人笔迹（「这次的图片」只画有笔迹的字，R-R07 / 10.12）。口径与格子一致（I6 / P88）：
 *   存下的墨迹（perRecordInk）或本页面会话里刚判断时记下的笔画（write/compare.js recalledInk）任一即算——图片取墨
 *   （images-entry.js inkPointsOf）也是这两处。页面内笔画刷新即失：perRecordInk 关时刷新后入口按 R-R07.allMissing。
 *   缺省看 state.ink + recalledInk；页面传入与格子同一个取法（inkOf）。perRecordInk=true（D27）时 recalledInk 不再补位，
 *   只看存下的墨迹。
 */
export function resultModel(state, { slot, sessionId, hasInk = null, policy = defaultPolicy }) {
  const found = findResultSession(state, { slot, sessionId });
  const session = found ? found.session : null;
  const records = recordsOfSession(state, sessionId);
  const byId = new Map(records.map(r => [r.id, r]));
  const items = session
    ? session.items.concat(seenCurrentItem(session, records))
    : records.map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const cells = items.map((it, index) => {
    const record = it.recordId ? byId.get(it.recordId) || null : null;
    const kind = record ? record.kind : it.kind;
    const char = record ? record.char : charOfCardKey(it.cardKey);
    const judgment = kind === 'judged' && record ? record.judgment : null;
    return {
      index,
      cardKey: it.cardKey,
      recordId: record ? record.id : it.recordId || null,
      char,
      kind,
      judgment,
      caption: captionOf(kind, judgment),
      canChange: kind === 'judged' && !!record && !record.legacy && !!session && canCorrect(session, record.id),
    };
  });
  const judgedCells = cells.filter(c => c.kind === 'judged');
  const count = new Set(records.filter(isJudged).map(r => r.cardKey)).size;
  const seen = uniq(cells.filter(c => c.kind === 'answer-seen').map(c => c.char));
  const skipped = uniq(cells.filter(c => c.kind === 'skipped').map(c => c.char));
  const variant = session ? (session.kind === 'picked' ? 'picked' : session.kind === 'first' ? 'first' : 'daily') : slot === 'B' ? 'picked' : 'daily';
  const early = !!(session && session.endedEarly);
  const unwritten = session ? Math.max(0, session.queue.length - session.cursor) : 0;
  const source = session && session.source ? session.source : { view: 'home' };
  const day = dayOfSession(session);

  const sub = [];
  let header;
  let kicker = null;
  let title;
  if (variant === 'picked') {
    header = t('R-R05.kicker');
    kicker = t('R-R05.kicker');
    title = t(early ? 'R-R05.earlyTitle' : 'X-RESULT.pickedDoneTitle');
    const ok = uniq(judgedCells.map(c => c.char));
    if (ok.length > 1) sub.push(t('R-R05.bodyAll', { chars: quote(ok) }));
    else if (ok.length === 1) sub.push(t('R-R05.bodyOne', { char: ok[0] }));
    const xs = seenSkippedNote(seen, skipped);
    if (xs) sub.push(xs);
    if (early && unwritten > 0) sub.push(t('R-R05.bodyEarly', { n: unwritten }));
  } else {
    // 阶段 1 P1-E7（交接 §5.1）：结果页最上面就是作品，不写「这次记录了 N 个字」「点一个格子…」；数量只出现在落款里。
    // 首练保留标题（D28 / P1-E5）：不以计数作标题；说明由格下标注与复现预告承担。
    header = t(variant === 'first' ? 'X-RESULT.headerFirst' : 'X-RESULT.headerDaily');
    title = variant === 'first' ? t('X-FIRST.title') : null;
  }
  if (variant === 'picked' && cells.length) sub.push(t('R-R02.gridHint'));

  let dateLine = null;
  if (variant === 'picked') dateLine = day ? t('X-RESULT.dateSource', { date: dateText(day), source: fromOf(source) }) : null;

  // 作品（daily / first；picked 没有作品，交接 §4–§5）：成员规则见 core/images/work.js。inkTest = 这条记录有没有本人墨
  // （存下的墨迹或本页面会话里刚判断时记下的笔画，与格子 / 图片取墨同一取法，I6）。
  const inkTest = typeof hasInk === 'function' ? hasInk : record => !!inkEntryOf(state, record) || hasStrokes(recalledInk(record.id, policy));
  const work = variant !== 'picked' && cells.length
    ? buildWork({ items: items.map(it => ({ cardKey: it.cardKey, recordId: it.recordId, kind: it.kind })), records: byId, hasInk: inkTest, added: addedOf(session) })
    : null;
  // 分享入口：作品里至少有一个字（没有任何墨时隐藏，§4.1）
  const share = !!work && work.cells.length > 0;

  return {
    found: !!session,
    where: found ? found.where : null,
    session,
    slot,
    sessionId,
    variant,
    early,
    header,
    kicker,
    title,
    sub,
    cells,
    cols: GRID_COLS[variant],
    count,
    seen,
    skipped,
    unwritten,
    dateLine,
    day,
    work,
    share,
    leave: leaveOf(source),
    again: variant === 'daily' || variant === 'first',
    source,
  };
}

/**
 * P77（过渡「补进」）：从看答案阶段（answer / trace / retrace，或看过答案后恢复到的 recall）「结束这组」时，当前字已写了
 * answer-seen 记录但会话没推进（items 里没有它）——结果页补一格「看过答案」（不可改判，K25）。
 * 只认本会话（sessionId 已由 records 过滤）、当前字的最近一条 answer-seen 记录；没有记录就不补（D22：没写完的字不算）。
 * 标题数字只按 judged 算，不受影响；说明句里的看过答案列举含它。
 * @returns {Array<{cardKey, recordId, kind:'answer-seen'}>} 0 或 1 项
 */
export function seenCurrentItem(session, records) {
  const cur = session && session.current;
  if (!cur || cur.answerSeen !== true) return [];
  if (!(session.cursor >= 0 && session.cursor < session.queue.length)) return [];
  const key = session.queue[session.cursor];
  if (session.items.some(it => it && it.cardKey === key)) return [];
  let rec = null;
  for (const r of records) if (r && r.kind === 'answer-seen' && r.cardKey === key && r.sessionId === session.id) rec = r; // 按 id 升序，取最后
  return rec ? [{ cardKey: key, recordId: rec.id, kind: 'answer-seen' }] : [];
}

function hasStrokes(strokes) {
  return Array.isArray(strokes) && strokes.some(st => Array.isArray(st) && st.length > 0);
}

/** 格子上的本人笔迹是否有东西可画（inkOf 的结果；「这次的图片」入口与格子同一判据，I6）。 */
export function inkPresent(ink) {
  return !!(ink && ((ink.points && ink.points.length) || (ink.strokes && ink.strokes.length)));
}

function inkEntryOf(state, record) {
  if (!state || !record || !state.ink) return null;
  const month = typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
  const id = record.inkId || record.id;
  const table = month ? state.ink[month] : null;
  return table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// ---------------------------------------------------------------- 纯函数：草稿变换

/** 写完的会话还在槽里 → 移入 lastEnded[slot]（正常结束，01 §3.3）。 */
export function finishInDraft(draft, { slot, sessionId, at }) {
  const s = sessionsOf(draft);
  const live = s[slot];
  if (!live || live.id !== sessionId) throw new Error('finish: session not in slot');
  if (!isComplete(live)) throw new Error('finish: session not complete');
  draft.sessions = endSlot(s, slot, { at, early: false });
}

const CLEAN = Object.freeze({ ok: true, noop: true, keys: Object.freeze([]) });
const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 结束写完的会话（幂等：已在 lastEnded → noop）。 */
export function commitFinish(store, { slot, sessionId }) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found) return STALE;
  if (found.where === 'ended') return CLEAN;
  if (!isComplete(found.session)) return STALE;
  return store.commit(LABELS.finish, (draft, ctx) => finishInDraft(draft, { slot, sessionId, at: ctx.now }));
}

/** 离开结果页：清掉 lastEnded[slot]（只清本组）。 */
export function commitLeave(store, { slot, sessionId }) {
  const s = sessionsOf(store.getState());
  if (!s.lastEnded[slot] || s.lastEnded[slot].id !== sessionId) return CLEAN;
  return store.commit(LABELS.leave, draft => {
    const cur = sessionsOf(draft);
    if (cur.lastEnded[slot] && cur.lastEnded[slot].id === sessionId) draft.sessions = clearLastEnded(cur, slot);
  });
}

/**
 * 结果页修改判断的 mutator 主体（决定-D19）：同一条记录只改 judgment、追加 corrections；
 * 以 items[].fsrsBefore 为起点、各记录 at 为 review 时间重放本字此后的 judged 记录，更新 sched；会话不动。
 * @returns {{record, entry}}
 */
export function correctResultInDraft(draft, { slot, sessionId, recordId, to, at, policy = defaultPolicy }) {
  const found = findResultSession(draft, { slot, sessionId });
  if (!found) throw new Error('correct: session not found');
  const s = found.session;
  if (!canCorrect(s, recordId)) throw new Error('correct: record cannot be corrected in this session');
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!record || !isJudged(record) || record.sessionId !== sessionId) throw new Error('correct: judged record not found');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const later = sortById(all.filter(r => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0))
    .map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = replay(fsrsBeforeOf(s, recordId), later, { policy, stoppedAt: prev ? prev.stoppedAt : undefined });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  return { record: next, entry };
}

/** 结果页修改判断 commit。已不能改（会话不在 / 不是本组可改的记录）时 stale。 */
export function commitResultCorrection(store, { slot, sessionId, recordId, to, policy } = {}) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found || !canCorrect(found.session, recordId)) return STALE;
  let out = null;
  const result = store.commit(LABELS.correct, (draft, ctx) => {
    out = correctResultInDraft(draft, { slot, sessionId, recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}

/** 结果页上还能不能撤销这次跳过：会话在（lastEnded 或槽里）、最后一个 item 就是这条 skipped、槽没被新组占住。 */
export function canUndoSkipFromResult(state, { slot, sessionId, recordId }) {
  const found = findResultSession(state, { slot, sessionId });
  if (!found) return false;
  if (found.where === 'ended' && sessionsOf(state)[slot]) return false;
  const last = found.session.items[found.session.items.length - 1];
  return !!last && last.kind === 'skipped' && last.recordId === recordId;
}

/**
 * 结果页上的跳过撤销（mutator 主体）：已结束的会话放回槽里（去掉 endedAt / endedEarly、清 lastEnded[slot]），
 * 然后同写字页的撤销：删 skipped 记录、字放回 cursor、current 回 recall、提示次数与笔画写回（skip.js undoSkipInDraft）。
 */
export function undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at }) {
  const s = sessionsOf(draft);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) {
    if (s[slot]) throw new Error('undo skip: slot is occupied by a newer group');
    const { endedAt, endedEarly, ...rest } = ended; // eslint-disable-line no-unused-vars
    draft.sessions = { ...clearLastEnded(s, slot), [slot]: rest };
  } else if (!s[slot] || s[slot].id !== sessionId) {
    throw new Error('undo skip: session changed');
  }
  return undoSkipInDraft(draft, { slot, sessionId, recordId, at, strokes });
}

export function commitResultSkipUndo(store, { slot, sessionId, recordId, strokes } = {}) {
  const state = store.getState();
  const found = findResultSession(state, { slot, sessionId });
  if (found && found.where === 'slot') {
    if (!canUndoSkip(state, { slot, sessionId, recordId })) return STALE;
  } else if (!canUndoSkipFromResult(state, { slot, sessionId, recordId })) {
    return STALE;
  }
  return store.commit(LABELS.undoSkip, (draft, ctx) => {
    undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at: ctx.now });
  });
}

// ---------------------------------------------------------------- 跨页交接与扩展点

let pendingUndo = null; // 写字页 → 结果页：最后一字跳过后的撤销机会（只在内存里：刷新即失，01 §3.2）

/**
 * 写字页在换成结果页之前交出撤销机会（skip.js useSkip().undo + slot）；null 清掉。
 * @param {{slot, sessionId, recordId, char, strokes, until}|null} undo
 */
export function handoffSkipUndo(undo) {
  pendingUndo = undo && undo.sessionId && undo.recordId ? { ...undo, failed: false } : null;
}

/** 结果页取走交接的撤销机会（取一次即清）；不是本组的或已过期的丢掉。 */
export function takeSkipUndo(slot, sessionId, nowMs = clockNow()) {
  const u = pendingUndo;
  pendingUndo = null;
  if (!u || u.slot !== slot || u.sessionId !== sessionId) return null;
  if (Number.isFinite(u.until) && u.until <= nowMs) return null;
  return u;
}

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

const hooks = { image: null };

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const SHARE_ICON = () => html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 14V3.5M7.2 7 11 3.2 14.8 7M6 10H5v8h12v-8h-1"></path></svg>`;

/** 右上「分享」的去处（M4-5 注册，P1-E7 起是结果页页头的分享图标：fn({slot, sessionId})）；没注册时入口不显示。 */
export function setResultImageAction(fn) {
  hooks.image = typeof fn === 'function' ? fn : null;
}

/** 写字页换成结果页（最后一字推进后 / 结束这组有判断）。 */
export function openResult(slot, sessionId) {
  nav.replace(RESULT_SCREEN, { slot, sessionId });
}

// ---------------------------------------------------------------- 组件

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(() => {
    const st = storeOrNull();
    return st ? st.getState() : null;
  });
  useEffect(() => {
    const st = storeOrNull();
    if (!st) return undefined;
    setState(st.getState());
    return st.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 某条 judged 记录的本人笔迹：存下的墨迹（perRecordInk 开）→ 本页面会话里刚判断时记下的笔画 → 没有。 */
function inkOf(store, record) {
  if (!record) return { points: null, strokes: null };
  if (store) {
    let ink = null;
    try {
      ink = store.getInk(record);
    } catch (error) {
      ink = null;
    }
    if (ink) {
      const decoded = decodeInk(ink);
      if (decoded) return { points: resampleForReplay(decoded), strokes: null };
    }
  }
  const raw = recalledInk(record.id);
  return raw ? { points: null, strokes: raw } : { points: null, strokes: null };
}

function findRecord(state, recordId) {
  for (const r of allRecords(state)) if (r && r.id === recordId) return r;
  return null;
}

// 原生 <button> 格子的按压反馈：与 Button 同一套 data-pressed 机制（P1-E1a）；样式见 .sz-rcell[data-pressed]。
const CELL_PRESS = pressFeedbackHandlers(() => false);

function ResultCell({ cell, record, ink, onOpen }) {
  const hasInk = inkPresent(ink);
  let sq;
  if (cell.kind === 'judged' && hasInk) {
    sq = html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="result-cell-ink" label=${cell.char} />`;
  } else if (cell.kind === 'judged') {
    // 有记录无笔迹（10.12）：标准字 +「没有笔迹」
    sq = html`<${PracticeGlyph} class="sz-rcell__glyph sz-rcell__glyph--shape" hidden=${true} char=${cell.char} testid="result-cell-glyph" />
      <span class="sz-rcell__noink" data-testid="result-cell-noink">${t('R-D07.noInkLabel')}</span>`;
  } else {
    sq = html`<${PracticeGlyph} class="sz-rcell__glyph" hidden=${true} char=${cell.char} testid="result-cell-glyph" />`;
  }
  return html`<button type="button" class="sz-rcell" ...${CELL_PRESS} data-testid="result-cell" data-index=${cell.index} data-kind=${cell.kind}
    data-judgment=${cell.judgment || ''} data-changeable=${cell.canChange ? 'true' : 'false'} data-record=${record ? record.id : ''}
    aria-label=${t('X-RESULT.cellAria', { char: cell.char, caption: cell.caption })}
    onClick=${() => onOpen(cell)}>
    <span class="sz-rcell__sq">${sq}</span>
    <span class="sz-rcell__cap">
      <${PracticeGlyph} class="sz-rcell__char" char=${cell.char} face=${FACE_FULL} testid="result-cell-char" />
      <span class="sz-rcell__res" data-testid="result-cell-caption" data-wrong=${cell.judgment === 'wrong' ? 'true' : 'false'}>${cell.caption}</span>
    </span>
  </button>`;
}

function Grid({ model, state, store, onOpen }) {
  const cells = model.cells;
  const few = (model.variant === 'picked' || model.variant === 'first') && cells.length > 0 && cells.length < model.cols; // 首练只有 3 个字（D38）：不补空格
  const cols = few ? cells.length : model.cols;
  const pads = few ? 0 : (cols - (cells.length % cols)) % cols;
  const style = few
    ? { gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, width: `calc((100% - 1px) * ${cols} / ${model.cols} + 1px)` }
    : { gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` };
  return html`<div class=${few ? 'sz-result__grid sz-result__grid--few' : 'sz-result__grid'} data-testid="result-grid"
    data-cols=${cols} style=${style}>
    ${cells.map(cell => {
      const record = cell.recordId ? findRecord(state, cell.recordId) : null;
      const ink = cell.kind === 'judged' ? inkOf(store, record) : null;
      return html`<${ResultCell} key=${cell.index} cell=${cell} record=${record} ink=${ink} onOpen=${onOpen} />`;
    })}
    ${Array.from({ length: pads }, (_, i) => html`<span key=${'pad' + i} class="sz-rcell sz-rcell--pad" aria-hidden="true">
      <span class="sz-rcell__sq"></span><span class="sz-rcell__cap"></span></span>`)}
  </div>`;
}

/** 格子对照弹层（overlay 组件；root 注入 close / active）。 */
export function ResultCellSheet({ slot, sessionId, recordId, cellKind, cellChar, close, active = true }) {
  const store = storeOrNull();
  const state = store ? store.getState() : null;
  const record = recordId && state ? findRecord(state, recordId) : null;
  const kind = record ? record.kind : cellKind;
  const char = record ? record.char : cellChar;
  const found = state ? findResultSession(state, { slot, sessionId }) : null;
  const judged = kind === 'judged' && !!record && isJudged(record);
  const changeable = judged && !record.legacy && !!found && canCorrect(found.session, record.id);
  const [failed, setFailed] = useState(false);
  const strokeData = useStrokeData(char);
  const [ink] = useState(() => (judged ? inkOf(store, record) : { points: null, strokes: null }));
  const judgment = judged ? record.judgment : null;
  let title;
  let note;
  if (judged) {
    title = t(judgment === 'wrong' ? 'R-R02.sheetTitleWrong' : 'R-R02.sheetTitleCorrect', { char });
    note = failed ? t('R-W10.changeFailed') : t('R-R02.sheetNoteChange');
  } else if (kind === 'answer-seen') {
    title = t('R-R02.sheetTitleSaw', { char });
    note = t('R-R02.sheetNoteSaw');
  } else {
    title = t('R-R02.sheetTitleSkipped', { char });
    note = t('R-R02.sheetNoteSkipped');
  }
  const flip = () => {
    const st = storeOrNull();
    const result = st ? commitResultCorrection(st, { slot, sessionId, recordId }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      if (close) close();
      return;
    }
    setFailed(true);
    markStateChange(); // 失败态是新状态（走查-W08）
  };
  const mine = t('R-W09.labelMine');
  const ref = t('R-W09.labelReference');
  const topLabel = changeable ? t('R-R02.sheetCancel') : t('R-R02.sheetClose');
  return html`<${Sheet} title=${title} onClose=${close} active=${active} testid="result-sheet">
    <div class="sz-change" data-kind=${kind}>
      <${Button} variant="text" class="sz-change__cancel" data-testid="result-sheet-close" onClick=${() => close && close()}>${topLabel}</${Button}>
      <div class="sz-change__minis">
        <div class="sz-change__col">
          <${InkMini} points=${ink.points} strokes=${ink.strokes} testid="result-sheet-mine" label=${mine}
            emptyText=${judged ? t('R-D07.noInkLarge') : t('R-R02.sheetNoInk')} emptyTestid="result-sheet-noink" />
          <span class="sz-compare__label" aria-hidden="true">${mine}</span>
        </div>
        <div class="sz-change__col">
          <${RefMini} char=${char} strokeData=${strokeData} testid="result-sheet-ref" label=${ref} />
          <span class="sz-compare__label" aria-hidden="true">${ref}</span>
        </div>
      </div>
    </div>
    <p class="sz-change__note" data-testid="result-sheet-note" aria-live="polite">${note}</p>
    ${changeable && failed
      ? html`<div class="sz-change__btns">
          <${Button} variant="secondary" data-testid="result-sheet-fail-cancel" onClick=${() => close && close()}>${t('R-W10.cancel')}</${Button}>
          <${Button} variant="primary" data-testid="result-sheet-fail-retry" onClick=${flip}>${t('R-W10.retry')}</${Button}>
        </div>`
      : changeable
        ? html`<${Button} variant="primary" data-testid="result-sheet-flip" onClick=${flip}>${t(judgment === 'correct' ? 'X-JUDGE.changeToWrong' : 'X-JUDGE.changeToCorrect')}</${Button}>`
        : null}
  </${Sheet}>`;
}

function openCellSheet({ slot, sessionId, cell }) {
  return nav.openOverlay(ResultCellSheet, {
    slot, sessionId, recordId: cell.recordId, cellKind: cell.kind, cellChar: cell.char,
  }, { name: 'result-sheet' });
}

function inRouterStack(entryId) {
  const router = getRouter();
  if (!router || !entryId) return false;
  return router.getState().stack.some(e => e.id === entryId);
}

/** 离开结果页（回来源）。 */
function leaveTo(leave) {
  if (TAB_VIEWS.includes(leave.view)) {
    const def = getScreen(leave.view);
    if (def && def.tab) {
      nav.switchTab(leave.view);
      return;
    }
  }
  nav.back();
}

function ResultScreen({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : '';
  const state = useStoreState();
  const store = storeOrNull();
  // 「这次的图片」入口与格子同一取法（存下的墨迹 → 本页面会话里的笔画，I6）
  const model = resultModel(state, { slot, sessionId, hasInk: record => inkPresent(inkOf(store, record)) });
  useEffect(() => { installCommitFeedback(getStore); }, []); // M5-5：结果页的改判断 / 撤销跳过 / 补写结束也发触觉（刷新后直接停在本页时写字页没挂过）

  // 写完但还在槽里（结束写入失败 / 刷新打断）→ 补写结束（幂等）。
  useEffect(() => {
    const st = storeOrNull();
    if (st) commitFinish(st, { slot, sessionId });
  }, [slot, sessionId]);

  // 被移出页面栈（离开 / 返回 / 切 tab）→ 清 lastEnded[slot]（01 §3.3）。
  const entryId = entry && entry.id;
  useEffect(() => () => {
    if (inRouterStack(entryId)) return;
    const st = storeOrNull();
    if (st) commitLeave(st, { slot, sessionId });
  }, [entryId]);

  // 跳过的撤销机会（写字页交过来的，剩余时长照旧）。
  // 计时在 SkipUndoDock 里（D36 / P115：5 秒、按住暂停、读屏不自动收起；until 是写字页给的绝对时刻）。
  const [undo, setUndo] = useState(() => takeSkipUndo(slot, sessionId));
  const dismissUndo = () => setUndo(null);
  const doUndo = () => {
    const u = undo;
    if (!u) return;
    const st = storeOrNull();
    const result = st
      ? commitResultSkipUndo(st, { slot, sessionId, recordId: u.recordId, strokes: u.strokes })
      : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      setUndo(null);
      nav.replace('write', { slot }); // 回到那个字（新的写字页按存下的现场取笔画）
      return;
    }
    if (result.error && result.error.kind === 'stale') {
      setUndo(null);
      return;
    }
    setUndo({ ...u, failed: true });
    markStateChange();
  };

  const [againFailed, setAgainFailed] = useState(false);
  const again = () => {
    dismissUndo();
    const st = storeOrNull();
    const source = model.source && model.source.view ? { ...model.source } : { view: 'home' };
    const r = st
      ? sessionStart.startNextA(st, { now: envNow, deck: deckAdapter, source })
      : { ok: false, error: { kind: 'unavailable' } };
    if (!r.ok) {
      setAgainFailed(true);
      markStateChange();
      return;
    }
    setAgainFailed(false);
    nav.back(); // 本页先出栈（回到来源），新组的写字页排在返回之后推入
    if (r.started || r.occupied) openWrite('A');
    else if (r.empty) openNonePage({ exhausted: r.libraryExhausted });
  };
  const leave = () => {
    dismissUndo();
    leaveTo(model.leave);
  };
  const openCell = cell => {
    dismissUndo();
    openCellSheet({ slot, sessionId, cell });
  };

  let footer;
  if (againFailed) {
    footer = html`<p class="sz-result__failnote" data-testid="result-again-note" aria-live="polite">${t('X-RESULT.againFailed')}</p>
      <div class="sz-result__fail">
        <${Button} variant="secondary" data-testid="result-again-cancel" onClick=${() => { setAgainFailed(false); markStateChange(); }}>${t('X-RESULT.againCancel')}</${Button}>
        <${Button} variant="primary" data-testid="result-again-retry" onClick=${again}>${t('X-RESULT.againRetry')}</${Button}>
      </div>`;
  } else if (model.again) {
    footer = html`<${Button} variant="primary" data-testid="result-again" onClick=${again}>${t('X-RESULT.again')}</${Button}>
      <${Button} variant="text" class="sz-result__leave" data-testid="result-leave" onClick=${leave}>${model.leave.label}</${Button}>`;
  } else {
    footer = html`<${Button} variant="primary" data-testid="result-leave" onClick=${leave}>${model.leave.label}</${Button}>`;
  }

  const imageAction = hooks.image;
  const isWork = model.variant === 'first' || model.variant === 'daily';
  // 复现预告句（首练与日常都有，交接 §5.1）；提醒邀请在首练与「今天的练习」结果页的槽位里
  const extras = isWork
    ? firstExtras({
      cells: model.cells,
      sched: state && state.sched,
      today: localDay(envNow()),
    })
    : null;
  const inkForRecord = record => (record ? inkOf(store, record) : null);
  const openEntry = entry => openCell(model.cells[entry.index]);
  const toggleEntry = entry => {
    const st = storeOrNull();
    if (st && entry.recordId) commitAdded(st, { slot, sessionId, recordId: entry.recordId });
  };
  // 右上「分享」：作品里至少有一个字才有（没有任何墨时隐藏，交接 §4.1）
  const shareButton = isWork && model.share && imageAction
    ? html`<${Button} variant="icon" data-testid="result-share" aria-label=${t('X-WORK.shareAria')}
        onClick=${() => { dismissUndo(); imageAction({ slot, sessionId }); }}>${SHARE_ICON()}</${Button}>`
    : null;
  return html`<${Page} title=${model.header} hideTitle=${isWork} leading="close" onBack=${leave} footer=${footer} trailing=${shareButton} testid="result-screen">
    <div class="sz-result" data-testid="result-body" data-variant=${model.variant} data-slot=${slot} data-session=${sessionId} data-early=${model.early ? 'true' : 'false'}
      data-found=${model.found ? 'true' : 'false'}>
      ${model.title || model.sub.length
        ? html`<div class="sz-result__head">
            ${model.title
              ? html`<h2 class=${model.variant === 'first' ? 'sz-result__title sz-result__title--lead' : 'sz-result__title'} data-testid="result-title">${model.kicker
                ? html`<span class="sz-result__kicker" data-testid="result-kicker">${model.kicker}</span><span class="sz-result__kicker">${model.title}</span>`
                : model.title}</h2>`
              : null}
            ${model.sub.length ? html`<p class="sz-result__sub" data-testid="result-sub">${model.sub.join('')}</p>` : null}
          </div>`
        : null}
      ${isWork && model.work
        ? html`<${WorkSection} work=${model.work} day=${model.day} dateText=${dateText(model.day)} inkOf=${inkForRecord} onOpen=${openEntry} />`
        : null}
      ${!isWork && model.cells.length ? html`<${Grid} model=${model} state=${state} store=${store} onOpen=${openCell} />` : null}
      ${model.dateLine ? html`<p class="sz-result__date" data-testid="result-date">${model.dateLine}</p>` : null}
      ${isWork && model.work ? html`<${WorkRows} rows=${model.work.rows.filter(r => r.state !== 'in')} inkOf=${inkForRecord} onOpen=${openEntry} onToggle=${toggleEntry} />` : null}
      ${extras ? html`<${ReviewPreview} text=${extras.preview} />` : null}
      ${isWork
        ? html`<div class="sz-result__remind" data-testid="result-remind-slot">
            <${ReminderInvite} store=${store} settings=${state && state.settings} session=${model.session} variant=${model.variant} />
          </div>`
        : null}
    </div>
    ${undo ? html`<${SkipUndoDock} char=${undo.char} failed=${!!undo.failed} onUndo=${doUndo} until=${undo.until}
      onExpire=${() => setUndo(u => (u === undo ? null : u))}
      onCancelFail=${() => { setUndo(null); markStateChange(); }} />` : null}
  </${Page}>`;
}

registerScreen(RESULT_SCREEN, ResultScreen, { label: t('X-RESULT.headerDaily') });
