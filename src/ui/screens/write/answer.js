// 看答案 / 描一遍 / 自己写（M1-4；决定-D18；01 §3.2 / §3.3 / §6.5；04 R-W07 / R-W08；走查-W19；原型 ShiziWriteScreen
// L407–L409、L544–L553、L605；reference/I-proto-write.md「看答案」「描一遍」「自己写一遍」）。
//
// 流程（01 §3.3 状态机 recall → 看答案确认 → answer → trace ⇄ retrace → 下一字）：
//   1. 回忆阶段书写格下方左侧「看答案」文字按钮（R-W07.btnShowAnswer）→ 居中确认「看了答案，这个字就记为看过答案。」
//      [接着想 / 看答案]（R-W07.confirm*；点遮罩 = 接着想）。
//   2. 确认 = 一次 store.commit：追加一条 kind='answer-seen' 记录（help.answerSeen=true，hints 照实）+ 会话现场
//      phase='answer'、answerSeen=true、笔画清空、结果行收起（决定-D19）。写失败**留在确认框**：正文换成
//      「没保存上，你写的字还在。」、按钮换成 [先不保存 / 再试一次]（R-G04 三段式，文案复用 R-W16）；重试成功才进看答案页。
//      同一会话同一字已有 answer-seen 记录时不再新增（事件不重复）。
//   3. 看答案页：与书写格同几何的卡片里用 hanzi-writer 按笔画播放（M1-2 animate 'play'，终态 = 完整字形）；
//      笔顺数据取不到（10.13）→ ShiziKai 楷体整字 DOM 文本（GlyphFallback）。按钮上方说明 R-W07.answerNote（10.13 用
//      R-W08.answerNote，字串相同）；按钮 [自己写 / 描一遍]；底部「下一个」文字按钮。
//   4. 描一遍（trace）：书写格参考字形层画描红（--tf 填充 + --tl 外描线；10.13 用浅色楷体整字、不分笔顺），进阶段先播一遍
//      笔顺（走查-W19；落笔即跳过；减少动态效果不播）；格下 R-W08.traceNote；主按钮「描好了，自己写」（没写时 disabled）；
//      底部「下一个」。进入描一遍时把该 answer-seen 记录的 help.traced 置 true（同一次 commit，帮助事实，D07）。
//   5. 自己写一遍（retrace）：空书写格；格下 R-W07.selfNote；按钮 [再描一遍 / 下一个]；底部不显示跳过。
//   6. 「下一个」= 一次 commit：sessions.advance(kind='answer-seen', recordId) → 追加 item、cursor+1、现场重置、
//      结果行 {kind:'saw'}（「「X」记为看过答案」由结果行（M1-5）显示）。不进判断页（compare）。
//   阶段切换（answer ⇄ trace ⇄ retrace）与「下一个」都是 commit：成功才切换 / 推进（D07）；失败留在当前阶段，
//   说明换成 R-W16.saveFailed、按钮换成 [先不保存 / 再试一次]（原型 saveFail + pend）。
//
// 规则：
// - 本文件只写 store.commit，不直接碰 localStorage；记录构造用 core/records.makeRecord，会话推进用 core/sessions。
// - 回忆阶段不渲染答案字（决定-D16）：「看答案」按钮与确认框里都没有字；答案字只在 answer / trace 阶段出现。
// - answer-seen 不是有效记录：不写 judged、不动 sched / FSRS、不写墨迹（决定-D18 / D23）。
//
// data-testid：write-show-answer（回忆阶段「看答案」）、write-answer-confirm（确认框面板；两键为 Confirm 组件的
// confirm-cancel / confirm-ok）、write-answer-card（看答案卡片，data-state=loading|ready|missing、data-anim）、
// write-answer-foot（answer 流程底栏，data-stage、data-failed）、write-answer-note（按钮上方说明）、
// write-answer-self（自己写）、write-answer-trace（描一遍）、write-trace-done（描好了，自己写）、
// write-retrace-trace（再描一遍）、write-answer-next（下一个）、write-answer-show（看过答案后回忆阶段的「看答案」，
// 仅恢复路径）、write-answer-fail-cancel / write-answer-fail-retry（保存失败两键）、write-trace-layer（描红层，
// data-state、data-anim）、write-glyph-fallback（10.13 楷体整字，M1-2 组件）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Confirm } from '../../components/Confirm.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { makeRecord, charOfCardKey } from '../../../core/records.js';
import { advance, clearLine, currentCardKey, withCurrent } from '../../../core/sessions.js';
import { peekStrokes, watchStrokes } from '../../../data/strokes.js';
import { animate, drawGlyph, glyphColor } from '../../canvas/glyph.js';
import { GlyphFallback } from './glyph-fallback.js';

