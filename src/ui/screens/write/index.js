// 写字页骨架（M1-1）：registerScreen('write')，params {slot:'A'|'B'}。
//
// 从 store 读 sessions[slot] 的当前字（core/sessions.currentCardKey）；页头（标题按阶段 R-W03、描一遍 / 自己写两步圆点 R-W04；回忆阶段中间是「n / 总数」R-W01、右上是 结束这组 / 跳过）、
// 结果行占位（M1-5）、题面占位（M1-8 换成 prompt.js）、书写格（边长按屏宽 / 视口高算，258–400，D36 / P118，与字号无关；内部坐标恒为 345 单位）、
// 撤销 / 清空（R-W18；A7 起在书写格正下方一行，图标加文字，撤销贴格左沿、清空贴格右沿；清空后给一次撤销，走查-W17）、按钮区：看答案占位（M1-4）、
// 提示占位（M1-3）、「写好了」（R-W29；空笔画时 disabled + aria-disabled，M1-5 接判断页）、跳过 / 结束这组占位（M1-5 / M2）。
//
// 版式（D49 减法修稿，实现交接 §13；D53 ② 起所有字号与 AX 版式同构，R3-C3W；D55 底栏改回文字行，R4-F1；W2 / D57 起方案 A7，P280 / P281）：页边 20；页头左「‹」、中间「n / 总数」
// （回忆阶段没有可见标题，标题只留给读屏；其它阶段标题在中间、计数在右侧）、右上「跳过」（picked 会话在它左边多一个「结束这组」）；
// 题面（整词居中，已给的字不装框）→ 16 → 书写格 → 格下（离格 4 的撤销 / 清空行 44 + 说明位 40：D19「上一个字」结果行、提示 / 看答案说明）作为一组，顶边按名义版式固定
// （layout.js，同一张卡的所有阶段不动）；底栏 = 求助行（foot.js WriteFoot，主按钮正上方 20 的凹面按钮：提示 / 看答案，其它阶段同位置换内容）+ 主按钮「写好了」，一次点击直达，没有菜单。
// 底栏下内边距 = 全 App 主按钮底线 max(24, 下安全区)（R5M / 审计 P1-15：A7 起主按钮是底栏最后一个，与首页、结果页、备份页同一条线；policy.writeGrid.footBottomMin = mainButtonLine）。
// 判断页（compare.js）的上下两格占书写格的位置（同一顶边、同一中线），两键进主按钮的位置，文字行留空占位。
//
// 规则：
// - 换字后 250ms 内落下的笔先持住、到点补开始 / 补画，不丢笔（01 §6.6 / 走查-V01；R2-X1 / P227：M3「250ms 起接受落笔、早到的缓存」，按事件 timeStamp）；进页面也算一次换字。
// - 换字 / 换阶段算「新状态」：按钮 0.4s 不响应（components/Button.js markStateChange，走查-W08）。
// - 左缘右滑返回（R4-G1，P270；取代 M0-7「写字页整页 backGestureEnabled=false」；R5-I2 / D58 ① / 交互规范 N3）：写字页每一个阶段都能滑动返回，
//   完成时执行的就是左上元素的同一个函数——回忆 / 看答案 / 描一遍 / 自己写是「‹」出页（nav.back；笔画现场在抬笔 / 撤销 / 清空时已写回会话，
//   跳过的撤销机会交给来源页，S4）；判断阶段是「‹ 接着写」页内回退（compare.back：回到刚才写字的状态，书写格与墨原样回来，
//   跟手画面是判断 → 回忆的 T-phase 倒放，见 root.js PHASE_BACK）。书写格四周有 20 页边，边缘起手不落在格子里；落笔中被手势打断时
//   ink-canvas.js 在 began 丢弃当前笔（与 pointercancel 同语义）。
// - 笔画现场（M1-6 persist.js）：本地现场从 session.current.strokes 取初值（刷新后回到同一阶段，笔迹都在）；
//   抬笔 / 撤销 / 清空后写回 sessions（失败不阻断，P52）；打开时做恢复幂等（已有 judged → 补推进，不再进 compare）。
// - 回忆阶段不把答案字写进任何属性 / 文本（决定-D16）：本页只暴露 cursor 序号，不暴露字。
//
// M1-5（compare.js / result-row.js / skip.js）：「写好了」→ 判断页（本地阶段覆盖 + 不阻断的会话写入，P52）；判断 commit
// （记录 + fsrsBefore + FSRS + 会话推进 + 按 perRecordInk 写墨迹）成功才翻下一字，失败三段式留在判断页；结果行（上一字
// judged / saw / skipped 三态，落笔后本字收起）与修改判断弹层；「跳过」（skipped 记录 + 3 秒撤销 = 第二次 commit）。
//
// M2-3（end.js / result/index.js）：「结束这组」（picked 会话，文字行右端、跳过左边；write-end-slot）；
// 最后一字处理完（判断 / 看答案后「下一个」/ 跳过，任一阶段）→ 会话移入 lastEnded（commitFinish）→ 本页就地换成结果页
// （nav.replace('result')，决定-D20 无中间页）；跳过最后一字的 3 秒撤销机会交给结果页（handoffSkipUndo）。
// M2 验收 H1：槽里没有会话（且不是刚交给结果页）→ 回本 tab 根，不留空页（刷新从 history 恢复 / reset / 跨天作废）。
//
// D63：写字页只有屏幕上写（原「在纸上写」写字方式与它的设置、纸面格、读屏建议已删；历史上的纸上记录仍照常显示，见 result/work.js、detail/records.js）。
//
// data-testid：write-screen、write-progress、write-steps、write-line-slot、write-prompt、write-grid（及
// write-grid-ink / write-grid-live / write-glyph-layer）、write-tools、write-undo、write-clear、write-note、
// write-done、write-foot、write-links（求助行）及其中的 write-hint / write-show-answer、页头的 write-skip / write-end（write-skip-slot / write-end-slot）、write-empty。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { injectStyles, T } from '../../components/styles.js';
import { InkGrid } from '../../canvas/ink-canvas.js';
import { currentCardKey, isComplete, PHASES } from '../../../core/sessions.js';
import { getStore, isReplacement } from '../../../store/store.js';
import { haptic, installCommitFeedback } from '../../../platform/haptics.js'; // M5-5 触觉 / 按键音（按 commit label）
import { warmSounds } from '../../../platform/sound.js'; // 阶段 1 S1：预载判断声 / 落款声（网页用；书写与描红不出声，P200）
import { t } from '../../../config/copy/index.js';
import * as policy from '../../../config/policy.js';
import { charOfCardKey } from '../../../core/records.js';
import { useHint, useStrokeData, HintNote } from './hint-layer.js';
import { Prompt } from './prompt.js';
import { answerInkKey, useAnswerFlow } from './answer.js';
import { useCompareFlow, useComparePhase } from './compare.js';
import { useResultRow } from './result-row.js';
import { handoffLeaveUndo, useSkip } from './skip.js';
import { useAxLevel, useCompact, useFootHairline, useWriteLayout } from './compact.js';
import { storedStrokes, usePersist } from './persist.js';
import { useEndGroup } from './end.js';
import { commitFinish, handoffSkipUndo, openResult } from '../result/index.js';
import { useFirstTip } from './first-tip.js';
import { LinkButton, Slot, WriteFoot } from './foot.js';
import { usePhaseFade } from './phase-fade.js';
import { gridLabel, useWriteAnnounce } from './sr-live.js';
import { AX_GRID_MIN, AX_NOTE_H, AX_BELOW_H, FOOT_BOTTOM_MIN, TOOL_ROW_H } from './layout.js';
import { NativeWriteHost, nativeWriteEnabled } from './native-session.js'; // B2.0：开关打开时本条目由原生写字页显示（默认关）

