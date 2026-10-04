// 字库 tab 根页 · 字库首页（墨墙）（02 M3-1；R-L01–R-L04、R-L07–R-L10；原型 docs/design/v10/extracted/字库墨墙屏-第十稿交接版.dc.html
// L26–L79、L353–L365；reference/K-proto-home-lib.md）。自注册，无中心路由表。
//
// 版式（D49 减法稿，实现交接 §14；各状态同一个顶部）：
//   大标题「字库」→ 查字框（library-query-slot；M3-3 用 setLibraryQuerySlot 挂 M2-0 查字组件，下面不再有说明句）
//   → 有记录：「写错过」「快忘了」两个同一模板的块（名称 + 数 + 右侧文字按钮「练这些字」 → library-list {kind}，M3-2；下面一排最该练的 5 个样字，
//            30pt 标准字形、wall1、不画朱点；没有字时只有名称 + 0，不画按钮与样字）
//            → 字墙题注「{n} 个字」（有记录的字数，R-L10，小标注）→ 墙（≤ 8 行，wall.js；点字 → 单字详情 detail {char}，M3-6；点空心字同样进详情，
//              空心 = 自选了还没写，描边 ink4）→ 墙下说明（R-L03；深色反向说法）+「还有 N 个字 ›」（P27；没截断时不显示；进 library-all，M3-4）
//   → 没有记录：「每天写的新字，从这个字库里挑。」（R-L05，原型 L37）+ 空态（原型 L71–L77）。
//   去掉的（D49）：搜索框下说明、练习范围一行（移到「我的 › 设置」）、「有记录的字」大数字与副统计、两栏说明与朱点、两行图例、「→」。
//   数据全部从记录算（R-L10；model.js 纯函数）。
//
// 导航：目标屏由拥有它们的卡自注册（M3-2 library-list、M3-4 library-all、M3-5 library-switch、M3-6 detail）；
// 还没注册时按钮不跳转（console.warn），不抛错。
//
// data-testid：screen-library（data-state=empty|records / data-recorded / data-today / data-compact）、library-query-slot、
//   library-no-record-note、library-card-wrong / library-card-forget（data-n；没有字 data-empty=true，无按钮无样字）、library-card-name /
//   library-card-count / library-card-practice（文字按钮「练这些字」）/ library-card-samples / library-card-mini-cell（样字）、library-caption（data-n）、
//   library-wall、library-wall-cell、library-legend-note、library-more（data-n）、library-empty。墙的 testid 见 wall.js。

