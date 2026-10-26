// 写错过 / 快忘了清单页（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02 / S05；03 P04 / P31；
// 原型 字库墨墙屏-第十稿交接版 L116–L136（结构）、L404–L414（数据与文案）；reference/K-proto-home-lib.md「写错过 / 快忘了清单」）。
//
// registerScreen('library-list')，params {kind:'wrong'|'forget'|'due'|'shaky'|'known'|'skipped', off?:string[]}。进入：openList(kind)（字库首页卡片、
// 「现在没有要写的字」页的「看写错过的字 ›」）。
//
// 版式：页头「写错过 / 快忘了」+ 右侧「全选 / 全不选」（S06）；正文标题「先练这 {N} 个」+ 顶部说明（R-E04）；逐行
// [圆圈勾选 44×44] [标准字大字] [词语（目标字加粗）/ 小字] [那一次的笔迹小图（写错过下标「写错那次」）] [›]（R-E03）；
// 列表下说明（R-E03）；底栏「选了 N 个字 · 写完会回到这里。」+ 主按钮（R-E02：≥2「练这些字」/ 1「练这个字」/
// 0「先选一个字」disabled + aria-disabled，Z02）。空态：虚框装饰字 + 标题 + 一句（R-E04）。
//
// 勾选（S06、04 §5.1-13；已决定 D36 / P113）：默认只选最该练的前 5 个字（标题「先练这 5 个」），其余收在
//   「其余 N 个字 ›」下展开；点圆圈选 / 取消；勾选状态存在本页（自己选过才写进 params.sel，刷新后恢复；null = 默认）。
//   从写字页返回（组没写完）→ 保留勾选；从本页开的组结束了（写完 / 结束这组 / S02 结束那组）→ 回来回到默认。
//   清单本身由记录实时算（R-E01），写完回来自动重算。
// 开组：一律走 session/index.js 的 startPicked(chars, {source:{view:'wrongList'|'forgetList'}})（旧 B 没写完时由它弹 S02）；
//   失败（写入失败）留在本页、勾选不变，底栏上方说明 X-LIST.startFailed，主按钮可再点（R-G04）。
//   结果页的离开按钮「回到写错过 / 回到快忘了」按来源 nav.back() 回到本页（R-R06、S05）。
// 点行看记录：单字详情（M3-6）。setListActions({detail}) 注册去处，或已注册名为 'detail' 的页面（params {char}）；
//   都没有时行不可点（不放点了没反应的按钮）。
// 「现在没有要写的字」页的「看写错过的字 ›」由本模块 setNoneActions({wrongList}) 注册（把那一页换成写错过清单）。
//
// 笔迹小图：该记录存下的墨迹（features.perRecordInk，P31 过渡关闭）→ 本页面会话里刚判断时记下的笔画 → 没有时写
//   「没有笔迹」（10.12；R-D07.noInkLabel）。
//
// 规则：只读 store；不写入（开组的写入在 core/session-start 里经 store.commit）；文案只取 copy/。
//
// data-testid：list-screen（页面）、list-body（data-kind、data-selected-count）、list-toggle-all、list-head、list-top、list-rows、
//   list-row（data-char、data-selectable、data-selected、data-record）、list-row-select、list-row-open（可点时）/
//   list-row-main（不可点时）、list-row-char、list-row-word、list-row-meta、list-row-thumb、list-row-thumb-ink、
//   list-row-thumb-noink、list-row-thumb-caption、list-rest-toggle（其余行的展开 / 收起，data-open）、list-note、list-hint、list-go、list-start-fail、
//   list-empty、list-empty-glyph、list-empty-title、list-empty-body；list-row 另有 data-group（top / rest）。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { FailBlock } from '../../components/FailBlock.js';
import { LiveRegion } from '../../components/LiveRegion.js';
import { Icons } from '../../components/icons.js';
import { Chevron } from '../../components/Chevron.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t, tRef } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { cardForKey, isPracticable } from '../../../data/deck.js';
import { localDay } from '../../../core/dates.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { InkMini, recalledInk } from '../write/compare.js';
import { startPicked } from '../session/index.js';
import { setNoneActions } from '../session/none.js';
import {
  groupFromHereActive, listModel, listRowMetaParts, normalizeKind, normalizeSel, sameSel, selectAllSel, selectNoneSel, toggleSel,
} from '../../../session/views/library-list.js';
import { setLibrarySubActions, setLibrarySubMeasure } from '../../../session/api/library-sub.js';
import { contentWidth, textLineStarts } from './web-metrics.js';

