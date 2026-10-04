// 写字页的「在纸上写，回来自判」（阶段 1 P1-E8；D46 ⑬ / D47；实现交接 §10.2；求助与判断 ⑤；03 P165 / P167）。
//
// 写字方式 = 本字临时切换（session.current.paper）优先，否则设置 settings.writeMode（core/paper.js paperOf）；只管回忆 / 判断两步。
// - 纸上（recall）：书写格位置换成同样大小的纸面格（不可落笔、不画十字线），格内居中「在纸上写」/「写好了点「写好了」，再自己对照。」/
//   文字按钮「改回在屏幕上写」（只改这一个字）；格下说明「这个字记下时会标注「纸上」，不留笔迹。」。题面、提示、看答案、跳过照常；
//   提示画在纸面格里（标准位置），这时格内文字收起、只留「改回在屏幕上写」贴在格底，不和提示笔画叠在一起。「写好了」不要求笔画。
// - 屏幕（recall，还没落笔）：格下一行右端（撤销 / 清空的位置）是「在纸上写」，只把这一个字改到纸上；落笔后换回撤销 / 清空。
// - 判断页（compare.js PaperCompareStage）、判断 commit（source:'paper'，不写墨迹）见 compare.js。
// 切换是会话现场写入（withCurrent {paper}），按 P52 不阻断：本地先切换，写失败也照样显示，下一次写入时由进判断页的 commit 带上。
// - 读屏开启时的建议（P168）：读屏 / 切换控制开启后第一次进写字页（platform/accessibility.js assistiveTechActive，阶段 0 桥），
//   格下说明位一条非阻断建议「读屏开启时，可以在纸上写好，回来自己对照。」+「不用」/「改为在纸上写」；出现即记 settings.paperSuggested，
//   只出现一次；「改为在纸上写」把设置改为纸上。
//
// data-testid：write-paper（纸面格，data-hinted）、write-paper-title、write-paper-body、write-paper-back（改回在屏幕上写）、
//   write-paper-note（格下说明）、write-to-paper（屏幕模式格下「在纸上写」）、write-paper-suggest（+ -text / -no / -yes）。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { InkGrid } from '../../canvas/ink-canvas.js';
import { t } from '../../../config/copy/index.js';
import { currentCardKey, withCurrent } from '../../../core/sessions.js';
import { paperOf, paperSuggestDue } from '../../../core/paper.js';

injectStyles('write-paper', `
.sz-paper{position:relative;flex:none;margin:0 auto;max-width:100%}
.sz-paper .sz-inkgrid__guides{display:none}
.sz-paper__body{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:${T.s2};padding:0 ${T.s4};text-align:center;pointer-events:none}
.sz-paper__title{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-paper__text{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-paper__back{margin-top:${T.s3};pointer-events:auto;min-height:44px;font-size:${T.fs15};color:${T.ink2}}
.sz-paper[data-hinted="true"] .sz-paper__body{justify-content:flex-end;padding-bottom:0}
.sz-paper[data-hinted="true"] .sz-paper__title,.sz-paper[data-hinted="true"] .sz-paper__text{display:none}
.sz-paper__note{display:block}
.sz-paper__nowrap{white-space:nowrap}
.sz-paper__suggest{display:flex;flex-direction:column;align-items:flex-start;gap:0;color:${T.ink2};font-size:${T.fs13};line-height:${T.lh13}}
.sz-paper__suggestbtns{display:flex;flex-wrap:wrap;gap:${T.s4};margin-left:-2px}
.sz-paper__sbtn{min-height:44px;padding:0 2px;font-size:${T.fs15};color:${T.ink1}}
.sz-write__topaperslot{position:absolute;right:-10px;top:0;bottom:0;display:flex;align-items:center}
.sz-write__topaper{height:44px;min-width:44px;padding:0 10px;font-size:${T.fs15};color:${T.ink2}}
`);

const EMPTY = Object.freeze([]);

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

/** 只对当前这一个字切换写字方式（current.paper）。当前字已不是 cardKey 时 {ok:false, error:{kind:'stale'}}。 */
export function commitPaperToggle(store, { slot, cardKey, paper }) {
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return { ok: false, error: { kind: 'stale' } };
  return store.commit('write:paper', (draft, ctx) => {
    const cur = sessionOf(draft, slot);
    if (!cur || currentCardKey(cur) !== cardKey) throw new Error('paper toggle: not the current card');
    draft.sessions = { ...draft.sessions, [slot]: withCurrent(cur, { paper: !!paper }, ctx.now) };
  });
}

/**
 * 当前这一字是不是在纸上写（本地切换覆盖 + 存下的 current.paper + 设置），以及切换动作。
 * @param {{slot, session, cardKey, settings, storedPhase, getStore}} o
 * @returns {{paper:boolean, toggle(next:boolean)}}
 */
