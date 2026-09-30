// 写字页骨架（M1-1）：registerScreen('write')，params {slot:'A'|'B'}。
//
// 从 store 读 sessions[slot] 的当前字（core/sessions.currentCardKey）；页头（标题按阶段 R-W03、右侧「n / 总数」R-W01、
// 描一遍 / 自己写两步圆点 R-W04）、结果行占位（M1-5）、题面占位（M1-8 换成 prompt.js）、书写格（标准 345；紧凑版
// 258 由 M1-7 传 size）、撤销 / 清空（R-W18；清空后给一次撤销，走查-W17）、按钮区：看答案占位（M1-4）、
// 提示占位（M1-3）、「写好了」（R-W29；空笔画时 disabled + aria-disabled，M1-5 接判断页）、跳过 / 结束这组占位（M1-5 / M2）。
//
// 规则：
// - 换字后 0.3s 书写格不接受落笔（01 §6.6 / 走查-V01，按事件 timeStamp）；进页面也算一次换字。
// - 换字 / 换阶段算「新状态」：按钮 0.4s 不响应（components/Button.js markStateChange，走查-W08）。
// - 写字页是顶层页面期间 backGestureEnabled=false（01 §7：整页期间，不是只在落笔期间——M0-7），离开顶层 / 卸载恢复 true。
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
// data-testid：write-screen、write-progress、write-steps、write-line-slot、write-prompt、write-grid（及
// write-grid-ink / write-grid-live / write-glyph-layer）、write-tools、write-undo、write-clear、write-note、
// write-answer-slot、write-hint-slot、write-done、write-skip-slot、write-end-slot、write-empty。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { InkGrid, STD_SIZE } from '../../canvas/ink-canvas.js';
import { currentCardKey, isComplete, PHASES } from '../../../core/sessions.js';
import { getStore, isReplacement } from '../../../store/store.js';
import { setBackGestureEnabled } from '../../../platform/bridge.js';
import { t } from '../../../config/copy/index.js';
import { charOfCardKey } from '../../../core/records.js';
import { useHint, useStrokeData, HintNote } from './hint-layer.js';
import { Prompt } from './prompt.js';
import { answerInkKey, useAnswerFlow } from './answer.js';
import { useCompareFlow, useComparePhase } from './compare.js';
import { useResultRow } from './result-row.js';
import { useSkip } from './skip.js';
import { COMPACT_GRID, useAnswerFit, useCompact } from './compact.js';
import { storedStrokes, usePersist } from './persist.js';
import { useEndGroup } from './end.js';
import { commitFinish, handoffSkipUndo, openResult } from '../result/index.js';

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

