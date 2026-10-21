// 结果页（M2-3；决定-D18 / D19 / D20 / D22；01 §3.2 / §3.3；04 R-R01–R-R07、R-W11；03 P11 / P14 / P15 / P50 / P62；
// 边改 S05；原型 ShiziScreen L116–L124（result / firstResult / endPicked）、L421–L457（数据与修改判断弹层）；
// reference/J-proto-screen.md §2.3.11–§2.3.13）。
//
// 进入：写字页最后一字处理完（判断 / 看答案后「下一个」/ 跳过）→ 会话移入 lastEnded[slot]（commitFinish）→ 写字页就地换成本页
// （nav.replace('result', {slot, sessionId})，决定-D20：无中间页）；「结束这组」有判断时同样换成本页（write/end.js）。
// 停在本页刷新：按 params 从 lastEnded[slot] 恢复（01 §3.3）；会话还在槽里（写完但结束写入失败）时照样显示并补写结束。
//
// 三态（按会话 kind）：
//   daily  「这次练习」：结果页即作品（P1-E7；E9c 起按 D49 减法修稿：没有底板、没有标题，作品格贴页边）；作品下「没放进图里」的行、复现句（每字「N 天后再见」，D48）；
//          底栏只有主按钮「再写一组」，出口只在页头左上「×」（D49 ③：没有「回到首页」）；第二次邀请没回答前，底栏是「好 / 不用了」（R2-R1 / N2-04）。
//   first  「第一次练习」：同一构图，多一个标题「这三个字，很多人提笔就忘。」（数取这一页上实际有几个字，V2-05；不以计数作标题，D28）与提醒邀请（内嵌，D35 / D46 ③）；
//          底栏（R2-R1 / N2-04 / N2-05 / I2-07）：邀请没回答前就是「好 / 不用了」，回答以后是主按钮「完成」+ 文字按钮「再写一组」。
//          首练专属的三块在 result/first.js（与 P1-E7 作品出口的分界：本文件的格子 / 日期行 / 图片入口属通用结果页，E7 改构图）。
//   picked 「这次选的字」：和日常组同一个作品版式（R2-R1 / V2-04 / T2-03：不再是 v1 的表格页）——作品格 + 落款（「二〇二六年十月四日　自选五字」）+ 印、
//          作品下「没放进图里」的行与复现句；没有页头标题和说明段（中途结束时只有一行「还有 N 个字没写。」，R-R05）；
//          底栏唯一的主按钮是离开按钮，按来源（R-R06「回到字库」等）；页头右上同样有分享（这次的图片）。
//   难度块按 P11（features.difficultyFeedback=false）不做。
// 说明句（R-R01 / P62）：看过答案与跳过的字按字列出（只有一类时按示例拆成两句）；都没有时用默认说明；末尾「点一个格子…」。
// 格子：点作品格 / 下面的行 → 底部对照弹层：
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
// data-testid：result-screen、result-body（data-variant=daily|first|picked、data-early）、result-title（首练）、
//   result-sub、作品与行见 result/work.js（work、work-cell、result-exrow…）、result-share（页头分享）、
//   result-remind-slot（首练 / 今天的练习的提醒邀请块，见 first.js）、result-again、result-leave（只在自己选字的结果页底栏）、result-again-note / result-again-cancel /
//   result-again-retry（再写一组失败）、result-sheet（对照弹层面板，data-kind）、result-sheet-close（取消 / 关闭）、
//   result-sheet-mine / result-sheet-ref / result-sheet-noink、result-sheet-note、result-sheet-flip、
//   result-sheet-fail-cancel / result-sheet-fail-retry；撤销底栏沿用 write-skip-undo*（skip.js SkipUndoBar）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { Sheet } from '../../components/Sheet.js';
import { FailBlock } from '../../components/FailBlock.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { installCommitFeedback } from '../../../platform/haptics.js'; // M5-5 触觉 / 按键音（按 commit label）
import { deckAdapter } from '../../../data/deck.js';
import { localDay, monthDayParts } from '../../../core/dates.js';
import { isJudged } from '../../../core/records.js';
import { canCorrect } from '../../../core/sessions.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import * as sessionStart from '../../../core/session-start.js';
import { allRecords } from '../write/answer.js';
import { InkMini, RefMini, recalledInk } from '../write/compare.js';
import { useStrokeData } from '../write/hint-layer.js';
import { SkipUndoDock } from '../write/skip.js';
import { openRedo } from '../write/redo.js'; // D66 ③ 重写错字
import { ViewCharLink } from '../write/result-row.js'; // .sz-change* 弹层样式（与写字页修改判断弹层同一版式）+「看这个字 ›」
import { NONE_SCREEN } from '../session/none.js';
import { LiveRegion } from '../../components/LiveRegion.js';
import { ReminderInvite, ReviewPreview, firstExtras, useReminderInvite } from './first.js';
import { WorkRows, WorkSection, commitAdded, commitSealed, shouldPlayReveal } from './work.js';

