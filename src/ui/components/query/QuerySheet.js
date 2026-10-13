// 查字 / 自己选字底部弹层（M2-0；决定-D21；04 R-Q01–R-Q06、R-Q08、R-H06；03 P42 / P43 / P45；
// 原型 字库墨墙屏 L146–L183、L415–L452，reference/K-proto-home-lib.md「查字 / 自己选字弹层」）。
//
// 框架：M0-4 的 Sheet（role=dialog aria-modal、焦点陷阱）挂在 router 的遮罩栈里（nav.openOverlay，index.js openQuery）；
// 点遮罩 / 系统返回 / Esc 关闭。弹层上再推入页面（练这个字、查看记录）时弹层留在栈里，返回后输入与选中不变（R-Q07）。
//
// 两种模式（P42 policy.queryModes，只有 lookup / pick）：
//   lookup（查字）：标题「查字」；逐字行没有勾选，输入不自动选中任何字、也不自动加入自选（任务卡 M2-0）。
//   pick（自己选字）：标题「自己选字」；逐字行左侧勾选圈，默认一个都不选；底部 sticky 按钮按选中数
//     0「先选一个字」（disabled + aria-disabled，R-Q06 / Z02）、1「练这个字」、N「练这 N 个字」→ onPick(chars)。
// 视图（core/query queryView）：hint（没有字）→ rows（多个字）→ card（一个字 / 点了某行；能练）或 bad（不能练）。
//   输入只有一个字时直接显示它的卡片（原型 L417）；多字时卡片上方「‹ 回到这 N 个字」。
// 输入过滤提示（R-Q03）在输入框下方；输入原文保留不截断（P45 policy.queryInputMax=null 不设上限）。
//
// 写入：只有卡片上点「加入自选的字」才 store.commit('query:add')，把 {char, at} 追加进 custom.added（决定-D21；01 §3.5）。
//   成功：轻提示「「X」已加入自选的字。」，按钮变禁用的「已在自选的字里」；失败：三段式，输入与卡片留着。
//   打开、输入、点行、勾选、看卡片一律不写存储。
// 开始练：交给调用方（onPick / onPractice，M2-1 / M2-2 / M3-3 接 S02 与建 B 会话）。回调返回 {ok:false}（或 resolve 成它）
//   时弹层显示 R-H06 三段式「没保存上，输入的字还在。」［先不保存 / 再试一次］，再试一次用同一批字再调一次。
// 焦点（R-Q08）：openQuery 已在点击事件里同步聚焦代理输入框（input.js）；本组件挂上后把焦点转给查字框，之后才让 Sheet
//   进入 active（Sheet 在 active 为假时不抢焦点），关闭时焦点回到打开弹层的控件。
// 键盘避让：visualViewport 缩小时弹层底边抬到可见区底边、高度按可见区算（input.js）。
// 版面（F5）：弹层本身不滚动——标题与输入框钉在顶部、主操作（pick 底栏 / 卡片「练这个字」/ 失败三段式）钉在底部，
//   中间（过滤提示、逐字行、卡片、「加入自选的字 / 查看记录」）是单独的滚动区 query-scroll。键盘 / 候选栏占掉可见区时，
//   输入框与主按钮始终在可见区里，不需要先滚动。
//
// data-testid：query-sheet（面板）、query-body（data-mode / data-view / data-cur）、query-input、query-note（每条过滤提示，data-key）、query-hint、
//   query-rows、query-back（‹ 回到这 N 个字）、query-bar（pick 底栏，data-count）、query-go、query-go-fail（+ -cancel / -retry）；
//   行与卡片见 CharRow.js / CharCard.js。

import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { Sheet } from '../Sheet.js';
import { Button } from '../Button.js';
import { FailBlock } from '../FailBlock.js';
import { injectStyles, SCROLL_Y, T } from '../styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import {
  charSummary, filterInput, filterNotes, flattenRecords, isPracticable, parsePinyinInput, pickBar, pinyinMatches, pyKey,
  queryView, selectedChars, withCustomAdded, writtenChars,
} from '../../../core/query.js';
import { libraryById } from '../../../core/cards.js';
import { allCards, cardForKey, currentLibraryId } from '../../../data/deck.js';
import { getStore } from '../../../store/store.js';
import { useStrokeData } from '../../screens/write/hint-layer.js';
import { CharRow } from './CharRow.js';
import { CharCard, BadCard, CardFooter, CardSecondary } from './CharCard.js';
import { QueryInput, handOffFocus, sheetFrameStyle, useVisualViewport } from './input.js';

