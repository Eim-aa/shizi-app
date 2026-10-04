// 写字页骨架（M1-1）：registerScreen('write')，params {slot:'A'|'B'}。
//
// 从 store 读 sessions[slot] 的当前字（core/sessions.currentCardKey）；页头（标题按阶段 R-W03、右侧「n / 总数」R-W01、
// 描一遍 / 自己写两步圆点 R-W04）、结果行占位（M1-5）、题面占位（M1-8 换成 prompt.js）、书写格（边长按屏宽 / 视口高算，258–400，
// D36 / P118，与字号无关；内部坐标恒为 345 单位）、撤销 / 清空（R-W18；格下一行右端，标准版与紧凑版同一位置，G32；清空后给一次撤销，走查-W17）、按钮区：看答案占位（M1-4）、
// 提示占位（M1-3）、「写好了」（R-W29；空笔画时 disabled + aria-disabled，M1-5 接判断页）、跳过 / 结束这组占位（M1-5 / M2）。
//
// 版式（D49 减法修稿，实现交接 §13；取代 P1-E1b 的版式）：页边 20；页头只有左「‹」与右计数（回忆阶段没有可见标题，标题只留给读屏）；题面（整词居中，已给的字
// 不装框）→ 16 → 书写格 → 格下工具行（高 40：说明在左，撤销 / 清空图标在右；D19「上一个字」结果行在这个说明位）作为一组，在页头与按钮行之间居中（空余 40% 在上，
// layout.js）；按钮行只有一个主按钮「写好了」，其下一行文字按钮：左「提示」「看答案」、右「跳过」（picked 会话再多一个「结束这组」，在「跳过」左边）。
// 判断页（compare.js）的上下两格占书写格的位置（同一顶边、同一中线），两键进主按钮的位置、文字行留空。
//
// 规则：
// - 换字后 0.3s 书写格不接受落笔（01 §6.6 / 走查-V01，按事件 timeStamp）；进页面也算一次换字。
// - 换字 / 换阶段算「新状态」：按钮 0.4s 不响应（components/Button.js markStateChange，走查-W08）。
// - 写字页是顶层页面期间 backGestureEnabled=false（01 §7：整页期间，不是只在落笔期间——M0-7）；离开顶层 / 卸载时交还
//   按栈的值（tab 根页 false、子页 true，router.backGestureAllowed），根组件在写字页为顶层时不发（ownsBackGesture）。
// - 笔画现场（M1-6 persist.js）：本地现场从 session.current.strokes 取初值（刷新后回到同一阶段，笔迹都在）；
//   抬笔 / 撤销 / 清空后写回 sessions（失败不阻断，P52）；打开时做恢复幂等（已有 judged → 补推进，不再进 compare）。
// - 回忆阶段不把答案字写进任何属性 / 文本（决定-D16）：本页只暴露 cursor 序号，不暴露字。
//
// M1-5（compare.js / result-row.js / skip.js）：「写好了」→ 判断页（本地阶段覆盖 + 不阻断的会话写入，P52）；判断 commit
// （记录 + fsrsBefore + FSRS + 会话推进 + 按 perRecordInk 写墨迹）成功才翻下一字，失败三段式留在判断页；结果行（上一字
// judged / saw / skipped 三态，落笔后本字收起）与修改判断弹层；「跳过」（skipped 记录 + 3 秒撤销 = 第二次 commit）。
//
// M2-3（end.js / result/index.js）：「结束这组」（picked 会话，跳过那一行右边；紧凑版在 write-end-slot）；
// 最后一字处理完（判断 / 看答案后「下一个」/ 跳过，任一阶段）→ 会话移入 lastEnded（commitFinish）→ 本页就地换成结果页
// （nav.replace('result')，决定-D20 无中间页）；跳过最后一字的 3 秒撤销机会交给结果页（handoffSkipUndo）。
// M2 验收 H1：槽里没有会话（且不是刚交给结果页）→ 回本 tab 根，不留空页（刷新从 history 恢复 / reset / 跨天作废）。
//
// P1-E8（paper.js，D46 ⑬）：这一字在纸上写时，书写格换成同样大小的纸面格（提示照常画在里面）、格下说明换成「纸上」说明、
// 「写好了」不要求笔画、判断页只有参考字形；屏幕上写且还没落笔时格下右端是「在纸上写」（只改这一个字）。
//
// data-testid：write-screen、write-progress、write-steps、write-line-slot、write-prompt、write-grid（及
// write-grid-ink / write-grid-live / write-glyph-layer）、write-tools、write-undo、write-clear、write-note、
// write-answer-slot、write-hint-slot、write-done、write-skip-slot、write-end-slot、write-empty。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { backGestureAllowed, registerScreen, getRouter, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { InkGrid } from '../../canvas/ink-canvas.js';
import { currentCardKey, isComplete, PHASES } from '../../../core/sessions.js';
import { getStore, isReplacement } from '../../../store/store.js';
import { setBackGestureEnabled } from '../../../platform/bridge.js';
import { installCommitFeedback } from '../../../platform/haptics.js'; // M5-5 触觉 / 按键音（按 commit label）
import { warmSounds } from '../../../platform/sound.js'; // 阶段 1 S1：预载判断声 / 落款声（网页用；书写与描红不出声，P200）
import { t } from '../../../config/copy/index.js';
import { charOfCardKey } from '../../../core/records.js';
import { useHint, useStrokeData, HintNote } from './hint-layer.js';
import { Prompt } from './prompt.js';
import { answerInkKey, useAnswerFlow } from './answer.js';
import { useCompareFlow, useComparePhase } from './compare.js';
import { useResultRow } from './result-row.js';
import { useSkip } from './skip.js';
import { useAxLevel, useCompact, useFootHairline, useWriteLayout } from './compact.js';
import { storedStrokes, usePersist } from './persist.js';
import { useEndGroup } from './end.js';
import { commitFinish, handoffSkipUndo, openResult } from '../result/index.js';
import { PaperNote, PaperStage, ToPaperButton, usePaperMode, usePaperSuggest } from './paper.js';
import { useFirstTip } from './first-tip.js';
import { assistiveTechActive } from '../../../platform/accessibility.js';
import { AxFoot } from './ax-menu.js';
import { AX_NOTE_H } from './layout.js';

