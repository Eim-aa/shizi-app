// 看答案 / 描一遍 / 自己写（M1-4；决定-D18；01 §3.2 / §3.3 / §6.5；04 R-W07 / R-W08；走查-W19；原型 ShiziWriteScreen
// L407–L409、L544–L553、L605；reference/I-proto-write.md「看答案」「描一遍」「自己写一遍」）。
//
// 流程（01 §3.3 状态机 recall → answer → trace ⇄ retrace → 下一字；D34 / D51 ⑧ 求助梯子静态部分，I2-02）：
//   1. 回忆阶段书写格下方左侧「看答案」文字按钮（R-W07.btnShowAnswer）→ **直接**看答案，没有确认框（D51 ⑧）。
//   2. 点「看答案」= 一次 store.commit：追加一条 kind='answer-seen' 记录（help.answerSeen=true，hints 照实）+ 会话现场
//      phase='answer'、answerSeen=true、结果行收起（决定-D19）；**本人笔画保留、不清空、不换卡**（D34 / D51 ⑧）。写失败：弹出一个失败框
//      「没保存上，你写的字还在。」[先不保存 / 再试一次]（R-G04 三段式，文案复用 R-W16），重试成功才进看答案页（D07）。
//      同一会话同一字已有 answer-seen 记录时不再新增（事件不重复）。
//   3. 看答案页（answer）：还是那个书写格——答案字形（--under 衬底色）画在参考字形层、**在本人墨下层**，本人墨 100% 不变；格子不再接受落笔；
//      答案衬底 400ms 显影（policy.motion.answerRevealMs，P210；减少动态效果直接显示）；不播笔顺。笔顺数据取不到（10.13）→ ShiziKai 楷体整字
//      DOM 文本（GlyphFallback）。按钮上方说明 R-W07.answerNote（10.13 用 R-W08.answerNote，字串相同）；按钮 [自己写 / 描一遍]；底部「下一个」文字按钮。
//      （C3-H / N3-06、D53：第一次用看答案时格下的一行说明 R-W07.firstExplain 已删——这一次本来就直接显示，预告没有参照；「记为看过答案」只在按钮上方这一处说。
//      settings.answerNoteSeen 标志位与 commitAnswerNoteSeen / answerNoteDue 保留，界面不再读它。）本人墨在 answer 阶段与回忆阶段共用同一份笔画现场
//      （answerInkKey）。读屏：答案字放在底栏一个视觉隐藏的 role=img（书写格本身 aria-hidden 参考层），名称是「参考字形：字，拼音，n 画，结构」（ref-label.js，A2-09）。
//   4. 描一遍（trace）：书写格参考字形层画描红（和提示同一种画法，canvas/glyph-wash.js；D53 ①：当前一笔 --danzhu 不透明实心，其余还没轮到的笔是同色相 0.75pt 双钩，
//      已描过的笔被本人墨盖住、不再画；没有灰外廓、没有整层不透明度；当前一笔 = 本阶段已写笔数，撤销 / 清空后退回；
//      10.13 用浅色楷体整字、不分笔顺），进阶段先快放一遍笔顺（每字只在第一次播，I3-07；总时长 ≤ 1.6s，policy.motion.stepPlayMaxMs，P210；走查-W19；落笔 / 点一下即到终态；
//      减少动态效果不播）；格下没有说明（R-W08.traceNote 已删：描一遍自明，不再用文字解释颜色）；主按钮「描好了，自己写」（没写时 disabled）；底部「下一个」。进入描一遍时把该 answer-seen 记录的
//      help.traced 置 true（同一次 commit，帮助事实，D07）。
//   5. 自己写一遍（retrace）：空书写格；格下 R-W07.selfNote；按钮 [再描一遍 / 下一个]；底部不显示跳过。
//      Q1（QA simB D1；D31 / 实现交接 §4.2）：离开自己写一遍（「下一个」或「再描一遍」，同一次 commit）时，格子里有本人笔画就把它
//      存成**这条 answer-seen 记录的墨迹**（storeSelfInkInDraft：store.setInk 按记录月份写 shizi.v2.ink.<月>，键 = 记录 id），
//      作品里成为「看后写的」格。记录 kind 不变、不写判断、不动 sched（D18 不变）；一次看答案后多次自己写只留最后一次
//      （同一记录键覆盖；最后一次没写就留上一次）；描一遍的笔画不存；看答案前在回忆阶段写的笔画不存（它们只是这一字的现场，推进时丢弃）。看过答案后恢复到的
//      recall（格下同样是自己写的说明）同样算。
//      留存：store/budget.js pruneInkOfCards（同一次 commit）——这个字只留最新一份看后自写，且要新于最近一次判断；组还开着时不回收。
//   6. 「下一个」= 一次 commit：sessions.advance(kind='answer-seen', recordId) → 追加 item、cursor+1、现场重置、
//      结果行 {kind:'saw'}（「「X」记为看过答案」由结果行（M1-5）显示）。不进判断页（compare）。
//   阶段切换（answer ⇄ trace ⇄ retrace）与「下一个」都是 commit：成功才切换 / 推进（D07）；失败留在当前阶段，
//   说明换成 R-W16.saveFailed、按钮换成 [先不保存 / 再试一次]（原型 saveFail + pend）。
//
// 规则：
// - 本文件只写 store.commit，不直接碰 localStorage；记录构造用 core/records.makeRecord，会话推进用 core/sessions。
// - 回忆阶段不渲染答案字（决定-D16）：「看答案」按钮与失败框里都没有字；答案字只在 answer / trace 阶段出现。
// - answer-seen 不是有效记录：不写 judged、不动 sched / FSRS（决定-D18 / D23）；墨迹只存「自己写一遍」的本人笔画（Q1，上面第 5 条）。
//
// data-testid：write-show-answer（回忆阶段「看答案」）、write-answer-confirm（只在写入失败时出现的失败框；两键为 Confirm 组件的
// confirm-cancel / confirm-ok）、write-answer-card（书写格参考字形层里的答案衬底，data-state=loading|ready|missing、data-anim=reveal|static）、
// write-answer-char（底栏里视觉隐藏的答案字，读屏用）、
// write-answer-foot（answer 流程底栏，data-stage、data-failed）、write-answer-note（按钮上方说明）、
// write-answer-self（自己写）、write-answer-trace（描一遍）、write-trace-done（描好了，自己写）、
// write-retrace-trace（再描一遍）、write-answer-next（下一个）、write-answer-show（看过答案后回忆阶段的「看答案」，
// 仅恢复路径）、write-answer-fail-cancel / write-answer-fail-retry（保存失败两键）、write-trace-layer（描红层，
// data-state、data-anim）、write-glyph-fallback（10.13 楷体整字，M1-2 组件）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Confirm } from '../../components/Confirm.js';
import { Icons } from '../../components/icons.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore, setInk } from '../../../store/store.js';
import { pruneInkOfCards } from '../../../store/budget.js';
import * as defaultPolicy from '../../../config/policy.js';
import { buildStroke, decodeRawStrokes, encodeInk } from '../../../core/ink-math.js';
import { makeRecord, charOfCardKey } from '../../../core/records.js';
import { advance, clearLine, currentCardKey, withCurrent } from '../../../core/sessions.js';
import { peekStrokes, watchStrokes } from '../../../data/strokes.js';
import { animate, drawGlyph, glyphColor, prefersReducedMotion } from '../../canvas/glyph.js';
import { GlyphWash, paintCanvas, useThemeVersion } from '../../canvas/glyph-wash.js';
import { GlyphFallback } from './glyph-fallback.js';
import { pyOf, refCardLabel } from './ref-label.js';
import { LinkButton, Slot, WriteFoot } from './foot.js';