export const ADD_LABEL = 'query:add';

injectStyles('query-sheet', `
.sz-sheet[data-testid="query-sheet"]{overflow:hidden}
/* 大字号 + 键盘弹起（Q2-9）：弹层全高；顶部让出安全区，标题视觉隐藏（仍是 dialog 的名字），内容区才放得下一张候选卡 */
.sz-sheet[data-testid="query-sheet"][data-full="true"]{border-radius:0;padding-top:max(${T.s4}, env(safe-area-inset-top, 0px))}
.sz-sheet[data-testid="query-sheet"][data-full="true"] .sz-sheet__title{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
/* 全高时标题行只剩「完成」（A2-05）：不占竖向空间——绝对定位到顶部右端、与查字框同一行，查字框右侧让出它的宽（两个汉字 + 点击区内边距），内容区高度不变（76-q2-09） */
.sz-sheet[data-testid="query-sheet"][data-full="true"] .sz-sheet__head{position:absolute;top:max(${T.s4}, env(safe-area-inset-top, 0px));right:${T.gutter};margin:0}
/* R3-K1（A3-04）：原先这条让宽规则写在不存在的 .sz-query__input-wrap 上，从没生效——AX5 下「完成」直接压在查字框的占位文字上。
   现在让在查字框本身（宽 = 100% − 让出的宽）；AX 档「完成」字号封顶 22（仍在查字框那一行，不占内容区高度，76-q2-09），让出 2 × 22 + 2 × --bx + 16 */
.sz-sheet[data-testid="query-sheet"][data-full="true"] .sz-query__input{width:calc(100% - (2 * ${T.fs15} + 8px + ${T.s4}))}
:root[data-ax] .sz-sheet[data-testid="query-sheet"][data-full="true"] .sz-sheet__done{font-size:calc(22px * 1);line-height:30px}
:root[data-ax] .sz-sheet[data-testid="query-sheet"][data-full="true"] .sz-query__input{width:calc(100% - (2 * 22px + 8px + ${T.s4}))}
.sz-query{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px}
.sz-query__scroll{flex:1 1 auto;min-height:0;${SCROLL_Y};
  display:flex;flex-direction:column;gap:16px;padding-bottom:1px} /* 带调拼音的回退字体让行高带小数，滚到底时最后一行可能差不到 1px 没露全；多留 1px（60-matrix scroll-end） */
.sz-query__notes{display:flex;flex-direction:column;gap:6px}
.sz-query__note{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:${T.rCtl};background:${T.field}}
.sz-query__notedot{flex:none;width:6px;height:6px;margin-top:8px;border-radius:50%;background:${T.ink2}}
.sz-query__notetext{flex:1;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink2}}
.sz-query__hint{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-query__back{align-self:flex-start;min-height:44px;margin:0 0 -10px;font-size:${T.fs15};color:${T.ink2};} /* 热区 44（Q2-13）：它是滚动区的第一个子元素，往上伸会被滚动区裁掉，所以改成真 44 高、只往下叠 10px */
.sz-query__foot{flex:none;max-height:56%;${SCROLL_Y};margin:0 calc(-1 * ${T.gutter}) calc(-1 * var(--qpb, 32px));
  padding:${T.s3} ${T.gutter} var(--qpb, 32px);display:flex;flex-direction:column;gap:${T.s2};background:${T.elev};z-index:1}
.sz-query__barfail{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-query__bartwo{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
`);

// ---------------------------------------------------------------- 纯函数（test/ui/query.test.mjs）

/** 题库与当前练习范围的查字谓词（「不能练」判定：不在当前库且不在题库，core/query isPracticable）。 */
export function deckPredicates(settings, lookup = cardForKey) {
  const lib = libraryById(currentLibraryId(settings));
  const card = c => lookup(`base:${c}`);
  return {
    inDeck: c => !!card(c),
    inLibrary: c => {
      const k = card(c);
      return !!(k && lib && lib.test(k));
    },
    card,
    pinyinEntries: () => pinyinEntriesOf(allCards(), lookup),
  };
}