export const LIST_SCREEN = 'library-list';

// ---------------------------------------------------------------- 去处注册

const actions = { detail: null };

/** 注册「点这一行看记录」的去处（M3-6 单字详情）：detail(char, {cardKey, kind})；传 null 取消。 */
export function setListActions(next) {
  if (!next || typeof next !== 'object') return;
  if ('detail' in next) actions.detail = typeof next.detail === 'function' ? next.detail : null;
}

/** 看记录的去处：注册的 detail → 名为 'detail' 的页面（push {char}）→ 没有（行不可点）。 */
function detailOpener() {
  if (actions.detail) return actions.detail;
  if (getScreen('detail')) return char => nav.push('detail', { char });
  return null;
}

/** 打开清单页。 */
export function openList(kind) {
  nav.push(LIST_SCREEN, { kind: normalizeKind(kind) });
}

/**
 * 「练这些字」一次点击直接开始一组（I3 · P0-05 / P0-06，规范 B3）：不经清单页，选的就是清单页默认勾选的那些字
 * （最该练的前 N 个能练的字，N = 每组字数，D36 / P113 / D66 ⑬）。来源记为清单（写完「回到写错过 / 快忘了」就是回来源页）。
 * @returns {object} startPicked 的结果；清单里一个能练的字都没有时 {ok:false, error:{kind:'invalid'}}
 */
export function startListDefault(kind, { state = null, today = localDay(envNow()), start = startPicked, cardFor = cardForKey, practicable = isPracticable } = {}) {
  let current = state;
  if (!current) {
    const store = storeOrNull();
    current = store ? store.getState() : null;
  }
  const model = listModel(current, { kind, sel: null, today, policy: defaultPolicy, cardFor, practicable });
  if (!model.selectedKeys.length) return { ok: false, error: { kind: 'invalid' } };
  return start(model.selectedKeys, { source: { view: model.view } });
}

// 「现在没有要写的字」页的次入口（R-H11 noChars「看写错过的字 ›」）：把那一页换成写错过清单。
setNoneActions({ wrongList: () => nav.replace(LIST_SCREEN, { kind: 'due' }) }); // r7-C1 D61 Q5：「写错过」并入「该复习了」

// ---------------------------------------------------------------- 样式

