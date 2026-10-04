// 上一个字的结果行与「修改判断」弹层（M1-5；决定-D19 / D07；01 §3.2 / §3.3 / §5 / §6.6；04 R-W10；
// 原型 ShiziWriteScreen L37–L42、L233–L252、L308–L310、L396、L595–L596、L634–L640；reference/I-proto-write.md「结果行」「修改判断弹层」）。
//
// 结果行三态（紧挨着的上一个字，R-W10）：
//   judged：「「X」记为写对 · 修改 ›」/「「X」已改为写对 · 修改 ›」（写错同构）——lastLine.kind 'record' | 'changed'；
//   saw：   「「X」记为看过答案」（无修改入口，K25）——lastLine.kind 'saw'（M1-4 写入）；
//   skipped：上一个字是跳过 → 结果行清空（「跳过后清空、只说紧挨着的上一个字」）；撤销入口在底部轻提示（skip.js）。
// 显示条件：当前字回忆阶段、没看过答案、书写格没有本人笔画、本字没落过笔（决定-D19）。
//   落笔（书写格接受一次落笔）→ 本字收起（本页内记住，换字前不再出现）；跳过 / 确认看答案 → 会话 lastLine 清空；
//   当前字提交（判断 / 看过答案后下一个）→ lastLine 换成当前字的，上一字的行消失。
// 「修改」→ 底部弹层：标题「修改「X」的判断」、右上「取消」；两张小卡「你的书写」/「参考字形」；
//   说明「刚才记的是写对。改了只换掉这一次，不会多算一次。」；主按钮「改为写错 / 改为写对」。
//   修改 = 一次 store.commit：同一条记录只改 judgment、追加 corrections（id / at / localDay / help 不变，决定-D19 / D07）；
//   从 items[].fsrsBefore 以各记录 at 重放本字此后的 judged 记录，更新 sched（due 随之变）；会话只把 lastLine 改成
//   'changed'，**current 原样不动**（当前字的提示 / 笔画 / 阶段都保留）。失败：弹层内说明换「没改成，还是原来的判断。」、
//   按钮换 [先不改 / 再试一次]；记录与 FSRS 不变；重试成功才关弹层。
//   只对本会话结果行仍可见、且 items 里有 fsrsBefore 的 judged 记录开放（sessions.canCorrect；看过答案 / 跳过不可改）。
// 弹层「你的书写」：perRecordInk 开时读该记录的墨迹；关时用本页刚判断时记下的笔画（compare.js rememberInk）；
//   都没有（刷新后且开关关闭）→ 10.12「这一次没有留下笔迹」。
//
// data-testid：write-line（结果行，data-state=judged|saw|skipped，data-kind=record|changed|saw）、write-line-text、
//   write-line-change（「修改 ›」按钮）、write-change-sheet（弹层面板）、write-change-cancel（取消）、
//   write-change-mine / write-change-ref（两张小卡）、write-change-noink、write-change-note（说明 / 失败句）、
//   write-change-flip（改为…）、write-change-fail-cancel（先不改）/ write-change-fail-retry（再试一次）。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { compareRecordIds, correctRecord, isJudged, isPaperRecord, sortById } from '../../../core/records.js';
import { canCorrect, fsrsBeforeOf, markLineChanged } from '../../../core/sessions.js';
import { replay } from '../../../core/fsrs.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { loadStrokes, peekStrokes } from '../../../data/strokes.js';
import { allRecords, replaceRecordInDraft } from './answer.js';
import { InkMini, RefMini, recalledInk } from './compare.js';

injectStyles('write-result-row', `
/* D46 ⑭：结果行在书写格下面的说明位（左对齐、13pt 墨三），不再是格子上方整行；「修改 ›」仍是 44 高的文字按钮 */
.sz-line{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:${T.s1} ${T.s2};
  font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};flex-wrap:wrap}
.sz-line[data-state="skipped"]{display:none}
.sz-line__dot{color:${T.ink4}}
.sz-line__change{min-height:${T.hit};padding:0;gap:${T.s1};color:${T.ink1};font-size:${T.fs13};}
.sz-change__cancel{position:absolute;right:12px;top:18px;height:44px;padding:0 12px;font-size:${T.fs15};color:${T.ink2}}
.sz-change__minis{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-change__col{display:flex;flex-direction:column;gap:12px;min-width:0}
.sz-change__note{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-change__btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-change .sz-sheet__title{font-family:inherit;font-size:${T.fs17};padding-right:64px}
`);

// ---------------------------------------------------------------- 纯函数

const LINE_KEYS = Object.freeze({
  record: { correct: 'R-W10.lineRecordedCorrect', wrong: 'R-W10.lineRecordedWrong' },
  changed: { correct: 'R-W10.lineChangedCorrect', wrong: 'R-W10.lineChangedWrong' },
});

/** 按 id 找记录（全部月份，含折叠月 kept）。 */
export function findRecord(state, recordId) {
  for (const r of allRecords(state)) if (r && r.id === recordId) return r;
  return null;
}

