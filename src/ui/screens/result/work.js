// 结果页即作品（阶段 1 P1-E7；交接 §4 / §5；D31 / D46 ⑥ ⑩；首练结果页与日常结果页共用这一作品构图）。
// E9c（D49 减法修稿）：作品直接放在页面纸上（没有作品底板）；作品下的行只剩「字 + 状态 + 动作」，无框、无分隔线、用留白分组；
// 朱点在字的右上角（墨迹外框右上外 2pt）。
//
//   WorkSection   作品（作品格 + 落款与印 + 格内「看后写的」标注）；第一次呈现时依次显现：格错开淡入 → 落款淡入 → 印落下（先落到 0.92，再用 120ms 回弹到 1），
//                 盖章声 s1、rigid 触觉与「印着纸」那一帧（缩放最小值）同帧（D51 ② / D53，I3-04 / T3-08，revealPlan；点一下直接到终态；减少动态效果只显示终态并立即同发）；
//                 刷新 / 冷启动恢复不重演、不再响（会话上的 sealedAt 标记，I3-05）；没有任何墨时换成衬底参考字一行 + 格下状态字（§4.2 变体）。
//   WorkRows      作品下「没放进图里」的行：36pt 字（有墨写本人墨，没墨写衬底）+ 状态词（写错了 / 看过答案 / 跳过了 / 写对 · 纸上…）+ 右侧「放进图里」
//                 （仅写错且有墨；纸上只有说明，D47）；点行 → 对照与修改（D19）。放进图里的字回到作品、这一行消失。
//   commitAdded   「放进图里」/ 从分享弹层拿出来：写进本组会话的 added（经 store.commit，刷新后仍在；核心规则在 core/images/work.js）。
//
// data-testid：work（作品；data-n / data-cols / data-rows / data-cell）、work-cell（data-index / data-char / data-mode / data-dot / data-state）、
//   work-cap、work-kuan、work-seal、work-dot；result-excluded、result-exrow（data-char / data-record / data-state / data-added）、result-exrow-open、
//   result-add（aria-pressed）；result-exrow 带 data-index（该字在本组里的序号，与作品格的 data-index 同一套）。
import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { CellCanvas, PlainRow, WorkPaper, WrongDot, useAxSize, useScreenWidth } from '../../components/work.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { M, prefersReducedMotion as reducedMotionOf } from '../../../config/motion.js';
import { t } from '../../../config/copy/index.js';
import { resultGrid } from '../../../core/images/layout.js';
import { kuan } from '../../work-text.js';
import { ChangeLink } from '../write/result-row.js';
import { keySound, warmSounds } from '../../../platform/sound.js';
import { haptic } from '../../../platform/haptics.js';

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/result-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { WORK_LABELS, locateSession, setAddedInDraft, commitAdded, commitSealed } from '../../../session/result-ops.js';
export { WORK_LABELS, locateSession, setAddedInDraft, commitAdded, commitSealed };
/** 作品下一行里字的边长（pt；AX 档 52，D49）与格内内边（字面约 88%，字是图，不随字号放大——AX 档单独取 52）。 */
export const ROW_GLYPH = 36;
export const ROW_GLYPH_AX = 52;
export const ROW_PAD = 0.03;

// ---------------------------------------------------------------- 作品显现与落印（D51 ②，网页阶段的最小过渡；完整编排属阶段 2 原生）

/** 整段显现的上限（ms，motion.moment.max）：格依次淡入 + 落款淡入 + 印落下（含回弹），印着纸那一帧发 s1 与一次 rigid 触觉。 */
export const REVEAL_MAX_MS = M.moment.max;