/** answer 流程的阶段（01 §3.3）。 */
export const ANSWER_PHASES = Object.freeze(['answer', 'trace', 'retrace']);

injectStyles('write-answer', `
.sz-answer__link{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:.5px;color:${T.i2}}
.sz-answer__card{position:relative;flex:none;box-sizing:border-box;max-width:100%;margin:0 auto;
  border:.5px solid ${T.i5};border-radius:16px;background:${T.c};overflow:hidden}
.sz-answer__anim{position:absolute;left:0;top:0;pointer-events:none}
.sz-answer__trace{position:absolute;inset:0;pointer-events:none}
.sz-answer__trace canvas{position:absolute;left:0;top:0;display:block}
.sz-answer__note{margin:0;width:100%;text-align:center;font-size:calc(13px * ${T.k});line-height:1.55;letter-spacing:.02em;
  color:${T.i3}}
.sz-answer__btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-answer__btns--one{grid-template-columns:minmax(0,1fr)}
.sz-answer__next{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:.5px}
`);

// ---------------------------------------------------------------- 纯函数（状态 → 草稿）

/** 已发布状态 / 草稿里的全部记录（按月数组或折叠月的 kept）。 */
export function allRecords(state) {
  const out = [];
  const months = state && state.records ? state.records : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

/** 本会话某字的 answer-seen 记录（最近一条）；没有返回 null。 */
export function findAnswerSeen(state, sessionIdValue, cardKey) {
  let found = null;
  for (const r of allRecords(state)) {
    if (r && r.kind === 'answer-seen' && r.sessionId === sessionIdValue && r.cardKey === cardKey) found = r;
  }
  return found;
}

function monthOfRecord(record) {
  return typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
}

/** 草稿里追加一条记录（新 id 是最大序号，放当月末尾；折叠月追加到 kept）。 */
export function appendRecordToDraft(draft, record) {
  const month = monthOfRecord(record);
  if (!month) throw new Error('appendRecord: record has no localDay');
  const value = draft.records[month];
  if (value === undefined || value === null) draft.records[month] = [record];
  else if (Array.isArray(value)) draft.records[month] = value.concat([record]);
  else if (Array.isArray(value.kept)) draft.records[month] = { ...value, kept: value.kept.concat([record]) };
  else throw new Error('appendRecord: unexpected records month shape');
}

/** 草稿里用同 id 的新记录替换旧记录（copy-on-write）。 */
export function replaceRecordInDraft(draft, next) {
  const month = monthOfRecord(next);
  const value = month ? draft.records[month] : null;
  const swap = list => list.map(r => (r.id === next.id ? next : r));
  if (Array.isArray(value)) draft.records[month] = swap(value);
  else if (value && Array.isArray(value.kept)) draft.records[month] = { ...value, kept: swap(value.kept) };
  else throw new Error('replaceRecord: month not found');
}

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function setSession(draft, slot, session) {
  draft.sessions = { ...draft.sessions, [slot]: session };
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 会话的当前字不是 cardKey（换字 / 已推进）→ 不提交，返回 stale。 */
function staleGuard(store, slot, cardKey) {
  const s = sessionOf(store.getState(), slot);
  return !s || currentCardKey(s) !== cardKey ? STALE : null;
}

/**
 * 确认看答案：一次 commit 写 answer-seen 记录 + 会话现场（phase='answer'、answerSeen、结果行收起）。
 * 同一会话同一字已有 answer-seen 记录时只更新会话（事件不重复）。
 * @returns store.commit 的结果；当前字已不是 cardKey 时 {ok:false, error:{kind:'stale'}}
 */
export function commitAnswerSeen(store, { slot, cardKey }) {
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit('write:answer-seen', (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer-seen: not the current card');
    if (!findAnswerSeen(draft, s.id, cardKey)) {
      const hints = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
      const record = makeRecord({
        id: ctx.nextId('r'),
        cardKey,
        sessionId: s.id,
        kind: 'answer-seen',
        at: ctx.now,
        help: { hints, answerSeen: true, traced: false },
      });
      appendRecordToDraft(draft, record);
    }
    const next = clearLine(withCurrent(s, { phase: 'answer', answerSeen: true, strokes: [], hintRange: null }, ctx.now));
    setSession(draft, slot, next);
  });
}

/**
 * answer 流程内换阶段（answer / trace / retrace；看过答案后的 recall 也可回到 answer）：笔画清空。
 * 进 trace 时同一次 commit 把该字的 answer-seen 记录 help.traced 置 true（帮助事实，01 §3.2）。
 */
export function commitAnswerPhase(store, { slot, cardKey, phase }) {
  if (!ANSWER_PHASES.includes(phase)) throw new RangeError('commitAnswerPhase: not an answer-flow phase');
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit(`write:answer-${phase}`, (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer phase: not the current card');
    if (phase === 'trace') {
      const record = findAnswerSeen(draft, s.id, cardKey);
      if (record && !record.help.traced) replaceRecordInDraft(draft, { ...record, help: { ...record.help, traced: true } });
    }
    setSession(draft, slot, withCurrent(s, { phase, strokes: [], hintRange: null }, ctx.now));
  });
}

/** 看过答案后「下一个」：推进到下一字（item kind='answer-seen'，结果行 'saw'），不进判断页。 */
export function commitAnswerNext(store, { slot, cardKey }) {
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit('write:answer-next', (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer next: not the current card');
    const record = findAnswerSeen(draft, s.id, cardKey);
    setSession(draft, slot, advance(s, { cardKey, recordId: record ? record.id : undefined, kind: 'answer-seen', at: ctx.now }));
  });
}

/** 写字页笔画现场的分组键：answer 流程每个阶段各自一份（进描一遍 / 自己写都是空格子，原型 strokes:[]）。 */
export function answerInkKey(cardKey, phase) {
  return ANSWER_PHASES.includes(phase) ? `${cardKey}|${phase}` : cardKey;
}

// ---------------------------------------------------------------- 小工具

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 深浅色变化计数（matchMedia 与 data-theme）；canvas / hanzi-writer 的颜色在绘制时读，变化后要重画。 */
function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setVersion(v => v + 1);
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    } catch (error) {
      mq = null;
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', bump);
    let observer = null;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(bump);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', bump);
      if (observer) observer.disconnect();
    };
  }, []);
  return version;
}

