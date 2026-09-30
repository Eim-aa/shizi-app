// 字库 tab 根页 · 字库首页（墨墙）（02 M3-1；R-L01–R-L04、R-L07–R-L10；原型 docs/design/v10/extracted/字库墨墙屏-第十稿交接版.dc.html
// L26–L79、L353–L365；reference/K-proto-home-lib.md）。自注册，无中心路由表。
//
// 版式（各状态同一个顶部，R-L01）：
//   标题「字库」→ 查字框占位（data-testid=library-query-slot；M3-3 用 setLibraryQuerySlot 挂 M2-0 查字组件）+ 说明（R-L04）
//   → 练习范围一行（只写库名，R-L01；整行是按钮 → 换库 library-switch，M3-5）
//   → 有记录：「有记录的字 N 个字」（大数字可点 → 有记录的字完整页 library-all，M3-4，R-L02）+ 两条事实（R-L10）
//            → 写错过 / 快忘了两张卡（有字才能点 → library-list {kind}，M3-2；空卡去卡片样式，R-L02 / R-L07）
//            → 图例 + 墙（≤ 8 行，wall.js；点字 → 单字详情 detail {char}，M3-6；点空心字同样进详情，详情画「没有记录」一态）
//            → 说明（R-L03；深色反向说法）+「还有 N 个字 ›」（P27；没截断时不显示）
//   → 没有记录：「每天写的新字，从这个字库里挑。」（R-L05，原型 L37）+ 空态（原型 L71–L77）。
//   数据全部从记录算（R-L10；model.js 纯函数）。
//
// 导航：目标屏由拥有它们的卡自注册（M3-2 library-list、M3-4 library-all、M3-5 library-switch、M3-6 detail）；
// 还没注册时按钮不跳转（console.warn），不抛错。
//
// data-testid：screen-library（data-state=empty|records / data-recorded / data-today / data-compact）、library-query-slot、
//   library-query-note、library-switch（data-library）、library-scope-name、library-no-record-note、library-count（data-n）、
//   library-fact（data-kind）、library-card-wrong / library-card-forget（data-n；空卡 data-empty=true 且不是按钮）、
//   library-card-mini-cell、library-legend…、library-wall、library-wall-cell、library-legend-note、library-more（data-n）、
//   library-empty。墙与图例的 testid 见 wall.js。