/** 印的落下（motion.moment.sealDrop 220）：从 1.25 落到最小缩放 0.92（着纸，SEAL_FALL_MS）再用 SEAL_REBOUND_MS（duration.press）回弹到 1（T3-08）。 */
export const SEAL_REBOUND_MS = M.dur.press;
export const SEAL_FALL_MS = M.moment.sealDrop - SEAL_REBOUND_MS;
/** 作品格淡入（moment.workCellIn）与落款淡入（duration.fade；D58 归并 140 → 150）：JS 时序与 CSS 动画同一来源。 */
export const CELL_IN_MS = M.moment.workCellIn;
export const KUAN_IN_MS = M.dur.fade;
/** szResultSeal 关键帧里着纸那一帧的位置（由时长算出，不手算）。 */
export const SEAL_CONTACT_AT = Math.round((SEAL_FALL_MS / M.moment.sealDrop) * 10000) / 100;

/**
 * 显现时序（纯函数）：n 个作品格。每格错开 stagger（≤ 50ms；字多时收紧，保证总时长 ≤ REVEAL_MAX_MS），落款在最后一格快到位时淡入，印在落款之后落下。
 * @returns {{stagger:number, cellMs:number, kuanDelay:number, kuanMs:number, sealDelay:number, sealMs:number, contactMs:number, total:number}} 全是 ms；
 *   contactMs = 印开始落下后多久着纸（缩放最小值，s1 与触觉在这一帧发）；total = 印回弹到位的时刻
 */
export function revealPlan(n) {
  const count = Math.max(1, Math.floor(Number(n) || 1));
  const cellMs = CELL_IN_MS;
  const kuanMs = KUAN_IN_MS;
  const sealMs = SEAL_FALL_MS + SEAL_REBOUND_MS;
  // total = (n − 1) × stagger + cellMs − 40（落款提前 40ms 进）+ 60（印比落款晚 60ms）+ sealMs ≤ 750  →  stagger ≤ (750 − 420) / (n − 1)
  const stagger = count > 1 ? Math.min(M.moment.workStagger, Math.floor((REVEAL_MAX_MS - (cellMs - 40 + 60 + sealMs)) / (count - 1))) : 0;
  const cellsEnd = (count - 1) * stagger + cellMs;
  const kuanDelay = cellsEnd - 40;
  const sealDelay = kuanDelay + 60;
  return { stagger, cellMs, kuanDelay, kuanMs, sealDelay, sealMs, contactMs: SEAL_FALL_MS, total: sealDelay + sealMs };
}

const revealed = new Set(); // 已经显现过 / 响过 s1 的组（sealKey）：回到本页不再重演

/** 测试：忘掉哪些组已经显现过。 */
export function resetReveal() {
  revealed.clear();
}

function prefersReducedMotion() {
  return reducedMotionOf(); // P2-13：全 App 唯一的判断（config/motion.js）
}

/** 这一组已经落过印（本次打开页面里响过，或会话上记着 sealedAt：冷启动 / 刷新恢复时不重演，I3-05）。 */
export function isSealed(key, session) {
  return revealed.has(key) || !!(session && Number.isFinite(session.sealedAt));
}

/** 结果页要不要演落印：有作品、没落过印、没开减少动态效果。ResultScreen 用它决定「先只显示作品」，WorkSection 用它决定是否播放。 */
export function shouldPlayReveal({ work, key, session = null }) {
  return !!work && !work.empty && !isSealed(key, session) && !prefersReducedMotion();
}

/** 印着纸的那一帧：盖章声 s1 与 rigid 触觉 seal 同帧发（I3-04：最后一字的 j1 在判断时已经响过；s1 不再等回弹结束，不叠在 j1 上）。 */
function sealMoment(settings, key) {
  haptic('seal');
  const play = () => keySound('seal', { key });
  if (!play()) warmSounds({ events: ['seal'] }).then(play, play); // 素材还没解码好：解码后补响，不占 key
}

