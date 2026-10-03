// 写错过 / 快忘了清单页（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02 / S05；03 P04 / P31；
// 原型 字库墨墙屏-第十稿交接版 L116–L136（结构）、L404–L414（数据与文案）；reference/K-proto-home-lib.md「写错过 / 快忘了清单」）。
//
// registerScreen('library-list')，params {kind:'wrong'|'forget', off?:string[]}。进入：openList(kind)（字库首页卡片、
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
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
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
  groupFromHereActive, listModel, normalizeKind, normalizeSel, sameSel, selectAllSel, selectNoneSel, toggleSel,
} from './list-model.js';

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

// 「现在没有要写的字」页的次入口（R-H11 noChars「看写错过的字 ›」）：把那一页换成写错过清单。
setNoneActions({ wrongList: () => nav.replace(LIST_SCREEN, { kind: 'wrong' }) });

// ---------------------------------------------------------------- 样式

injectStyles('library-list', `
.sz-list{display:flex;flex-direction:column;gap:22px}
.sz-list__intro{display:flex;flex-direction:column;gap:8px}
.sz-list__head{margin:0;font-family:${T.serif};font-size:calc(26px * ${T.k});line-height:calc(34px * ${T.k});font-weight:500;
  letter-spacing:.04em;color:${T.i1}}
.sz-list__top{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-list__rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;border-top:1px solid ${T.i5}}
.sz-lrow{min-height:84px;box-sizing:border-box;display:flex;align-items:center;gap:12px;border-bottom:1px solid ${T.i5}}
.sz-lrow__sel{flex:none;width:44px;height:44px;margin:0 -8px 0 -9px;display:grid;place-items:center}
.sz-lrow__dot{width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:1.5px solid ${T.i4};display:grid;place-items:center}
.sz-lrow__sel[aria-checked="true"] .sz-lrow__dot{border:0;background:${T.i1}}
.sz-lrow__gap{flex:none;width:27px}
.sz-lrow__open{flex:1;min-width:0;min-height:84px;box-sizing:border-box;padding:10px 0;display:flex;align-items:center;gap:12px;
  text-align:left;color:inherit}
.sz-lrow__char{flex:none;width:calc(44px * ${T.k});text-align:center;font-family:var(--kai, serif);font-size:calc(36px * ${T.k});
  line-height:calc(48px * ${T.k});color:${T.i1}}
.sz-lrow__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.sz-lrow__word{font-family:var(--kai, serif);font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});color:${T.i2}}
.sz-lrow__word b{font-weight:700;color:${T.i1}}
.sz-lrow__meta{display:block;font-size:calc(14px * ${T.k});line-height:calc(20px * ${T.k});
  color:${T.i2};font-variant-numeric:tabular-nums}
/* 每段整段换行；M6-2：一段比这一栏还宽时（320 宽 + 大字）段内再换行，不越出这一栏压到右边的小图说明 */
.sz-lrow__meta span{display:inline-block;max-width:100%}
.sz-lrow__thumbcol{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px}
.sz-lrow__thumb{position:relative;width:44px;height:44px;box-sizing:border-box;border:1px solid var(--g, rgba(166,83,63,.28));
  background:${T.c};display:grid;place-items:center;overflow:hidden}
.sz-lrow__thumb .sz-compare__card{position:absolute;inset:0;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
.sz-lrow__noink{max-width:2.4em;font-size:calc(11px * ${T.k});line-height:1.2;color:${T.i3};text-align:center;overflow-wrap:anywhere}
.sz-lrow__cap{font-size:calc(11px * ${T.k});line-height:1.2;color:${T.i3};white-space:nowrap}
.sz-lrow__chev{flex:none;font-size:calc(15px * ${T.k});color:${T.i3}}
.sz-list__note{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-list__hint{margin:0;text-align:center;font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});color:${T.i3}}
.sz-list__fail{margin:0;text-align:center;font-size:calc(13px * ${T.k});line-height:1.6;color:${T.ar}}
.sz-list__toggle{min-height:44px;padding:0 4px;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-list__rest{align-self:flex-start;min-height:44px;padding:0 4px;margin-top:-12px;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-list-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;
  padding:24px 0 96px}
.sz-list-empty__glyph{width:88px;height:88px;box-sizing:border-box;border:1px dashed var(--g, rgba(166,83,63,.28));display:grid;
  place-items:center;font-family:var(--kai, serif);font-size:52px;color:${T.i4}}
.sz-list-empty__title{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});font-weight:500;
  color:${T.i1}}
.sz-list-empty__body{margin:0;max-width:290px;font-size:calc(13px * ${T.k});line-height:1.75;color:${T.i3};text-wrap:pretty}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK = () => html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--p, #F4F0E7)" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 7.2 2.6 2.6L11 4.4"></path></svg>`;

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
    ${row.thumbCaption ? html`<span class="sz-lrow__cap" data-testid="list-row-thumb-caption">${row.thumbCaption}</span>` : null}
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
    <span class="sz-lrow__char" data-testid="list-row-char">${row.char}</span>
    <span class="sz-lrow__main">
      ${w.has ? html`<span class="sz-lrow__word" data-testid="list-row-word">${w.pre}${w.tg ? html`<b>${w.tg}</b>` : null}${w.post}</span>` : null}
      <span class="sz-lrow__meta" data-testid="list-row-meta">${row.metaParts.map((part, i) => html`${i ? ' ' : ''}<span key=${i}>${i ? `· ${part}` : part}</span>`)}</span>
    </span>
    <${Thumb} row=${row} ink=${ink} />`;
  return html`<li class="sz-lrow" data-testid="list-row" data-char=${row.char} data-selectable=${row.selectable ? 'true' : 'false'}
    data-selected=${row.selected ? 'true' : 'false'} data-group=${row.group} data-record=${row.recordId}>
    ${sel}
    ${onDetail
      ? html`<${Button} variant="plain" class="sz-lrow__open" data-testid="list-row-open" onClick=${() => onDetail(row)}>
          ${body}<span class="sz-lrow__chev" aria-hidden="true">›</span>
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
    const r = startPicked(keys, { source: { view: model.view } });
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
    return html`<${Page} title=${model.title} testid="list-screen">
      <div class="sz-list-empty" data-testid="list-empty" data-kind=${kind}>
        <span class="sz-list-empty__glyph" aria-hidden="true" data-testid="list-empty-glyph">${model.emptyGlyph}</span>
        <h2 class="sz-list-empty__title" data-testid="list-empty-title">${model.emptyTitle}</h2>
        <p class="sz-list-empty__body" data-testid="list-empty-body">${model.emptyBody}</p>
      </div>
    </${Page}>`;
  }

  const shown = restOpen ? model.rows : model.rows.filter(r => r.group === 'top');
  const trailing = model.selectableCount > 0
    ? html`<${Button} variant="plain" class="sz-list__toggle" data-testid="list-toggle-all" rapid=${true}
        onClick=${toggleAll}>${model.toggleAllLabel}</${Button}>`
    : null;
  const footer = html`
    ${failed ? html`<p class="sz-list__fail" data-testid="list-start-fail" aria-live="polite">${t('X-LIST.startFailed')}</p>` : null}
    <p class="sz-list__hint" data-testid="list-hint" aria-live="polite">${model.hint}</p>
    <${Button} variant="primary" data-testid="list-go" disabled=${model.button.disabled} onClick=${start}>${model.button.label}</${Button}>`;
  return html`<${Page} title=${model.title} trailing=${trailing} footer=${footer} testid="list-screen">
    <div class="sz-list" data-testid="list-body" data-kind=${kind} data-empty="false" data-selected-count=${model.selectedCount}>
      <div class="sz-list__intro">
        <h2 class="sz-list__head" data-testid="list-head">${model.head}</h2>
        <p class="sz-list__top" data-testid="list-top">${model.top}</p>
      </div>
      <ul class="sz-list__rows" data-testid="list-rows">
        ${shown.map(row => html`<${Row} key=${row.char} row=${row} ink=${inkOf(store, row.record)}
          onToggle=${toggle} onDetail=${onDetail} />`)}
      </ul>
      ${model.restCount > 0
        ? html`<${Button} variant="plain" class="sz-list__rest" data-testid="list-rest-toggle" data-open=${restOpen ? 'true' : 'false'}
            aria-expanded=${restOpen ? 'true' : 'false'} onClick=${() => setRestOpen(open => !open)}>${restOpen ? model.restHideLabel : model.restLabel}</${Button}>`
        : null}
      <p class="sz-list__note" data-testid="list-note">${model.note}</p>
    </div>
  </${Page}>`;
}

registerScreen(LIST_SCREEN, ListScreen, { label: t('R-E04.titleWrong') });
