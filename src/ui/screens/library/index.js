// 字库 tab 根页（r7-L1，D60「字库方向四」：docs/design/library/字库方向四.html；原 02 M3-1 墨墙首页整体重做）。自注册，无中心路由表。
//
// 版式（自上而下，各状态同一个顶部；每一行都是「名称 …… 值 ›」的设置式一句话）：
//   1 大标题「字库」
//   2 搜索框（library-search；紧接大标题；占位「搜索汉字或拼音」；点开 = M3-3 查字弹层，query-entry.js LibraryQueryBox）
//   3 「练习范围 …… {库名} ›」（library-range；整行一个按钮 → 换库页 library-switch，与「我的 › 设置 › 练习范围」同一页、同一个值 settings.library）
//   4 「今日练习 …… {值} ›」+ 第二行小字（library-today，data-phase = fresh | half | done）：整行一次点击 = 首页主按钮在该状态下的同一动作
//     （home/index.js startToday（D66 ⑧：只续 / 开今天的练习，不碰自己选的那一组）：开始写字 / 继续写字 / 再写一组；数与状态取自 model.js todayPlanModel，它内部用首页自己的 homeModel 与 planDaily，不另算）。
//     进写字页的转场是 T0-6：被点的行就是 B1 的来源（root.js 捕获阶段 noteTap → paper-transition）。
//   5 小标题「已练汉字 N」（library-written，data-n）+ 右侧文字按钮「全部 ›」（library-all-open → library-all，墨墙留在那里）
//     下面三行记忆状态（library-zone，data-kind = due | shaky | known，data-n）：名称 + 数 + 至多三个样字（本人墨，墨色 wall4 / wall2 / wall1）+ ›，
//     点进区详情页（library-list，params {kind}，list.js「练这些字」）；0 个字的档只写名称与 0、墨三、不可点、不画 ›。
//     三档下面空一段（与块间距同为 26）、单独成一块：「已跳过」（D62 / D63，library-skipped-block > library-skipped；同一行模板；点过「跳过」、至今没有判断记录的字，不计入已练汉字数；点进 library-list {kind:'skipped'}）。
//   没有记录时 1–4 照常，第 5 块写「已练汉字 0」、三档都是 0（不另做空状态插画与说明句）。
//   去掉的：写错过 / 快忘了两块、页内「练这些字」、墨墙与图例说明、「还有 N 个字」。
//   AX（:root[data-ax]）：行内折行（名称与值上下排），不画样字与第二行小字；整页不滚动、不重叠。
// 文案全部在 copy/library.js 的 X-LIBFOUR.*（措辞由负责人最后统一改，所以集中在这一组键里）。
// 数据全部从记录与调度表算（model.js 纯函数）；本页不写入（点「今日练习」开组的写入在 core/session-start 经 store.commit）。
//
// data-testid：screen-library、library-home（data-state = empty|records / data-recorded / data-today）、library-search、
//   library-query-slot / library-query-open（查字框按钮）、library-range（library-range-value）、library-today（data-phase / data-n；
//   library-today-value、library-today-sub、library-today-fail*）、library-written（data-n；library-written-count）、library-all-open、
//   library-zone（data-kind / data-n；library-zone-name、library-zone-count、library-zone-sample）。

import { html, useEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Chevron } from '../../components/Chevron.js';
import { FailBlock } from '../../components/FailBlock.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { localDay } from '../../../core/dates.js';
import { currentLibraryId, deckAdapter } from '../../../data/deck.js';
import { MEMORY_ZONES, memoryZones, skippedZone, todayPlanModel, zoneSamples } from '../../../session/views/library.js';
import { normalizeKind } from '../../../session/views/library-list.js';
import { Glyph } from './wall.js';
import { startToday } from '../home/index.js';
import './list.js'; // M3-2 清单页自注册（library-list）：三档的区详情页复用它（kind = due | shaky | known）
import './switch.js'; // M3-5 换库页自注册（library-switch）
import './all.js'; // M3-4 有记录的字（完整页）自注册（library-all）
import { LibraryQueryBox } from './query-entry.js'; // M3-3 顶部查字框（lookup 查字弹层）

// tab 名取自文案表（copy/common.js X-TABS）。
export const LIBRARY_LABEL = t('X-TABS.library');
export const LIBRARY_TAB = 'library';

/** 本页跳转的目标屏（由各自的卡注册）。 */
export const LIBRARY_ROUTES = Object.freeze({
  list: 'library-list', // M3-2 清单页，params {kind:'wrong'|'forget'|'due'|'shaky'|'known'}
  all: 'library-all', // M3-4 有记录的字（完整页）
  switch: 'library-switch', // M3-5 换库
  detail: 'detail', // M3-6 单字详情，params {char}
});

