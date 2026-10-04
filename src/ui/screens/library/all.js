// 「有记录的字」完整页（02 M3-4；04 R-A01–R-A04；03 P04 / P20 / P27 / P56；原型 字库墨墙屏-第十稿交接版.dc.html L85–L114、
// L367–L402；reference/K-proto-home-lib.md「有记录的字完整页」）。数据全部由 all-model.js（纯函数）从记录算。
//
// registerScreen('library-all')，params {sort?, filter?, fold?, find?}（页面自己用 nav.setParams 写回，刷新 / 返回后恢复）。
// 进入：字库首页的大数字「有记录的字 N 个字」与墙下「还有 N 个字 ›」（M3-1 LIBRARY_ROUTES.all）。
//
// 版式（原型 L85–L114）：页头「有记录的字」→ 查字框（吸顶；只在有记录的字里查，R-A03；aria「在有记录的字里查字」；
//   命中时右侧「在 {month} 月」，没有记录时框下「「X」还没有记录。」）→ 排序三键（R-A01；选了筛选后收起，R-A04）
//   → 筛选四项（R-A02；再点取消；0 个的变灰，R-A04）→ 图例（与字库首页同一套，wall.js）→ 说明句 → 分组（组名 + 字数，
//   格子与墨墙同一画法；拼音排序时每格下标拼音，R-A04）→ 收起的月份（点开）→「练这些字」（R-A02）。
// 查字命中：排序 / 筛选 / 图例 / 说明都收起，只显示命中的字所在的月份，这一格描一圈（R-A03）。
// 按月排：默认展开最近两个月；点展开的月份标题收起，点下面收起的月份行展开（R-A01）。
// 分批画（01 §10「一次 ≤ 72 格」、原型 budget=72）：先画前 72 格，其余逐帧补上（300 字首屏 < 200ms）。
//
// 去处：点格子 → 单字详情（'detail' {char}，M3-6）；「练这些字」：自选了还没写 → session startPicked(keys,
//   {source:{view:'allWritten'}})（旧 B 没写完由它弹 S02；写入失败留在本页、筛选不变，说明 X-ALL.startFailed，可再点）；
//   写错过 / 快忘了 → 推入对应清单页（'library-list' {kind}，M3-2；原型 filterGo）。目标屏没注册时不跳转（console.warn）。
// 只读 store；本页不写入。文案只取 copy/。
//
// data-testid（前缀 all-）：all-screen（页面）、all-body（data-sort / data-filter / data-find-mode / data-found / data-total /
//   data-rendered / data-recorded / data-cols）、all-find（输入框）、all-find-where、all-find-miss、all-sorts、all-sort（data-key、
//   aria-pressed）、all-chips、all-chip（data-key / data-n / aria-pressed / disabled）、all-note、all-group（data-key / data-month）、
//   all-group-head（展开的月份标题是按钮，aria-expanded=true；其余是文字）、all-group-name、all-group-count、all-cells、
//   all-cell（data-char / data-kind / data-tone / data-hit / data-py）、all-cell-py、all-closed、all-month（data-month，
//   aria-expanded=false）、all-go（data-kind=start|list）、all-start-fail、all-empty。图例沿用 wall.js 的 library-legend*。