/** 笔顺数据：{status:'loading'|'ready'|'missing', data}；首帧用 peekStrokes 避免闪一下。 */
function useStrokeData(char, onStatus) {
  const [load, setLoad] = useState(() => {
    const peek = char ? peekStrokes(char) : undefined;
    return peek ? { status: 'ready', data: peek } : { status: 'loading', data: null };
  });
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => {
    if (!char) return undefined;
    const w = watchStrokes(char, ev => {
      const next = { status: ev.status, data: ev.status === 'ready' ? ev.data : null };
      setLoad(prev => (prev.status === next.status && prev.data === next.data ? prev : next));
    });
    return () => w.stop();
  }, [char]);
  useEffect(() => {
    if (statusRef.current) statusRef.current(load.status);
  }, [load.status]);
  return load;
}

function paintCanvas(canvas, cssSize) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const px = Math.round(cssSize * dpr);
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = (dpr * cssSize) / 345; // 按书写格内部 345 单位画（01 §6.1）
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

// ---------------------------------------------------------------- 看答案卡片（answer 阶段）

/**
 * 与书写格同几何的卡片：hanzi-writer 按笔画播放，终态完整字形；10.13 楷体整字（DOM 文本）。
 * 主题切换后以静态终态重建（不重播）。
 */
export function AnswerCard({ char, size = 345, onStatus }) {
  const load = useStrokeData(char, onStatus);
  const hostRef = useRef(null);
  const ctrlRef = useRef(null);
  const playedRef = useRef(false);
  const [anim, setAnim] = useState('idle');
  const theme = useThemeVersion();

  useLayoutEffect(() => {
    if (ctrlRef.current) {
      ctrlRef.current.destroy();
      ctrlRef.current = null;
    }
    if (load.status !== 'ready' || !load.data || !hostRef.current) {
      setAnim('idle');
      return undefined;
    }
    // 第一次正常播放；之后（主题变化重建）直接给终态
    const ctrl = animate(hostRef.current, load.data, {
      mode: 'play',
      char,
      size,
      color: glyphColor('--ref'),
      ...(playedRef.current ? { reducedMotion: true } : {}),
    });
    playedRef.current = true;
    ctrlRef.current = ctrl;
    setAnim(ctrl.state);
    ctrl.done.then(result => {
      if (ctrlRef.current === ctrl) setAnim(result);
    });
    return undefined;
  }, [load.data, load.status, size, theme]);

  useEffect(() => () => {
    if (ctrlRef.current) ctrlRef.current.destroy();
    ctrlRef.current = null;
  }, []);

  return html`<div class="sz-answer__card" data-testid="write-answer-card" data-state=${load.status} data-anim=${anim}
    role="img" aria-label=${char} style=${{ width: `${size}px`, height: `${size}px` }}>
    <div class="sz-answer__anim" ref=${hostRef} style=${{ width: `${size}px`, height: `${size}px` }}></div>
    ${load.status === 'missing' ? html`<${GlyphFallback} char=${char} variant="answer" size=${size} />` : null}
  </div>`;
}