export { commitAdded };

export const RESULT_SCREEN = 'result';
// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/result-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { firstTitle, LABELS, findResultSession, recordsOfSession, leaveOf, resultModel, seenCurrentItem, inkPresent, finishInDraft, commitFinish, commitLeave, correctResultInDraft, commitResultCorrection, canUndoSkipFromResult, undoSkipFromResultInDraft, commitResultSkipUndo } from '../../../session/result-ops.js';
export { firstTitle, LABELS, findResultSession, recordsOfSession, leaveOf, resultModel, seenCurrentItem, inkPresent, finishInDraft, commitFinish, commitLeave, correctResultInDraft, commitResultCorrection, canUndoSkipFromResult, undoSkipFromResultInDraft, commitResultSkipUndo };
/** 离开时直接回 tab 根的来源（其余来源按页面栈返回）。 */
const TAB_VIEWS = Object.freeze(['home', 'library', 'mine']);

injectStyles('result', `
.sz-result{display:flex;flex-direction:column}
.sz-result__head{display:flex;flex-direction:column;gap:8px}
.sz-result__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1};text-wrap:pretty}
.sz-result__title--lead{font-size:${T.fs22};line-height:${T.lh22}}
.sz-result__title:focus{outline:none}
.sz-result__sub{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
/* 作品页（daily / first / picked，D49；自选组 R2-R1 起同一版式）：没有底板；间距用留白分组（作品→行 28、行→复现句 20、复现句→邀请 28）；内容不满一屏时整组在页头与按钮行之间居中（底部内边约 5%），超出时贴顶滚动 */
.sz-result{gap:0;margin:auto 0;padding-bottom:5vh}
.sz-result>.sz-work{margin-top:4px}
.sz-result__head{margin-bottom:24px;gap:0}
.sz-result__head+.sz-work{margin-top:0}
.sz-result__remind{margin-top:28px}
:root:not([data-ax]) .sz-result__remind{position:sticky;bottom:0;z-index:1;background:${T.paper};padding-bottom:${T.s2}} /* AX 档底栏占掉大半屏、邀请卡比正文区还高，粘住只会盖住内容：AX 档仍在正文末尾，滚到才见（与其它正文一样） */ /* D66 ⑯：提醒邀请（问句 + 开启提醒 / 先不用）粘在正文可视区底部——作品与各行再高，按钮也在 iPhone 17 首屏内、不靠滚动才看见；滚到底时回到自然位置 */
.sz-result__remind:empty{display:none}
.sz-result__textbtn{align-self:flex-start;margin-bottom:${T.s2}} /* 首练「再写一组」：文字按钮在主按钮正上方、左对齐 20pt 线，与主按钮视觉间距 20（与写字页求助行同一做法，B2） */
.sz-result__textrow{display:flex;flex-wrap:wrap;align-items:center;gap:0 20px;margin-bottom:${T.s2}} /* 首练：「再写一组」「重写错字」两枚文字按钮同一行（D66 ③），都在主按钮正上方 */
.sz-result__textrow .sz-result__textbtn{margin-bottom:0}
.sz-result__fail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-result__failnote{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-page[data-testid="result-screen"] .sz-page__body{padding-top:12px}
/* 日常 / 首练结果页的页头标题只给读屏；AX 档的页头规则（ui/components/ax.js）会把标题挤成单独一行，这里压回去（作品不再被标题盖住，D49） */
:root[data-ax][data-text-large] .sz-page[data-testid="result-screen"] .sz-page__head>.sz-page__title--hidden{position:absolute;left:auto;right:auto;flex:none;
  width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* 底栏：主按钮是底栏最后一个，落在全 App 主按钮底线上（Page 底栏 max(24, 下安全区)，规范 B2，审计 P1-15），与写字页「写好了」同一位置；
   内容滚到它下面时上沿出现 hairline（data-under，由 useFootHairline 写） */
.sz-page[data-testid="result-screen"] .sz-page__foot[data-under="true"]{box-shadow:0 calc(${T.hair} * -1) 0 ${T.line}}
`);