/** answer 流程的阶段（01 §3.3）。 */
export const ANSWER_PHASES = Object.freeze(['answer', 'trace', 'retrace']);

/**
 * 描一遍阶段主按钮的文案（P259）：AX3 起用短文案「自己写」（SE 3 的 AX5 下「描好了，自己写」折成三行），其余档「描好了，自己写」。纯函数。
 * @param {number} ax  AX 档（1–5；0 = 不是 AX 档）
 */
export function traceDoneLabel(ax = 0, policy = defaultPolicy) {
  return ax >= policy.axShortPrimaryFrom ? t('X-ANSWER.btnTraceDoneShort') : t('X-ANSWER.btnTraceDone');
}

/** 答案衬底显影时长（P210）。 */
export const ANSWER_REVEAL_MS = defaultPolicy.motion.answerRevealMs;
/** 描一遍前笔顺快放总时长上限（P210）。 */
export const STEP_PLAY_MAX_MS = defaultPolicy.motion.stepPlayMaxMs;

injectStyles('write-answer', `
@keyframes szAnswerReveal{from{opacity:0}to{opacity:1}}
.sz-answer__under{position:absolute;inset:0;pointer-events:none}
.sz-answer__under canvas{position:absolute;left:0;top:0;display:block;animation:szAnswerReveal ${ANSWER_REVEAL_MS}ms ease-out both}
.sz-answer__anim{position:absolute;left:0;top:0;pointer-events:none}
.sz-answer__trace{position:absolute;inset:0;pointer-events:none}
.sz-answer__trace canvas{position:absolute;left:0;top:0;display:block}
.sz-answer__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sz-answer__note{margin:0;width:100%;text-align:center;font-size:${T.fs13};line-height:${T.lh13};
  color:${T.ink3}}
@media (prefers-reduced-motion: reduce){.sz-answer__under canvas{animation:none}}
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

/** 至少一笔、至少一个点的原始笔画。 */
function hasStrokes(strokes) {
  return Array.isArray(strokes) && strokes.some(st => Array.isArray(st) && st.length > 0);
}

/** 当前阶段是不是「自己写」：自己写一遍（retrace），或看过答案后恢复到的回忆阶段（格下同样是 R-W07.selfNote）。 */
export function isSelfWritePhase(current) {
  if (!current) return false;
  return current.phase === 'retrace' || (current.phase === 'recall' && current.answerSeen === true);
}

/** perRecordInk 开关（P31 / D27）：显式传入优先，否则读 policy.features。 */
function inkEnabled(perRecordInk, policy) {
  if (typeof perRecordInk === 'boolean') return perRecordInk;
  const p = policy || defaultPolicy;
  return !!(p.features && p.features.perRecordInk === true);
}

/**
 * Q1：把「自己写一遍」的本人笔画存成本会话这个字的 answer-seen 记录的墨迹（store.commit 的 mutate 里调用）。
 * 当前阶段不是自己写、没有 answer-seen 记录、没有笔画或 perRecordInk 关时什么都不做。strokes 缺省取会话现场
 * （session.current.strokes，抬笔写回的那份——刷新 / 冷启动后本地现场即由它恢复）。同一记录键覆盖 = 只留最后一次；
 * 随后 pruneInkOfCards 回收这个字更早的看后自写（组已关的），判断墨迹的 D27 留存不变。
 * @returns {{stored:boolean, recordId:string|null}}
 */
export function storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy } = {}) {
  const none = { stored: false, recordId: null };
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey || !isSelfWritePhase(s.current)) return none;
  if (!inkEnabled(perRecordInk, policy)) return none;
  const record = findAnswerSeen(draft, s.id, cardKey);
  if (!record) return none;
  const raw = Array.isArray(strokes) ? strokes : decodeRawStrokes(s.current.strokes || []);
  if (!hasStrokes(raw)) return { stored: false, recordId: record.id };
  const built = raw.filter(st => Array.isArray(st) && st.length).map(st => buildStroke(st, { final: true }));
  setInk(draft, record, encodeInk(built, { policy: policy || defaultPolicy }));
  pruneInkOfCards(draft, [cardKey]);
  return { stored: true, recordId: record.id };
}

/**
 * 点「看答案」：一次 commit 写 answer-seen 记录 + 会话现场（phase='answer'、answerSeen、结果行收起）。
 * **本人笔画不清空**（D34 / D51 ⑧：答案衬在本人墨下层）。同一会话同一字已有 answer-seen 记录时只更新会话（事件不重复）。
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
    const next = clearLine(withCurrent(s, { phase: 'answer', answerSeen: true, hintRange: null }, ctx.now));
    setSession(draft, slot, next);
  });
}

/**
 * answer 流程内换阶段（answer / trace / retrace；看过答案后的 recall 也可回到 answer）：笔画清空。
 * 进 trace 时同一次 commit 把该字的 answer-seen 记录 help.traced 置 true（帮助事实，01 §3.2）。
 * 离开自己写一遍时同一次 commit 存下本人笔画（Q1，storeSelfInkInDraft；strokes = 写字页本地现场，缺省取会话现场）。
 */
export function commitAnswerPhase(store, { slot, cardKey, phase, strokes, perRecordInk, policy }) {
  if (!ANSWER_PHASES.includes(phase)) throw new RangeError('commitAnswerPhase: not an answer-flow phase');
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit(`write:answer-${phase}`, (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer phase: not the current card');
    storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy });
    if (phase === 'trace') {
      const record = findAnswerSeen(draft, s.id, cardKey);
      if (record && !record.help.traced) replaceRecordInDraft(draft, { ...record, help: { ...record.help, traced: true } });
    }
    // 看答案（answer）与回忆共用一份笔画现场（本人墨不清空）；描一遍 / 自己写是空格子。
    const patch = phase === 'answer' ? { phase, hintRange: null } : { phase, strokes: [], hintRange: null };
    setSession(draft, slot, withCurrent(s, patch, ctx.now));
  });
}

/**
 * 看过答案后「下一个」：推进到下一字（item kind='answer-seen'，结果行 'saw'），不进判断页。
 * 从自己写一遍按「下一个」时同一次 commit 存下本人笔画（Q1，storeSelfInkInDraft）；写失败什么都不留（D07）。
 */
export function commitAnswerNext(store, { slot, cardKey, strokes, perRecordInk, policy }) {
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit('write:answer-next', (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer next: not the current card');
    storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy });
    const record = findAnswerSeen(draft, s.id, cardKey);
    setSession(draft, slot, advance(s, { cardKey, recordId: record ? record.id : undefined, kind: 'answer-seen', at: ctx.now }));
  });
}

/**
 * 写字页笔画现场的分组键：描一遍 / 自己写各自一份（都是空格子，原型 strokes:[]）；看答案（answer）与回忆共用一份——
 * 答案衬在本人墨下层、本人墨不清空（D34 / D51 ⑧）。
 */
export function answerInkKey(cardKey, phase) {
  return phase === 'trace' || phase === 'retrace' ? `${cardKey}|${phase}` : cardKey;
}

/** 看答案第一次的格下说明：记下已出现过（settings.answerNoteSeen = true，只出现一次，P212）。已记过不写。 */
export function commitAnswerNoteSeen(store) {
  const cur = store.getState().settings;
  if (cur && cur.answerNoteSeen === true) return { ok: true, keys: [], skipped: true };
  return store.commit('write:answer-note', draft => {
    draft.settings = { ...(draft.settings || {}), answerNoteSeen: true };
  });
}

/** 这一刻要不要出现第一次的说明：在看答案阶段、从没出现过。纯函数。 */
export function answerNoteDue({ settings = null, phase = 'recall' } = {}) {
  return phase === 'answer' && !(settings && settings.answerNoteSeen === true);
}

// ---------------------------------------------------------------- 小工具

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
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

// ---------------------------------------------------------------- 答案衬底（answer 阶段，书写格参考字形层）

/**
 * 看答案：答案字形用 --under 衬底色画在书写格的参考字形层里——在本人墨下层，本人墨不变暗、不清空、不换卡（D34 / D51 ⑧）。
 * 400ms 显影（CSS 动画，减少动态效果直接显示）；不播笔顺。笔顺数据取不到（10.13）→ ShiziKai 楷体整字 DOM 文本。主题变化只重画。
 */
export function AnswerUnderLayer({ char, cssSize = 345, onStatus }) {
  const load = useStrokeData(char, onStatus);
  const canvasRef = useRef(null);
  const theme = useThemeVersion();
  const reduced = prefersReducedMotion();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = paintCanvas(canvas, cssSize);
    if (load.status === 'ready' && load.data) drawGlyph(ctx, load.data, { color: glyphColor('--under') });
  }, [load.data, load.status, cssSize, theme]);

  return html`<div class="sz-answer__under" data-testid="write-answer-card" data-state=${load.status}
    data-anim=${reduced ? 'static' : 'reveal'} aria-hidden="true">
    <canvas ref=${canvasRef}></canvas>
    ${load.status === 'missing' ? html`<${GlyphFallback} char=${char} variant="under" size=${cssSize} />` : null}
  </div>`;
}

// ---------------------------------------------------------------- 描红层（trace 阶段，书写格参考字形层）

// 描一遍前的笔顺快放「每字只在第一次描时播」（I3-07，D46-17）：按 会话 id + 字 记已播过，同一字再进描一遍（自己写 → 再描一遍）直接是描红终态。
// 只记在本页面会话里（不进存储）：刷新 / 冷启动后第一次进描一遍可能再播一次，换一组 / 另一天的同一字是新的一次。
const previewedTrace = new Set();
const PREVIEWED_CAP = 200;

/** 这个字在这个会话里的描一遍快放播过了吗。 */
export function tracePreviewed(playKey) {
  return !!playKey && previewedTrace.has(playKey);
}

/** 记下这个字的快放播过了（超过上限丢最早的）。 */
export function markTracePreviewed(playKey) {
  if (!playKey) return;
  previewedTrace.delete(playKey);
  previewedTrace.add(playKey);
  while (previewedTrace.size > PREVIEWED_CAP) previewedTrace.delete(previewedTrace.values().next().value);
}

/** 测试清理接口：忘掉播过的字（单测 / e2e 之间不共享）。 */
export function forgetTracePreviewed() {
  previewedTrace.clear();
}

/**
 * 描一遍的描红笔画：当前一笔实心、其余还没轮到的笔是双钩（D53 ①）。当前一笔 = 本阶段已写笔数（written），已描过的笔被本人墨盖住、不画；全部写完什么都不画。纯函数。
 * @returns {{solid:number[], hook:number[]}}
 */
export function traceSplit(total, written) {
  const n = Math.max(0, Math.trunc(Number(total) || 0));
  const w = Math.max(0, Math.trunc(Number(written) || 0));
  if (w >= n) return { solid: [], hook: [] };
  const hook = [];
  for (let i = w + 1; i < n; i += 1) hook.push(i);
  return { solid: [w], hook };
}

/**
 * 描一遍：和提示同一种画法（canvas/glyph-wash.js，D53 ①）——当前一笔 --danzhu 不透明实心、其余笔双钩（同色相 0.75pt 细轮廓）、已描过的笔不画（本人墨盖住）；
 * 进阶段先快放一遍笔顺（≤ 1.6s，走查-W19），落笔 / 点一下即跳过；
 * 同一个字只在第一次进描一遍时播（I3-07：playKey = 会话 id + 字，播过的再进直接是终态）；10.13 浅色楷体整字、不播。主题变化只重画描红，不重播。
 */
export function TraceLayer({ char, cssSize = 345, onStatus, strokeCount = 0, playKey = null }) {
  const load = useStrokeData(char, onStatus);
  const rootRef = useRef(null);
  const animRef = useRef(null);
  const ctrlRef = useRef(null);
  const [anim, setAnim] = useState('idle');

  // 先播一遍（每字只在第一次进描一遍时播，I3-07）
  useLayoutEffect(() => {
    if (ctrlRef.current) {
      ctrlRef.current.destroy();
      ctrlRef.current = null;
    }
    if (load.status !== 'ready' || !load.data || !animRef.current) {
      setAnim('idle');
      return undefined;
    }
    if (tracePreviewed(playKey)) {
      setAnim('idle'); // 这个字已播过：直接是描红终态
      return undefined;
    }
    markTracePreviewed(playKey);
    const ctrl = animate(animRef.current, load.data, { mode: 'preview', char, size: cssSize, maxMs: STEP_PLAY_MAX_MS });
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

  const total = load.status === 'ready' && load.data && Array.isArray(load.data.strokes) ? load.data.strokes.length : 0;
  const split = traceSplit(total, strokeCount);
  return html`<div class="sz-answer__trace" ref=${rootRef} data-testid="write-trace-layer" data-state=${load.status} data-anim=${anim}
    data-current=${split.solid.length ? String(split.solid[0]) : 'none'}>
    ${load.status === 'ready' && load.data
      ? html`<${GlyphWash} data=${load.data} cssSize=${cssSize} solid=${split.solid} hook=${split.hook} fillTestid="write-trace-fill" />` : null}
    <div class="sz-answer__anim" ref=${animRef} style=${{ width: `${cssSize}px`, height: `${cssSize}px` }}></div>
    ${load.status === 'missing' ? html`<${GlyphFallback} char=${char} variant="trace" size=${cssSize} />` : null}
  </div>`;
}

// ---------------------------------------------------------------- 写入失败框

function AnswerConfirm(props) {
  return html`<${Confirm} ...${props} testid="write-answer-confirm" />`;
}

/**
 * 点「看答案」写入失败时才出现的失败框（R-G04 三段式，D07：写入成功才进看答案页）：「没保存上，你写的字还在。」[先不保存 / 再试一次]；
 * 重试成功（或当前字已变）才关。平时点「看答案」没有任何确认框（D51 ⑧）。
 * @returns overlay id
 */
export function openAnswerSaveFailed({ slot, cardKey }) {
  let id = null;
  const onConfirm = () => {
    const store = storeOrNull();
    const result = store ? commitAnswerSeen(store, { slot, cardKey }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) nav.closeOverlay(id);
  };
  id = nav.openOverlay(AnswerConfirm, {
    body: t('R-W16.saveFailed'),
    cancelLabel: t('R-W16.cancel'),
    confirmLabel: t('R-W16.retry'),
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
 * @param {Array} [o.strokes]  当前阶段书写格的本人原始笔画（离开自己写一遍时存成看后自写的墨迹，Q1）
 * @param {() => void} [o.onShowAnswer]  点了「看答案」（写入前；写字页用来结束跳过的撤销机会，G3）
 * @param {number} [o.ax]  AX 档（1–5；0 = 不是 AX 档）：只影响描一遍主按钮的文案（P259）与字号；底栏所有字号都是「主按钮 + 一行文字按钮」（D55，write/foot.js），说明在格下说明位（note）
 * @param {boolean} [o.footCompact]  AX 档书写格仍放不下（P261 ②）：底栏主按钮字号封顶
 * @param {{button:any}|null} [o.end]  （已不用：A7 起「结束这组」在页头右上，write/index.js，D57）
 * @returns {{active:boolean, link:any, show:Function, stage:any, glyphLayer:any, note:string, footer:any}}
 *   active：本流程接管底栏（answer / trace / retrace，或看过答案后的 recall）；
 *   link：回忆阶段「看答案」的文字按钮（回忆阶段文字行左组；动作是 show）；stage：恒为 null（看答案不换卡，答案衬底画在书写格参考字形层里，D51 ⑧）；
 *   glyphLayer：answer 阶段的答案衬底 / trace 阶段的描红，书写格参考字形层内容；note：书写格下说明（write-note）；footer：接管时的底栏。
 */
export function useAnswerFlow({ slot, session, cardKey, phase, strokeCount = 0, strokes = null, onShowAnswer, ax = 0, end = null, footCompact = false }) {
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
    else if (action.kind === 'next') result = commitAnswerNext(store, { slot, cardKey, strokes: strokes || undefined });
    else result = commitAnswerPhase(store, { slot, cardKey, phase: action.phase, strokes: strokes || undefined });
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      setFail(null);
      return;
    }
    setFail({ ...action, key: failKey });
  };

  // 点「看答案」：直接看，没有确认框（D51 ⑧）；写入失败才弹失败框（D07）。
  const showAnswer = () => {
    if (typeof onShowAnswer === 'function') onShowAnswer(); // 写字页：跳过的撤销机会到此结束（G3）
    const store = storeOrNull();
    const result = store ? commitAnswerSeen(store, { slot, cardKey }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) return;
    openAnswerSaveFailed({ slot, cardKey });
  };
  const link = cardKey && phase === 'recall' && !answerSeen
    ? html`<${LinkButton} testid="write-show-answer" icon=${Icons.answer()} label=${t('R-W07.btnShowAnswer')} onClick=${showAnswer} />`
    : null;

  if (!active) return { active: false, failed: false, link, show: showAnswer, stage: null, glyphLayer: null, note: '', footer: null };

  const missing = glyphStatus === 'missing';
  const stage = null; // 看答案不换卡（D51 ⑧）
  const glyphLayer = phase === 'answer'
    ? ({ cssSize }) => html`<${AnswerUnderLayer} key=${'answer|' + cardKey} char=${char} cssSize=${cssSize} onStatus=${setGlyphStatus} />`
    : phase === 'trace'
      ? ({ cssSize }) => html`<${TraceLayer} key=${'trace|' + cardKey} char=${char} cssSize=${cssSize} onStatus=${setGlyphStatus}
          strokeCount=${strokeCount} playKey=${session ? `${session.id}|${cardKey}` : cardKey} />`
      : null;

  // 看答案页底栏里视觉隐藏的答案字（书写格参考层 aria-hidden）：读屏名称与判断页参考卡同一句——字、拼音、笔画数、结构 / 部件数（A2-09 / P232）
  const answerLabel = phase === 'answer'
    ? refCardLabel({ char, py: pyOf(cardKey), strokeData: { status: glyphStatus, data: glyphStatus === 'ready' ? peekStrokes(char) : null } })
    : '';
  const failed = !!failNow;
  const failText = t('R-W16.saveFailed');
  let note = '';
  if (phase !== 'answer') {
    if (failed) note = failText;
    else if (phase === 'trace') note = ''; // 描一遍格下没有说明（R-W08.traceNote 已删）
    else note = t('R-W07.selfNote'); // retrace，或看过答案后的 recall
  }
  const noteAbove = phase === 'answer'
    ? (failed ? failText : missing ? t('R-W08.answerNote') : t('R-W07.answerNote'))
    : '';

  const next = () => run({ kind: 'next' });
  const toPhase = p => () => run({ kind: 'phase', phase: p });
  // 底栏（所有字号同构，A7 / D57 / P280）：求助行（主按钮正上方，凹面按钮）+ 主按钮，各阶段同高；说明（答案说明 / 保存失败）在格下说明位，答案字永远不被说明盖住（A2-01）。
  // 求助行：左 = 本阶段的次要路径（自己写 / 再描一遍 / 看答案），右 =「下一个」（结束这组在页头右上）；保存失败时主按钮「再试一次」、「先不保存」在求助行。
  const link2 = (testid, label, onClick, icon = null) => html`<${Slot} testid=${testid + '-slot'}><${LinkButton} testid=${testid} label=${label} icon=${icon} onClick=${onClick} /></${Slot}>`;
  const nextLink = link2('write-answer-next', t('R-W07.btnNext'), next);
  let primary;
  let left = null;
  let right = null;
  if (failed) {
    primary = { testid: 'write-answer-fail-retry', label: t('R-W16.retry'), onClick: () => run(failNow) };
    left = link2('write-answer-fail-cancel', t('R-W16.cancel'), () => setFail(null));
    right = null;
  } else if (phase === 'answer') {
    primary = { testid: 'write-answer-trace', label: t('R-W07.btnTrace'), onClick: toPhase('trace') };
    left = link2('write-answer-self', t('R-W07.btnSelf'), toPhase('retrace'));
    right = nextLink;
  } else if (phase === 'trace') {
    primary = { testid: 'write-trace-done', label: traceDoneLabel(ax), disabled: strokeCount === 0, onClick: toPhase('retrace') };
    right = nextLink;
  } else if (phase === 'retrace') {
    primary = { testid: 'write-answer-next', label: t('R-W07.btnNext'), onClick: next };
    left = link2('write-retrace-trace', t('X-ANSWER.btnRetrace'), toPhase('trace'));
  } else {
    // 看过答案后的回忆阶段（只在恢复路径出现；原型 L544）
    primary = { testid: 'write-answer-next', label: t('R-W07.btnNext'), onClick: next };
    left = link2('write-answer-show', t('R-W07.btnShowAnswer'), toPhase('answer'), Icons.answer());
  }
  const lead = phase === 'answer' ? html`<span class="sz-answer__sr" role="img" aria-label=${answerLabel} data-testid="write-answer-char"></span>` : null;
  const axNote = phase === 'answer' ? noteAbove : note; // 「记为看过答案」只在这一处说（C3-R T3-05：第一次的预告句已删）
  const footer = html`<${WriteFoot} primary=${primary} left=${left} right=${right} testid="write-answer-foot" stage=${phase} failed=${failed} lead=${lead} compact=${footCompact} />`;
  return { active: true, failed, link, show: showAnswer, stage, glyphLayer, note: axNote, footer };
}