// ---------------------------------------------------------------- 描红层（trace 阶段，书写格参考字形层）

/**
 * 描一遍：Path2D 描红（--tf 填充 + --tl 外描线 4）；进阶段先播一遍笔顺（走查-W19），落笔即跳过；
 * 10.13 浅色楷体整字、不播。主题变化只重画描红，不重播。
 */
export function TraceLayer({ char, cssSize = 345, onStatus }) {
  const load = useStrokeData(char, onStatus);
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const ctrlRef = useRef(null);
  const [anim, setAnim] = useState('idle');
  const theme = useThemeVersion();

  // 描红轮廓
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = paintCanvas(canvas, cssSize);
    if (load.status === 'ready' && load.data) {
      drawGlyph(ctx, load.data, { color: glyphColor('--tf'), outline: { color: glyphColor('--tl'), width: 4 } });
    }
  }, [load.data, load.status, cssSize, theme]);

  // 先播一遍（每次进描一遍一次）
  useLayoutEffect(() => {
    if (ctrlRef.current) {
      ctrlRef.current.destroy();
      ctrlRef.current = null;
    }
    if (load.status !== 'ready' || !load.data || !animRef.current) {
      setAnim('idle');
      return undefined;
    }
    const ctrl = animate(animRef.current, load.data, { mode: 'preview', char, size: cssSize });
    ctrlRef.current = ctrl;
    setAnim(ctrl.state);
    ctrl.done.then(result => {
      if (ctrlRef.current === ctrl) setAnim(result);
    });
    return undefined;
  }, [load.data, load.status, cssSize]);

  // 落笔即跳过（捕获阶段，书写格自己的指针处理照常）
  useEffect(() => {
    const root = rootRef.current;
    const grid = root && root.closest ? root.closest('.sz-inkgrid') : null;
    if (!grid) return undefined;
    const onDown = () => {
      if (ctrlRef.current && ctrlRef.current.state === 'running') ctrlRef.current.skip();
    };
    grid.addEventListener('pointerdown', onDown, true);
    return () => grid.removeEventListener('pointerdown', onDown, true);
  }, []);

  useEffect(() => () => {
    if (ctrlRef.current) ctrlRef.current.destroy();
    ctrlRef.current = null;
  }, []);

  return html`<div class="sz-answer__trace" ref=${rootRef} data-testid="write-trace-layer" data-state=${load.status} data-anim=${anim}>
    <canvas ref=${canvasRef} aria-hidden="true"></canvas>
    <div class="sz-answer__anim" ref=${animRef} style=${{ width: `${cssSize}px`, height: `${cssSize}px` }}></div>
    ${load.status === 'missing' ? html`<${GlyphFallback} char=${char} variant="trace" size=${cssSize} />` : null}
  </div>`;
}