import { html, useEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { localDay } from '../../../core/dates.js';
import { currentLibraryId } from '../../../data/deck.js';
import { formatDay } from '../../components/query/CharCard.js';
import { useCompact } from '../write/compact.js';
import { libraryHomeModel, cardMini } from './model.js';
import { Legend, LegendNote, MiniRow, Wall, WALL_CSS } from './wall.js';
import './list.js'; // M3-2 写错过 / 快忘了清单页自注册（library-list）；也注册「现在没有要写的字」页的「看写错过的字」
import './switch.js'; // M3-5 换库页自注册（library-switch）
import './all.js'; // M3-4 有记录的字（完整页）自注册（library-all）
import { LibraryQueryBox } from './query-entry.js'; // M3-3 顶部查字框（lookup 查字弹层）

// tab 名取自文案表（copy/common.js X-TABS）。
export const LIBRARY_LABEL = t('X-TABS.library');
export const LIBRARY_TAB = 'library';

/** 本页跳转的目标屏（由各自的卡注册）。 */
export const LIBRARY_ROUTES = Object.freeze({
  list: 'library-list', // M3-2 写错过 / 快忘了清单，params {kind:'wrong'|'forget'}
  all: 'library-all', // M3-4 有记录的字（完整页）
  switch: 'library-switch', // M3-5 换库
  detail: 'detail', // M3-6 单字详情，params {char}
});

const ICON = html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5.4C7.8 3 4.6 3.8 3 4.6v13.2c2.4-.8 5.4-.4 8 1.2 2.6-1.6 5.6-2 8-1.2V4.6c-1.6-.8-4.8-1.6-8 .8ZM11 5.4v13.6"></path></svg>`;

injectStyles('library', `
.sz-lib{display:flex;flex-direction:column;min-height:0}
.sz-lib__query{display:flex;flex-direction:column;gap:2px}
.sz-lib__qnote{margin:0;padding:6px 2px 4px;font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});color:${T.i3};text-wrap:pretty}
.sz-lib__scope.sz-btn{margin-top:calc(16px - 6px * ${T.k});width:100%;min-height:48px;padding:6px 0;text-align:left;
  border-top:.5px solid ${T.i5};border-bottom:.5px solid ${T.i5};display:flex;flex-wrap:wrap;align-items:center;
  justify-content:space-between;gap:2px 12px}
.sz-lib__scopel{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 10px;min-width:0}
.sz-lib__scopelabel{font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});letter-spacing:.14em;color:${T.i3};white-space:nowrap}
.sz-lib__scopename{font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});color:${T.i1};white-space:nowrap}
.sz-lib__scopeentry{flex:none;margin-left:auto;font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});letter-spacing:.02em;
  color:${T.i2};white-space:nowrap}
.sz-lib__nonote{margin:8px 0 0;font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});color:${T.i3}}
.sz-lib__rec{display:flex;flex-direction:column;gap:4px;margin-top:calc(42px - 20px * ${T.k})}
.sz-lib__count.sz-btn{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;min-height:44px}
.sz-lib__label{font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});letter-spacing:.14em;color:${T.i3}}
.sz-lib__num{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px}
.sz-lib__big{font-family:${T.serif};font-size:calc(34px * ${T.k});line-height:calc(42px * ${T.k});font-weight:500;color:${T.i1};
  font-variant-numeric:tabular-nums}
.sz-lib__unit{font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});font-weight:500;color:${T.i2}}
.sz-lib__facts{display:block;overflow:hidden;margin:0;font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});color:${T.i2}}
.sz-lib__factrow{display:flex;flex-wrap:wrap;margin-left:calc(-18px * ${T.k})}
.sz-lib__fact{white-space:nowrap}
.sz-lib__sep{display:inline-block;width:calc(18px * ${T.k});text-align:center}
.sz-lib__cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:calc(24px - 10px * ${T.k})}
.sz-lib__card{box-sizing:border-box;min-width:0;display:flex;flex-direction:column;gap:6px;text-align:left}
.sz-lib__card.sz-btn{border-radius:18px;background:${T.c};border:.5px solid ${T.i5};box-shadow:0 10px 24px rgba(59,47,40,.07);
  padding:14px 14px 8px}
.sz-lib__card--empty{padding:14px 0 8px}
.sz-lib__cardhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sz-lib__cardtitle{display:flex;align-items:center;gap:7px;font-family:${T.serif};font-size:calc(20px * ${T.k});
  line-height:calc(28px * ${T.k});font-weight:500;color:${T.i1};white-space:nowrap}
.sz-lib__cardn{font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});font-weight:500;color:${T.i1};
  font-variant-numeric:tabular-nums}
.sz-lib__cardnote{font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});color:${T.i2};text-wrap:pretty}
.sz-lib__act{min-height:40px;display:flex;align-items:center;font-size:calc(15px * ${T.k});letter-spacing:.04em;color:${T.i1}}
.sz-lib__wallsec{display:flex;flex-direction:column;gap:12px;margin-top:26px}
.sz-lib__foot{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sz-lib__footnote{flex:1;min-width:0;font-size:calc(13px * ${T.k});line-height:calc(18px * ${T.k});color:${T.i3};text-wrap:pretty}
.sz-lib__more.sz-btn{flex:none;white-space:nowrap;color:${T.i2}}
.sz-lib__empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;
  padding:36px 16px 28px}
.sz-lib__emptyglyph{display:block;margin-bottom:6px;font-family:var(--kai, serif);font-size:calc(46px * ${T.k});line-height:1;
  color:transparent;-webkit-text-stroke:1px ${T.i3}}
.sz-lib__emptytitle{margin:0;font-family:${T.serif};font-size:calc(20px * ${T.k});line-height:calc(28px * ${T.k});font-weight:500;
  color:${T.i1}}
.sz-lib__emptytext{margin:0;max-width:calc(250px * ${T.k});font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});
  color:${T.i2};text-wrap:pretty}
${WALL_CSS}
`);

// ---------------------------------------------------------------- 查字框占位（M3-3）

let querySlot = null;

/**
 * M3-3 挂查字框：传一个组件（无 props），画在 library-query-slot 里（R-L04 说明句在它下面）；传 null 取消。
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

/** 回前台时重算「今天」（墨色档位按天）。 */
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
export const openList = kind => go(LIBRARY_ROUTES.list, { kind: kind === 'forget' ? 'forget' : 'wrong' });
export const openAll = () => go(LIBRARY_ROUTES.all);
export const openSwitch = () => go(LIBRARY_ROUTES.switch);

/** 练习范围一行的库名（R-L01：只写库名；「小学初中常用字」改名后的名字）。 */
export function libraryName(libraryId) {
  if (libraryId === 'curriculum2500') return t('R-L01.curriculumName');
  return t(`R-L06.lib.${libraryId}.name`);
}

// ---------------------------------------------------------------- 视图

function factText(fact) {
  if (fact.kind === 'customUnwritten') return t('R-L10.customUnwritten', { n: fact.n });
  return t('X-LIBHOME.since', { date: formatDay(fact.day) });
}

function Facts({ facts }) {
  if (!facts.length) return null;
  const sep = t('X-LIBHOME.factSep');
  return html`<p class="sz-lib__facts"><span class="sz-lib__factrow">
    ${facts.map(f => html`<span key=${f.kind} class="sz-lib__fact" data-testid="library-fact" data-kind=${f.kind}
      ><span class="sz-lib__sep" aria-hidden="true">${sep}</span>${factText(f)}</span>`)}
  </span></p>`;
}

const CARD_COPY = Object.freeze({
  wrong: { title: 'R-E04.titleWrong', note: 'X-LIBHOME.wrongCardNote', empty: 'X-LIBHOME.wrongCardEmpty' },
  forget: { title: 'R-E04.titleForget', note: 'R-L07.forgetCardNote', empty: 'R-L07.forgetCardEmpty' },
});

function Card({ kind, items, getInk }) {
  const copy = CARD_COPY[kind];
  const n = items.length;
  const title = html`<span class="sz-lib__cardtitle">${kind === 'wrong'
    ? html`<span class="sz-lib__dot" aria-hidden="true"></span>` : null}${t(copy.title)}</span>`;
  if (!n) {
    // 空卡：去卡片样式、不是按钮（R-L02「卡片有字才能点」「空卡片去卡片样式」）。
    return html`<div class="sz-lib__card sz-lib__card--empty" data-testid=${`library-card-${kind}`} data-n="0" data-empty="true">
      <span class="sz-lib__cardhead">${title}</span>
      <span class="sz-lib__cardnote">${t(copy.empty)}</span>
    </div>`;
  }
  return html`<${Button} variant="plain" class="sz-lib__card" data-testid=${`library-card-${kind}`} data-n=${n} data-empty="false"
    onClick=${() => openList(kind)}>
    <span class="sz-lib__cardhead">${title}<span class="sz-lib__cardn">${n}</span></span>
    <span class="sz-lib__cardnote">${t(copy.note)}</span>
    <${MiniRow} cells=${cardMini(items, kind)} getInk=${getInk} />
    <span class="sz-lib__act">${t(n === 1 ? 'X-LIBHOME.cardActOne' : 'X-LIBHOME.cardActMany')}</span>
  </${Button}>`;
}

function EmptyState() {
  return html`<div class="sz-lib__empty" data-testid="library-empty">
    <span class="sz-lib__emptyglyph" aria-hidden="true">${t('X-LIBHOME.emptyGlyph')}</span>
    <p class="sz-lib__emptytitle">${t('X-LIBHOME.emptyTitle')}</p>
    <p class="sz-lib__emptytext">${t('R-L05.empty')}</p>
  </div>`;
}

function LibraryScreen() {
  const state = useStoreState();
  const today = useToday();
  const compact = useCompact();
  const model = useMemo(() => libraryHomeModel(state, today, { compact }), [state, today, compact]);
  const libraryId = currentLibraryId(state && state.settings);
  const getInk = useMemo(() => record => {
    try {
      return getStore().getInk(record);
    } catch (error) {
      return null;
    }
  }, [state]);
  const Slot = querySlot;

  return html`<${TabPage} title=${LIBRARY_LABEL} testid="screen-library">
    <div class="sz-lib" data-testid="library-home" data-state=${model.empty ? 'empty' : 'records'} data-recorded=${model.recorded}
      data-today=${today} data-compact=${compact ? 'true' : 'false'}>
      <div class="sz-lib__query">
        <div data-testid="library-query-slot">${Slot ? html`<${Slot} />` : html`<${LibraryQueryBox} />`}</div>
        <p class="sz-lib__qnote" data-testid="library-query-note">${t('R-L04.queryNote')}</p>
      </div>
      <${Button} variant="plain" class="sz-lib__scope" data-testid="library-switch" data-library=${libraryId} onClick=${openSwitch}>
        <span class="sz-lib__scopel"><span class="sz-lib__scopelabel">${t('R-S01.library')}</span
          ><span class="sz-lib__scopename" data-testid="library-scope-name">${libraryName(libraryId)}</span></span>
        <span class="sz-lib__scopeentry">${t('R-L06.entry')}</span>
      </${Button}>
      ${model.empty
        ? html`<p class="sz-lib__nonote" data-testid="library-no-record-note">${t('R-L05.noRecordNote')}</p><${EmptyState} />`
        : html`<div class="sz-lib__rec">
            <${Button} variant="plain" class="sz-lib__count" data-testid="library-count" data-n=${model.recorded} onClick=${openAll}>
              <span class="sz-lib__label">${t('X-LIBHOME.recordedLabel')}</span>
              <span class="sz-lib__num"><span class="sz-lib__big">${model.recorded}</span><span class="sz-lib__unit">${t('X-LIBHOME.countUnit')}</span></span>
            </${Button}>
            <${Facts} facts=${model.facts} />
          </div>
          <div class="sz-lib__cards">
            <${Card} kind="wrong" items=${model.wrong.items} getInk=${getInk} />
            <${Card} kind="forget" items=${model.forget.items} getInk=${getInk} />
          </div>
          <div class="sz-lib__wallsec">
            <${Legend} />
            <${Wall} wall=${model.wall} getInk=${getInk} onOpen=${openDetail} />
            <div class="sz-lib__foot">
              <span class="sz-lib__footnote"><${LegendNote} /></span>
              ${model.wall.more > 0
                ? html`<${Button} variant="text" class="sz-lib__more" data-testid="library-more" data-n=${model.wall.more}
                    onClick=${openAll}>${t('R-L02.more', { n: model.wall.more })}</${Button}>`
                : null}
            </div>
          </div>`}
    </div>
  </${TabPage}>`;
}

registerScreen(LIBRARY_TAB, LibraryScreen, { tab: true, order: 1, label: LIBRARY_LABEL, icon: ICON });