import { html, useEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { TabPage } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { PracticeGlyph, FACE_FULL } from '../../components/PracticeGlyph.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { localDay } from '../../../core/dates.js';
import { libraryHomeModel, cardMini } from './model.js';
import { LegendNote, Samples, Wall, WALL_CSS, useWallLayout } from './wall.js';
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

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5.4C7.8 3 4.6 3.8 3 4.6v13.2c2.4-.8 5.4-.4 8 1.2 2.6-1.6 5.6-2 8-1.2V4.6c-1.6-.8-4.8-1.6-8 .8ZM11 5.4v13.6"></path></svg>`;

injectStyles('library', `
.sz-tabpage[data-testid="screen-library"]{gap:12px}
.sz-lib{display:flex;flex-direction:column;min-height:0}
.sz-lib__query{display:flex;flex-direction:column}
.sz-lib__nonote{margin:${T.s2} 0 0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
/* 写错过 / 快忘了：同一个行模板（查字下 28，两块之间 20）。第一行 名称 17 / 500 + 数 15 墨三 + 右侧文字按钮；第二行样字（下 6） */
.sz-lib__pbs{display:flex;flex-direction:column;margin-top:28px}
.sz-lib__pb{display:flex;flex-direction:column;gap:6px;min-width:0}
.sz-lib__pb+.sz-lib__pb{margin-top:20px}
.sz-lib__l1{display:flex;align-items:center;gap:${T.s2};min-height:${T.hit}}
.sz-lib__name{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-lib__cnt{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-lib__sp{flex:1}
.sz-lib__l1 .sz-btn--text{flex:none}
:root[data-ax] .sz-lib__l1{flex-wrap:wrap}
:root[data-ax] .sz-lib__sp{display:none}
:root[data-ax] .sz-lib__l1 .sz-btn--text{flex:1 0 100%;justify-content:flex-start;padding-left:0}
/* 字墙题注：快忘了块下 36，字墙在题注下 8 */
.sz-lib__wl{margin:36px 0 0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-lib__wallsec{display:flex;flex-direction:column;gap:${T.s3};margin-top:${T.s2}}
.sz-lib__foot{display:flex;align-items:center;justify-content:space-between;gap:${T.s3}}
.sz-lib__footnote{flex:1;min-width:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-lib__more.sz-btn{flex:none;white-space:nowrap;color:${T.ink2}}
.sz-lib__empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${T.s2};text-align:center;
  padding:${T.s8} ${T.s4} ${T.s6}}
.sz-lib__emptyglyph{display:block;margin-bottom:${T.s2};width:calc(46px * ${T.k});height:calc(46px * ${T.k});color:${T.ink3}}
.sz-lib__emptytitle{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;
  color:${T.ink1}}
.sz-lib__emptytext{margin:0;max-width:calc(250px * ${T.k});font-size:${T.fs15};line-height:${T.lh15};
  color:${T.ink2};text-wrap:pretty}
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

/** 写错过 / 快忘了的块（D49：两块同一模板）。 */
function PracticeBlock({ kind, items }) {
  const n = items.length;
  const name = t(kind === 'wrong' ? 'R-E04.titleWrong' : 'R-E04.titleForget');
  return html`<section class="sz-lib__pb" data-testid=${`library-card-${kind}`} data-n=${n} data-empty=${n ? 'false' : 'true'}>
    <div class="sz-lib__l1">
      <span class="sz-lib__name" data-testid="library-card-name">${name}</span>
      <span class="sz-lib__cnt" data-testid="library-card-count">${n}</span>
      <span class="sz-lib__sp"></span>
      ${n
        ? html`<${Button} variant="text" data-testid="library-card-practice" aria-label=${t('X-LIBHOME.practiceAria', { label: name })}
            onClick=${() => openList(kind)}>${t('X-LIBHOME.practiceThese')}</${Button}>`
        : null}
    </div>
    ${n ? html`<${Samples} cells=${cardMini(items, kind)} />` : null}
  </section>`;
}

function EmptyState() {
  return html`<div class="sz-lib__empty" data-testid="library-empty">
    <span class="sz-lib__emptyglyph" aria-hidden="true"><${PracticeGlyph} char=${t('X-LIBHOME.emptyGlyph')} face=${FACE_FULL} variant="hollow" /></span>
    <p class="sz-lib__emptytitle">${t('X-LIBHOME.emptyTitle')}</p>
    <p class="sz-lib__emptytext">${t('R-L05.empty')}</p>
  </div>`;
}

function LibraryScreen() {
  const state = useStoreState();
  const today = useToday();
  const { large, width } = useWallLayout();
  const compact = large;
  const model = useMemo(() => libraryHomeModel(state, today, { compact: large, width }), [state, today, large, width]);
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
      </div>
      ${model.empty
        ? html`<p class="sz-lib__nonote" data-testid="library-no-record-note">${t('R-L05.noRecordNote')}</p><${EmptyState} />`
        : html`<div class="sz-lib__pbs">
            <${PracticeBlock} kind="wrong" items=${model.wrong.items} />
            <${PracticeBlock} kind="forget" items=${model.forget.items} />
          </div>
          <p class="sz-lib__wl" data-testid="library-caption" data-n=${model.recorded}>${t('X-LIBHOME.caption', { n: model.recorded })}</p>
          <div class="sz-lib__wallsec">
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