export const WRITE_SCREEN = 'write';
/** 换字后书写格的落笔门限（01 §6.6 / 走查-V01；P227：300 → 250，门限内的笔先持住、到点补画，不再丢弃）。 */
export const PEN_ARM_MS = 250;

// 阶段 → 标题（R-W03）。trace（描一遍）的标题在 R-W03 没有槽位，取原型 L553（copy X-ANSWER.titleTrace，M1-4）。
const TITLE_KEYS = Object.freeze({
  recall: 'R-W03.titleRecall',
  compare: 'R-W03.titleCompare',
  answer: 'R-W03.titleAnswer',
  trace: 'X-ANSWER.titleTrace',
  retrace: 'R-W03.titleSelf',
});

export function titleFor(phase) {
  const key = TITLE_KEYS[phase];
  return key ? t(key) : '';
}

// D66 ③：重写错字页（write/redo.js）是同一套版式，页面级样式认它的 testid（:is 要 iOS 14+，API 下限 15.0）
const W = '.sz-page:is([data-testid="write-screen"],[data-testid="redo-screen"])';
/** AX3–AX5 的选择器（辅助字分层封顶的第二、三档；R3-K1 P243）。 */
const AX_HI = (sel, extra = '') => [3, 4, 5].map(n => `:root[data-ax="${n}"]${extra} ${sel}`).join(',');
/** AX3–AX5 格下说明位的最小高度：两行 22pt 辅助字 2 × 30 + 上内边距 8（AX1–AX2 仍是 AX_NOTE_H = 56）。 */
const AX_NOTE_H_HI = 2 * 30 + 8;
/** AX3–AX5 格下总高的最小值：撤销 / 清空行 + 两行说明位。 */
const AX_BELOW_H_HI = TOOL_ROW_H + AX_NOTE_H_HI;