// 拼音索引：题库卡数组（同一份）只建一次。字频序 = 题库顺序；每个字取它自己的 base 卡的拼音。
const pinyinMemo = new WeakMap();
function pinyinEntriesOf(cards, lookup) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const memo = pinyinMemo.get(cards);
  if (memo && memo.lookup === lookup) return memo.list;
  const seen = new Set();
  const list = [];
  for (const c of cards) {
    const ch = c && c.target;
    if (!ch || seen.has(ch)) continue;
    const card = lookup(`base:${ch}`);
    if (!card) continue;
    seen.add(ch);
    const key = pyKey(card.py);
    if (key) list.push({ char: ch, key });
  }
  pinyinMemo.set(cards, { lookup, list });
  return list;
}

/** 加入自选的字：一次 commit（决定-D21）。已在自选里时不写。返回 store.commit 的结果。 */
export function commitAdd(store, char) {
  return store.commit(ADD_LABEL, (draft, ctx) => {
    const next = withCustomAdded(draft.custom, char, ctx.now);
    if (next) draft.custom = next;
  });
}

/** 回调的结果（同步值或 Promise）是不是失败：{ok:false}。 */
export async function isFailure(result) {
  let value = result;
  try {
    value = await result;
  } catch (error) {
    return true;
  }
  return !!(value && typeof value === 'object' && value.ok === false);
}

/** 模型：给定输入与状态，算出视图、提示、逐字摘要、pick 底栏。纯函数。 */
export function sheetModel({ mode, text, cur, selected, state, predicates, policy = defaultPolicy }) {
  const records = flattenRecords(state && state.records);
  let filtered = filterInput(text, { max: policy.queryInputMax });
  // 只有拼音字母（可带声调，v 当 ü）：列出读音匹配的字（本人写过的在前，再按常用度）；与输入汉字同一套行 / 卡片 / 勾选。
  const py = filtered.hanCount === 0 && typeof predicates.pinyinEntries === 'function' ? parsePinyinInput(text) : null;
  let pinyin = null;
  if (py) {
    const chars = pinyinMatches(py.query, predicates.pinyinEntries(), { written: writtenChars(records) });
    pinyin = { raw: py.raw, count: chars.length };
    filtered = { chars, removed: 0, duplicates: [], hanCount: 0, overLimit: 0, total: filtered.total };
  }
  const practicable = c => isPracticable(c, predicates);
  const v = queryView({ chars: filtered.chars, cur, practicable });
  const ctx = { records, sched: state ? state.sched : null, custom: state ? state.custom : null };
  const summaries = filtered.chars.map(c => charSummary(c, { ...ctx, practicable: practicable(c) }));
  const chosen = mode === 'pick' ? selectedChars(filtered.chars, selected, practicable) : [];
  return {
    filtered,
    view: v.view,
    cur: v.cur,
    notes: pinyin ? (pinyin.count ? [] : [{ key: 'X-QUERY.pinyinNone', vars: { char: pinyin.raw } }]) : filterNotes(filtered, v.view),
    pinyin: !!pinyin,
    summaries,
    summary: v.cur ? summaries.find(s => s.char === v.cur) : null,
    multi: filtered.chars.length > 1,
    chosen,
    bar: mode === 'pick' && (v.view === 'hint' || v.view === 'rows') ? pickBar(chosen.length) : null,
  };
}

/**
 * pick 底栏（纯视图）：R-Q06 按钮（0 个真禁用）；开始练失败时换成 R-H06 三段式。bar 为 null（不在 pick 的 hint / rows）时不画。
 */
export function PickBar({ bar, count = 0, failed = false, onGo, onCancel, onRetry }) {
  if (!bar) return null;
  return html`<div class="sz-query__bar sz-query__foot" data-testid="query-bar" data-count=${count}>
    ${failed
      ? html`${FailBlock({ layout: 'dialog', testid: 'query-go-fail', text: t('R-H06.saveFailed'), cancelLabel: t('R-H06.cancel'), retryLabel: t('R-H06.retry'), onCancel: onCancel, onRetry: onRetry })}`
      : html`<${Button} variant="primary" data-testid="query-go" disabled=${bar.disabled} onClick=${onGo}>${t(bar.key, bar.vars)}</${Button}>`}
  </div>`;
}

// ---------------------------------------------------------------- 组件