injectStyles('result-work', `
@keyframes szWorkCellIn{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@keyframes szWorkKuanIn{from{opacity:0}to{opacity:1}}
/* 印：SEAL_FALL_MS 落到 0.92（着纸，关键帧位置 = SEAL_FALL_MS / sealDrop）→ SEAL_REBOUND_MS 回弹到 1（T3-08）；着纸那一帧发 s1 与触觉 */
@keyframes szResultSeal{0%{opacity:0;transform:scale(${M.scale.sealFrom})}${SEAL_CONTACT_AT}%{opacity:1;transform:scale(.92)}100%{opacity:1;transform:scale(1)}}
.sz-wcell--in{animation:szWorkCellIn ${CELL_IN_MS}ms ${T.eOut} both}
.sz-work__kuan--in{animation:szWorkKuanIn ${KUAN_IN_MS}ms ${T.eOut} both}
.sz-seal--land{animation:szResultSeal ${M.moment.sealDrop}ms ${T.eOut} both}
/* 先只显示作品：印落下后，标题、各行、复现句、邀请与底栏 150ms 淡入（ResultScreen 写 data-late） */
.sz-result[data-late="pending"]>:not(.sz-work){opacity:0;pointer-events:none;visibility:hidden} /* visibility:hidden：读屏和键盘也摸不到还没出现的按钮（I3 · P2-20；inert 要 iOS 15.5，API 下限 15.0） */
.sz-result:not([data-late])>:not(.sz-work){transition:opacity ${M.moment.resultLateIn}ms ${T.eOut}}
.sz-page[data-late="pending"] .sz-page__foot{opacity:0;pointer-events:none;visibility:hidden}
.sz-page[data-testid="result-screen"]:not([data-late]) .sz-page__foot{transition:opacity ${M.moment.resultLateIn}ms ${T.eOut}}
@media (prefers-reduced-motion: reduce){.sz-result:not([data-late])>:not(.sz-work),.sz-page[data-testid="result-screen"]:not([data-late]) .sz-page__foot{transition-duration:${T.dReduce};transition-timing-function:${T.eLinear}}} /* 减少动态效果：不演显现与落印（shouldPlayReveal，T1 直接终态），触觉与 s1 照发 */
.sz-exrows{display:flex;flex-direction:column;margin-top:28px}
.sz-exrow{display:flex;align-items:center;gap:4px;min-height:52px;box-sizing:border-box}
.sz-exrow__open{flex:1;min-width:0;min-height:52px;display:flex;align-items:center;gap:12px;padding:8px 0;margin:0;border:0;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
.sz-exrow__open:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-exrow__open[data-pressed]{background:${T.field}}
.sz-exrow__cell{position:relative;flex:none;width:${ROW_GLYPH}px;height:${ROW_GLYPH}px}
.sz-exrow__cell--ax{width:${ROW_GLYPH_AX}px;height:${ROW_GLYPH_AX}px}
.sz-exrow__cell canvas{position:absolute;left:0;top:0}
.sz-exrow__t{flex:1;min-width:0;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2}}
.sz-exrow__tag{color:${T.ink3}}
.sz-exrow .sz-btn--text{flex:none}
.sz-exrow .sz-line__change{margin:0;padding:0 var(--bx)} /* D66 ④：与写字页结果行同一个「修改 ›」组件；这里在行内垂直居中，不需要结果行那样向上抵 4pt */
:root[data-ax] .sz-exrow{flex-wrap:wrap;padding:6px 0}
:root[data-ax] .sz-exrow__open{flex:1 1 100%;min-height:${ROW_GLYPH_AX}px;padding:0}
:root[data-ax] .sz-exrow .sz-btn--text{margin-left:${ROW_GLYPH_AX + 12}px}
`);

// ---------------------------------------------------------------- 视图

export function stateWord(entry) {
  if (entry.tag === 'afterSeen') return t('X-WORK.cellStateAfterSeen');
  return t(entry.judgment === 'wrong' ? 'X-WORK.cellStateWrong' : 'X-WORK.cellStateCorrect');
}

export function judgmentWord(entry) {
  return t(entry.judgment === 'wrong' ? 'X-WORK.statusWrong' : 'X-WORK.statusCorrect');
}