// 版式与 AX 同构（D53 ②，P257）：撤销 / 清空在书写格正下方一行（A7，P280）；底栏 = 求助行 + 主按钮（D55 / D57，P260 / P280；AX 档求助行字号封顶，P261）。
// AX 档（D51 ⑦，P225；A2-01 / A2-04 / A2-09）：写字页永不滚动（最矮的屏放不下时见 P278 的让步）。格下 = 撤销 / 清空行（24pt 图标、热区 44）+ 说明位（说明 / 提示 / 结果行；高度按实际内容，至少两行，P241），
// 底栏 = 求助行（56 高）+「写好了」（foot.js）。辅助字分层封顶（R3-K1 P243，第三轮审查 A3-03：上一轮一律 17pt 矫枉过正）：
// 说明 / 结果行 / 进度 / 页头标题 AX1–AX2 17pt、AX3–AX5 22pt；纸上写说明 22 / 28pt；拼音见 prompt.js（22 / 28pt）；题面汉字（格 52 × min(k, 1.6) = 83，字面 66）仍是页面上最大的字。
// 页头标题可折两行（不再单行省略）。
// 下面 :root[data-ax] 开头的规则就是这一套（尺寸见 layout.js axWriteLayout）。
injectStyles('write', `
${W} .sz-page__body{padding:0 ${T.gutter};gap:0}
${W} .sz-page__foot{padding:${T.s3} ${T.gutter} max(${FOOT_BOTTOM_MIN}px, env(safe-area-inset-bottom, 0px));gap:0} /* 底栏 = 求助行 + 主按钮（A7：求助行在「写好了」正上方）；主按钮是底栏最后一个，下内边距 = 全 App 主按钮底线 max(24, 下安全区)（规范 B2，审计 P1-15） */
${W} .sz-page__foot{position:relative}
${W} .sz-page__foot[data-under="true"]::before{content:"";position:absolute;left:0;right:0;top:0;height:${T.hair};background:${T.line}} /* 不占高度：出现 / 消失不挪动内容 */
:root[data-ax][data-text-large] ${W} .sz-page__head>.sz-page__title--hidden{position:absolute;order:0;flex:none;width:1px;height:1px;
  padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sz-write{--bleed:0px;flex:none;display:flex;flex-direction:column;align-items:stretch;gap:0}
.sz-write__prompt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
.sz-write[data-pfit] .sz-write__prompt{transform:scale(var(--pfit));transform-origin:50% 0;margin-bottom:var(--pfit-pull)} /* P299：放不下时题面整体按可用高度缩小（不重排、不截断；量到的题面高不受 transform 影响），下面的书写格跟着上移 */
.sz-write__gridwrap{display:flex;justify-content:center;margin:${T.s4} calc(-1 * var(--bleed)) 0}
.sz-write__below{position:relative;box-sizing:border-box;width:100%;display:flex;flex-direction:column;align-items:stretch;margin:0} /* 格下 = 撤销 / 清空行（与书写格同宽、居中）+ 说明位（A7，D57）。说明位取内容宽（屏宽 − 40），各字号同一条（与 AX 档同构，D53 ②；r7-W3）：
  书写格让到下限以下的矮屏上（SE 3 的 245）说明若只有格宽，XXXL 下 R-W07.selfNote 折成两行 54pt，比名义版式留的 40 高、压到底栏下；取内容宽后同一句是一行。书写格边长仍只由视口定（D36 / P299） */
.sz-write__note{flex:1;min-width:0;min-height:40px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-write__firsttip,.sz-hintnote{padding:3px 0} /* 单行时仍是 40 高的一行（文字居中，离格子 10）；两行说明（提示说明）46 高，文字离格子 ≥ 3、不被按钮行挡住（最矮的屏上书写格组只剩 4 的余量） */
.sz-write__firsttip{display:block}
.sz-write__headtools{display:flex;align-items:center}
.sz-write__headact{display:flex;align-items:center}
.sz-write__headact:empty{display:none}
.sz-write__headact+.sz-write__headact{margin-left:16px} /* 结束这组 | 跳过：字与字 ≥ 12，点击区不重叠（B2 / I3 · P1-13） */
.sz-write__headact .sz-btn--text{font-size:${T.fs17};line-height:${T.lh17};color:${T.ink2}}
/* 格下工具行（A7，D57，P280）：离格 4、撤销贴格左沿、清空贴格右沿，图标加文字、无底、常规字重；看答案阶段 / 纸上那一字没有墨可撤：整行收起（书写格 g 与组顶按名义版式算，不跟着挪） */
.sz-write__tools{flex:none;box-sizing:border-box;max-width:100%;height:${TOOL_ROW_H - 4}px;margin:4px auto 0;display:flex;align-items:center;justify-content:space-between}
.sz-write__tools[data-shown="false"]{display:none} /* 没有墨可撤的阶段不占位（说明贴着格子；书写格的大小与顶边不受影响：g 与组顶按名义版式固定，layout.js） */
.sz-write__tool{position:relative;min-height:${T.hit};padding:0 ${T.s1};margin-inline:calc(-1 * ${T.s1});display:inline-flex;align-items:center;gap:6px;
  font-family:${T.hei};font-size:${T.fs17};line-height:${T.lh17};font-weight:400;color:${T.ink2};white-space:nowrap}
.sz-write__tool svg{flex:none;width:20px;height:20px}
.sz-write__tool[data-pressed]{color:${T.ink1};transform:none;filter:none}
.sz-write__tool[disabled]{color:${T.ink4}}
.sz-write__progress{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-write__steps{height:5px;margin:-8px 0 3px;display:flex;justify-content:center;gap:5px;pointer-events:none}
.sz-write__dot{width:5px;height:5px;box-sizing:border-box;border-radius:50%;border:1px solid ${T.ink3}}
.sz-write__dot[data-on="true"]{border:0;background:${T.ink1}}
:root[data-ax] ${W} .sz-write__below{min-height:${AX_BELOW_H}px}
:root[data-ax] ${W} .sz-write__below *,:root[data-ax] ${W} .sz-write__progress{font-size:calc(17px * 1);line-height:24px}
${AX_HI(`${W} .sz-write__below *`)},${AX_HI(`${W} .sz-write__progress`)}{font-size:calc(22px * 1);line-height:30px}
:root[data-ax] ${W} .sz-write__note{box-sizing:border-box;min-height:${AX_NOTE_H}px;justify-content:flex-start;padding-top:8px}
${AX_HI(`${W} .sz-write__note`)}{min-height:${AX_NOTE_H_HI}px} /* 两行 22pt 辅助字 2 × 30 + 上内边距 8 */
${AX_HI(`${W} .sz-write__below`)}{min-height:${AX_BELOW_H_HI}px}
:root[data-ax] ${W} .sz-write__tool svg{width:24px;height:24px}
:root[data-ax] ${W} .sz-write__headact .sz-btn--text{font-size:calc(17px * 1);line-height:24px}
${AX_HI(`${W} .sz-write__headact .sz-btn--text`)}{font-size:calc(22px * 1);line-height:30px}
/* 书写格放不下 220、底栏已收紧（footCompact → data-tight，P278）：书写格上方间距 16 → 8、工具行贴格、说明位去掉上内边距（再让出 16pt） */
${W} .sz-write[data-tight="true"] .sz-write__gridwrap{margin-top:8px}
${W} .sz-write[data-tight="true"] .sz-write__tools{margin-top:0}
:root[data-ax] ${W} .sz-write[data-tight="true"] .sz-write__note{padding-top:0;min-height:${AX_NOTE_H - 8}px}
${AX_HI(`${W} .sz-write[data-tight="true"] .sz-write__note`)}{min-height:${AX_NOTE_H_HI - 8}px}
.sz-write__headtools .sz-write__progress{padding-right:4px}
:root[data-ax][data-text-large] ${W} .sz-page__head{flex-wrap:nowrap}
:root[data-ax][data-text-large] ${W} .sz-page__head>.sz-page__title:not(.sz-page__title--hidden){position:static;order:0;flex:1 1 0;min-width:0;
  padding:0 4px;text-align:center;white-space:normal;line-break:strict;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
  font-size:calc(17px * 1);line-height:24px}
${AX_HI(`${W} .sz-page__head>.sz-page__title:not(.sz-page__title--hidden)`, '[data-text-large]')}{font-size:calc(22px * 1);line-height:30px}
`);