injectStyles('library-list', `
.sz-list{display:flex;flex-direction:column;gap:${T.s6}}
.sz-list__intro{display:flex;flex-direction:column;gap:8px}
.sz-list__head{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1}}
.sz-list__top{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-list__rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;border-top:1px solid ${T.line}}
.sz-lrow{min-height:84px;box-sizing:border-box;display:flex;align-items:center;gap:12px;border-bottom:1px solid ${T.line}}
.sz-lrow__sel{flex:none;width:44px;height:44px;margin:0 -8px 0 -9px;display:grid;place-items:center}
.sz-lrow__dot{width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:1.5px solid ${T.ink4};display:grid;place-items:center}
.sz-lrow__sel[aria-checked="true"] .sz-lrow__dot{border:0;background:${T.ink1}}
.sz-lrow__gap{flex:none;width:27px}
.sz-lrow__open{flex:1;min-width:0;min-height:84px;box-sizing:border-box;padding:10px 0;display:flex;align-items:center;gap:12px;
  text-align:left;color:inherit}
.sz-lrow__char{flex:none;width:calc(44px * ${T.k});height:calc(44px * ${T.k});color:${T.ink1}} /* 标准字形用轮廓（P1-E2）：44pt 方框，字面 ≈ 34pt */
.sz-lrow__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:${T.s1}}
.sz-lrow__word{font-family:${T.kai};font-size:${T.fs22};line-height:${T.lh22};color:${T.ink2}}
.sz-lrow__word b{font-weight:700;color:${T.ink1}}
.sz-lrow__meta{display:block;font-size:${T.fs15};line-height:${T.lh15};
  color:${T.ink2};font-variant-numeric:tabular-nums}
/* 每段整段换行（间隔号在前一段末尾，不落行首，H1）；M6-2：一段比这一栏还宽时（320 宽 + 大字）段内再换行，不越出这一栏压到右边的小图说明 */
.sz-lrow__meta span{display:inline-block;max-width:100%}
.sz-lrow__thumbcol{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px}
.sz-lrow__thumb{position:relative;width:44px;height:44px;box-sizing:border-box;border:${T.frameW} solid ${T.frame};
  ${TEX};display:grid;place-items:center;overflow:hidden}
.sz-lrow__thumb .sz-compare__card{position:absolute;inset:0;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
.sz-lrow__noink{max-width:2.4em;font-size:${T.fs11};line-height:${T.lh11};color:${T.ink3};text-align:center;overflow-wrap:anywhere}
.sz-lrow__cap{font-size:${T.fs11};line-height:${T.lh11};color:${T.ink3};white-space:nowrap}
.sz-list__note{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-list__hint{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-list__toggle{min-height:44px;padding:0 4px;margin-right:-4px;font-size:${T.fs15};color:${T.ink2}} /* 页头尾端：字形外缘落在 20pt 线（H1） */
.sz-list__rest{align-self:flex-start;min-height:44px;padding:0 4px;margin:-12px 0 0 -4px;font-size:${T.fs15};color:${T.ink2}}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK = () => Icons.check({ color: 'var(--paper)' });

// ---------------------------------------------------------------- 状态

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(() => {
    const st = storeOrNull();
    return st ? st.getState() : null;
  });
  useEffect(() => {
    const st = storeOrNull();
    if (!st) return undefined;
    setState(st.getState());
    return st.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 某条记录的笔迹：存下的墨迹 → 本页面会话里刚判断时记下的笔画 → 没有。 */
function inkOf(store, record) {
  if (!record) return null;
  if (store) {
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
  const raw = recalledInk(record.id);
  return raw && raw.length ? { points: null, strokes: raw } : null;
}

function isTopEntry(entryId) {
  const router = getRouter();
  if (!router || !entryId) return false;
  const snap = router.getState();
  return !!(snap && snap.top && snap.top.id === entryId);
}

// ---------------------------------------------------------------- 组件

function Thumb({ row, ink }) {
  const has = !!(ink && ((ink.points && ink.points.length) || (ink.strokes && ink.strokes.length)));
  return html`<span class="sz-lrow__thumbcol" aria-hidden="true">
    <span class="sz-lrow__thumb" data-testid="list-row-thumb">
      ${has
        ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="list-row-thumb-ink" label=${row.char} />`
        : html`<span class="sz-lrow__noink" data-testid="list-row-thumb-noink">${t('R-D07.noInkLabel')}</span>`}
    </span>
    ${row.thumbCaption ? html`<span class="sz-lrow__cap" data-testid="list-row-thumb-caption">${tRef(row.thumbCaption)}</span>` : null}
  </span>`;
}

function Row({ row, ink, onToggle, onDetail }) {
  const sel = row.selectable
    ? html`<${Button} variant="plain" class="sz-lrow__sel" role="checkbox" aria-checked=${row.selected ? 'true' : 'false'}
        rapid=${true} aria-label=${t(row.selected ? 'X-QUERY.unselectAria' : 'X-QUERY.selectAria', { char: row.char })}
        data-testid="list-row-select" onClick=${() => onToggle(row.char)}>
        <span class="sz-lrow__dot" aria-hidden="true">${row.selected ? CHECK() : null}</span>
      </${Button}>`
    : html`<span class="sz-lrow__gap" aria-hidden="true"></span>`;
  const w = row.word;
  const body = html`
    <span class="sz-lrow__char" data-testid="list-row-char"><${PracticeGlyph} char=${row.char} face=${0.7} /></span>
    <span class="sz-lrow__main">
      ${w.has ? html`<span class="sz-lrow__word" data-testid="list-row-word">${w.pre}${w.tg ? html`<b>${w.tg}</b>` : null}${w.post}</span>` : null}
      <span class="sz-lrow__meta" data-testid="list-row-meta">${listRowMetaParts(tRef(row.meta)).map((part, i) => html`${i ? ' ' : ''}<span key=${i}>${part}</span>`)}</span>
    </span>
    ${row.noThumb ? null : html`<${Thumb} row=${row} ink=${ink} />`}`;
  return html`<li class="sz-lrow" data-testid="list-row" data-char=${row.char} data-selectable=${row.selectable ? 'true' : 'false'}
    data-selected=${row.selected ? 'true' : 'false'} data-group=${row.group} data-record=${row.recordId}>
    ${sel}
    ${onDetail
      ? html`<${Button} variant="plain" class="sz-lrow__open" data-testid="list-row-open" onClick=${() => onDetail(row)}>
          ${body}<${Chevron} />
        </${Button}>`
      : html`<div class="sz-lrow__open" data-testid="list-row-main">${body}</div>`}
  </li>`;
}

function ListScreen({ params, entry }) {
  const kind = normalizeKind(params && params.kind);
  const entryId = entry && entry.id;
  const state = useStoreState();
  const store = storeOrNull();
  const [sel, setSel] = useState(() => normalizeSel(params && params.sel)); // null = 默认（最该练的前 5 个）
  const [failed, setFailed] = useState(false);

  const today = localDay(envNow());
  const model = listModel(state, {
    kind, sel, today, policy: defaultPolicy, cardFor: cardForKey, practicable: isPracticable,
  });
  // 其余行默认折叠；已经有被选中的「其余」行时（刷新恢复 / 全选）直接展开，免得选了看不见。
  const [restOpen, setRestOpen] = useState(() => model.rows.some(r => r.group === 'rest' && r.selected));

  // 从本页开的组结束了 → 重新全选（R-E02「写完回来重新全选」；没写完返回保留勾选，S06）。
  const mine = groupFromHereActive(state, model.view);
  const prevMine = useRef(mine);
  useEffect(() => {
    if (prevMine.current && !mine) {
      setSel(null);
      setRestOpen(false);
    }
    prevMine.current = mine;
  }, [mine]);

  // 自己选过的勾选写进 params（本页在顶层时），刷新 / 从写字页刷新后返回都能恢复；默认不写（params.sel 缺省）。
  useEffect(() => {
    if (!isTopEntry(entryId)) return;
    if (!sameSel(params && params.sel, sel)) nav.setParams({ sel });
  });

  const defaultChars = model.rows.filter(r => r.group === 'top' && r.selectable).map(r => r.char);
  const toggle = char => {
    setFailed(false);
    setSel(cur => toggleSel(cur === null ? defaultChars : cur, char));
  };
  const toggleAll = () => {
    setFailed(false);
    if (model.allSelected) {
      setSel(selectNoneSel());
    } else {
      setSel(selectAllSel(model));
      setRestOpen(true);
    }
  };
  const start = () => {
    const keys = model.selectedKeys;
    if (!keys.length) return;
    const r = startListKeys(keys, model.view);
    if (!r || !r.ok) {
      setFailed(true);
      markStateChange();
      return;
    }
    setFailed(false);
  };
  const open = detailOpener();
  const onDetail = open ? row => open(row.char, { cardKey: row.cardKey, kind }) : null;

  if (model.empty) {
    return html`<${Page} title=${tRef(model.title)} testid="list-screen">
      ${EmptyState({ title: tRef(model.emptyTitle), body: tRef(model.emptyBody), glyph: tRef(model.emptyGlyph), attrs: { 'data-kind': kind },
        testids: { root: 'list-empty', cell: 'list-empty-glyph', title: 'list-empty-title', body: 'list-empty-body' } })}
    </${Page}>`;
  }

  const shown = restOpen ? model.rows : model.rows.filter(r => r.group === 'top');
  const trailing = model.selectableCount > 0
    ? html`<${Button} variant="plain" class="sz-list__toggle" data-testid="list-toggle-all" rapid=${true}
        onClick=${toggleAll}>${tRef(model.toggleAllLabel)}</${Button}>`
    : null;
  // 开组写入失败：底栏就地三段式（S1，components/FailBlock.js，审计 P1-32）——主按钮位置换成「再试一次」（同一个 list-go），上方「先不开始」
  const footer = failed
    ? html`${FailBlock({ layout: 'foot', testid: 'list-start-failure', noteTestid: 'list-start-fail', retryTestid: 'list-go', cancelTestid: 'list-start-cancel', text: t('X-LIST.startFailed'), cancelLabel: t('X-LIST.startStay'), onCancel: () => setFailed(false), onRetry: start })}`
    : html`
    <p class="sz-list__hint" data-testid="list-hint">${tRef(model.hint)}</p>
    <${LiveRegion} text=${tRef(model.button.label)} testid="list-go-live" />
    <${Button} variant="primary" data-testid="list-go" disabled=${model.button.disabled} onClick=${start}>${tRef(model.button.label)}</${Button}>`;
  return html`<${Page} title=${tRef(model.title)} trailing=${trailing} footer=${footer} testid="list-screen">
    <div class="sz-list" data-testid="list-body" data-kind=${kind} data-empty="false" data-selected-count=${model.selectedCount}>
      <div class="sz-list__intro">
        <h2 class="sz-list__head" data-testid="list-head">${tRef(model.head)}</h2>
        <p class="sz-list__top" data-testid="list-top">${tRef(model.top)}</p>
      </div>
      <ul class="sz-list__rows" data-testid="list-rows">
        ${shown.map(row => html`<${Row} key=${row.char} row=${row} ink=${inkOf(store, row.record)}
          onToggle=${toggle} onDetail=${onDetail} />`)}
      </ul>
      ${model.restCount > 0
        ? html`<${Button} variant="plain" class="sz-list__rest" data-testid="list-rest-toggle" data-open=${restOpen ? 'true' : 'false'}
            aria-expanded=${restOpen ? 'true' : 'false'} onClick=${() => setRestOpen(open => !open)}>${tRef(restOpen ? model.restHideLabel : model.restLabel)}</${Button}>`
        : null}
      <p class="sz-list__note" data-testid="list-note">${tRef(model.note)}</p>
    </div>
  </${Page}>`;
}

/**
 * 开一组（清单页「练这些字」）：网页路径与 App API 路径调的是**同一个函数**（B3.8 契约）。
 * @param {string[]} keys 选中的字（cardKey）
 * @param {string} view 来源视图（wrongList / forgetList / dueList …；结果页的离开按钮按它回到本页）
 */
export function startListKeys(keys, view) {
  return startPicked(keys, { source: { view } });
}

// 原生页（ShiziScreen_library_list）走 App API：同一组函数对象，网页路径 == API 路径。
setLibrarySubActions({
  startList: ({ keys, view } = {}) => startListKeys(keys || [], view),
});

/**
 * 网页量测（B3.8）：原生这一页的说明句是 text-wrap: pretty 的段落（网页 WebKit 按整段均衡各行长度，
 * 原生 TextKit 没有这个规则）——网页这边用同一组 CSS 量出每一行从第几个字开始，随 view.library-list
 * 的回包信封（metrics）交给原生。量法见 ./web-metrics.js。
 */
setLibrarySubMeasure({
  list: (view) => {
    const w = contentWidth();
    if (!w) return null;
    const line = (text, cls, wrapClass) => (text ? textLineStarts(text, { wrapClass, cls }, w) : null);
    return {
      top: line(tRef(view.top), 'sz-list__top', 'sz-list'),
      hint: line(tRef(view.hint), 'sz-list__hint', 'sz-list'),
      note: line(tRef(view.note), 'sz-list__note', 'sz-list'),
    };
  },
});

registerScreen(LIST_SCREEN, ListScreen, { label: t('R-E04.titleWrong'), native: true });