// ---------------------------------------------------------------- 确认框

function AnswerConfirm(props) {
  return html`<${Confirm} ...${props} testid="write-answer-confirm" />`;
}

/**
 * 打开看答案确认框；确认 → commitAnswerSeen；失败留在确认框换三段式文案，重试成功才关。
 * @returns overlay id
 */
export function openAnswerConfirm({ slot, cardKey }) {
  let id = null;
  const onConfirm = () => {
    const store = storeOrNull();
    const result = store ? commitAnswerSeen(store, { slot, cardKey }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      nav.closeOverlay(id);
      return;
    }
    nav.updateOverlay(id, {
      body: t('R-W16.saveFailed'),
      cancelLabel: t('R-W16.cancel'),
      confirmLabel: t('R-W16.retry'),
    });
  };
  id = nav.openOverlay(AnswerConfirm, {
    body: t('R-W07.confirmBody'),
    cancelLabel: t('R-W07.confirmKeepThinking'),
    confirmLabel: t('R-W07.confirmShow'),
    onConfirm,
  }, { name: 'write-answer-confirm' });
  return id;
}

// ---------------------------------------------------------------- 写字页接线

/**
 * 写字页用的 answer 流程接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {string|null} o.cardKey
 * @param {string} o.phase
 * @param {number} o.strokeCount  当前阶段书写格笔数
 * @param {number} [o.size=345]
 * @param {() => void} [o.onShowAnswer]  点了「看答案」（确认框打开前；写字页用来结束跳过的撤销机会，G3）
 * @param {any} [o.endButton]  「结束这组」按钮（write/end.js useEndGroup().button；picked 会话才有）：放在底栏「下一个」那一行的
 *   右端（与回忆阶段「跳过」那一行同一位置，M2 验收 H4）；保存失败两键占住底栏时不显示。
 * @returns {{active:boolean, link:any, stage:any, glyphLayer:any, note:string, footer:any}}
 *   active：本流程接管底栏（answer / trace / retrace，或看过答案后的 recall）；
 *   link：回忆阶段「看答案」按钮（放 write-answer-slot）；stage：answer 阶段替代书写格的看答案卡片；
 *   glyphLayer：trace 阶段书写格参考字形层内容；note：书写格下说明（write-note）；footer：接管时的底栏。
 */