/** 从字库「今日练习」开的组，写完结果页的离开按钮是「回到字库」（R-R06 leaveLibrary）。 */
export const LIBRARY_TODAY_SOURCE = Object.freeze({ view: LIBRARY_TAB });

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5.4C7.8 3 4.6 3.8 3 4.6v13.2c2.4-.8 5.4-.4 8 1.2 2.6-1.6 5.6-2 8-1.2V4.6c-1.6-.8-4.8-1.6-8 .8ZM11 5.4v13.6"></path></svg>`;

injectStyles('library', `
.sz-tabpage[data-testid="screen-library"]{gap:8px}
.sz-lib{display:flex;flex-direction:column;min-height:0}
.sz-lib__query{display:flex;flex-direction:column}
/* 块：第一块（练习范围）离搜索 18，其余块之间 26（设计稿 k4-blk）；块顶一条发丝线，块内每行底下一条 */
.sz-libr__blk{flex:none;margin-top:26px;border-top:${T.hair} solid ${T.line}}
.sz-libr__blk--first{margin-top:18px}
.sz-libr__blk--flush{margin-top:0}
.sz-libr__row{box-sizing:border-box;width:100%;min-height:56px;display:flex;align-items:center;gap:${T.s2};position:relative;
  border-bottom:${T.hair} solid ${T.line};text-align:left;color:${T.ink1}}
.sz-libr__row--two{min-height:64px}
.sz-libr__tx{display:flex;flex-direction:column;gap:1px;min-width:0}
.sz-libr__nm{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-libr__cap{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-libr__cnt{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums;white-space:nowrap}
.sz-libr__sp{flex:1;min-width:0}
.sz-libr__val{min-width:0;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2};font-variant-numeric:tabular-nums;text-align:right}
.sz-libr__row--zero{cursor:default}
.sz-libr__row--zero .sz-libr__nm{color:${T.ink3}} /* 0 个字的行只变灰，名称字号 / 字重与其他行同级（D62） */
/* 小标题「已练汉字 N」+ 右侧「全部 ›」：小标题与各行名称同一级（17 / 500 墨一，D62），数同「数」（15 墨三） */
.sz-libr__wr{flex:none;margin-top:26px}
.sz-libr__h{display:flex;align-items:center;gap:${T.s2};min-height:32px;padding-bottom:${T.s1}}
.sz-libr__ht{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-libr__hn{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-libr__h .sz-btn--text{margin-left:auto;flex:none;white-space:nowrap}
.sz-libr__samples{display:flex;gap:${T.s1};margin:0 2px 0 0;padding:0;flex:none}
.sz-libr__sample{position:relative;flex:none;width:34px;height:34px;display:block}
.sz-libr__fail{margin-top:${T.s3}}
/* AX：名称与值上下排、行内折行；不画样字与第二行小字；块间距收紧（设计稿 AX5） */
:root[data-ax] .sz-tabpage[data-testid="screen-library"]{gap:6px;padding-bottom:${T.s2}}
:root[data-ax] .sz-libr__blk{margin-top:10px}
:root[data-ax] .sz-libr__blk--first{margin-top:8px}
:root[data-ax] .sz-libr__blk--flush{margin-top:0}
:root[data-ax] .sz-libr__wr{margin-top:10px}
:root[data-ax] .sz-libr__row{flex-wrap:wrap;min-height:56px;padding:0 30px 0 0;column-gap:${T.s3};row-gap:0}
:root[data-ax] .sz-libr__row .sz-chev{position:absolute;right:0;top:50%;margin-top:-6.5px}
:root[data-ax] .sz-libr__sp,:root[data-ax] .sz-libr__samples,:root[data-ax] .sz-libr__cap{display:none}
:root[data-ax] .sz-libr__val{flex:1 0 100%;text-align:left}
:root[data-ax] .sz-libr__h{min-height:0;flex-wrap:nowrap;row-gap:0;column-gap:2px;padding-bottom:0} /* 小标题与各行名称同一级后仍占一行（AX 不滚） */
:root[data-ax] .sz-libr__h .sz-btn--text{margin-right:0;padding-left:0;padding-right:0;font-size:${T.fs11};line-height:${T.lh11}}
:root[data-ax] .sz-libr__ht{white-space:nowrap}
:root[data-ax] .sz-libq__text{font-size:${T.fs13};line-height:${T.lh13}}
:root[data-ax] .sz-libr__val{font-size:${T.fs15};line-height:${T.lh15}}
:root[data-ax] .sz-libq.sz-btn{min-height:56px}
`);