function dateText(day) {
  if (!day) return '';
  return t('R-H02.dateFormat', monthDayParts(day));
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
const SHARE_ICON = () => Icons.share();

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

/** 某条记录的本人笔迹（judged，或看过答案后自己写的那份，Q1）：存下的墨迹（perRecordInk 开）→ 本页面会话里刚判断时记下的笔画 → 没有。 */
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
  // 看过答案的格：有看后自写的本人墨（Q1）就画出来，没有仍是「这次没写」
  const [ink] = useState(() => (judged || (kind === 'answer-seen' && record) ? inkOf(store, record) : { points: null, strokes: null }));
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
  return html`<${Sheet} title=${title} onClose=${close} active=${active} testid="result-sheet" dismiss="own">
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
    <${ViewCharLink} testid="result-sheet-detail" char=${char} close=${close} />
    ${changeable && failed
      ? html`${FailBlock({ layout: 'dialog', text: '', testid: 'result-sheet-fail', cancelLabel: t('R-W10.cancel'), retryLabel: t('R-W10.retry'), onCancel: () => close && close(), onRetry: flip })}`
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

/**
 * 离开结果页（回来源）。R5-I2（审计 P1-01，交互规范 N3-5）：来源是 tab 根且它就在结果页正下方时用 nav.back()——与左缘右滑同一条路径、
 * 同一个转场（B1 纸缩回按钮 / B3 安静淡出，planPaper 接手）；只有中间还隔着别的页面时才静默跳回 tab 根。
 */
export function leaveTo(leave, router = getRouter()) {
  if (TAB_VIEWS.includes(leave.view)) {
    const def = getScreen(leave.view);
    if (def && def.tab) {
      const snap = router ? router.getState() : null;
      const pages = snap ? snap.stack.filter(e => e.k === 's') : [];
      if (pages.length === 2 && pages[0].n === leave.view) {
        nav.back();
        return;
      }
      nav.switchTab(leave.view);
      return;
    }
  }
  nav.back();
}

/**
 * 内容滚到按钮行下面时，按钮行上沿出现 hairline（D49，实现交接 §0.5 / §4.1）：body 下面还有内容没滚到 → 给 .sz-page__foot 写 data-under="true"。
 * 页面骨架 Page 不认识这条规则，所以由本页从自己的根节点往上找；每次渲染后与 body 滚动 / 尺寸变化时重算。
 */
function useFootHairline(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    const page = root && root.closest ? root.closest('.sz-page') : null;
    const body = page ? page.querySelector('.sz-page__body') : null;
    const foot = page ? page.querySelector('.sz-page__foot') : null;
    if (!body || !foot) return undefined;
    const update = () => {
      const under = body.scrollHeight - body.scrollTop - body.clientHeight > 1;
      const cur = foot.getAttribute('data-under') === 'true';
      if (under !== cur) {
        if (under) foot.setAttribute('data-under', 'true');
        else foot.removeAttribute('data-under');
      }
    };
    update();
    body.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(update);
      ro.observe(body);
      if (root) ro.observe(root);
    }
    return () => {
      body.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
      foot.removeAttribute('data-under');
    };
  });
}

function ResultScreen({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : '';
  const state = useStoreState();
  const store = storeOrNull();
  const rootRef = useRef(null);
  useFootHairline(rootRef);
  // 「这次的图片」入口与格子同一取法（存下的墨迹 → 本页面会话里的笔画，I6）
  const model = resultModel(state, { slot, sessionId, hasInk: record => inkPresent(inkOf(store, record)) });
  const sealKey = `${slot}:${sessionId}`;
  // 作品落定（印落下，D51 ② / D53）：邀请的 600ms 从这时算起；落印没有要演的（已落过印 / 减少动态效果 / 没有作品）时一开始就是已落定，文字与底栏不隐藏
  const [landed, setLanded] = useState(() => !shouldPlayReveal({ work: model.work, key: sealKey, session: model.session }));
  useLayoutEffect(() => { // 印落下之前先只显示作品（I3-04）：给页面写 data-late，底栏跟着淡入（正文那一半由 .sz-result[data-late] 管）
    const root = rootRef.current;
    const page = root && root.closest ? root.closest('.sz-page') : null;
    if (!page) return undefined;
    if (landed) page.removeAttribute('data-late');
    else page.setAttribute('data-late', 'pending');
    return () => page.removeAttribute('data-late');
  }, [landed]);
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
      nav.replace('write', { slot }, { animate: true }); // 回到那个字（新的写字页按存下的现场取笔画）；同一张纸换内容，T-phase 淡化（P2-19）
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
    // R5-I2（审计 P1-03）：一段转场——新组的写字页就地换掉本页（同一张纸换内容，T-phase 淡化），不再先 B1 收回首页、再 B3 打开写字页。
    // 栈的结果与以前相同（来源页 / 写字页），返回时照样回到来源（来源按钮的记录还在下层页名下）。
    if (r.started || r.occupied) nav.replace('write', { slot: 'A' }, { animate: true });
    else if (r.empty) nav.replace(NONE_SCREEN, { exhausted: !!r.libraryExhausted }, { animate: true });
    else nav.back();
  };
  const leave = () => {
    dismissUndo();
    leaveTo(model.leave);
  };
  const openCell = cell => {
    dismissUndo();
    openCellSheet({ slot, sessionId, cell });
  };

  // 提醒邀请（首练 / 第二次）：「好 / 不用了」在正文的邀请块里，不替换吸底栏（P0-03）
  const invite = useReminderInvite({ store, settings: state && state.settings, session: model.session, variant: model.variant, ready: landed });
  useEffect(() => { if (!model.work || model.work.empty) setLanded(true); }, [!!model.work, model.work ? model.work.empty : true]); // 没有作品（没有落印）：直接算落定

  // D66 ③ 重写错字：本组（按现在的记录）写错的字再写一遍，只算练习；没有写错的字不显示。一次点击推入（普通推入，D62），写完回到本页
  const wrongChars = model.cells.filter(c => c.kind === 'judged' && c.judgment === 'wrong').map(c => c.char);
  const redoButton = wrongChars.length
    ? html`<${Button} variant="text" class="sz-result__textbtn" data-testid="result-redo" onClick=${() => { dismissUndo(); openRedo(wrongChars); }}>${t('X-REDO.title')}</${Button}>`
    : null;
  let footer;
  if (againFailed) {
    // 「再写一组」开组失败：底栏就地三段式（S1，components/FailBlock.js）
    footer = html`${FailBlock({ layout: 'foot', speak: false, testid: 'result-again-fail', noteTestid: 'result-again-note', cancelTestid: 'result-again-cancel', retryTestid: 'result-again-retry', text: t('X-RESULT.againFailed'), cancelLabel: t('X-RESULT.againCancel'), retryLabel: t('X-RESULT.againRetry'), onCancel: () => { setAgainFailed(false); markStateChange(); }, onRetry: again })}`;
  } else if (model.variant === 'first') {
    // 首练收尾（N2-05）：主按钮是「完成」，「再写一组」降为文字按钮，在主按钮正上方（与写字页求助行同位，主按钮落在全 App 底线，P1-15）；有写错的字时旁边多一枚「重写错字」（D66 ③）
    footer = html`<div class="sz-result__textrow"><${Button} variant="text" class="sz-result__textbtn" data-testid="result-again" onClick=${again}>${t('X-RESULT.again')}</${Button}>${redoButton}</div>
      <${Button} variant="primary" data-testid="result-done" onClick=${leave}>${t('X-RESULT.done')}</${Button}>`;
  } else if (model.again) {
    // D49 ③：出口只在页头左上「×」；底栏只有主按钮（落在全 App 主按钮底线，与写字页「写好了」同位）；有写错的字时主按钮正上方多一枚文字按钮「重写错字」（D66 ③）
    footer = html`${redoButton}<${Button} variant="primary" data-testid="result-again" onClick=${again}>${t('X-RESULT.again')}</${Button}>`;
  } else {
    // 主按钮行与其它变体同一位置（全 App 主按钮底线，P1-15）
    footer = html`${redoButton}<${Button} variant="primary" data-testid="result-leave" onClick=${leave}>${model.leave.label}</${Button}>`;
  }

  const imageAction = hooks.image;
  // 复现预告句（三种结果页都有，交接 §5.1）；提醒邀请在首练与「今天的练习」结果页的槽位里
  const extras = firstExtras({
    cells: model.cells,
    sched: state && state.sched,
    today: localDay(envNow()),
    work: model.work,
    variant: model.variant,
  });
  const inkForRecord = record => (record ? inkOf(store, record) : null);
  const openEntry = entry => openCell(model.cells[entry.index]);
  const toggleEntry = entry => {
    const st = storeOrNull();
    if (st && entry.recordId) commitAdded(st, { slot, sessionId, recordId: entry.recordId });
  };
  // 右上「分享」：作品里至少有一个字才有（没有任何墨时隐藏，交接 §4.1）
  const shareButton = model.share && imageAction
    ? html`<${Button} variant="icon" data-testid="result-share" aria-label=${t('X-WORK.shareAria')}
        onClick=${() => { dismissUndo(); imageAction({ slot, sessionId }); }}>${SHARE_ICON()}</${Button}>`
    : null;
  return html`<${Page} title=${model.header} hideTitle=${true} leading="close" onBack=${leave} footer=${footer} trailing=${shareButton} testid="result-screen">
    <div class="sz-result" ref=${rootRef} data-testid="result-body" data-late=${landed ? null : 'pending'} data-variant=${model.variant} data-slot=${slot} data-session=${sessionId} data-early=${model.early ? 'true' : 'false'}
      data-found=${model.found ? 'true' : 'false'}>
      ${model.title || model.sub.length
        ? html`<div class="sz-result__head">
            ${model.title ? html`<h2 class="sz-result__title sz-result__title--lead" data-testid="result-title">${model.title}</h2>` : null}
            ${model.sub.length ? html`<p class="sz-result__sub" data-testid="result-sub">${model.sub.join('')}</p>` : null}
          </div>`
        : null}
      ${model.work
        ? html`<${WorkSection} work=${model.work} day=${model.day} dateText=${dateText(model.day)} inkOf=${inkForRecord} onOpen=${openEntry}
          picked=${model.variant === 'picked'} sealKey=${sealKey} session=${model.session} settings=${state && state.settings}
          onSealed=${() => { const st = storeOrNull(); if (st) commitSealed(st, { slot, sessionId }); }} onLanded=${() => setLanded(true)} />`
        : null}
      ${model.work ? html`<${WorkRows} rows=${model.work.rows.filter(r => r.state !== 'in')} inkOf=${inkForRecord} onOpen=${openEntry} onToggle=${toggleEntry} quiet=${model.work.empty}
        changeable=${row => !!(model.cells[row.index] && model.cells[row.index].canChange)} />` : null}
      ${extras ? html`<${ReviewPreview} text=${extras.preview} />` : null}
      <div class="sz-result__remind" data-testid="result-remind-slot">
        <${ReminderInvite} invite=${invite} />
      </div>
      <${LiveRegion} text=${againFailed ? t('X-RESULT.againFailed') : invite.failed ? t('X-SETTINGS.saveFailed') : ''} testid="result-live" />
    </div>
    ${undo ? html`<${SkipUndoDock} char=${undo.char} failed=${!!undo.failed} onUndo=${doUndo} until=${undo.until}
      onExpire=${() => setUndo(u => (u === undo ? null : u))}
      onCancelFail=${() => { setUndo(null); markStateChange(); }} />` : null}
  </${Page}>`;
}

registerScreen(RESULT_SCREEN, ResultScreen, { label: t('X-RESULT.headerDaily') });