/**
 * 结果行模型（不看「是否显示」，只看会话里紧挨着的上一个字）。
 * @returns {{state:'judged'|'saw'|'skipped'|'none', kind?, recordId?, char?, judgment?, text?, action?, canChange?}}
 */
export function resultRowModel(session, state) {
  if (!session) return { state: 'none' };
  const line = session.lastLine;
  if (!line) {
    const last = session.items && session.items.length ? session.items[session.items.length - 1] : null;
    return last && last.kind === 'skipped' ? { state: 'skipped' } : { state: 'none' };
  }
  const record = findRecord(state, line.recordId);
  const char = record ? record.char : null;
  if (!record || !char) return { state: 'none' };
  if (line.kind === 'saw') {
    return { state: 'saw', kind: 'saw', recordId: record.id, char, text: t('R-W10.lineSaw', { char }), action: null, canChange: false };
  }
  if (!isJudged(record)) return { state: 'none' };
  const keys = LINE_KEYS[line.kind === 'changed' ? 'changed' : 'record'];
  const full = t(keys[record.judgment], { char });
  // 「「X」记为写对 · 修改 ›」→ 正文 +「修改 ›」按钮（原型 L39–L40：· 分隔，› aria-hidden）。
  const cut = full.lastIndexOf(' · ');
  const text = cut >= 0 ? full.slice(0, cut) : full;
  const action = cut >= 0 ? full.slice(cut + 3) : null;
  return {
    state: 'judged',
    kind: line.kind === 'changed' ? 'changed' : 'record',
    recordId: record.id,
    char,
    judgment: record.judgment,
    text,
    action,
    canChange: !!action && canCorrect(session, record.id),
  };
}

/** 结果行是否显示（决定-D19）：回忆阶段、没看过答案、格子里没有本人笔画、本字没落过笔。 */
export function lineVisible({ phase, answerSeen, strokeCount, penDown }) {
  return phase === 'recall' && !answerSeen && !(strokeCount > 0) && !penDown;
}

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

/**
 * 修改判断的 mutator 主体：同一记录改 judgment + 追加 corrections；从 fsrsBefore 重放本字此后的 judged 记录更新 sched；
 * 会话只改 lastLine（'changed'），current 不动。
 * @returns {{record, entry}}
 */
export function correctInDraft(draft, { slot, recordId, to, at, policy = defaultPolicy }) {
  const s = sessionOf(draft, slot);
  if (!s || !s.lastLine || s.lastLine.recordId !== recordId) throw new Error('correct: not the line record');
  if (!canCorrect(s, recordId)) throw new Error('correct: record cannot be corrected in this session');
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!record || !isJudged(record)) throw new Error('correct: judged record not found');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const later = sortById(all.filter(r => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0))
    .map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = replay(fsrsBeforeOf(s, recordId), later, { policy, stoppedAt: prev ? prev.stoppedAt : undefined });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  draft.sessions = { ...draft.sessions, [slot]: markLineChanged(s, recordId) };
  return { record: next, entry };
}

/**
 * 修改判断 commit。to 缺省 = 反过来。当前结果行已不是这条记录时 {ok:false, error:{kind:'stale'}}。
 */