export function useAnswerFlow({ slot, session, cardKey, phase, strokeCount = 0, size = 345, onShowAnswer, endButton = null }) {
  const char = cardKey ? charOfCardKey(cardKey) : null;
  const answerSeen = !!(session && session.current && session.current.answerSeen);
  const inFlow = ANSWER_PHASES.includes(phase);
  const active = !!cardKey && (inFlow || (phase === 'recall' && answerSeen));
  const [fail, setFail] = useState(null); // null | {kind:'phase', phase} | {kind:'next'}
  const [glyphStatus, setGlyphStatus] = useState('loading');
  const failKey = `${cardKey}|${phase}`;
  const failNow = fail && fail.key === failKey ? fail : null;

  const run = action => {
    const store = storeOrNull();
    let result;
    if (!store) result = { ok: false, error: { kind: 'unavailable' } };
    else if (action.kind === 'next') result = commitAnswerNext(store, { slot, cardKey });
    else result = commitAnswerPhase(store, { slot, cardKey, phase: action.phase });
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      setFail(null);
      return;
    }
    setFail({ ...action, key: failKey });
  };

  const link = cardKey && phase === 'recall' && !answerSeen
    ? html`<${Button} variant="text" class="sz-answer__link" data-testid="write-show-answer"
        onClick=${() => {
          if (typeof onShowAnswer === 'function') onShowAnswer(); // 写字页：跳过的撤销机会到此结束（G3）
          openAnswerConfirm({ slot, cardKey });
        }}>${t('R-W07.btnShowAnswer')}</${Button}>`
    : null;

  if (!active) return { active: false, link, stage: null, glyphLayer: null, note: '', footer: null };

  const missing = glyphStatus === 'missing';
  const stage = phase === 'answer'
    ? html`<${AnswerCard} key=${'answer|' + cardKey} char=${char} size=${size} onStatus=${setGlyphStatus} />`
    : null;
  const glyphLayer = phase === 'trace'
    ? ({ cssSize }) => html`<${TraceLayer} key=${'trace|' + cardKey} char=${char} cssSize=${cssSize} onStatus=${setGlyphStatus} />`
    : null;

  const failed = !!failNow;
  const failText = t('R-W16.saveFailed');
  let note = '';
  if (phase !== 'answer') {
    if (failed) note = failText;
    else if (phase === 'trace') note = t('R-W08.traceNote');
    else note = t('R-W07.selfNote'); // retrace，或看过答案后的 recall
  }
  const noteAbove = phase === 'answer'
    ? (failed ? failText : missing ? t('R-W08.answerNote') : t('R-W07.answerNote'))
    : '';

  const next = () => run({ kind: 'next' });
  const toPhase = p => () => run({ kind: 'phase', phase: p });
  let buttons;
  let one = false;
  let skipRow = false;
  if (failed) {
    buttons = html`
      <${Button} variant="secondary" data-testid="write-answer-fail-cancel" onClick=${() => setFail(null)}>${t('R-W16.cancel')}</${Button}>
      <${Button} variant="primary" data-testid="write-answer-fail-retry" onClick=${() => run(failNow)}>${t('R-W16.retry')}</${Button}>`;
  } else if (phase === 'answer') {
    buttons = html`
      <${Button} variant="secondary" data-testid="write-answer-self" onClick=${toPhase('retrace')}>${t('R-W07.btnSelf')}</${Button}>
      <${Button} variant="primary" data-testid="write-answer-trace" onClick=${toPhase('trace')}>${t('R-W07.btnTrace')}</${Button}>`;
    skipRow = true;
  } else if (phase === 'trace') {
    one = true;
    buttons = html`<${Button} variant="primary" data-testid="write-trace-done" disabled=${strokeCount === 0}
      onClick=${toPhase('retrace')}>${t('X-ANSWER.btnTraceDone')}</${Button}>`;
    skipRow = true;
  } else if (phase === 'retrace') {
    buttons = html`
      <${Button} variant="secondary" data-testid="write-retrace-trace" onClick=${toPhase('trace')}>${t('X-ANSWER.btnRetrace')}</${Button}>
      <${Button} variant="primary" data-testid="write-answer-next" onClick=${next}>${t('R-W07.btnNext')}</${Button}>`;
  } else {
    // 看过答案后的回忆阶段（只在恢复路径出现；原型 L544）：[看答案 / 下一个]
    buttons = html`
      <${Button} variant="secondary" data-testid="write-answer-show" onClick=${toPhase('answer')}>${t('R-W07.btnShowAnswer')}</${Button}>
      <${Button} variant="primary" data-testid="write-answer-next" onClick=${next}>${t('R-W07.btnNext')}</${Button}>`;
  }

  const footer = html`<div class="sz-write__foot" data-testid="write-answer-foot" data-stage=${phase}
    data-failed=${failed ? 'true' : 'false'}>
    <div class="sz-write__linkrow">${noteAbove
      ? html`<p class="sz-answer__note" data-testid="write-answer-note" aria-live="polite">${noteAbove}</p>`
      : null}</div>
    <div class=${one ? 'sz-answer__btns sz-answer__btns--one' : 'sz-answer__btns'}>${buttons}</div>
    <div class="sz-write__skiprow">${skipRow && !failed
      ? html`<${Button} variant="text" class="sz-answer__next" data-testid="write-answer-next" onClick=${next}>${t('R-W07.btnNext')}</${Button}>`
      : null}${endButton && !failed ? html`<span class="sz-write__endslot" data-testid="write-end-slot">${endButton}</span>` : null}</div>
  </div>`;

  return { active: true, link, stage, glyphLayer, note, footer };
}