export function usePaperMode({ slot, session, cardKey, settings, storedPhase, getStore }) {
  const [local, setLocal] = useState(null); // {key, paper}
  const key = session && cardKey ? `${session.id}|${session.cursor}|${cardKey}` : null;
  const current = session && session.current ? { ...session.current, phase: storedPhase } : { phase: storedPhase };
  let paper = paperOf({ settings, current });
  if (local && local.key === key && (storedPhase === 'recall' || storedPhase === 'compare')) paper = local.paper;
  return {
    paper,
    toggle(next) {
      if (!key) return;
      setLocal({ key, paper: !!next });
      let store = null;
      try {
        store = getStore();
      } catch (error) {
        return;
      }
      commitPaperToggle(store, { slot, cardKey, paper: !!next }); // P52：失败不阻断
    },
  };
}

/**
 * 纸面格：与书写格同样大小（size），不可落笔；提示层照常画在里面（glyphLayer）。hinted 时格内文字收起，只留「改回在屏幕上写」。
 */
export function PaperStage({ size, glyphLayer = null, hinted = false, onBack }) {
  return html`<div class="sz-paper" data-testid="write-paper" data-hinted=${hinted ? 'true' : 'false'} style=${{ width: `${size}px` }}>
    <div aria-hidden="true"><${InkGrid} strokes=${EMPTY} drawable=${false} size=${size} glyphLayer=${glyphLayer} testid="write-paper-grid" /></div>
    <div class="sz-paper__body">
      <span class="sz-paper__title" data-testid="write-paper-title">${t('X-PAPER.title')}</span>
      <span class="sz-paper__text" data-testid="write-paper-body">${t('X-PAPER.body')}</span>
      <${Button} variant="text" class="sz-paper__back" data-testid="write-paper-back" onClick=${onBack}>${t('X-PAPER.backToScreen')}</${Button}>
    </div>
  </div>`;
}

/**
 * 纸上那一字的格下说明。句子里「…」括起来的词（「纸上」）整体不换行（Q2-12，复测 simC D9：窄的时候被断成「纸 / 上」两行）；
 * 按引号切分，不在代码里写死文案。
 */
export function PaperNote() {
  const parts = t('X-PAPER.note').split(/(「[^」]*」)/);
  return html`<span class="sz-paper__note" data-testid="write-paper-note">${parts.map(part => (/^「[^」]*」$/.test(part)
    ? html`<span class="sz-paper__nowrap">${part}</span>` : part))}</span>`;
}

// ---------------------------------------------------------------- 读屏开启时的建议（P168；求助与判断 ⑤「读屏开启时的第一次」）

/** 记下建议已出现过（settings.paperSuggested = true，只出现一次）。已记过不写。 */
export function commitPaperSuggested(store) {
  const cur = store.getState().settings;
  if (cur && cur.paperSuggested === true) return { ok: true, keys: [], skipped: true };
  return store.commit('write:paper-suggest', draft => {
    draft.settings = { ...(draft.settings || {}), paperSuggested: true };
  });
}

/** 接受建议：写字方式设置改为纸上（settings.writeMode = 'paper'，同时记下已出现过）。 */
export function commitPaperAccept(store) {
  return store.commit('write:paper-accept', draft => {
    draft.settings = { ...(draft.settings || {}), writeMode: 'paper', paperSuggested: true };
  });
}

/**
 * 读屏 / 切换控制开启后第一次进写字页时，格下一条非阻断建议（只出现一次）：进页时判定一次（paperSuggestDue），
 * 出现即记 settings.paperSuggested（写失败不阻断，下次进页可能再出现一次）；点「改为在纸上写」改设置、点「不用」收起；离开本页即不再显示。
 * @param {{settings:object|null, phase:string, paper:boolean, assistive:()=>boolean, getStore:()=>object}} o
 * @returns {{node:*}}
 */
export function usePaperSuggest({ settings, phase, paper, assistive, getStore }) {
  const [shown, setShown] = useState(() => paperSuggestDue({ settings, assistive: !!assistive() }));
  const recorded = useRef(false);
  useEffect(() => {
    if (!shown || recorded.current) return;
    recorded.current = true;
    try {
      commitPaperSuggested(getStore()); // 失败不阻断
    } catch (error) {
      // store 不可用：照样显示
    }
  }, [shown]);
  if (!shown || paper || phase !== 'recall') return { node: null };
  const accept = () => {
    setShown(false);
    try {
      commitPaperAccept(getStore());
    } catch (error) {
      // 写不进去：这一次照旧在屏幕上写
    }
  };
  return {
    node: html`<span class="sz-paper__suggest" role="status" data-testid="write-paper-suggest">
      <span data-testid="write-paper-suggest-text">${t('X-PAPER.suggest')}</span>
      <span class="sz-paper__suggestbtns">
        <${Button} variant="text" class="sz-paper__sbtn" data-testid="write-paper-suggest-no" onClick=${() => setShown(false)}>${t('X-PAPER.suggestNo')}</${Button}>
        <${Button} variant="text" class="sz-paper__sbtn" data-testid="write-paper-suggest-yes" onClick=${accept}>${t('X-PAPER.suggestYes')}</${Button}>
      </span>
    </span>`,
  };
}

/** 屏幕模式格下一行右端「在纸上写」（还没落笔时占撤销 / 清空的位置）。 */
export function ToPaperButton({ onClick }) {
  return html`<${Button} variant="plain" class="sz-write__topaper" data-testid="write-to-paper" onClick=${onClick}>${t('X-PAPER.toPaper')}</${Button}>`;
}