function useStore() {
  const read = () => {
    try {
      return getStore();
    } catch (error) {
      return null;
    }
  };
  const [store] = useState(read);
  const [state, setState] = useState(() => (store ? store.getState() : null));
  useEffect(() => {
    if (!store) return undefined;
    setState(store.getState());
    return store.subscribe(next => setState(next));
  }, [store]);
  return { store, state };
}

function restoreFocus(el) {
  if (!el || typeof el.focus !== 'function' || !el.isConnected) return;
  if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return;
  try {
    el.focus({ preventScroll: true });
  } catch (error) {
    // 元素已不可聚焦
  }
}

/**
 * 遮罩内容组件（index.js openQuery 经 nav.openOverlay 打开）。
 * @param {object} p
 * @param {'lookup'|'pick'} p.mode
 * @param {(chars:string[], api) => any} [p.onPick]  pick 底栏 / 卡片「练这个字」（没有 onPractice 时）
 * @param {(char:string, api) => any} [p.onPractice]  卡片「练这个字」
 * @param {(char:string, api) => any} [p.onDetail]  「查看记录」（M3-6 之前不传 → 按钮置灰）
 * @param {string} [p.initialText]
 * @param {Element|null} [p.opener]  打开弹层的控件（关闭后焦点回到它）
 * @param {() => void} p.close  @param {boolean} p.active  由 OverlayHost 传入
 */