export function commitCorrection(store, { slot, recordId, to, policy } = {}) {
  const s = sessionOf(store.getState(), slot);
  if (!s || !s.lastLine || s.lastLine.recordId !== recordId || !canCorrect(s, recordId)) {
    return { ok: false, error: { kind: 'stale' } };
  }
  let out = null;
  const result = store.commit('write:correct', (draft, ctx) => {
    out = correctInDraft(draft, { slot, recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}

// ---------------------------------------------------------------- 弹层

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 弹层「你的书写」点列：墨迹（开关开）→ 本页记下的笔画 → 没有。 */
function inkOfRecord(store, record) {
  if (store && record) {
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
  const raw = record ? recalledInk(record.id) : null;
  return raw ? { points: null, strokes: raw } : { points: null, strokes: null };
}

function useLoadedStrokes(char) {
  const [load, setLoad] = useState(() => {
    const peek = char ? peekStrokes(char) : undefined;
    return peek ? { status: 'ready', data: peek } : { status: 'loading', data: null };
  });
  useEffect(() => {
    if (!char || load.status === 'ready') return undefined;
    let alive = true;
    loadStrokes(char).then(data => {
      if (alive) setLoad(data ? { status: 'ready', data } : { status: 'missing', data: null });
    });
    return () => {
      alive = false;
    };
  }, [char]);
  return load;
}

/** 修改判断弹层（overlay 组件；root 注入 close / active）。 */
export function ChangeSheet({ slot, recordId, close, active = true }) {
  const store = storeOrNull();
  const state = store ? store.getState() : null;
  const record = state ? findRecord(state, recordId) : null;
  const char = record ? record.char : '';
  const [failed, setFailed] = useState(false);
  const strokeData = useLoadedStrokes(char);
  const [ink] = useState(() => inkOfRecord(store, record));
  const judgment = record ? record.judgment : 'correct';
  const flip = () => {
    const st = storeOrNull();
    const result = st ? commitCorrection(st, { slot, recordId }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      if (close) close();
      return;
    }
    setFailed(true);
    markStateChange(); // 失败态是新状态（走查-W08）
  };
  const note = failed ? t('R-W10.changeFailed') : t(judgment === 'correct' ? 'R-W10.changeBodyCorrect' : 'R-W10.changeBodyWrong');
  const flipLabel = t(judgment === 'correct' ? 'X-JUDGE.changeToWrong' : 'X-JUDGE.changeToCorrect');
  const mine = t('R-W09.labelMine');
  const ref = t('R-W09.labelReference');
  return html`<${Sheet} title=${t('X-JUDGE.changeTitle', { char })} onClose=${close} active=${active} testid="write-change-sheet">
    <div class="sz-change">
      <${Button} variant="text" class="sz-change__cancel" data-testid="write-change-cancel" onClick=${() => close && close()}>${t('X-JUDGE.changeCancel')}</${Button}>
      <div class="sz-change__minis">
        <div class="sz-change__col">
          ${isPaperRecord(record)
    ? html`<div class="sz-compare__empty" data-testid="write-change-paper" role="img" aria-label=${t('X-JUDGE.paperMineLabel')}>${t('X-JUDGE.paperMineBox')}</div>`
    : html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="write-change-mine" label=${mine}
            emptyText=${t('R-D07.noInkLarge')} emptyTestid="write-change-noink" />`}
          <span class="sz-compare__label" aria-hidden="true">${mine}</span>
        </div>
        <div class="sz-change__col">
          <${RefMini} char=${char} strokeData=${strokeData} testid="write-change-ref" label=${ref} />
          <span class="sz-compare__label" aria-hidden="true">${ref}</span>
        </div>
      </div>
    </div>
    <p class="sz-change__note" data-testid="write-change-note" aria-live="polite">${note}</p>
    ${failed
      ? html`<div class="sz-change__btns">
          <${Button} variant="secondary" data-testid="write-change-fail-cancel" onClick=${() => close && close()}>${t('R-W10.cancel')}</${Button}>
          <${Button} variant="primary" data-testid="write-change-fail-retry" onClick=${flip}>${t('R-W10.retry')}</${Button}>
        </div>`
      : html`<${Button} variant="primary" data-testid="write-change-flip" onClick=${flip}>${flipLabel}</${Button}>`}
  </${Sheet}>`;
}

/** 打开修改判断弹层；返回 overlay id。 */
export function openChangeSheet({ slot, recordId }) {
  return nav.openOverlay(ChangeSheet, { slot, recordId }, { name: 'write-change-sheet' });
}

// ---------------------------------------------------------------- 组件与写字页接线

/** 结果行视图（纯视图，单测直接调用）。model 为 resultRowModel 的结果。 */
export function ResultRowView({ model, onChange }) {
  if (!model || model.state === 'none') return null;
  if (model.state === 'skipped') {
    return html`<div class="sz-line" data-testid="write-line" data-state="skipped" aria-hidden="true"></div>`;
  }
  const action = model.action && model.canChange
    ? (() => {
      const label = model.action.replace(/\s*›\s*$/, '');
      return html`<span class="sz-line__dot" aria-hidden="true">·</span><${Button} variant="text" class="sz-line__change"
        data-testid="write-line-change" onClick=${onChange}>${label}<span aria-hidden="true">›</span></${Button}>`;
    })()
    : null;
  return html`<div class="sz-line" data-testid="write-line" data-state=${model.state} data-kind=${model.kind}
    role="status" aria-live="polite"><span data-testid="write-line-text">${model.text}</span>${action}</div>`;
}

/**
 * 写字页的结果行接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {object|null} o.state   store 已发布状态
 * @param {string} o.phase        有效阶段
 * @param {number} o.strokeCount  书写格本人笔数
 * @returns {{model, visible, node, onStrokeStart}}
 */
export function useResultRow({ slot, session, state, phase, strokeCount }) {
  const key = session ? `${session.id}|${session.cursor}` : null;
  const [penKey, setPenKey] = useState(null); // 本字落过笔（本页内记住，换字前不再出现）
  const model = resultRowModel(session, state);
  const answerSeen = !!(session && session.current && session.current.answerSeen);
  const visible = !!key && model.state !== 'none'
    && lineVisible({ phase, answerSeen, strokeCount, penDown: penKey === key });
  const onChange = () => {
    if (model.state === 'judged' && model.canChange) openChangeSheet({ slot, recordId: model.recordId });
  };
  return {
    model,
    visible,
    node: visible ? html`<${ResultRowView} model=${model} onChange=${onChange} />` : null,
    onStrokeStart() {
      if (key && penKey !== key) setPenKey(key);
    },
  };
}