export const WRITE_SCREEN = 'write';
/** 换字后书写格不接受落笔的时长（01 §6.6 / 走查-V01，已定）。 */
export const PEN_ARM_MS = 300;

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

const W = '.sz-page[data-testid="write-screen"]';

// AX 档（D51 ⑦，P225；A2-01 / A2-04 / A2-09）：写字页永不滚动。撤销 / 清空常驻页头（28pt 图标、热区 44），底栏只剩「写好了」+「⋯」（ax-menu.js），
// 格下只剩固定 56 高的说明位（说明 / 提示 / 结果行，辅助字封顶 17pt）；拼音、进度、说明、纸上说明等辅助信息封顶 17pt，题面汉字才随档放大（prompt.js）。
// 下面 :root[data-ax] 开头的规则就是这一套（尺寸见 layout.js axWriteLayout）。
injectStyles('write', `
${W} .sz-page__body{padding:0 ${T.gutter};gap:0}
${W} .sz-page__foot{padding:${T.s3} ${T.gutter} max(8px, env(safe-area-inset-bottom, 0px));gap:0}
${W} .sz-page__foot{position:relative}
${W} .sz-page__foot[data-under="true"]::before{content:"";position:absolute;left:0;right:0;top:0;height:${T.hair};background:${T.line}} /* 不占高度：出现 / 消失不挪动内容 */
:root[data-ax][data-text-large] ${W} .sz-page__head>.sz-page__title--hidden{position:absolute;order:0;flex:none;width:1px;height:1px;
  padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sz-write{--bleed:0px;flex:none;display:flex;flex-direction:column;align-items:stretch;gap:0}
.sz-write__prompt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
.sz-write__gridwrap{display:flex;justify-content:center;margin:${T.s4} calc(-1 * var(--bleed)) 0}
.sz-write__below{position:relative;box-sizing:border-box;max-width:100%;min-height:40px;display:flex;align-items:flex-start;justify-content:space-between;gap:${T.s3};margin:0 auto}
.sz-write__note{flex:1;min-width:0;min-height:40px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-write__firsttip,.sz-hintnote,.sz-paper__note{padding:3px 0} /* 单行时仍是 40 高的一行（文字居中，离格子 10）；两行说明（提示说明、纸上脚注）46 高，文字离格子 ≥ 3、不被按钮行挡住（最矮的屏上书写格组只剩 4 的余量） */
.sz-write__firsttip{display:block}
.sz-write__tools{flex:none;height:40px;display:flex;align-items:center;margin-right:-8px}
.sz-write__tools[data-shown="false"]{visibility:hidden}
.sz-write__tools[data-paper="true"]{display:none} /* 纸上那一字没有撤销 / 清空，不再为它们空着一块宽度（脚注才放得下，Q2-12） */
/* 图标按钮（设计系统 sz-ibtn）：可见 36（::before 画底）、热区 44（base.css 的按钮最小 44 就是热区，两个相邻的图标压 4）；有墨 ink2、无墨 ink4 且不可点 */
.sz-write__ibtn{position:relative;width:44px;height:44px;display:grid;place-items:center;padding:0;color:${T.ink2}}
.sz-write__ibtn+.sz-write__ibtn{margin-left:-4px}
.sz-write__ibtn::before{content:"";position:absolute;inset:4px;border-radius:${T.rCtl}}
.sz-write__ibtn svg{position:relative;width:20px;height:20px}
.sz-write__ibtn[data-pressed]{color:${T.ink1};transform:none;filter:none}
.sz-write__ibtn[data-pressed]::before{background:${T.field}}
.sz-write__ibtn[disabled]{color:${T.ink4}}
.sz-write__progress{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-write__steps{height:5px;margin:-8px 0 3px;display:flex;justify-content:center;gap:5px;pointer-events:none}
.sz-write__dot{width:5px;height:5px;box-sizing:border-box;border-radius:50%;border:1px solid ${T.ink3}}
.sz-write__dot[data-on="true"]{border:0;background:${T.ink1}}
.sz-write__foot{display:flex;flex-direction:column;gap:6px}
.sz-write__main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${T.s3};align-items:stretch}
.sz-write__links{min-height:${T.hit};display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:${T.s3}}
.sz-write__linkgrp{display:flex;align-items:center;gap:${T.s4};min-width:0}
.sz-write__linkgrp:last-child{margin-left:auto}
.sz-write__slot:empty{display:none}
.sz-write__linkrow,.sz-write__skiprow,.sz-write__hint{min-height:${T.hit};display:flex;align-items:center}
.sz-write__endslot{display:flex;align-items:center}
:root[data-ax] .sz-write__links--ghost{display:none}
:root[data-ax] ${W} .sz-write__below{width:100%;min-height:${AX_NOTE_H}px;margin:0}
:root[data-ax] ${W} .sz-write__below *,:root[data-ax] ${W} .sz-paper__title,:root[data-ax] ${W} .sz-paper__text,:root[data-ax] ${W} .sz-paper__back,
:root[data-ax] ${W} .sz-write__progress{font-size:calc(17px * 1);line-height:24px}
:root[data-ax] ${W} .sz-write__note{box-sizing:border-box;min-height:${AX_NOTE_H}px;justify-content:flex-start;padding-top:8px}
:root[data-ax] ${W} .sz-write__axhead{display:flex;align-items:center}
:root[data-ax] ${W} .sz-write__axhead .sz-write__tools{height:44px;margin-right:0;visibility:visible}
:root[data-ax] ${W} .sz-write__axhead .sz-write__tools[data-shown="false"]{visibility:hidden}
:root[data-ax] ${W} .sz-write__axhead .sz-write__ibtn svg{width:28px;height:28px}
:root[data-ax] ${W} .sz-write__axhead .sz-write__ibtn::before{inset:0}
:root[data-ax] ${W} .sz-write__axhead .sz-write__ibtn+.sz-write__ibtn{margin-left:0}
:root[data-ax] ${W} .sz-write__axhead .sz-write__progress{padding-left:4px}
:root[data-ax][data-text-large] ${W} .sz-page__head{flex-wrap:nowrap}
:root[data-ax][data-text-large] ${W} .sz-page__head>.sz-page__title:not(.sz-page__title--hidden){position:static;order:0;flex:1 1 0;min-width:0;
  padding:0 4px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:calc(17px * 1);line-height:24px}
`);