import { html, useEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { localDay } from '../../../core/dates.js';
import { cardForKey, isPracticable } from '../../../data/deck.js';
import { startPicked } from '../session/index.js';
import { Glyph, Legend, cellLabel, toneColor, useWallLayout } from './wall.js';
import {
  allModel, normalizeFilter, normalizeFold, normalizeSort, takeCells, toggleFold, RENDER_BATCH,
} from './all-model.js';

export const ALL_SCREEN = 'library-all';
export const ALL_SOURCE_VIEW = 'allWritten';

/** 打开本页（字库首页用 LIBRARY_ROUTES.all 推同一个屏名）。 */
export function openAllWritten(params = {}) {
  nav.push(ALL_SCREEN, params);
}

// ---------------------------------------------------------------- 样式

injectStyles('library-all', `
.sz-all{display:flex;flex-direction:column;gap:${T.s4}}
.sz-all__findbar{position:sticky;top:calc(-1 * ${T.s4});z-index:2;margin:calc(-1 * ${T.s4}) calc(-1 * ${T.gutter}) 0;padding:${T.s4} ${T.gutter} ${T.s1};background:${T.paper};display:flex;
  flex-direction:column;gap:${T.s2}}
.sz-all__find{position:relative;min-height:calc(50px * ${T.k});box-sizing:border-box;border-radius:${T.rCtl};background:${T.field};
  display:flex;align-items:center;gap:${T.s3};padding:0 ${T.s4}}
.sz-all__find--hit{background:${T.sheet};box-shadow:inset 0 0 0 1px ${T.ink2}}
.sz-all__find svg{flex:none}
.sz-all__input{flex:1;min-width:0;border:0;background:transparent;outline:none;padding:0;font-family:${T.kai};
  font-size:${T.fs22};line-height:${T.lh22};color:${T.ink1}}
.sz-all__input::placeholder{font-family:${T.hei};font-size:${T.fs17};color:${T.ink2}}
.sz-all__where{flex:none;font-size:${T.fs15};color:${T.ink2};white-space:nowrap}
.sz-all__miss{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-all__sorts{display:flex;padding:3px;border-radius:${T.rCtl};background:${T.field}}
.sz-all__sort.sz-btn{flex:1;min-height:44px;box-sizing:border-box;border-radius:calc(${T.rCtl} - 3px);display:grid;place-items:center;
  font-size:${T.fs15};color:${T.ink2}}
.sz-all__sort.sz-btn[aria-pressed="true"]{background:${T.sheet};color:${T.ink1}}
.sz-all__chips{display:flex;flex-wrap:wrap;gap:${T.s2}}
.sz-all__chip.sz-btn{min-height:44px;box-sizing:border-box;padding:0 ${T.s4};border-radius:${T.rCtl};box-shadow:inset 0 0 0 .5px ${T.ink4};
  display:inline-flex;align-items:center;gap:${T.s2};font-size:${T.fs15};color:${T.ink2};white-space:nowrap}
.sz-all__chip.sz-btn[aria-pressed="true"]{background:${T.field};box-shadow:inset 0 0 0 1px ${T.ink1};color:${T.ink1}}
.sz-all__chip.sz-btn[disabled]{color:${T.ink4};box-shadow:inset 0 0 0 .5px ${T.line}}
.sz-all__chip.sz-btn[disabled] .sz-lib__dot{opacity:.45}
.sz-all__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-all__group{display:flex;flex-direction:column;gap:${T.s2};margin-top:${T.s1}}
.sz-all__head{display:flex;justify-content:space-between;align-items:baseline;gap:${T.s3};width:100%;text-align:left;min-height:28px}
.sz-all__head.sz-btn{min-height:44px}
.sz-all__name{display:flex;align-items:center;gap:${T.s2};font-family:${T.song};font-size:${T.fs22};
  line-height:${T.lh22};font-weight:500;color:${T.ink2}}
.sz-all__count{font-size:${T.fs15};color:${T.ink2};font-variant-numeric:tabular-nums;white-space:nowrap}
.sz-all__swatch{flex:none;display:block;width:20px;height:7px;overflow:visible}
.sz-all__swatch path{fill:${T.ink1}}
.sz-all__grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));container-type:inline-size}
.sz-all__cell.sz-btn{position:relative;display:flex;flex-direction:column;align-items:stretch;min-width:0;min-height:0;padding:0;border-radius:${T.rWork};
  background:transparent}
.sz-all__cell.sz-btn:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-all__sq{position:relative;display:block;width:100%;aspect-ratio:1/1;overflow:hidden}
.sz-all__ring{position:absolute;inset:1px;border-radius:${T.rWork};box-shadow:inset 0 0 0 2px ${T.ink1};pointer-events:none}
.sz-all__py{display:block;margin:-2px 0 4px;text-align:center;font-size:${T.fs11};line-height:${T.lh11};
  color:${T.ink2};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sz-all__closed{margin:${T.s2} 0 0;padding:0;list-style:none;display:flex;flex-direction:column;border-top:.5px solid ${T.line}}
.sz-all__month.sz-btn{width:100%;min-height:52px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border-bottom:.5px solid ${T.line};text-align:left}
.sz-all__mname{font-size:${T.fs17};color:${T.ink1}}
.sz-all__mcount{font-size:${T.fs15};color:${T.ink2};white-space:nowrap;font-variant-numeric:tabular-nums}
.sz-all__go.sz-btn{align-self:flex-start}
.sz-all__fail{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink1}}
.sz-all__empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${T.s2};text-align:center;
  padding:${T.s8} ${T.s4} ${T.s6}}
.sz-all__emptytitle{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;
  color:${T.ink1}}
.sz-all__emptytext{margin:0;max-width:calc(250px * ${T.k});font-size:${T.fs15};line-height:${T.lh15};
  color:${T.ink2};text-wrap:pretty}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const SEARCH_ICON = () => html`<svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="var(--ink2)" stroke-width="1.6"
  stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6"></circle><path d="m14.5 14.5 4 4"></path></svg>`;

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

function isTopEntry(entryId) {
  const router = getRouter();
  if (!router || !entryId) return false;
  const snap = router.getState();
  return !!(snap && snap.top && snap.top.id === entryId);
}

/** 拼音（P20 policy.pinyinSource='seed-py'：题库卡片的 py；题库外的字没有）。 */
function pyOfChar(char) {
  const card = cardForKey(`base:${char}`);
  return card && typeof card.py === 'string' ? card.py : '';
}

function goScreen(name, params) {
  if (!getScreen(name)) {
    console.warn(`[shizi] library-all: screen "${name}" is not registered yet`);
    return false;
  }
  nav.push(name, params);
  return true;
}

function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
}

// ---------------------------------------------------------------- 组件

/** 图例里的一笔短横（与 wall.js Swatch 同一笔；多久没写的组名前）。 */
function Swatch({ tone }) {
  return html`<svg class="sz-all__swatch" viewBox="0 0 40 14" aria-hidden="true" focusable="false">
    <path d="M1.5 7.6C6 5.2 13 4.6 22 4.9c6 .2 11 .5 16.2 1.3.6.1.6 1.4 0 1.6C32 9.6 22 9.3 13 9.5 8 9.6 4.4 10.2 2.2 10.4.6 10.5.3 8.3 1.5 7.6Z"
      style=${{ fill: toneColor(tone) }}></path>
  </svg>`;
}

function Cell({ cell, getInk, onOpen }) {
  return html`<${Button} variant="plain" class="sz-all__cell" data-testid="all-cell" data-char=${cell.char} data-kind=${cell.kind}
    data-tone=${cell.tone == null ? '' : cell.tone} data-hit=${cell.hit ? 'true' : 'false'} data-py=${cell.py == null ? null : cell.py}
    aria-label=${cellLabel(cell)} onClick=${() => onOpen(cell.char)}>
    <span class="sz-all__sq"><${Glyph} cell=${cell} getInk=${getInk} />${cell.hit ? html`<span class="sz-all__ring" aria-hidden="true"></span>` : null}</span>
    ${cell.py != null ? html`<span class="sz-all__py" data-testid="all-cell-py" aria-hidden="true">${cell.py}</span>` : null}
  </${Button}>`;
}

function Group({ group, cols, getInk, onOpen, onFold }) {
  const title = html`<span class="sz-all__name" data-testid="all-group-name">${group.tone != null ? html`<${Swatch} tone=${group.tone} />` : null}${group.name}</span>
    <span class="sz-all__count" data-testid="all-group-count">${group.count}</span>`;
  let head = null;
  if (group.head) {
    head = group.fold === 'open'
      ? html`<${Button} variant="plain" class="sz-all__head" data-testid="all-group-head" aria-expanded="true"
          onClick=${() => onFold(group.month, true)}>${title}</${Button}>`
      : html`<div class="sz-all__head" data-testid="all-group-head">${title}</div>`;
  }
  return html`<section class="sz-all__group" data-testid="all-group" data-key=${group.key} data-month=${group.month || null}>
    ${head}
    <div class="sz-all__grid" data-testid="all-cells" role="group" aria-label=${group.name || null} style=${{ '--cols': cols }}>
      ${group.cells.map(cell => html`<${Cell} key=${cell.char} cell=${cell} getInk=${getInk} onOpen=${onOpen} />`)}
    </div>
  </section>`;
}

function AllScreen({ params, entry }) {
  const p = params || {};
  const entryId = entry && entry.id;
  const state = useStoreState();
  const { large: compact, width } = useWallLayout();
  const [sort, setSort] = useState(() => normalizeSort(p.sort));
  const [filter, setFilter] = useState(() => normalizeFilter(p.filter));
  const [fold, setFold] = useState(() => normalizeFold(p.fold));
  const [find, setFind] = useState(() => (typeof p.find === 'string' ? p.find : ''));
  const [failed, setFailed] = useState(false);
  const today = localDay(envNow());

  const model = useMemo(() => allModel(state, {
    today, policy: defaultPolicy, compact, width, sort, filter, fold, find, pyOf: pyOfChar, practicable: isPracticable,
  }), [state, today, compact, width, sort, filter, fold, find]);

  // 分批画：视图一变就从 72 格重新开始，之后逐帧补 72 格（01 §10）。
  const viewKey = `${model.sort}|${model.filter}|${find}|${JSON.stringify(fold)}`;
  const [batch, setBatch] = useState({ key: viewKey, n: RENDER_BATCH });
  const limit = batch.key === viewKey ? batch.n : RENDER_BATCH;
  useEffect(() => {
    if (limit >= model.total) return undefined;
    return nextFrame(() => setBatch({ key: viewKey, n: limit + RENDER_BATCH }));
  }, [viewKey, limit, model.total]);
  const shown = useMemo(() => takeCells(model.groups, limit), [model.groups, limit]);
  const rendered = Math.min(limit, model.total);

  // 视图参数写回 params（本页在顶层时），刷新 / 从详情返回都能恢复。
  useEffect(() => {
    if (!isTopEntry(entryId)) return;
    const next = { sort, filter, fold, find };
    const cur = { sort: normalizeSort(p.sort), filter: normalizeFilter(p.filter), fold: normalizeFold(p.fold), find: typeof p.find === 'string' ? p.find : '' };
    if (JSON.stringify(next) !== JSON.stringify(cur)) nav.setParams(next);
  });

  const getInk = useMemo(() => record => {
    try {
      return getStore().getInk(record);
    } catch (error) {
      return null;
    }
  }, [state]);

  const openDetail = char => goScreen('detail', { char });
  const onSort = key => {
    setFailed(false);
    setSort(key);
  };
  const onChip = key => {
    setFailed(false);
    setFilter(cur => (cur === key ? '' : key));
  };
  const onFold = (month, open) => setFold(cur => toggleFold(cur, month, open));
  const onGo = () => {
    const go = model.go;
    if (!go) return;
    if (go.kind === 'list') {
      goScreen('library-list', { kind: go.listKind });
      return;
    }
    const r = startPicked(go.keys, { source: { view: ALL_SOURCE_VIEW } });
    if (!r || !r.ok) {
      setFailed(true);
      markStateChange();
      return;
    }
    setFailed(false);
  };

  const title = t('X-LIBHOME.recordedLabel');
  if (model.empty) {
    return html`<${Page} title=${title} testid="all-screen">
      <div class="sz-lib sz-all__empty" data-testid="all-empty">
        <p class="sz-all__emptytitle">${t('X-LIBHOME.emptyTitle')}</p>
        <p class="sz-all__emptytext">${t('R-L05.empty')}</p>
      </div>
    </${Page}>`;
  }

  const f = model.find;
  return html`<${Page} title=${title} testid="all-screen">
    <div class="sz-lib sz-all" data-testid="all-body" data-sort=${model.sort} data-filter=${model.filter} data-find-mode=${f.mode}
      data-found=${f.found ? 'true' : 'false'} data-total=${model.total} data-rendered=${rendered} data-recorded=${model.recorded}
      data-cols=${model.cols}>
      <div class="sz-all__findbar">
        <label class=${`sz-all__find${f.found ? ' sz-all__find--hit' : ''}`}>
          ${SEARCH_ICON()}
          <input class="sz-all__input" type="search" data-testid="all-find" value=${find} aria-label=${t('R-A03.searchAria')}
            placeholder=${t('R-Q01.titleLookup')} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck=${false}
            enterkeyhint="search" onInput=${e => { setFailed(false); setFind(e.currentTarget.value); }} />
          ${f.where ? html`<span class="sz-all__where" data-testid="all-find-where" aria-live="polite">${f.where}</span>` : null}
        </label>
        ${f.miss ? html`<p class="sz-all__miss" data-testid="all-find-miss" aria-live="polite">${f.miss}</p>` : null}
      </div>
      ${model.showSort
        ? html`<div class="sz-all__sorts" data-testid="all-sorts" role="group">
            ${model.sorts.map(s => html`<${Button} key=${s.key} variant="plain" class="sz-all__sort" data-testid="all-sort" data-key=${s.key}
              aria-pressed=${s.active ? 'true' : 'false'} rapid=${true} onClick=${() => onSort(s.key)}>${s.label}</${Button}>`)}
          </div>`
        : null}
      ${model.showChips
        ? html`<div class="sz-all__chips" data-testid="all-chips">
            ${model.chips.map(c => html`<${Button} key=${c.key} variant="plain" class="sz-all__chip" data-testid="all-chip" data-key=${c.key}
              data-n=${c.n} aria-pressed=${c.active ? 'true' : 'false'} disabled=${c.disabled} rapid=${true}
              onClick=${() => onChip(c.key)}>${c.key === 'wrong' ? html`<span class="sz-lib__dot" aria-hidden="true"></span>` : null}${c.label}</${Button}>`)}
          </div>`
        : null}
      ${model.showLegend ? html`<${Legend} />` : null}
      ${model.note ? html`<p class="sz-all__note" data-testid="all-note">${model.note}</p>` : null}
      ${shown.map(g => html`<${Group} key=${g.key} group=${g} cols=${model.cols} getInk=${getInk} onOpen=${openDetail} onFold=${onFold} />`)}
      ${model.closed.length
        ? html`<ul class="sz-all__closed" data-testid="all-closed">
            ${model.closed.map(m => html`<li key=${m.month}><${Button} variant="plain" class="sz-all__month" data-testid="all-month"
              data-month=${m.month} aria-expanded="false" onClick=${() => onFold(m.month, false)}>
              <span class="sz-all__mname">${m.name}</span><span class="sz-all__mcount">${t('X-ALL.closedCount', { n: m.count })}</span>
            </${Button}></li>`)}
          </ul>`
        : null}
      ${failed ? html`<p class="sz-all__fail" data-testid="all-start-fail" aria-live="polite">${t('X-ALL.startFailed')}</p>` : null}
      ${model.go
        ? html`<${Button} variant="text" class="sz-all__go" data-testid="all-go" data-kind=${model.go.kind}
            onClick=${onGo}>${t('R-A02.practiceThese')}</${Button}>`
        : null}
    </div>
  </${Page}>`;
}

registerScreen(ALL_SCREEN, AllScreen, { label: t('X-LIBHOME.recordedLabel') });