/** 衬底一行（整组没有墨）格下的状态字：纸上那一字写「纸上」（D47，交接 §4.2 / §10.2）。 */
export function statusWord(entry) {
  if (entry.state === 'paper') return t('X-WORK.statusPaper');
  if (entry.kind === 'skipped') return t('X-WORK.statusSkipped');
  if (entry.kind === 'answer-seen') return t('X-WORK.statusSeen');
  return judgmentWord(entry);
}

/** 衬底一行里一格的读屏状态：纸上「写对，纸上」（交接 §5.5），其余同格下状态字。 */
export function cellStateOf(entry) {
  return entry.state === 'paper' ? t('X-WORK.paperState', { state: judgmentWord(entry) }) : statusWord(entry);
}

/** 整体读屏名称：「作品：疆、酱、酝，3 个字，10月5日」。 */
export function workAria(chars, n, date) {
  const joined = chars.join(t('X-WORK.charsJoin'));
  return n > 1 ? t('X-WORK.workAria', { chars: joined, n, date }) : t('X-WORK.workAriaOne', { chars: joined, date });
}

/**
 * 作品（或没有墨时的衬底一行）。
 * @param {{work:object, day:string|null, dateText:string, inkOf:(record)=>object|null, onOpen:(entry)=>void}} props
 *   work = core/images/work.js buildWork 的结果；inkOf(record) → {points, strokes}。
 */