export function QuerySheet(p) {
  const { mode = 'lookup', onPick, onPractice, onDetail, initialText = '', opener = null, close, active = true } = p;
  const { store, state } = useStore();
  const [text, setText] = useState(initialText);
  const [cur, setCur] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [addFailed, setAddFailed] = useState('');
  const [goFailed, setGoFailed] = useState(null); // {chars, from:'bar'|'card'}
  const [armed, setArmed] = useState(false);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const viewport = useVisualViewport();

  const predicates = useMemo(() => deckPredicates(state ? state.settings : null), [state && state.settings]);
  const model = useMemo(() => sheetModel({ mode, text, cur, selected, state, predicates }), [mode, text, cur, selected, state, predicates]);
  const strokeData = useStrokeData(model.view === 'card' ? model.cur : '');

  // 焦点：代理框 → 查字框（同一轮事件循环里、Sheet 的挂载 effect 之后），再让 Sheet 进入 active。
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      handOffFocus(inputRef.current);
      setArmed(true);
    });
    return () => {
      alive = false;
      const back = opener;
      Promise.resolve().then(() => restoreFocus(back));
    };
  }, []);

  // 键盘避让：面板（Sheet 的 .sz-sheet）按可见区定位。
  useLayoutEffect(() => {
    const panel = rootRef.current && rootRef.current.closest('.sz-sheet');
    if (!panel) return;
    const large = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-text-large');
    const f = sheetFrameStyle(viewport, { large });
    panel.style.bottom = f.bottom;
    panel.style.maxHeight = f.maxHeight;
    panel.style.minHeight = f.minHeight;
    panel.style.paddingBottom = f.paddingBottom;
    panel.style.setProperty('--qpb', f.pb);
    panel.dataset.keyboard = viewport && viewport.inset > 0 ? 'true' : 'false';
    panel.dataset.full = f.full ? 'true' : 'false';
  }, [viewport && viewport.inset, viewport && viewport.height, viewport && viewport.top]);

  // 看卡片 / 回到逐字行：面板滚回顶部（输入框与卡片的开头都在视野里）。
  useLayoutEffect(() => {
    const scroller = rootRef.current && rootRef.current.querySelector('.sz-query__scroll');
    if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
  }, [model.cur]);

  // 换字 / 改输入后，上一次的失败状态不再适用。
  useEffect(() => {
    setAddFailed(prev => (prev && prev !== model.cur ? '' : prev));
  }, [model.cur]);

  const api = { close: () => close && close(), mode };

  const runGo = async (chars, from) => {
    setGoFailed(null);
    const cb = from === 'card' && onPractice ? () => onPractice(chars[0], api) : () => (onPick ? onPick(chars, api) : undefined);
    if (await isFailure(cb())) setGoFailed({ chars, from });
  };

  const add = () => {
    const c = model.cur;
    if (!c || !store) return;
    const result = commitAdd(store, c);
    if (result && result.ok) {
      setAddFailed(''); // 成功不提示：卡片上的按钮自己变成禁用的「已在自选的字里」（D58 / I3 P0-14）
    } else {
      setAddFailed(c);
    }
  };

  const toggle = c => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    return next;
  });

  const title = mode === 'pick' ? t('R-Q01.titlePick') : t('R-Q01.titleLookup');
  const { view } = model;

  let rows = null;
  let body = null;
  let secondary = null; // 卡片下面的次要按钮（滚动区内）
  let footer = null; // 钉在弹层底部的主操作（F5）
  if (view === 'rows') {
    rows = html`<ul class="sz-qrows" data-testid="query-rows">${model.summaries.map(s => {
      const card = predicates.card(s.char);
      return html`<${CharRow} key=${s.char} summary=${s} pinyin=${card ? card.py : ''} word=${card ? card.word : ''}
        selectable=${mode === 'pick' && s.practicable} selected=${model.chosen.includes(s.char)}
        onOpen=${c => { setCur(c); setGoFailed(null); }} onToggle=${toggle} />`;
    })}</ul>`;
  } else if (view === 'card' && model.summary) {
    const card = predicates.card(model.cur);
    const failedHere = goFailed && goFailed.from === 'card' && goFailed.chars[0] === model.cur;
    const addFailedHere = addFailed === model.cur;
    body = html`<${CharCard} summary=${model.summary} pinyin=${card ? card.py : ''} word=${card ? card.word : ''}
      strokeCount=${card ? card.strokes : 0} strokeData=${strokeData} getInk=${store ? store.getInk : null} withActions=${false} />`;
    secondary = html`<${CardSecondary} summary=${model.summary} addFailed=${addFailedHere} practiceFailed=${!!failedHere}
      canDetail=${typeof onDetail === 'function'} onAdd=${add} onDetail=${() => onDetail && onDetail(model.cur, api)} />`;
    footer = html`<div class="sz-query__foot" data-testid="query-card-foot">
      <${CardFooter} summary=${model.summary} addFailed=${addFailedHere} practiceFailed=${!!failedHere}
        onPractice=${() => runGo([model.cur], 'card')} onAdd=${add} onAddCancel=${() => setAddFailed('')}
        onPracticeCancel=${() => setGoFailed(null)} onPracticeRetry=${() => runGo([model.cur], 'card')} />
    </div>`;
  } else if (view === 'bad' && model.summary) {
    body = html`<${BadCard} summary=${model.summary} canDetail=${typeof onDetail === 'function'}
      onDetail=${() => onDetail && onDetail(model.cur, api)} />`;
  }

  const hint = view === 'hint' ? t('R-Q02.pickNote') : view === 'rows' ? t('R-Q02.lookupNote') : '';
  const back = model.multi && (view === 'card' || view === 'bad')
    ? html`<${Button} variant="text" class="sz-query__back" data-testid="query-back"
        onClick=${() => { setCur(''); setGoFailed(null); }}>${t('R-Q05.backToList', { n: model.filtered.chars.length })}</${Button}>`
    : null;

  const bar = footer || html`<${PickBar} bar=${model.bar} count=${model.chosen.length} failed=${!!(goFailed && goFailed.from === 'bar')}
    onGo=${() => runGo(model.chosen, 'bar')} onCancel=${() => setGoFailed(null)} onRetry=${() => goFailed && runGo(goFailed.chars, 'bar')} />`;

  return html`<${Sheet} title=${title} onClose=${close} active=${active && armed} testid="query-sheet">
    <div class="sz-query" ref=${rootRef} data-testid="query-body" data-mode=${mode} data-view=${view} data-cur=${model.cur || undefined}>
      <${QueryInput} inputRef=${inputRef} initial=${initialText} label=${title} placeholder=${t('R-Q01.placeholder')}
        onText=${v => { setText(v); setGoFailed(null); }} />
      <div class="sz-query__scroll" data-testid="query-scroll">
        ${model.notes.length ? html`<div class="sz-query__notes" aria-live="polite">${model.notes.map(n => html`<div class="sz-query__note"
          data-testid="query-note" data-key=${n.key}><span class="sz-query__notedot" aria-hidden="true"></span>
          <span class="sz-query__notetext">${t(n.key, n.vars)}</span></div>`)}</div>` : null}
        ${rows}
        ${hint ? html`<p class="sz-query__hint" data-testid="query-hint">${hint}</p>` : null}
        ${back}
        ${body}
        ${secondary}
      </div>
    </div>
    ${bar}
  </${Sheet}>`;
}