injectStyles('write', `
.sz-write{display:flex;flex-direction:column;align-items:stretch;gap:0}
.sz-write__line{min-height:40px;display:flex;align-items:center;justify-content:center}
.sz-write__prompt{min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  padding-bottom:8px}
.sz-write__gridwrap{display:flex;justify-content:center}
.sz-write__below{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px}
.sz-write__note{flex:1;min-width:0;font-size:calc(13px * ${T.k});line-height:1.55;letter-spacing:.02em;color:${T.i3}}
.sz-write__tools{flex:none;display:flex;gap:4px;margin-right:-10px}
.sz-write__tools[data-shown="false"]{visibility:hidden}
.sz-write__tool{height:44px;padding:0 10px;font-size:calc(15px * ${T.k});letter-spacing:.08em;color:${T.i2}}
.sz-write__progress{font-size:calc(13px * ${T.k});color:${T.i3};font-variant-numeric:tabular-nums;letter-spacing:.04em;
  padding-right:16px}
.sz-write__steps{height:5px;margin:-8px 0 3px;display:flex;justify-content:center;gap:5px;pointer-events:none}
.sz-write__dot{width:5px;height:5px;box-sizing:border-box;border-radius:50%;border:1px solid ${T.i3}}
.sz-write__dot[data-on="true"]{border:0;background:${T.i1}}
.sz-write__foot{display:flex;flex-direction:column;gap:0}
.sz-write__linkrow{min-height:36px;display:flex;align-items:center}
.sz-write__main{display:grid;grid-template-columns:148px 1fr;gap:12px;align-items:stretch}
.sz-write__hint{min-height:52px}
.sz-write__skiprow{min-height:40px;display:flex;align-items:center;justify-content:center;position:relative}
.sz-write__skiprow>.sz-write__endslot{position:absolute;right:-8px;top:0;bottom:0;display:flex;align-items:center}
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
      setBackGestureEnabled(!isTop);
      setTop(isTop);
    };
    apply(router ? router.getState() : null);
    const off = router ? router.subscribe(apply) : () => {};
    return () => {
      off();
      setBackGestureEnabled(true);
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

function WriteScreen({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const { state, epoch } = useStoreState();
  const session = state && state.sessions ? state.sessions[slot] || null : null;
  const cardKey = currentCardKey(session);
  const rawPhase = session && session.current ? session.current.phase : 'recall';
  const storedPhase = PHASES.includes(rawPhase) ? rawPhase : 'recall';

  const isTop = useBackGestureGate(entry);
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

  // M1-5：有效阶段 = 存下的阶段 + 进 / 出判断页的本地覆盖（写入不阻断，P52）；compare 且没有本人笔画按 recall（01 §3.3）。
  const cmpPhase = useComparePhase({ slot, session, cardKey, storedPhase, strokeCount: view.strokes.length });
  const phase = cmpPhase.phase;
  // M1-6 会话现场：本地笔画一变就写回 sessions（P52 不阻断 + 一次性提示）、visibilitychange 重写、打开时恢复幂等。
  // M2-2：只有顶层写字页写回现场（抬笔 / visibilitychange / pagehide / 离开）；被压在下面时不写（cardKey 传 null = 不写）。
  const persist = usePersist({ slot, session, state, cardKey: isTop ? cardKey : null, inkKey, strokes: view.strokes, phase });

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
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, written: view.strokes.length, strokes: strokeData, getStore,
    onHinted: endSkipUndo,
  });
  // M1-7 紧凑版（compact.js）：书写格 258、看答案卡片按屏高 200–345、撤销 / 清空在格上方、底栏两行。
  const compact = useCompact();
  const writeRef = useRef(null);
  const answerSize = useAnswerFit(writeRef, { enabled: compact && phase === 'answer', key: cardKey || '' });
  const gridSize = compact ? COMPACT_GRID : STD_SIZE;
  // M1-5 判断页、结果行、跳过。
  const compare = useCompareFlow({
    slot, session, cardKey, char: charOfCardKey(cardKey), phase, strokes: view.strokes, hints: hint.used, strokeData,
    onLeave: cmpPhase.leave, size: STD_SIZE,
  });
  const row = useResultRow({ slot, session, state, phase, strokeCount: view.strokes.length });
  const skip = useSkip({ slot, session, cardKey, phase, hints: hint.used, strokes: view.strokes });
  endSkipUndoRef.current = skip.dismiss;
  // M2-3「结束这组」（picked 会话；打开确认框即结束跳过的撤销机会）。除判断页外各阶段都显示（H4）。
  const end = useEndGroup({ slot, session, phase, blocked: skip.failed, onOpen: endSkipUndo });
  // M1-4 看答案 / 描一遍 / 自己写（answer.js）：回忆阶段「看答案」按钮、answer 阶段卡片、描红层、格下说明、接管底栏
  // （接管时「结束这组」放在它底栏「下一个」那一行右端，H4）。
  const answer = useAnswerFlow({
    slot, session, cardKey, phase, strokeCount: view.strokes.length, size: compact ? answerSize : STD_SIZE,
    onShowAnswer: endSkipUndo, endButton: end.button,
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
    // 进判断页（compare）；空格子不进（01 §6.6：按钮 disabled 之外再挡一次；判断 commit 前还会再断言有本人笔画）。
    if (!view.strokes.length) return;
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
  const progress = html`<span class="sz-write__progress" data-testid="write-progress">${t('R-W01.progress', {
    n: session.cursor + 1,
    total: session.queue.length,
  })}</span>`;

  const answerSlot = html`<div class="sz-write__linkrow" data-testid="write-answer-slot">${answer.link}</div>`;
  const mainRow = skip.failed ? skip.failButtons : html`<div class="sz-write__main">
      <div class="sz-write__hint" data-testid="write-hint-slot">${hint.button}</div>
      <${Button} variant="primary" data-testid="write-done" disabled=${!hasStrokes} onClick=${onDone}>${t('R-W29.btnDone')}</${Button}>
    </div>`;
  const skipSlot = html`<div class="sz-write__skiprow" data-testid="write-skip-slot">${skip.button}${!compact && end.button
    ? html`<span class="sz-write__endslot" data-testid="write-end-slot">${end.button}</span>` : null}</div>`;
  // 紧凑版（R-W18）：「提示 · 写好了」一行，「看答案 · 跳过 · 结束这组」一行（结束这组的槽位留给 M2）。
  const footer = compact
    ? html`<div class="sz-write__foot" data-compact="true">
      ${mainRow}
      <div class="sz-write__links" data-testid="write-links">${answerSlot}${skipSlot}<div class="sz-write__endslot" data-testid="write-end-slot">${end.button}</div></div>
    </div>`
    : html`<div class="sz-write__foot">
    ${answerSlot}
    ${mainRow}
    ${skipSlot}
  </div>`;
  const tools = html`<span class="sz-write__tools" data-testid="write-tools" data-shown=${canUndo && drawable ? 'true' : 'false'}>
          <${Button} variant="plain" class="sz-write__tool" data-testid="write-undo" disabled=${!canUndo} rapid
            onClick=${onUndo}>${t('R-W18.btnUndo')}</${Button}>
          <${Button} variant="plain" class="sz-write__tool" data-testid="write-clear" disabled=${!hasStrokes} rapid
            onClick=${onClear}>${t('R-W18.btnClear')}</${Button}>
        </span>`;

  return html`<${Page} title=${titleFor(phase)} lead=${compare.lead} trailing=${progress}
    footer=${answer.footer || (compare.active ? null : footer)} testid="write-screen">
    <div class="sz-write" ref=${writeRef} data-cursor=${session.cursor} data-phase=${phase} data-slot=${slot}
      data-compact=${compact ? 'true' : 'false'}>
      <${StepDots} phase=${phase} />
      <div class="sz-write__line" data-testid="write-line-slot">${row.node}${compact ? tools : null}</div>
      <${Prompt} cardKey=${cardKey} phase=${phase} />
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
          label=${t('X-WRITE.gridLabel')}
        />`}
      </div>
      <div class="sz-write__below">
        <span class="sz-write__note" data-testid="write-note">${answer.active ? answer.note
          : skip.failed ? skip.note : html`<${HintNote} note=${hint.note} />`}</span>
        ${compact ? null : tools}
      </div>
    </div>
    ${skip.bar}
    ${persist.notice}
  </${Page}>`;
}

registerScreen(WRITE_SCREEN, WriteScreen, { label: titleFor('recall') });