export function WorkSection({ work, day, dateText, inkOf, onOpen, picked = false, sealKey = '', settings = null, onLanded = null, session = null, onSealed = null }) {
  const sw = useScreenWidth();
  // 作品显现与落印（D51 ② / D53）：第一次呈现这一组时，格依次淡入 → 落款淡入 → 印落下（落到 0.92 再 120ms 回弹）；盖章声 s1（S1，D50 ⑦）与 rigid 触觉 seal
  // 在「印着纸」那一帧（缩放最小值，不等 animationend）同帧发，总时长 ≤ 750ms。
  // 点一下直接到终态（印立刻落下、s1 与触觉立刻同发）；减少动态效果只显示终态并立即同发；同一组（sealKey）只响一次，回到本页 / 重绘不再重演；
  // 会话上记着 sealedAt（落印时 commit）的组，冷启动 / 刷新恢复时直接是终态，不发声、不发触觉（I3-05）；
  // 没有墨（衬底一行、无落款）不响。onLanded：作品落定（印回弹到位 / 点掉；邀请块的 600ms 从这时算起，文字与底栏也从这时淡入）。
  const hasSeal = !work.empty;
  const key = sealKey || 'work';
  const plan = revealPlan(work.empty ? 1 : work.cells.length);
  const sealedBefore = useRef(isSealed(key, session)); // 打开页面那一刻就已经落过印的组：全程不发声
  const [phase, setPhase] = useState(() => (shouldPlayReveal({ work, key, session }) ? 'play' : 'done'));
  const landedRef = useRef(false);
  const firedRef = useRef(false);
  const contactRaf = useRef(0);
  // 着纸那一帧：s1 + 触觉同发，随后记下 sealedAt（commit 放在声音与触觉之后，不占这一帧）
  const fire = () => {
    if (firedRef.current || !hasSeal || sealedBefore.current) return;
    firedRef.current = true;
    cancelAnimationFrame(contactRaf.current);
    revealed.add(key); // 同一组只响一次（回到本页 / 重绘不再来）
    sealMoment(settings, key);
    if (typeof onSealed === 'function') setTimeout(onSealed, 0);
  };
  const land = () => {
    if (landedRef.current) return;
    landedRef.current = true;
    setPhase('done');
    if (typeof onLanded === 'function') onLanded();
  };
  // 点掉 / 保底 / 减少动态效果：终态画出来之后的这一帧立即同发（印在动画中途被点掉时，声音响起的那一帧画面上已经是落定的印）；正常播放时早在着纸那一帧发过了，这里是空操作
  useEffect(() => {
    if (phase === 'done') fire();
  }, [phase]);
  // 印开始落下（animationstart，delay 之后）→ 按印的动画时钟逐帧看，activeTime ≥ contactMs 的第一帧就是着纸那一帧
  const onSealStart = event => {
    const target = event && event.target;
    let anim = null;
    try {
      anim = target && typeof target.getAnimations === 'function' ? target.getAnimations().find(a => a.animationName === 'szResultSeal') : null;
    } catch (error) {
      anim = null;
    }
    const HALF_FRAME = 1000 / 120; // 半帧（60Hz 一帧 16.7ms）：帧时间，不是动画时长
    const due = () => {
      if (!anim) return true;
      try {
        const timing = anim.effect.getComputedTiming();
        const at = Number(anim.currentTime) - (Number(timing.delay) || 0); // 印的动画时钟：开始落下后过了多久（currentTime 含 delay）
        return !(at < plan.contactMs - HALF_FRAME); // 取最近的一帧：离着纸不到半帧的这一帧就算着纸（否则时钟差零点几毫秒就会晚发一整帧，声音落在回弹里）。NaN（读不到）也当作到了，不误等
      } catch (error) {
        return true;
      }
    };
    const frame = () => {
      if (firedRef.current || landedRef.current) return;
      if (due()) fire();
      else contactRaf.current = requestAnimationFrame(frame);
    };
    if (anim) frame();
    else setTimeout(() => { contactRaf.current = requestAnimationFrame(fire); }, plan.contactMs);
  };
  useEffect(() => {
    if (hasSeal) warmSounds({ events: ['seal'] }); // 预解码，印着纸时马上能响
    if (phase === 'done') {
      land();
      return undefined;
    }
    const timer = setTimeout(land, plan.total + M.dur.fade); // 保底：animationend 没来（后台标签页等）也要落
    const skip = () => land();
    window.addEventListener('pointerdown', skip, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(contactRaf.current);
      window.removeEventListener('pointerdown', skip, true);
    };
  }, [hasSeal, key]);
  const reveal = phase === 'play' ? { plan, onLand: land, onStart: onSealStart } : null;
  if (work.empty) {
    const entries = work.entries;
    if (!entries.length) return null;
    const grid = resultGrid(entries.length, sw);
    // 没有任何作品的一屏：写错的字，格下不写状态字、不画朱点——下面的行已经点过一次名（N3-03 / D53：不重复点名，朱色 ≤ 2）；其余（跳过 / 看过答案 / 纸上 / 没墨的写对）照旧写状态字
    const cells = entries.map(e => {
      const wrongOne = e.judgment === 'wrong' && e.kind === 'judged' && e.state !== 'paper';
      return {
        key: e.index, index: e.index, ch: e.char, status: wrongOne ? '' : statusWord(e), wrong: false,
        label: t('X-WORK.cellAria', { char: e.char, state: cellStateOf(e) }),
      };
    });
    return html`<${PlainRow} cells=${cells} grid=${grid} onOpen=${cell => onOpen(entries[cell.index])}
      label=${workAria(entries.map(e => e.char), entries.length, dateText)} />`;
  }
  const grid = resultGrid(work.cells.length, sw);
  const cells = work.cells.map(e => ({
    key: e.recordId || e.index, index: e.index, ch: e.char, ink: inkOf(e.record), mode: 'hand', dot: e.dot, record: e.recordId || '', state: e.state,
    label: t('X-WORK.cellAria', { char: e.char, state: stateWord(e) }),
  }));
  const caps = work.cells.map(e => (e.tag === 'afterSeen' ? t('X-WORK.afterSeen') : ''));
  return html`<${WorkPaper} cells=${cells} grid=${grid} caps=${caps} kuan=${kuan({ day, n: cells.length, picked })} reveal=${reveal}
    onOpen=${cell => onOpen(work.entries[cell.index])} label=${workAria(work.cells.map(e => e.char), work.cells.length, dateText)} />`;
}