const EMPTY = Object.freeze([]);

// 撤销 / 清空的图标（设计系统 减法修稿：i-undo / i-clear，20 见方）；每次渲染现取新 vnode（vendor/ui.js 注释，M6-3）。
const UNDO_ICON = () => html`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 5 3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 0 1 0 9H9"></path></svg>`;
const CLEAR_ICON = () => html`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"></path></svg>`;

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
 * 本页是顶层页面期间关掉原生左缘返回手势（01 §7），离开顶层 / 卸载时恢复。
 * 返回本页是不是顶层页面（M2-2：只有顶层写字页写回会话现场）。
 */
function useBackGestureGate(entry) {
  const [top, setTop] = useState(true);
  useEffect(() => {
    const router = getRouter();
    const id = entry && entry.id;
    const apply = snap => {
      const isTop = !router || !id || !snap || !snap.top || snap.top.id === id;
      // 不在顶层时按根组件同一规则（tab 根页 false、有子页 true），免得返回 tab 根时先发一个 true。
      setBackGestureEnabled(isTop ? false : backGestureAllowed(snap));
      setTop(isTop);
    };
    apply(router ? router.getState() : null);
    const off = router ? router.subscribe(apply) : () => {};
    return () => {
      off();
      // 卸载（返回动画结束后才发生）时交还给当前栈：tab 根页仍是 false，子页 true。阻断页自己再置 false。
      setBackGestureEnabled(router ? backGestureAllowed(router.getState()) : true);
    };
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
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const { state, epoch } = useStoreState();
  const isTop = useBackGestureGate(entry);
  useEffect(() => { installCommitFeedback(getStore); }, []); // M5-5：判断 / 提示 / 看答案 / 撤销等 commit 成功后发触觉与判断声（platform/haptics.js）
  useEffect(() => { warmSounds({ state }); }, []); // S1：网页预载判断声三个变体与落款声，判断时直接播（settings.sound 关着不请求）
  const epochRef = useRef(epoch);
  epochRef.current = epoch;
  return html`<${WriteBody} key=${`e${epoch}`} slot=${slot} state=${state} epoch=${epoch} isTop=${isTop} entry=${entry}
    isStale=${() => epochRef.current !== epoch} />`;
}

function WriteBody({ slot, state, epoch, isTop, entry, isStale }) {
  const session = state && state.sessions ? state.sessions[slot] || null : null;
  const cardKey = currentCardKey(session);
  const rawPhase = session && session.current ? session.current.phase : 'recall';
  const storedPhase = PHASES.includes(rawPhase) ? rawPhase : 'recall';
  // M2-2：被压在下面期间本页不写回现场；重新成为顶层时，若这期间存下的现场被别处改过（上面那页写过同一槽），
  // 按存下的现场重取本地笔画，不把旧笔画写回去；没被改过就保留本地笔画（下一次写回照常）。
  const topGenRef = useRef({ was: isTop, gen: 0, current: null });
  const storedCurrent = session ? session.current : null;
  if (!isTop && topGenRef.current.was) topGenRef.current.current = storedCurrent;
  if (isTop && !topGenRef.current.was && storedCurrent !== topGenRef.current.current) topGenRef.current.gen += 1;
  topGenRef.current.was = isTop;

  // 换字（含进页面）→ 0.3s 不接受落笔。在渲染期定下时刻（与原型 penArm 同法，Math.max 幂等），保证新字第一帧就生效。
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

  // P1-E8（D46 ⑬）：这一字在纸上写还是屏幕上写（本字切换 current.paper 优先，否则设置 settings.writeMode；只管 recall / compare）。
  const paperMode = usePaperMode({ slot, session, cardKey, settings: state ? state.settings : null, storedPhase, getStore });
  // M1-5：有效阶段 = 存下的阶段 + 进 / 出判断页的本地覆盖（写入不阻断，P52）；compare 且没有本人笔画按 recall（01 §3.3），纸上那一字除外。
  const cmpPhase = useComparePhase({ slot, session, cardKey, storedPhase, strokeCount: view.strokes.length, paper: paperMode.paper });
  const phase = cmpPhase.phase;
  const paper = paperMode.paper && (phase === 'recall' || phase === 'compare');
  // P1-E8（P168）：读屏开启后第一次进写字页，格下一条「改为在纸上写」的非阻断建议（只出现一次）。
  const suggest = usePaperSuggest({ settings: state ? state.settings : null, phase, paper, assistive: assistiveTechActive, getStore });
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
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, written: paper ? 0 : view.strokes.length, strokes: strokeData, getStore,
    onHinted: endSkipUndo,
  });
  // Q2-1（03 P181）：首练第 1 字格下一次性提示「凭记忆写，想不起来可以点提示。」（settings.firstTipSeen；首次落笔 / 用提示后收起）。
  const firstTip = useFirstTip({
    settings: state ? state.settings : null, session, phase, paper, strokeCount: view.strokes.length, hinted: hint.used > 0,
    blocked: !!suggest.node, getStore,
  });
  // 版式（compact.js useWriteLayout → layout.js，D49 实现交接 §13.2）：题面 + 书写格 + 格下工具行作为一组在页头与按钮行之间居中（空余 40% 在上）；书写格边长按
  // 可用高度算（258–400，D36 / P118，与字号、阶段、提示无关）；判断页上下两格（AX 档可能并排）与书写格同一顶边、同一中线。内部坐标恒为 345 单位，这里只是显示尺寸。
  const compact = useCompact();
  const ax = useAxLevel();
  const writeRef = useRef(null);
  const layout = useWriteLayout(writeRef, { phase, ax });
  const gridSize = layout.g;
  const groupTop = phase === 'compare' ? layout.pair.top : layout.top;
  useFootHairline(writeRef); // 内容比可视高度长（AX 档 / 小屏放不下）时，按钮行上沿出现 hairline
  // M1-5 判断页、结果行、跳过。判断页两格边长 layout.pair（D46 ⑪ / D49：上下排，AX 档取上下排与并排里格子更大的一种）。
  const compare = useCompareFlow({
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, strokes: view.strokes, hints: hint.used, strokeData,
    onLeave: cmpPhase.leave, size: layout.pair.s || gridSize, layout: layout.pair.layout, paper, paperSize: gridSize,
  });
  const row = useResultRow({ slot, session, state, phase, strokeCount: view.strokes.length });
  const skip = useSkip({ slot, session, cardKey, phase, hints: hint.used, strokes: view.strokes });
  endSkipUndoRef.current = skip.dismiss;
  // M2-3「结束这组」（picked 会话；打开确认框即结束跳过的撤销机会）。除判断页外各阶段都显示（H4）。
  const end = useEndGroup({ slot, session, phase, blocked: skip.failed, onOpen: endSkipUndo });
  // M1-4 看答案 / 描一遍 / 自己写（answer.js）：回忆阶段「看答案」按钮、answer 阶段卡片、描红层、格下说明、接管底栏
  // （接管时「结束这组」放在它底栏「下一个」那一行右端，H4）。Q1：本地笔画交给它，离开自己写一遍时存成看后自写的墨迹。
  const answer = useAnswerFlow({
    slot, session, cardKey, phase, strokeCount: view.strokes.length, strokes: view.strokes,
    onShowAnswer: endSkipUndo, endButton: end.button, ax, endOpen: end.open,
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
    hint.onStrokeStart();
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
    // 进判断页（compare）；空格子不进（01 §6.6：按钮 disabled 之外再挡一次；判断 commit 前还会再断言有本人笔画）。纸上那一字不要求笔画（P1-E8）。
    if (!view.strokes.length && !paper) return;
    cmpPhase.enter(view.strokes);
  };

  // 撤销底栏挂在页面根上（G3）：最后一字跳过后是空页（M2-3 换成结果页），底栏照样在、可撤销回到那个字。
  if (!cardKey) {
    return html`<${Page} title=${titleFor('recall')} testid="write-screen">
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

  // P1-E8：屏幕上写、还没落笔（也没有可撤销的清空）时可以改成「在纸上写」（只改这一个字）；纸上那一字不显示撤销 / 清空。
  const toPaper = !paper && phase === 'recall' && !canUndo && !skip.failed;
  // 撤销 / 清空（R-W18）：标准版在格下一行右端（落第一笔后才出现）；AX 档在页头右侧、常驻（无墨时 ink4 且不可点，P225）；纸上那一字与看答案 / 判断阶段不显示。
  const tools = html`<span class="sz-write__tools" data-testid="write-tools" data-shown=${(ax > 0 || canUndo) && drawable && !paper ? 'true' : 'false'}
          data-paper=${paper ? 'true' : null}>
          <${Button} variant="plain" class="sz-write__ibtn" data-testid="write-undo" aria-label=${t('R-W18.btnUndo')} disabled=${!canUndo} rapid
            onClick=${onUndo}>${UNDO_ICON()}</${Button}>
          <${Button} variant="plain" class="sz-write__ibtn" data-testid="write-clear" aria-label=${t('R-W18.btnClear')} disabled=${!hasStrokes} rapid
            onClick=${onClear}>${CLEAR_ICON()}</${Button}>
        </span>`;

  // 按钮行（D49，实现交接 §13.1）：主按钮「写好了」（满宽、唯一）；其下一行文字按钮——左「提示」「看答案」（不合并，D49 ②），右「跳过」（picked 会话在它左边多一个「结束这组」）。
  // 保存失败（跳过写失败）时主按钮换成 [先不保存 / 再试一次]。
  const mainRow = skip.failed ? skip.failButtons
    : html`<${Button} variant="primary" data-testid="write-done" disabled=${!hasStrokes && !paper} onClick=${onDone}>${t('R-W29.btnDone')}</${Button}>`;
  const footer = html`<div class="sz-write__foot" data-compact=${compact ? 'true' : 'false'}>
      ${mainRow}
      <div class="sz-write__links" data-testid="write-links">
        <div class="sz-write__linkgrp sz-write__slot">
          <div class="sz-write__hint sz-write__slot" data-testid="write-hint-slot">${hint.button}</div>
          <div class="sz-write__linkrow sz-write__slot" data-testid="write-answer-slot">${answer.link}</div>
        </div>
        <div class="sz-write__linkgrp sz-write__slot">
          ${end.button ? html`<div class="sz-write__endslot" data-testid="write-end-slot">${end.button}</div>` : null}
          <div class="sz-write__skiprow sz-write__slot" data-testid="write-skip-slot">${skip.button}</div>
        </div>
      </div>
    </div>`;
  // AX 档底栏（P225）：一行「写好了」+「⋯」，提示 / 看答案 / 跳过 / 在纸上写 / 结束这组收进菜单（ax-menu.js）；保存失败时主按钮是「再试一次」，「先不保存」进菜单。
  let axFooter = null;
  if (ax > 0) {
    const hm = hint.buttonModel;
    const items = [];
    if (hm.kind === 'unavailable') items.push({ testid: 'write-hint-unavailable', label: t('R-W05.hintUnavailable'), static: true });
    else if (hm.kind !== 'hidden') items.push({ testid: 'write-hint', label: hm.text, ariaLabel: hm.label, disabled: !!hm.disabled, onSelect: hint.onHint });
    if (answer.link) items.push({ testid: 'write-show-answer', label: t('R-W07.btnShowAnswer'), onSelect: answer.show });
    if (skip.button) items.push({ testid: 'write-skip', label: t('R-W14.btnSkip'), onSelect: skip.run });
    if (toPaper) items.push({ testid: 'write-to-paper', label: t('X-PAPER.toPaper'), onSelect: () => paperMode.toggle(true) });
    if (end.open) items.push({ testid: 'write-end', label: t('R-W15.end'), onSelect: end.open });
    axFooter = skip.failed
      ? html`<${AxFoot} primary=${{ testid: 'write-skip-fail-retry', label: t('R-W16.retry'), onClick: skip.run }}
          items=${[{ testid: 'write-skip-fail-cancel', label: t('R-W16.cancel'), onSelect: skip.cancelFail }]} testid="write-foot" stage="recall" failed=${true} />`
      : html`<${AxFoot} primary=${{ testid: 'write-done', label: t('R-W29.btnDone'), disabled: !hasStrokes && !paper, onClick: onDone }}
          items=${items} testid="write-foot" stage=${phase} />`;
  }
  // 标准版：「在纸上写」叠在（隐藏着的）撤销 / 清空同一位置（右端）；AX 档在「⋯」菜单里。
  const toPaperSlot = toPaper && ax <= 0 ? html`<span class="sz-write__topaperslot"><${ToPaperButton} onClick=${() => paperMode.toggle(true)} /></span>` : null;
  const noteBody = answer.active ? answer.note
    : skip.failed ? skip.note : paper ? html`<${PaperNote} />` : hint.note ? html`<${HintNote} note=${hint.note} />` : firstTip.node;

  const trailing = ax > 0 ? html`<span class="sz-write__axhead">${tools}${progress}</span>` : progress;
  return html`<${Page} title=${titleFor(phase)} hideTitle=${phase === 'recall' || (phase === 'compare' && ax > 0)} lead=${compare.lead}
    trailing=${trailing} footer=${answer.footer || (compare.active ? compare.footer : (ax > 0 ? axFooter : footer))} testid="write-screen">
    <div class="sz-write" ref=${writeRef} data-cursor=${session.cursor} data-phase=${phase} data-slot=${slot}
      data-compact=${compact ? 'true' : 'false'} data-ax=${ax > 0 ? String(ax) : null} style=${{ paddingTop: `${groupTop}px` }}>
      <${StepDots} phase=${phase} />
      <${Prompt} cardKey=${cardKey} queue=${session.queue} phase=${phase} />
      <div class="sz-write__gridwrap">
        ${answer.stage || compare.stage || (paper ? html`<${PaperStage} size=${gridSize} glyphLayer=${hint.layer}
          hinted=${hint.used > 0} onBack=${() => paperMode.toggle(false)} />` : null) || html`<${InkGrid}
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
          label=${t('X-WRITE.gridLabel')}
        />`}
      </div>
      ${compare.active ? null : html`<div class="sz-write__below" style=${ax > 0 ? undefined : { width: `${gridSize}px` }}>
        <span class="sz-write__note" data-testid="write-note"><span class="sz-write__lineslot" data-testid="write-line-slot">${row.node}</span>${suggest.node}${noteBody}</span>
        ${ax > 0 ? null : tools}${toPaperSlot}
      </div>`}
    </div>
    ${skip.bar}
    ${persist.notice}
  </${Page}>`;
}

registerScreen(WRITE_SCREEN, WriteScreen, { label: titleFor('recall'), ownsBackGesture: true });
