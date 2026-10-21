// 看答案 / 描一遍 / 自己写（M1-4；决定-D18；01 §3.2 / §3.3 / §6.5；04 R-W07 / R-W08；走查-W19；原型 ShiziWriteScreen
// L407–L409、L544–L553、L605；reference/I-proto-write.md「看答案」「描一遍」「自己写一遍」）。
//
// 流程（01 §3.3 状态机 recall → trace ⇄ retrace → 下一字；D64 ② 起看答案直接进描一遍，不再有中间的 answer 页）：
//   1. 回忆阶段书写格下方左侧「看答案」文字按钮（R-W07.btnShowAnswer）→ **直接**看答案，没有确认框（D51 ⑧）。
//   2. 点「看答案」= 一次 store.commit：追加一条 kind='answer-seen' 记录（help.answerSeen=true，help.traced=true，hints 照实）+ 会话现场
//      phase='trace'、answerSeen=true、本人笔画清空（描一遍是空格子）、结果行收起（决定-D19）。写失败：就地三段式
//      「没保存上，你写的字还在。」[先不保存 / 再试一次]（R-G04，文案复用 R-W16），重试成功才进描一遍（D07）。
//      同一会话同一字已有 answer-seen 记录时不再新增（事件不重复）。旧版本存下的 phase='answer' 现场按描一遍恢复（write/index.js）。
//      提示给完整个字时（hint-layer.js，D64 ①）也走这个函数（stay:true：留在回忆页，记录 traced=false），与看答案同一口径。
//   3. 描一遍（trace）：标准写法直接淡显在书写格参考字形层，立即可描（D64 ②）。画法和提示同一种（canvas/glyph-wash.js；D53 ①：当前一笔 --danzhu 不透明实心，
//      其余还没轮到的笔是同色相 0.75pt 双钩，已描过的笔被本人墨盖住、不再画；没有灰外廓、没有整层不透明度；当前一笔 = 本阶段已写笔数，撤销 / 清空后退回；
//      10.13 用浅色楷体整字、不分笔顺），进阶段先快放一遍笔顺（每字只在第一次播，I3-07；总时长 ≤ 1.6s，policy.motion.stepPlayMaxMs，P210；走查-W19；落笔 / 点一下即到终态；
//      减少动态效果不播）。格下说明 R-W07.answerNote（10.13 用 R-W08.answerNote，字串相同；「记为看过答案」只在这一处说）。读屏：答案字放在底栏一个视觉隐藏的 role=img
//      （书写格参考层 aria-hidden），名称是「参考字形：字，拼音，n 画，结构」（ref-label.js，A2-09）。主按钮「凭记忆写」（X-ANSWER.btnTraceDone）；底部「下一个」。
//      settings.answerNoteSeen 标志位与 commitAnswerNoteSeen / answerNoteDue 保留，界面不再读它。
//   4. 凭记忆写（retrace，原「自己写一遍」）：点「凭记忆写」清掉答案与笔迹，空书写格；格下 R-W07.selfNote；按钮 [再描一遍 / 下一个]；底部不显示跳过。
//      Q1（QA simB D1；D31 / 实现交接 §4.2）：离开凭记忆写（「下一个」或「再描一遍」，同一次 commit）时，格子里有本人笔画就把它
//      存成**这条 answer-seen 记录的墨迹**（storeSelfInkInDraft：store.setInk 按记录月份写 shizi.v2.ink.<月>，键 = 记录 id），
//      作品里成为「看后写的」格。记录 kind 不变、不写判断、不动 sched（D18 不变）；一次看答案后多次凭记忆写只留最后一次
//      （同一记录键覆盖；最后一次没写就留上一次）；描一遍的笔画不存；看答案前在回忆阶段写的笔画不存（它们只是这一字的现场，推进时丢弃）。看过答案后恢复到的
//      recall（格下同样是自己写的说明）同样算。
//      留存：store/budget.js pruneInkOfCards（同一次 commit）——这个字只留最新一份看后自写，且要新于最近一次判断；组还开着时不回收。
//   5. 「下一个」= 一次 commit：sessions.advance(kind='answer-seen', recordId) → 追加 item、cursor+1、现场重置、
//      结果行 {kind:'saw'}（「「X」记为看过答案」由结果行（M1-5）显示）。不进判断页（compare）。
//   阶段切换（trace ⇄ retrace）与「下一个」都是 commit：成功才切换 / 推进（D07）；失败留在当前阶段，
//   说明换成 R-W16.saveFailed、按钮换成 [先不保存 / 再试一次]（原型 saveFail + pend）。
//
// 规则：
// - 本文件只写 store.commit，不直接碰 localStorage；记录构造用 core/records.makeRecord，会话推进用 core/sessions。
// - 回忆阶段不渲染答案字（决定-D16）：「看答案」按钮与失败框里都没有字；答案字只在 answer / trace 阶段出现。
// - answer-seen 不是有效记录：不写 judged（决定-D18 / D23）；D66 ① 起复习字看答案当天记一次 Again（core/fsrs.js applyAnswerSeen，同一次 commit），新字不动 sched；墨迹只存「自己写一遍」的本人笔画（Q1，上面第 5 条）。
//
// data-testid：write-show-answer（回忆阶段「看答案」）、write-show-answer-cancel / write-show-answer-retry（点「看答案」写入失败时底栏就地的三段式：
// 说明在格下 write-note，S1 / 审计 P1-24）、write-answer-char（底栏里视觉隐藏的答案字，读屏用）、
// write-answer-foot（answer 流程底栏，data-stage、data-failed）、write-trace-done（凭记忆写）、
// write-retrace-trace（再描一遍）、write-answer-next（下一个）、write-answer-show（看过答案后回忆阶段的「看答案」，
// 仅恢复路径 / 提示给完之后）、write-answer-fail-cancel / write-answer-fail-retry（保存失败两键）、write-trace-layer（描红层，
// data-state、data-anim）、write-glyph-fallback（10.13 楷体整字，M1-2 组件）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { Button, markStateChange } from '../../components/Button.js';
import { useAnnounce } from '../../components/FailBlock.js';
import { Icons } from '../../components/icons.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import * as defaultPolicy from '../../../config/policy.js';
import { charOfCardKey } from '../../../core/records.js';
import { peekStrokes, watchStrokes } from '../../../data/strokes.js';
import { animate } from '../../canvas/glyph.js';
import { GlyphWash } from '../../canvas/glyph-wash.js';
import { GlyphFallback } from './glyph-fallback.js';
import { pyOf, refCardLabel } from './ref-label.js';
import { LinkButton, Slot, WriteFoot } from './foot.js';

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/write-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { ANSWER_PHASES, allRecords, findAnswerSeen, appendRecordToDraft, replaceRecordInDraft, isSelfWritePhase, storeSelfInkInDraft, commitAnswerSeen, commitAnswerPhase, commitAnswerNext, answerInkKey, commitAnswerNoteSeen, answerNoteDue } from '../../../session/write-ops.js';
export { ANSWER_PHASES, allRecords, findAnswerSeen, appendRecordToDraft, replaceRecordInDraft, isSelfWritePhase, storeSelfInkInDraft, commitAnswerSeen, commitAnswerPhase, commitAnswerNext, answerInkKey, commitAnswerNoteSeen, answerNoteDue };