const EMPTY = Object.freeze([]);

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * 订阅 store，返回 {state, epoch}：state 是已发布状态（store 未启动时为 null）；epoch 在本页挂载期间每遇到一次
 * 整体替换（store.isReplacement：load / seed / 恢复备份）加一——本地笔画现场以它为键的一部分，替换后按新状态重取，
 * 不把旧状态下的本地笔画（例如被替换掉的会话上写的一笔）带进新会话（M1 验收 G1）。
 */
function useStoreState() {
  const read = () => {
    try {
      return { state: getStore().getState(), epoch: 0 };
    } catch (error) {
      return { state: null, epoch: 0 };
    }
  };
  const [snap, setSnap] = useState(read);
  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      return undefined;
    }
    setSnap(prev => (prev.state === store.getState() ? prev : { state: store.getState(), epoch: prev.epoch }));
    return store.subscribe((next, info) => setSnap(prev => ({ state: next, epoch: prev.epoch + (isReplacement(info) ? 1 : 0) })));
  }, []);
  return snap;
}

/**
 * 本页是不是顶层页面（M2-2：只有顶层写字页写回会话现场）。
 * R4-G1 起不再管原生左缘返回门控（根组件统一发，见文件头）。
 */
function useIsTop(entry) {
  const [top, setTop] = useState(true);
  useEffect(() => {
    const router = getRouter();
    const id = entry && entry.id;
    const apply = snap => setTop(!router || !id || !snap || !snap.top || snap.top.id === id);
    apply(router ? router.getState() : null);
    return router ? router.subscribe(apply) : undefined;
  }, [entry && entry.id]);
  return top;
}

/**
 * 本页是不是「空着的」顶层：顶层页面就是本页、上面没有遮罩、router 没有正在等的返回。
 * 最后一字推进后只在这时换成结果页（nav.replace 只能换顶层页面，M2-3）。
 */
function useTopFree(entry) {
  const [free, setFree] = useState(false);
  useEffect(() => {
    const router = getRouter();
    const id = entry && entry.id;
    const apply = snap => setFree(!!id && !!snap && !!snap.top && snap.top.id === id && !snap.topIsOverlay && !snap.pending);
    apply(router ? router.getState() : null);
    return router ? router.subscribe(apply) : undefined;
  }, [entry && entry.id]);
  return free;
}

function StepDots({ phase }) {
  if (phase !== 'trace' && phase !== 'retrace') return null;
  const first = phase === 'trace';
  return html`<span class="sz-write__steps" role="img" data-testid="write-steps"
    aria-label=${t(first ? 'R-W04.stepTrace' : 'R-W04.stepSelf')}>
    <span class="sz-write__dot" data-on=${first ? 'true' : 'false'}></span>
    <span class="sz-write__dot" data-on=${first ? 'false' : 'true'}></span>
  </span>`;
}

/**
 * 写字页外壳：store 订阅、原生返回手势门控与触觉接线留在这一层（整页期间不变）；页面本体按 store 替换代数 epoch 作 key
 * 挂载——store 被整体替换（seed / 恢复备份 / 撤销 / 清空 / 迁移 / 重读）后，本体的全部本地状态（笔画现场、判断页本地阶段
 * 与失败态、跳过撤销机会与失败态、提示、看答案失败态、结果行收起、换字落笔门限、最后一字交接与回根标记）一起按新状态重来，
 * 不把替换前的现场带进新状态（M1 验收 G1 只接了笔画现场；M6-6 补齐「写字页其它本地状态接 epoch」）。
 * 旧本体卸载时 usePersist 的「离开即写回」不写：它记下的是替换前的现场（isStale）。
 */