export function rowText(entry, quiet = false) {
  switch (entry.state) {
    case 'addable':
    case 'added':
      return t(quiet ? 'X-FIRST.excludedQuiet' : 'X-FIRST.excluded');
    case 'noInk':
      return t(entry.judgment === 'wrong' ? 'X-WORK.rowNoInkWrong' : 'X-WORK.rowNoInkCorrect');
    case 'seen':
      return t('X-WORK.rowSeen');
    case 'skipped':
      return t('X-WORK.rowSkipped');
    default:
      // 纸上：「写对」，后面单独接墨三的「· 纸上」（rowTag）
      return t(entry.judgment === 'wrong' ? 'X-WORK.rowPaperWrong' : 'X-WORK.rowPaperCorrect');
  }
}

/** 纸上行的读屏名称：「{字}，写对，纸上」（交接 §5.5）；其余行读「{字}，{状态}」，字在文字里已经没有了（D49）。 */
export function rowAria(entry, quiet = false) {
  if (entry.state === 'paper') return t('X-WORK.rowPaperAria', { char: entry.char, state: judgmentWord(entry) });
  return t('X-WORK.rowAria', { char: entry.char, state: rowText(entry, quiet) });
}

/**
 * 作品下没放进图里的行（已放进图里的字回到作品，不再有行）。
 * D66 ④：写错的那一行带「修改 ›」（changeable(row) 为真时），与写字页结果行是同一个组件（write/result-row.js ChangeLink），点开同一个对照与改判弹层。
 * @param {{rows:Array, inkOf:(record)=>object|null, onOpen:(entry)=>void, onToggle:(entry)=>void, changeable?:(entry)=>boolean}} props
 */
export function WorkRows({ rows, inkOf, onOpen, onToggle, quiet = false, changeable = null }) {
  const ax = useAxSize();
  const shown = (rows || []).filter(row => row.state !== 'added');
  if (!shown.length) return null;
  const size = ax ? ROW_GLYPH_AX : ROW_GLYPH;
  return html`<div class="sz-exrows" data-testid="result-excluded">${shown.map(row => {
    const inked = row.state === 'addable';
    // 写错的字（有墨可放进图里的、或写错但没留墨迹的）在字的右上带朱点；纸上行没有墨、不带
    // quiet（没有任何作品，全写错那一屏）：不带朱点、用中性的「写过了」——朱点留给「放进图里」以后的作品（N3-03 / D53，P248）
    const wrongRow = !quiet && (row.state === 'addable' || (row.state === 'noInk' && row.judgment === 'wrong'));
    const ink = inked ? inkOf(row.record) : null;
    return html`<div key=${row.index} class="sz-exrow" data-testid="result-exrow" data-index=${row.index} data-char=${row.char} data-record=${row.recordId || ''}
      data-state=${row.state}>
      <button type="button" class="sz-exrow__open" data-testid="result-exrow-open" aria-label=${rowAria(row, quiet)} onClick=${() => onOpen(row)}>
        <span class=${ax ? 'sz-exrow__cell sz-exrow__cell--ax' : 'sz-exrow__cell'} data-testid="result-exrow-glyph" aria-hidden="true">
          <${CellCanvas} ch=${row.char} ink=${ink} mode=${inked ? 'hand' : 'under'} size=${size} pad=${ROW_PAD} testid="result-exrow-canvas" />
          ${wrongRow ? html`<${WrongDot} size=${size} ink=${ink} pad=${ROW_PAD} testid="result-exrow-dot" />` : null}
        </span>
        <span class="sz-exrow__t" data-testid="result-exrow-text">${rowText(row, quiet)}${row.state === 'paper'
          ? html` <span class="sz-exrow__tag" data-testid="result-exrow-tag">${t('X-DETAIL.paperTag')}</span>`
          : null}</span>
      </button>
      ${row.judgment === 'wrong' && changeable && changeable(row)
        ? html`<${ChangeLink} testid="result-exrow-change" onClick=${() => onOpen(row)} />` : null}
      ${inked
        ? html`<${Button} variant="text" data-testid="result-add"
            aria-label=${t('X-FIRST.addAria', { char: row.char })}
            onClick=${() => onToggle(row)}>${t('X-FIRST.addIn')}</${Button}>`
        : null}
    </div>`;
  })}</div>`;
}