/**
 * 描一遍阶段主按钮的文案（P259）：AX3 起用短文案「自己写」（SE 3 的 AX5 下「描好了，自己写」折成三行），其余档「描好了，自己写」。纯函数。
 * @param {number} ax  AX 档（1–5；0 = 不是 AX 档）
 */
export function traceDoneLabel(ax = 0, policy = defaultPolicy) {
  return ax >= policy.axShortPrimaryFrom ? t('X-ANSWER.btnTraceDoneShort') : t('X-ANSWER.btnTraceDone');
}

/** 描一遍前笔顺快放总时长上限（P210）。 */
export const STEP_PLAY_MAX_MS = defaultPolicy.motion.stepPlayMaxMs;

injectStyles('write-answer', `
.sz-answer__anim{position:absolute;left:0;top:0;pointer-events:none}
.sz-answer__trace{position:absolute;inset:0;pointer-events:none}
.sz-answer__trace canvas{position:absolute;left:0;top:0;display:block}
.sz-answer__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sz-answer__note{margin:0;width:100%;text-align:center;font-size:${T.fs13};line-height:${T.lh13};
  color:${T.ink3}}
`);

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
export function useAnswerFlow({ slot, session, cardKey, phase: rawPhase, strokeCount = 0, strokes = null, onShowAnswer, ax = 0, end = null, footCompact = false, hintDone = null }) {
  // 旧版本存下的 'answer' 阶段（D64 ②之前的看答案页）按描一遍处理：标准写法淡显在格子里、可直接描。
  const phase = rawPhase === 'answer' ? 'trace' : rawPhase;
  const char = cardKey ? charOfCardKey(cardKey) : null;
  const answerSeen = !!(session && session.current && session.current.answerSeen);
  const inFlow = ANSWER_PHASES.includes(phase);
  const active = !!cardKey && (inFlow || (phase === 'recall' && answerSeen));
  const [fail, setFail] = useState(null); // null | {kind:'phase', phase} | {kind:'next'} | {kind:'show'}（点「看答案」写入失败，就地三段式）
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

  // 点「看答案」：直接看，没有确认框（D51 ⑧）；写入失败（D07）就在写字页底栏就地给三段式（S1：说明在格下说明位、「先不保存」在求助行、主按钮「再试一次」；
  // 原先是居中模态框，审计 P1-24），不再开弹层。
  const showAnswer = () => {
    if (typeof onShowAnswer === 'function') onShowAnswer(); // 写字页：跳过的撤销机会到此结束（G3）
    const store = storeOrNull();
    const result = store ? commitAnswerSeen(store, { slot, cardKey }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      setFail(null);
      return;
    }
    setFail({ kind: 'show', key: failKey });
    markStateChange();
  };
  const showFailed = !!(failNow && failNow.kind === 'show' && phase === 'recall' && !answerSeen);
  useAnnounce(failNow && (inFlow || showFailed) ? t('R-W16.saveFailed') : '');
  const link = cardKey && phase === 'recall' && !answerSeen
    ? html`<${LinkButton} testid="write-show-answer" icon=${Icons.answer()} label=${t('R-W07.btnShowAnswer')} onClick=${showAnswer} />`
    : null;

  if (showFailed) {
    const footer = html`<${WriteFoot} primary=${{ testid: 'write-show-answer-retry', label: t('R-W16.retry'), onClick: showAnswer }} testid="write-foot" stage="recall" failed=${true} compact=${footCompact}
      left=${html`<${Slot} testid="write-fail-slot"><${LinkButton} testid="write-show-answer-cancel" label=${t('R-W16.cancel')} onClick=${() => { setFail(null); markStateChange(); }} /></${Slot}>`} />`;
    return { active: true, failed: true, link: null, show: showAnswer, stage: null, glyphLayer: null, note: t('R-W16.saveFailed'), footer };
  }
  if (!active) return { active: false, failed: false, link, show: showAnswer, stage: null, glyphLayer: null, note: '', footer: null };

  const missing = glyphStatus === 'missing';
  const stage = null; // 看答案不换卡（D51 ⑧）
  const glyphLayer = phase === 'trace'
    ? ({ cssSize }) => html`<${TraceLayer} key=${'trace|' + cardKey} char=${char} cssSize=${cssSize} onStatus=${setGlyphStatus}
        strokeCount=${strokeCount} playKey=${session ? `${session.id}|${cardKey}` : cardKey} />`
    : null;

  // 描一遍页底栏里视觉隐藏的答案字（书写格参考层 aria-hidden）：读屏名称与判断页参考卡同一句——字、拼音、笔画数、结构 / 部件数（A2-09 / P232）
  const answerLabel = phase === 'trace'
    ? refCardLabel({ char, py: pyOf(cardKey), strokeData: { status: glyphStatus, data: glyphStatus === 'ready' ? peekStrokes(char) : null } })
    : '';
  const failed = !!failNow;
  const failText = t('R-W16.saveFailed');
  let note;
  if (failed) note = failText;
  else if (phase === 'trace') note = missing ? t('R-W08.answerNote') : t('R-W07.answerNote'); // 「记为看过答案」只在这一处说（C3-R T3-05；D64 ②：看答案直接进描一遍，说明随之搬到这里）
  else note = t('R-W07.selfNote'); // retrace，或看过答案后的 recall

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
  } else if (phase === 'trace') {
    // D64 ②：「凭记忆写」清掉答案与笔迹、回到空格子再写一遍（原「自己写」的去处）；不要求先描，所以不再因没写而灰掉
    primary = { testid: 'write-trace-done', label: traceDoneLabel(ax), onClick: toPhase('retrace') };
    right = nextLink;
  } else if (phase === 'retrace') {
    primary = { testid: 'write-answer-next', label: t('R-W07.btnNext'), onClick: next };
    left = link2('write-retrace-trace', t('X-ANSWER.btnRetrace'), toPhase('trace'));
  } else {
    // 看过答案后的回忆阶段（只在恢复路径出现；原型 L544）
    primary = { testid: 'write-answer-next', label: t('R-W07.btnNext'), onClick: next };
    left = link2('write-answer-show', t('R-W07.btnShowAnswer'), toPhase('trace'), Icons.answer());
    // 提示整字给完而记的看过答案（D64 ①）：提示按钮仍在，不可点（读屏「提示已用完」）
    right = hintDone ? html`<${Slot} testid="write-hint-slot" cls="sz-write__hint">${hintDone}</${Slot}>` : null;
  }
  const lead = phase === 'trace' ? html`<span class="sz-answer__sr" role="img" aria-label=${answerLabel} data-testid="write-answer-char"></span>` : null;
  const footer = html`<${WriteFoot} primary=${primary} left=${left} right=${right} testid="write-answer-foot" stage=${phase} failed=${failed} lead=${lead} compact=${footCompact} />`;
  return { active: true, failed, link, show: showAnswer, stage, glyphLayer, note, footer };
}