function WriteScreen({ params, entry }) {
  if (nativeWriteEnabled()) return html`<${NativeWriteHost} params=${params} entry=${entry} />`;
  return html`<${WebWriteScreen} params=${params} entry=${entry} />`;
}

function WebWriteScreen({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const { state, epoch } = useStoreState();
  const isTop = useIsTop(entry);
  useEffect(() => { installCommitFeedback(getStore); }, []); // M5-5：判断 / 提示 / 看答案 / 撤销等 commit 成功后发触觉与判断声（platform/haptics.js）
  useEffect(() => { warmSounds(); }, []); // S1：网页预载判断声三个变体与落款声，判断时直接播
  const epochRef = useRef(epoch);
  epochRef.current = epoch;
  return html`<${WriteBody} key=${`e${epoch}`} slot=${slot} state=${state} epoch=${epoch} isTop=${isTop} entry=${entry}
    isStale=${() => epochRef.current !== epoch} />`;
}

function WriteBody({ slot, state, epoch, isTop, entry, isStale }) {
  const session = state && state.sessions ? state.sessions[slot] || null : null;
  const cardKey = currentCardKey(session);
  const rawPhase = session && session.current ? session.current.phase : 'recall';
  // D64 ②：看答案直接进描一遍；旧版本存下的 'answer' 阶段（先看后点「描一遍」）按描一遍恢复。
  const storedPhase = rawPhase === 'answer' ? 'trace' : PHASES.includes(rawPhase) ? rawPhase : 'recall';
  // M2-2：被压在下面期间本页不写回现场；重新成为顶层时，若这期间存下的现场被别处改过（上面那页写过同一槽），
  // 按存下的现场重取本地笔画，不把旧笔画写回去；没被改过就保留本地笔画（下一次写回照常）。
  const topGenRef = useRef({ was: isTop, gen: 0, current: null });
  const storedCurrent = session ? session.current : null;
  if (!isTop && topGenRef.current.was) topGenRef.current.current = storedCurrent;
  if (isTop && !topGenRef.current.was && storedCurrent !== topGenRef.current.current) topGenRef.current.gen += 1;
  topGenRef.current.was = isTop;

  // 换字（含进页面）→ 250ms 内的落笔先持住、到点补画。在渲染期定下时刻（与原型 penArm 同法，Math.max 幂等），保证新字第一帧就生效。
  const armRef = useRef({ key: undefined, until: 0 });
  if (armRef.current.key !== cardKey) armRef.current = { key: cardKey, until: clockNow() + PEN_ARM_MS };

  // 当前字的笔画现场：{key, strokes, cleared}；cleared = 清空前的笔画（给一次撤销，W17）。
  // M1-4：answer / trace / retrace 各阶段各自一份（进描一遍 / 自己写都是空格子），recall ⇄ compare 共用一份。
  const inkKey = answerInkKey(cardKey, storedPhase); // recall 与 compare 同一份，用存下的阶段即可
  // 本地现场的键 = store 替换代数 + inkKey：store 被整体替换（seed / 恢复备份 / reset 重读）后，即使还是同一个字、
  // 同一阶段，也按新状态重取，不沿用替换前的本地笔画（G1：下层写字页留着旧会话上的一笔，重新 seed 后又画回来）。
  const localKey = `${epoch}.${topGenRef.current.gen}#${inkKey}`;
  const keyRef = useRef({ localKey, inkKey });
  keyRef.current = { localKey, inkKey };
  // M1-6：每一份现场的初值取存下的 session.current.strokes（刷新恢复）；之后以本地为准，由 usePersist 写回。
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const hydrate = ({ localKey: key, inkKey: ik }) => {
    const s = sessionRef.current;
    return { key, strokes: storedStrokes(s, currentCardKey(s), ik), cleared: null };
  };
  const [ink, setInk] = useState(() => hydrate(keyRef.current));
  const view = ink.key === localKey ? ink : hydrate(keyRef.current);
  const update = fn => setInk(prev => fn(prev.key === keyRef.current.localKey ? prev : hydrate(keyRef.current)));

  // M1-5：有效阶段 = 存下的阶段 + 进 / 出判断页的本地覆盖（写入不阻断，P52）；compare 且没有本人笔画按 recall（01 §3.3）。
  const cmpPhase = useComparePhase({ slot, session, cardKey, storedPhase, strokeCount: view.strokes.length });
  const phase = cmpPhase.phase;
  // M1-6 会话现场：本地笔画一变就写回 sessions（P52 不阻断 + 一次性提示）、visibilitychange 重写、打开时恢复幂等。
  // M2-2：只有顶层写字页写回现场（抬笔 / visibilitychange / pagehide / 离开）；被压在下面时不写（cardKey 传 null = 不写）。
  const persist = usePersist({ slot, session, state, cardKey: isTop ? cardKey : null, inkKey, strokes: view.strokes, phase, isStale });

  // 换字 / 换阶段 = 新状态：按钮 0.4s 不响应。
  useLayoutEffect(() => {
    markStateChange();
  }, [cardKey, phase]);

  // 跳过的 3 秒撤销：下一字一开始操作（落笔 / 提示 / 看答案）就结束（G3）。skip 在后面创建，这里经 ref 调用。
  const endSkipUndoRef = useRef(null);
  const endSkipUndo = () => {
    if (endSkipUndoRef.current) endSkipUndoRef.current();
  };
  // M1-3 提示：当前字的笔顺数据（M1-4 看答案 / 描一遍共用 strokeData）与提示控制器（hint-layer.js）。
  const strokeData = useStrokeData(charOfCardKey(cardKey));
  const hint = useHint({
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, written: view.strokes.length, ownStrokes: view.strokes, strokes: strokeData, getStore,
    onHinted: endSkipUndo,
  });
  // Q2-1（03 P181）：首练第 1 字格下一次性提示「凭记忆写；想不起来，点下面的「提示」。」（settings.firstTipSeen；首次落笔 / 用提示后收起）。
  const firstTip = useFirstTip({
    settings: state ? state.settings : null, session, phase, strokeCount: view.strokes.length, hinted: hint.used > 0,
    getStore,
  });
  // 版式（compact.js useWriteLayout → layout.js，D49 实现交接 §13.2）：题面 + 书写格 + 格下工具行作为一组在页头与按钮行之间居中（空余 40% 在上）；书写格边长按
  // 可用高度算（258–400，D36 / P118，与字号、阶段、提示无关）；判断页上下两格（AX 档可能并排）与书写格同一顶边、同一中线。内部坐标恒为 345 单位，这里只是显示尺寸。
  const compact = useCompact();
  const ax = useAxLevel();
  const writeRef = useRef(null);
  const layout = useWriteLayout(writeRef, { phase, ax, noteKey: cardKey ? `${cardKey}|${phase}` : null });
  // P261 / P278：AX 档书写格会低于下限 220 时，底栏主按钮字号直接封顶 34pt（提示 / 看答案 / 跳过任何字号都不收起；「在纸上写」已不在写字页，D56）。
  // 封顶后不再自动放回，换了字号 / 屏幕尺寸才重新判断。
  const viewKey = `${ax}|${layout.width}|${layout.nominalHeight}`;
  const [footCompactKey, setFootCompactKey] = useState(null);
  const footCompact = ax > 0 && footCompactKey === viewKey;
  useLayoutEffect(() => {
    if (ax > 0 && layout.tight && !footCompact) setFootCompactKey(viewKey);
  }, [ax, layout.tight, footCompact, viewKey]);
  const gridSize = layout.g;
  const pfit = layout.promptScale || 1; // P299：题面缩放（只在放不下时 < 1）
  const groupTop = phase === 'compare' ? layout.pair.top : layout.top;
  // 阶段 / 换字的 150ms 交叉淡化（phase-fade.js，P227）：key 一变，渲染期给旧页拍快照，提交后盖上去淡出；减少动态效果直接切换。
  usePhaseFade(writeRef, cardKey ? `${cardKey}|${phase}` : null);
  useFootHairline(writeRef); // 内容比可视高度长（AX 档 / 小屏放不下）时，按钮行上沿出现 hairline
  // M1-5 判断页、结果行、跳过。判断页两格边长 layout.pair（D46 ⑪ / D49：上下排，AX 档取上下排与并排里格子更大的一种）。
  const compare = useCompareFlow({
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, strokes: view.strokes, hints: hint.used, strokeData,
    onLeave: cmpPhase.leave, size: layout.pair.s || gridSize, layout: layout.pair.layout,
  });
  const row = useResultRow({ slot, session, state, phase, strokeCount: view.strokes.length });
  const skip = useSkip({ slot, session, cardKey, phase, hints: hint.used, strokes: view.strokes });
  endSkipUndoRef.current = skip.dismiss;
  // M1-4 看答案 / 描一遍 / 自己写（answer.js）：回忆阶段「看答案」按钮、answer 阶段卡片、描红层、格下说明、接管底栏
  // （接管时「结束这组」放在它底栏「下一个」那一行右端，H4）。Q1：本地笔画交给它，离开自己写一遍时存成看后自写的墨迹。
  const answer = useAnswerFlow({
    slot, session, cardKey, phase, strokeCount: view.strokes.length, strokes: view.strokes,
    onShowAnswer: endSkipUndo, ax, footCompact,
    hintDone: hint.buttonModel.kind === 'exhausted' ? hint.button : null, // 提示整字给完而记的看过答案：底栏仍留着不可点的「提示」（D64 ①）
  });
  // M2-3「结束这组」（picked 会话；打开确认框即结束跳过的撤销机会）。除判断页外各阶段都显示（H4）；A7（D57）起在页头右上、跳过左边。保存失败（跳过 / 看答案流程）时不显示。
  const end = useEndGroup({ slot, session, phase, blocked: skip.failed || answer.failed, onOpen: endSkipUndo });

  // 读屏播报（A2-06，P231）：笔数（抬笔 / 撤销 / 清空）、提示给出了哪几笔、描一遍出现时的笔序；视觉隐藏的 aria-live=polite 区域，挂在写字页根上（不在淡化快照里）。
  const announce = useWriteAnnounce({
    key: cardKey ? `${cardKey}|${phase}` : null,
    strokeCount: view.strokes.length,
    drawable: (phase === 'recall' || phase === 'trace' || phase === 'retrace'),
    hintView: hint.view,
    trace: { active: phase === 'trace', status: strokeData ? strokeData.status : 'loading', total: strokeData && strokeData.data && strokeData.data.medians ? strokeData.data.medians.length : 0 },
  });

  // M2-3：最后一字处理完（任一阶段推进，cursor 到队尾）→ 会话移入 lastEnded → 就地换成结果页（D20，无中间页）。
  // 跳过最后一字的撤销机会交给结果页；结束写入失败时结果页照样按槽里的会话显示并补写（commitFinish 幂等）。
  const topFree = useTopFree(entry);
  const complete = !!session && isComplete(session);
  const finishedRef = useRef(null);
  // layout effect：在浏览器画出这一帧之前换页（写字页的空占位不会被画出来；router 重渲染走微任务）。
  useLayoutEffect(() => {
    if (!complete || !topFree || finishedRef.current === session.id) return;
    finishedRef.current = session.id;
    const u = skip.undo;
    handoffSkipUndo(u && !u.failed && u.sessionId === session.id ? { ...u, slot } : null);
    try {
      commitFinish(getStore(), { slot, sessionId: session.id });
    } catch (error) {
      // store 不可用：结果页按槽里的会话显示，挂载时再补写
    }
    openResult(slot, session.id);
  }, [complete, topFree, session && session.id]);

  // M2 验收 H1：槽里没有会话（测试 reset / 跨天作废 / 别处结束了这组，或刷新时 router 从 history.state 恢复出一个已经没有
  // 会话的写字页）→ 回到本 tab 的根（首页），不显示只有标题的空页。最后一字已交给结果页（finishedRef）时不算。
  // 只在本页是空着的顶层时做，并按 router / store 的即时状态再判一次：结束这组等流程在 commit 之后紧接着 closeOverlay +
  // back / replace，那时 router 已有 pending 或顶层已换，这里不插手。router.replace 只能换成子页面，回 tab 根用 switchTab
  // （同一 tab：退回 depth 0，不换 tab）。
  const orphan = !session && !finishedRef.current;
  const leftRef = useRef(false);
  useEffect(() => {
    if (!orphan || !topFree || leftRef.current) return;
    const router = getRouter();
    const snap = router ? router.getState() : null;
    const id = entry && entry.id;
    if (!snap || !id || !snap.top || snap.top.id !== id || snap.topIsOverlay || snap.pending || snap.depth === 0) return;
    let live = null;
    try {
      const st = getStore().getState();
      live = st && st.sessions ? st.sessions[slot] || null : null;
    } catch (error) {
      live = null;
    }
    if (live) return;
    leftRef.current = true;
    nav.switchTab(snap.tab);
  }, [orphan, topFree]);
  const onStrokeStart = () => {
    row.onStrokeStart(); // 落笔：上一字的结果行收起（决定-D19）
    skip.dismiss(); // 落笔：跳过的撤销机会结束（G3）
  };

  const onStrokeEnd = raw => update(prev => ({ ...prev, strokes: prev.strokes.concat([raw]), cleared: null }));
  const onUndo = () => update(prev => {
    if (prev.strokes.length) return { ...prev, strokes: prev.strokes.slice(0, -1) };
    if (prev.cleared) return { ...prev, strokes: prev.cleared, cleared: null };
    return prev;
  });
  const onClear = () => update(prev => (prev.strokes.length ? { ...prev, strokes: EMPTY, cleared: prev.strokes } : prev));
  const onDone = () => {
    // 进判断页（compare）；空格子不进（01 §6.6：按钮 disabled 之外再挡一次；判断 commit 前还会再断言有本人笔画）。
    if (!view.strokes.length) return;
    haptic('light'); // F1：「写好了」书写格开始收缩（不写记录的操作随用户动作发，P1-35）
    cmpPhase.enter(view.strokes);
  };

  // 「‹」出页（左缘右滑同一个函数）：跳过的撤销条还在时，把剩余的撤销机会交给来源页（交互规范 S4「撤销窗口跟人走」，审计 P1-11）。
  const leave = () => {
    const u = skip.undo;
    handoffLeaveUndo(u && !u.failed && session && u.sessionId === session.id ? { ...u, slot } : null);
    nav.back();
  };

  // 撤销底栏挂在页面根上（G3）：最后一字跳过后是空页（M2-3 换成结果页），底栏照样在、可撤销回到那个字。
  if (!cardKey) {
    return html`<${Page} title=${titleFor('recall')} onBack=${leave} testid="write-screen">
      <div data-testid="write-empty"></div>
      ${skip.bar}
    </${Page}>`;
  }

  const hasStrokes = view.strokes.length > 0;
  const canUndo = hasStrokes || !!view.cleared;
  const drawable = phase === 'recall' || phase === 'trace' || phase === 'retrace';
  // 进度「n / 总数」：读屏念「第 n 个字，共 m 个」（A2-09），不念斜杠符号；AX 档视觉上封顶 17pt（P225）。
  const progress = html`<span class="sz-write__progress" data-testid="write-progress" role="img"
    aria-label=${t('R-W01.progressLabel', { n: session.cursor + 1, total: session.queue.length })}>${t('R-W01.progress', {
    n: session.cursor + 1,
    total: session.queue.length,
  })}</span>`;

  // 撤销 / 清空（R-W18，A7 / D57 / P280）：格下一行，撤销贴格左沿、清空贴格右沿，图标加文字；无墨时 ink4 且不可点（P226 / I2-06）；看答案 / 判断阶段 visibility:hidden 占位。
  const toolRow = html`<div class="sz-write__tools" data-testid="write-tools" data-shown=${drawable ? 'true' : 'false'}
          style=${{ width: `${gridSize}px` }}>
          <${Button} variant="plain" class="sz-write__tool" data-testid="write-undo" aria-label=${t('R-W18.btnUndo')} disabled=${!canUndo} rapid
            onClick=${onUndo}>${Icons.undo()}<span>${t('R-W18.btnUndo')}</span></${Button}>
          <${Button} variant="plain" class="sz-write__tool" data-testid="write-clear" aria-label=${t('R-W18.btnClear')} disabled=${!hasStrokes} rapid
            onClick=${onClear}>${Icons.clear()}<span>${t('R-W18.btnClear')}</span></${Button}>
        </div>`;

  const noteBody = answer.active ? answer.note
    : skip.failed ? skip.note : hint.note ? html`<${HintNote} note=${hint.note} />` : firstTip.node;
  // 格下说明位的内容（结果行 / 说明）。
  const noteNodes = html`<span class="sz-write__lineslot" data-testid="write-line-slot">${row.node}</span>${noteBody}`;
  const hasNote = !!(row.node || noteBody);
  // 底栏（A7，D57，P280）：求助行（主按钮正上方 20）+ 主按钮「写好了」——左 提示 / 看答案，一次点击直达，没有菜单；跳过、结束这组在页头右上（write/index.js 下面的 trailing）。
  // 保存失败（跳过写失败）时主按钮是「再试一次」，「先不保存」是求助行里的按钮。
  const footer = skip.failed
    ? html`<${WriteFoot} primary=${{ testid: 'write-skip-fail-retry', label: t('R-W16.retry'), onClick: skip.run }} testid="write-foot" stage="recall" failed=${true} compact=${footCompact}
        left=${html`<${Slot} testid="write-fail-slot"><${LinkButton} testid="write-skip-fail-cancel" label=${t('R-W16.cancel')} onClick=${skip.cancelFail} /></${Slot}>`} />`
    : html`<${WriteFoot} primary=${{ testid: 'write-done', label: t('R-W29.btnDone'), disabled: !hasStrokes, onClick: onDone }} testid="write-foot" stage=${phase} compact=${footCompact}
        left=${html`<${Slot} testid="write-hint-slot" cls="sz-write__hint">${hint.button}</${Slot}>
          <${Slot} testid="write-answer-slot">${answer.link}</${Slot}>`} />`;

  // 页头（A7，D57，P280）：回忆阶段（标题只给读屏）中间是进度「2 / 5」、右上是 [结束这组][跳过]；其余阶段中间仍是标题，进度和 [结束这组] 在右侧（「下一个」在求助行）。
  // 判断页没有撤销 / 清空 / 跳过，右侧只有进度。
  const endNode = end.button ? html`<span class="sz-write__headact" data-testid="write-end-slot">${end.button}</span>` : null;
  const skipNode = skip.button ? html`<span class="sz-write__headact" data-testid="write-skip-slot">${skip.button}</span>` : null;
  const centerProgress = phase === 'recall' && !compare.active;
  const trailing = compare.active
    ? html`<span class="sz-write__headtools">${progress}</span>`
    : centerProgress ? html`<span class="sz-write__headtools">${endNode}${skipNode}</span>` : html`<span class="sz-write__headtools">${progress}${endNode}</span>`;
  return html`<${Page} title=${titleFor(phase)} hideTitle=${phase === 'recall' || (phase === 'compare' && ax > 0)} onBack=${leave}
    backLabel=${phase === 'trace' || phase === 'retrace' ? 'leave' : 'back'} lead=${compare.lead} onLead=${compare.back}
    center=${centerProgress ? progress : null} trailing=${trailing} footer=${answer.footer || (compare.active ? compare.footer : footer)} testid="write-screen">
    <div class="sz-write" ref=${writeRef} data-cursor=${session.cursor} data-phase=${phase} data-slot=${slot} data-grid=${gridSize}
      data-compact=${compact ? 'true' : 'false'} data-tight=${footCompact ? 'true' : null} data-ax=${ax > 0 ? String(ax) : null} data-pfit=${pfit < 1 ? String(pfit) : null} data-gfit=${ax > 0 && gridSize < AX_GRID_MIN ? "true" : null}
      style=${pfit < 1 ? { paddingTop: `${groupTop}px`, '--pfit': String(pfit), '--pfit-pull': `${-Math.round((1 - pfit) * layout.promptHeight * 10) / 10}px` } : { paddingTop: `${groupTop}px` }}>
      <${StepDots} phase=${phase} />
      <${Prompt} cardKey=${cardKey} queue=${session.queue} phase=${phase} />
      <div class="sz-write__gridwrap">
        ${answer.stage || compare.stage || html`<${InkGrid}
          strokes=${view.strokes}
          onStrokeEnd=${onStrokeEnd}
          drawable=${drawable}
          acceptFrom=${armRef.current.until}
          onStrokeStart=${onStrokeStart}
          glyphLayer=${answer.glyphLayer || hint.layer}
          inkOpacity=${hint.inkOpacity}
          inkTransition=${hint.inkTransition}
          resetKey=${cardKey + '|' + phase}
          size=${gridSize}
          label=${gridLabel(view.strokes.length)}
        />`}
      </div>
      ${compare.active ? null : html`<div class="sz-write__below" data-has-note=${hasNote ? 'true' : 'false'}>
        ${toolRow}
        <span class="sz-write__note" data-testid="write-note">${noteNodes}</span>
      </div>`}
    </div>
    ${announce.node}
    ${skip.bar}
    ${persist.notice}
  </${Page}>`;
}

registerScreen(WRITE_SCREEN, WriteScreen, { label: titleFor('recall'), nativeHost: () => nativeWriteEnabled() });
