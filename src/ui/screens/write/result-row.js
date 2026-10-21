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
import { FailBlock } from '../../components/FailBlock.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { isPaperRecord } from '../../../core/records.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { loadStrokes, peekStrokes } from '../../../data/strokes.js';
import { openCharDetail } from '../detail/open.js';
import './answer.js';
import { InkMini, RefMini, recalledInk } from './compare.js';

injectStyles('write-result-row', `
/* D46 ⑭：结果行在书写格下面的说明位（左对齐、13pt 墨三），不再是格子上方整行；「修改 ›」仍是 44 高的文字按钮；标准字号下一行放得下，AX 档允许折行（D49） */
.sz-line{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:${T.s1} ${T.s2};
  font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};flex-wrap:wrap}
.sz-line[data-state="skipped"]{display:none}
.sz-line__dot{color:${T.ink4}}
.sz-line__change{--bx:4px;min-width:${T.hit};min-height:${T.hit};margin:-4px calc(-1 * var(--bx)) 0;padding:4px var(--bx) 0;gap:${T.s1};color:${T.ink1};font-size:${T.fs13};} /* 按钮盒 44 × (文字宽 + 8)。① min-width 44 加左右各 4 的内边距让按钮盒不比点击区（::after，≥ 44 宽）窄——WebKit 下点击区伸出按钮盒会让按钮 scrollWidth > clientWidth（K2），负外边距抵回，文字位置不变；② 比 40 高的说明位多出的 4 全部伸向上面（上外边距 -4、上内边距 4 把字抵回行中线）：伸向下面的部分会让正文区出现 2pt 的可滚动量（SE 3 XXXL，写字页不得滚动），向上伸出不计入可滚动区；热区仍是 44 */
.sz-change__cancel{position:absolute;right:12px;top:18px;height:44px;padding:0 12px;font-size:${T.fs15};color:${T.ink2}}
.sz-change__view{align-self:flex-start;margin-left:calc(-1 * var(--bx,0px))} /* D66 ⑮：「看这个字 ›」文字按钮，左对齐 20pt 线（规范 B2），在说明与主按钮之间 */
.sz-change__minis{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-change__col{display:flex;flex-direction:column;gap:12px;min-width:0}
.sz-change__note{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-change__btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-change .sz-sheet__title{font-family:inherit;font-size:${T.fs17};padding-right:64px}
`);

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/write-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { findRecord, resultRowModel, lineVisible, correctInDraft, commitCorrection } from '../../../session/write-ops.js';
export { findRecord, resultRowModel, lineVisible, correctInDraft, commitCorrection };
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

/**
 * 「看这个字 ›」（D66 ⑮）：对照 / 改判弹层里进字详情的入口——结果页与写字页是同一个组件（写字页只给「上一个字」，当前字的答案不会泄露，D16）。
 * 先关弹层再推入详情（普通推入，D62），详情返回回到弹层下面的这一页。
 */
export function ViewCharLink({ testid, char, close }) {
  if (!char) return null;
  return html`<${Button} variant="text" class="sz-change__view" data-testid=${testid}
    onClick=${() => { if (close) close(); openCharDetail(char); }}>${t('X-DETAIL.viewChar')}</${Button}>`;
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
  return html`<${Sheet} title=${t('X-JUDGE.changeTitle', { char })} onClose=${close} active=${active} testid="write-change-sheet" dismiss="own">
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
    <${ViewCharLink} testid="write-change-detail" char=${char} close=${close} />
    ${failed
      ? html`${FailBlock({ layout: 'dialog', text: '', testid: 'write-change-fail', cancelLabel: t('R-W10.cancel'), retryLabel: t('R-W10.retry'), onCancel: () => close && close(), onRetry: flip })}`
      : html`<${Button} variant="primary" data-testid="write-change-flip" onClick=${flip}>${flipLabel}</${Button}>`}
  </${Sheet}>`;
}

/** 打开修改判断弹层；返回 overlay id。 */
export function openChangeSheet({ slot, recordId }) {
  return nav.openOverlay(ChangeSheet, { slot, recordId }, { name: 'write-change-sheet' });
}

// ---------------------------------------------------------------- 组件与写字页接线

/**
 * 「修改 ›」：改判的入口按钮（D66 ④）。写字页结果行与结果页写错的那一行用的是它——同一个组件、同一个外观（文字按钮，行尾 ›），点了都打开改判弹层。
 * label 缺省取结果行文案里「 · 」后面的那个词（R-W10.lineRecordedCorrect 的「修改 ›」去掉 ›）。
 */
export function changeLabel() {
  const full = t('R-W10.lineRecordedCorrect');
  const cut = full.lastIndexOf(' · ');
  return (cut >= 0 ? full.slice(cut + 3) : '').replace(/\s*›\s*$/, '');
}

export function ChangeLink({ label = changeLabel(), onClick, testid = 'write-line-change', ...rest }) {
  return html`<${Button} variant="text" class="sz-line__change" data-testid=${testid} onClick=${onClick} ...${rest}>${label}<span aria-hidden="true">›</span></${Button}>`;
}

/** 结果行视图（纯视图，单测直接调用）。model 为 resultRowModel 的结果。 */
export function ResultRowView({ model, onChange }) {
  if (!model || model.state === 'none') return null;
  if (model.state === 'skipped') {
    return html`<div class="sz-line" data-testid="write-line" data-state="skipped" aria-hidden="true"></div>`;
  }
  const action = model.action && model.canChange
    ? html`<span class="sz-line__dot" aria-hidden="true">·</span>${ChangeLink({ label: model.action.replace(/\s*›\s*$/, ''), onClick: onChange })}`
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