// ---------------------------------------------------------------- 查字框占位（M3-3）

let querySlot = null;

/**
 * M3-3 挂查字框：传一个组件（无 props），画在 library-query-slot 里；传 null 取消。
 * 查字组件要求在点击处理里同步调用 openQuery（R-Q08），由挂上来的组件自己负责。
 */
export function setLibraryQuerySlot(component) {
  querySlot = typeof component === 'function' ? component : null;
}

// ---------------------------------------------------------------- 状态订阅

function readState() {
  try {
    return getStore().getState();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(readState);
  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      return undefined;
    }
    setState(store.getState());
    return store.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 回前台时重算「今天」（今日练习 / 到期按天算）。 */
function useToday() {
  const [today, setToday] = useState(() => localDay(envNow()));
  useEffect(() => {
    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setToday(localDay(envNow()));
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, []);
  // 每次渲染也对一次（store 变化引起的渲染顺带拿到平移后的测试时钟）。
  const now = localDay(envNow());
  return now !== today ? now : today;
}

// ---------------------------------------------------------------- 动作

/** 跳到本页的某个去处；目标屏还没注册（并行卡未合入）时不跳转。返回是否跳转。 */
export function go(name, params) {
  if (!getScreen(name)) {
    console.warn(`[shizi] library: screen "${name}" is not registered yet`);
    return false;
  }
  nav.push(name, params);
  return true;
}

export const openDetail = char => go(LIBRARY_ROUTES.detail, { char });
export const openList = kind => go(LIBRARY_ROUTES.list, { kind: normalizeKind(kind) });
export const openAll = () => go(LIBRARY_ROUTES.all);
export const openSwitch = () => go(LIBRARY_ROUTES.switch);

/** 练习范围一行的库名（R-L01：只写库名；与「我的 › 设置 › 练习范围」同一个函数、同一个值）。 */
export function libraryName(libraryId) {
  if (libraryId === 'curriculum2500') return t('R-L01.curriculumName');
  return t(`R-L06.lib.${libraryId}.name`);
}

// ---------------------------------------------------------------- 视图

/** 「今日练习」的值与第二行小字（文案键都在 X-LIBFOUR.*）。 */
export function todayTexts(plan) {
  if (plan.phase === 'half') return { value: t('X-LIBFOUR.todayHalfValue', { n: plan.n }), sub: t('X-LIBFOUR.todayHalfSub') };
  if (plan.phase === 'done') return { value: t('X-LIBFOUR.todayDoneValue'), sub: t('X-LIBFOUR.todayDoneSub') };
  if (plan.n <= 0) return { value: t('X-LIBFOUR.todayNoneValue'), sub: '' };
  let sub;
  if (plan.review > 0 && plan.fresh > 0) sub = t('X-LIBFOUR.todaySubBoth', { n: plan.review, m: plan.fresh });
  else if (plan.review > 0) sub = t('X-LIBFOUR.todaySubReview', { n: plan.review });
  else sub = t('X-LIBFOUR.todaySubNew', { n: plan.fresh });
  return { value: t('X-LIBFOUR.todayValue', { n: plan.n }), sub };
}

function RangeRow({ libraryId }) {
  return html`<div class="sz-libr__blk sz-libr__blk--first">
    <${Button} variant="plain" class="sz-libr__row" data-testid="library-range" onClick=${openSwitch}>
      <span class="sz-libr__nm">${t('R-S01.library')}</span>
      <span class="sz-libr__sp"></span>
      <span class="sz-libr__val" data-testid="library-range-value">${libraryName(libraryId)}</span>
      <${Chevron} />
    </${Button}>
  </div>`;
}

function TodayRow({ plan }) {
  const [failed, setFailed] = useState(false);
  const { value, sub } = todayTexts(plan);
  const start = () => {
    let r;
    try {
      r = startToday({ source: LIBRARY_TODAY_SOURCE });
    } catch (error) {
      console.error('[shizi] library today action failed', error);
      r = { ok: false };
    }
    const bad = !!(r && r.ok === false);
    setFailed(bad);
    if (bad) markStateChange();
  };
  return html`<div class="sz-libr__blk">
    <${Button} variant="plain" class=${sub ? 'sz-libr__row sz-libr__row--two' : 'sz-libr__row'} data-testid="library-today" data-phase=${plan.phase}
      data-n=${String(plan.n)} onClick=${start}>
      <span class="sz-libr__tx">
        <span class="sz-libr__nm">${t('X-LIBFOUR.todayLabel')}</span>
        ${sub ? html`<span class="sz-libr__cap" data-testid="library-today-sub">${sub}</span>` : null}
      </span>
      <span class="sz-libr__sp"></span>
      <span class="sz-libr__val" data-testid="library-today-value">${value}</span>
      <${Chevron} />
    </${Button}>
    ${failed
    ? html`<div class="sz-libr__fail">${FailBlock({
      layout: 'page',
      testid: 'library-today-fail',
      text: t('X-HOME.startFailed'),
      retryLabel: t('R-H06.retry'),
      cancelLabel: t('R-H06.cancel'),
      onRetry: start,
      onCancel: () => setFailed(false),
    })}</div>`
    : null}
  </div>`;
}

/** 三档里的一行（D60）：有字 = 一个按钮（名称 + 数 + 样字 + ›）；0 个字 = 只写名称与 0（墨三、不可点、不画 ›）。 */
function ZoneRow({ zone, getInk }) {
  const name = t(`X-LIBFOUR.zone.${zone.kind}`);
  const id = zone.kind === 'skipped' ? 'library-skipped' : 'library-zone'; // 已跳过（D62）同一行模板，testid 单列，不混进三档的计数
  if (!zone.n) {
    return html`<div class="sz-libr__row sz-libr__row--zero" data-testid=${id} data-kind=${zone.kind} data-n="0">
      <span class="sz-libr__nm" data-testid=${`${id}-name`}>${name}</span>
      <span class="sz-libr__cnt" data-testid=${`${id}-count`}>0</span>
    </div>`;
  }
  const cells = zoneSamples(zone);
  return html`<${Button} variant="plain" class="sz-libr__row sz-libr__row--zone" data-testid=${id} data-kind=${zone.kind}
    data-n=${String(zone.n)} onClick=${() => openList(zone.kind)}>
    <span class="sz-libr__nm" data-testid=${`${id}-name`}>${name}</span>
    <span class="sz-libr__cnt" data-testid=${`${id}-count`}>${zone.n}</span>
    <span class="sz-libr__sp"></span>
    <span class="sz-libr__samples" aria-hidden="true">
      ${cells.map(cell => html`<span key=${cell.char} class="sz-libr__sample" data-testid=${`${id}-sample`} data-char=${cell.char}
        data-tone=${cell.tone}><${Glyph} cell=${cell} getInk=${getInk} /></span>`)}
    </span>
    <${Chevron} />
  </${Button}>`;
}

function LibraryScreen() {
  const state = useStoreState();
  const today = useToday();
  const mem = useMemo(() => memoryZones(state, today), [state, today]);
  const skipped = useMemo(() => skippedZone(state), [state]);
  const plan = useMemo(() => todayPlanModel(state, envNow(), { deck: deckAdapter }), [state, today]);
  const getInk = useMemo(() => record => {
    try {
      return getStore().getInk(record);
    } catch (error) {
      return null;
    }
  }, [state]);
  const libraryId = currentLibraryId(state && state.settings);
  const Slot = querySlot;

  return html`<${TabPage} title=${LIBRARY_LABEL} testid="screen-library">
    <div class="sz-lib" data-testid="library-home" data-state=${mem.recorded ? 'records' : 'empty'} data-recorded=${mem.recorded} data-today=${today}>
      <div class="sz-lib__query" data-testid="library-search">
        <div data-testid="library-query-slot">${Slot ? html`<${Slot} />` : html`<${LibraryQueryBox} />`}</div>
      </div>
      <${RangeRow} libraryId=${libraryId} />
      <${TodayRow} plan=${plan} />
      <div class="sz-libr__wr">
        <div class="sz-libr__h" data-testid="library-written" data-n=${mem.recorded}>
          <span class="sz-libr__ht">${t('X-LIBFOUR.writtenHeading')}</span>
          <span class="sz-libr__hn" data-testid="library-written-count">${mem.recorded}</span>
          <${Button} variant="text" data-testid="library-all-open" aria-label=${t('X-LIBFOUR.writtenAllAria')}
            onClick=${openAll}>${t('X-LIBFOUR.writtenAll')}</${Button}>
        </div>
        <div class="sz-libr__blk sz-libr__blk--flush">
          ${MEMORY_ZONES.map(kind => html`<${ZoneRow} key=${kind} zone=${mem.zones[kind]} getInk=${getInk} />`)}
        </div>
        <div class="sz-libr__blk" data-testid="library-skipped-block">
          <${ZoneRow} zone=${skipped} getInk=${getInk} />
        </div>
      </div>
    </div>
  </${TabPage}>`;
}

registerScreen(LIBRARY_TAB, LibraryScreen, { tab: true, order: 1, label: LIBRARY_LABEL, icon: ICON });
