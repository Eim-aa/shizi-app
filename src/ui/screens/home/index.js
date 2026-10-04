// 习字 tab 根页 · 首页（02 M2-1；阶段 1 P1-E5 按设计稿「首练与首页」重排：D43 首页方案 B、D46 ①②④；R-H01–R-H07、R-H11；
// 阶段 1 E9a 按减法修稿 D49 修订：实现交接 §1 / §2.4）。自注册，无中心路由表。
//
// 版式（D49；位置不动，只换内容）：
//   日期行（13 墨三，R-H02）→ 题记一行（日期下 2：宋 13 墨三，「心不厌精，手不忘熟。」+ 8 + 出处作者名，单行不折，不带印；AX1–AX5 隐藏，
//   读屏把它作为标题的补充读出：h1 aria-describedby）→ 标题「今天写几个字」（宋 28，题记下 10）→ 字帖位（在标题与主按钮之间光学居中，
//   区域底留 6% 内边）→ 固定位置的墨色主按钮（宽 240 居中，距 Tab 栏上沿 119，D43）→ 文字按钮「自己选字」。同屏字号 13 / 17 / 28 三级。
//   首页没有朱色（题记不带印；不画写错朱点，D46 ①）；首页不画任何计数（「这一组还有 N 个字」「字库里有 N 个字了 ›」删去，D49-7：
//   计数只进读屏标签），只在今天写的字多于 8 个时留一行「今天写了 N 个字」。字帖格只有外框与格间两种线，空格就是笺面（copybook.js）。
//   五态（today.js homeViewOf，03 P155）：
//     fresh     今天还没写：字帖位 = 书家「拾」，下面没有字；
//     today     今天写过：字帖位 = 今天写的字（本人笔迹），n > 8 才有一行「今天写了 N 个字」，主按钮「再写一组」；
//     progress  有进行中的组：这一组的格子（写过的有墨，没写的是空笺面），主按钮「继续写字」；读屏名称「这一组还有 N 个字」；
//     special   大写数字特别组那天（D40）：一句提示 + 文字按钮「这次先写平常的字」（点了顺延，D46 ④，session-start.deferSpecial）；
//     back      离开 ≥7 天回来（D41）：书家「拾」，「你写过的 N 个字都还在。」，不提缺了几天。
//   首次打开（first）：书家「拾」+ 竖排题跋三列 + 一枚印，没有日期和标题；主按钮「开始写字」，下面「先写三个大家常忘的字。」；
//     不显示「自己选字」，首练完成后出现（D46 ②）。品牌时刻 ≤1.8s：题跋逐字淡入 → 印 → 按钮；点任意处立即静帧，「减少动态效果」直接静帧。
//     （印的触觉与动效编排属阶段 2；测试宿主默认不放动画，URL 加 brand=1 才放。）AX1–AX5：题跋改横排三行（一行一句，宋 13 档，
//     「拾」缩到 120，印跟在末句后，主按钮满宽，说明句在按钮下 4），不放品牌动画（静帧）。
//   首页光影层（叶影 / 日光 / 夜灯）取消（D43，03 P143）：设计稿首页没有光影层，light.js 已删除。
//   AX1–AX5：题记隐藏；主按钮满宽、「自己选字」在下；字帖格宽按剩余高度重算（下限 44）；整页可滚动，主按钮不固定；Tab 栏不放大。
//
// 行为：
//   主按钮：B 有没写完的组 → 续写 B（D05 B 优先）；否则 session.startA（A 有没写完 → 续写；否则第一次练习 / 今天的练习；
//     选不出字 →「现在没有要写的字」页，R-H11）。
//   A+B 两组都没写完：格子是 B 的，下面一行文字按钮是 A 的「今天的练习 · 接着写」（无箭头；剩余字数只进读屏名称，D49 ⑦ / P196），点它续写 A（R-H04）。
//   「自己选字」：在点击处理里同步打开查字组件 pick 模式（R-Q08）；选好后开「这次选的字」（B）：旧 B 没写完 → 关弹层、S02（R-H05）；
//     否则一次 commit 开 B，成功才关弹层、打开写字页；失败（{ok:false}）弹层就地显示 R-H06 三段式、输入还在。
//   开组 / 续写写入失败：主按钮下方就地三段式「没保存上，刚才的选择没记下。」［先不保存 / 再试一次］（R-G04；文案待定 P55）。
//   「这次先写平常的字」：一次 commit 写 settings.capitalDeferredDay，随即开一组普通的今天的练习（Q2-2，交接 §1.2）。
//   跨天：挂载与回前台时 session.expireStale()（P37）；日期在回前台、每 30s 重算。
//
// data-testid：screen-home（data-view / data-hero / data-records / data-resume / data-period / data-compact / data-today / data-ax）、home-date、
//   home-epigraph（data-index）、home-title、home-start、home-first-tip（首次打开按钮下一行）、home-first（首次打开字帖位 + 题跋）、
//   home-motto、home-seal、home-brand-shi、home-zone（读屏 group：字库计数）、home-today-count（只在 n > 8 时有）、home-ink-row / home-ink-item
//   （今天写的字）、home-progress（data-slot / data-kind / data-remaining，读屏名称含剩余字数）/ home-cell、other-line（data-slot）、
//   home-back-note、home-capital-hint（data-kind = capital1 | capital2；含 home-capital-body）、
//   home-capital-defer、home-pick、home-start-fail（+ -cancel / -retry）；测试宿主另有 demo-push、write-test-entry（开发入口，不是用户文案）。

import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { EPIGRAPHS, epigraphAuthor } from '../../../config/epigraphs.js';
import { isTestHost, now as envNow } from '../../../platform/env.js';
import { getStore } from '../../../store/store.js';
import { deckAdapter } from '../../../data/deck.js';
import * as core from '../../../core/session-start.js';
import { localDay, periodOf } from '../../../core/dates.js';
import { openQuery } from '../../components/query/index.js';
import { useCompact } from '../write/compact.js';
import { ensureNavHooks, expireStale, openWrite, resumeSlot, startA, startPicked } from '../session/index.js';
import { setNoneActions } from '../session/none.js';
import { homeModel, resumeLineText, resumeLineAria, INK_ROW_MAX } from './today.js';
import { BrandShi, HomeTie, axTieCellSize, firstShiSize, shiCellSize, tieCellSize, tieCols, useElementWidth } from './copybook.js';
import { useAxLevel } from '../../components/ax.js';
// 写字页自注册（M1-1）：首页是它的入口页，随首页一起加载。
import '../write/index.js';

// M1-1：测试宿主（?test=1 且 localhost）才出现的写字页入口，e2e 与走查用；开发标签不是用户文案（同 _demo）。
const DEV_WRITE_ENTRY = '写字（测试）';

// tab 名取自文案表（copy/common.js X-TABS）。
export const HOME_LABEL = t('X-TABS.write');
export const HOME_TAB = 'home';
/** 时段 / 日期重算间隔（ms）：只在时段或日期真的变了时重画。 */
export const CLOCK_TICK_MS = 30000;
/** 首次打开品牌时刻的总长（ms，设计稿 §一：≤1.8s）：题跋逐字淡入 0.15–1.35s，印 1.35–1.65s，按钮 1.65–1.85s。 */
export const BRAND_TOTAL_MS = 1850;

// 演示子页只在测试主机上加载（ui/root.js），生产形态里 getScreen 为 null，入口不出现。
const DEMO_SCREEN = '_demo/sub';

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 9.4 11 3l8 6.4V19H3V9.4M8.4 19v-6.6h5.2V19"></path></svg>`;

// .sz-home 用 isolation:isolate 自成层叠上下文：内部 z-index 不能越过 router 图层（转场 / 跟手返回时下层首页露出，
// 否则首页内容会盖在上层写字页上、吃掉书写格的指针事件）。

injectStyles('home', `
.sz-home{position:relative;isolation:isolate;min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  padding:calc(12px + env(safe-area-inset-top, 0px)) 20px 0;color:${T.ink1}}
.sz-home__head{position:relative;flex:none}
.sz-home__date{margin:0;font-size:${T.fs13};line-height:${T.lh13};white-space:nowrap;color:${T.ink3}}
.sz-home__epi{margin:2px 0 0;font-family:${T.song};font-weight:400;font-size:${T.fs13};line-height:${T.lh13};white-space:nowrap;color:${T.ink3}} /* 题记一行（D49）：宋 13 墨三，不带印 */
.sz-home__episrc{margin-left:8px}
.sz-home__seal{width:16px;height:16px;box-sizing:border-box;border-radius:${T.rWork};display:grid;place-items:center;flex:none}
.sz-home__seal>span{display:grid;place-items:center;font-family:${T.kai};font-size:calc(11px * 1);line-height:1} /* 印是图形：字形固定 11px（seal16），不随 --k（Q2-10） */
.sz-home__title{margin:10px 0 0;font-family:${T.song};font-weight:500;font-size:${T.fs28};
  line-height:${T.lh28};color:${T.ink1};text-wrap:balance}
.sz-home__title:focus{outline:none}
.sz-home__zone{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:0 0 calc(6% + 2.4px)} /* 字帖块在标题与主按钮之间光学居中：区域底留整屏宽的 6%（百分比按内容宽算，内容宽 = 屏宽 − 40，故 + 40 × 6% = 2.4px），视觉略偏上（D49） */
.sz-home__block{display:flex;flex-direction:column;align-items:center;max-width:100%}
.sz-home__gap{flex:none;height:16px}
.sz-home__line{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:balance}
.sz-home__other.sz-btn{margin-top:4px;min-height:${T.hit};padding:0 12px;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__foot{flex:none;min-height:119px;display:flex;flex-direction:column;align-items:center}
.sz-home__cta.sz-btn{width:240px;max-width:100%}
.sz-home__side.sz-btn{margin-top:4px;min-height:${T.hit};justify-content:center;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2}}
.sz-home__note{margin:16px 0 0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__fail{margin-top:12px;width:100%;max-width:345px;display:flex;flex-direction:column;gap:10px}
.sz-home__failnote{margin:0;text-align:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-home__failbtns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-home__dev{position:absolute;left:20px;right:20px;top:100%;display:flex;flex-direction:column;gap:8px;padding:12px 0} /* 测试宿主的开发入口：落在首屏下面，不占流内位置（首屏版式与线上一致） */
.sz-first{display:flex;gap:20px;align-items:flex-start;justify-content:center}
.sz-first__motto{margin:0;display:flex;flex-direction:row-reverse;align-items:flex-start;font-family:${T.song};font-weight:400;
  font-size:${T.fs22};line-height:34px;color:${T.ink1}}
.sz-first__motto:focus{outline:none}
.sz-first__col{writing-mode:vertical-rl;letter-spacing:.2em;white-space:nowrap}
.sz-first__col--last{writing-mode:horizontal-tb;display:flex;flex-direction:column;align-items:center;gap:10px}
.sz-first__line{writing-mode:vertical-rl;letter-spacing:.2em;white-space:nowrap}
.sz-first--compact .sz-first__motto{font-size:${T.fs17};line-height:30px}
.sz-first--ax{flex-direction:column;align-items:center;gap:16px}
.sz-first__mottoh{margin:0;font-family:${T.song};font-weight:400;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink1};text-align:center}
.sz-first__mottoh:focus{outline:none}
.sz-first__hline{display:block;white-space:nowrap}
.sz-first__hline .sz-home__seal{display:inline-grid;margin-left:8px;vertical-align:middle}
@keyframes szBrandIn{from{opacity:0}to{opacity:1}}
@keyframes szBrandSeal{0%{opacity:0;transform:scale(1.25)}60%{opacity:1;transform:scale(.92)}100%{opacity:1;transform:scale(1)}}
.sz-home--brand .sz-first__ch{opacity:0;animation:szBrandIn 200ms ease-out both;animation-delay:calc(150ms + var(--i) * 62ms)}
.sz-home--brand .sz-first__seal{opacity:0;animation:szBrandSeal 300ms ease-out 1350ms both}
.sz-home--brand .sz-home__foot{opacity:0;animation:szBrandIn 200ms ease-out 1650ms both}
@media (prefers-reduced-motion: reduce){
  .sz-home--brand .sz-first__ch,.sz-home--brand .sz-first__seal,.sz-home--brand .sz-home__foot{animation:none;opacity:1}
}
:root[data-ax] .sz-home__epi{display:none} /* AX1–AX5：题记隐藏（读屏经标题的 aria-describedby 读到，D49） */
:root[data-ax] .sz-home__cta.sz-btn{width:100%}
:root[data-ax] .sz-home__note{margin-top:4px}
`);

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

function clockKey() {
  const ms = envNow();
  return `${localDay(ms)}|${periodOf(ms)}`;
}

function safeExpire() {
  try {
    expireStale();
  } catch (error) {
    // store 未启动：什么都不做
  }
}

/**
 * 日期 / 时段时钟：回前台（visibilitychange / pageshow）与每 CLOCK_TICK_MS 重算，只在日期或时段变了时触发重画；
 * 回前台与挂载时顺带做跨天过期（P37，session.expireStale 没有过期的会话时不写入）。
 */
function useHomeClock() {
  const [key, setKey] = useState(clockKey);
  useEffect(() => {
    safeExpire();
    const tick = () => setKey(prev => {
      const next = clockKey();
      if (next !== prev && next.split('|')[0] !== prev.split('|')[0]) safeExpire();
      return next;
    });
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      safeExpire();
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    const timer = setInterval(tick, CLOCK_TICK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      clearInterval(timer);
    };
  }, []);
  return key;
}

// ---------------------------------------------------------------- 品牌时刻（首次打开）

let brandPlayed = false; // 同一次页面加载里只放一次（回到首次打开的首页不再重放）

function reducedMotion() {
  try {
    return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return false;
  }
}

/** 这次要不要放品牌动画：减少动态效果 → 不放（静帧）；测试宿主默认不放（e2e 要稳定的静帧），URL 带 brand=1 才放。 */
export function brandAllowed(win = typeof window !== 'undefined' ? window : null) {
  if (reducedMotion()) return false;
  if (isTestHost()) {
    try {
      return new URLSearchParams(win.location.search).get('brand') === '1';
    } catch (error) {
      return false;
    }
  }
  return true;
}

/** 品牌时刻：true = 正在放。点任意处 / 按键 / 到时间立即回到静帧（可打断）。 */
function useBrandMoment(active, rootRef) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!active || brandPlayed || !brandAllowed()) return undefined;
    brandPlayed = true;
    setPlaying(true);
    const stop = () => setPlaying(false);
    const timer = setTimeout(stop, BRAND_TOTAL_MS);
    const el = rootRef.current;
    if (el) {
      el.addEventListener('pointerdown', stop, { once: true });
      el.addEventListener('keydown', stop, { once: true });
    }
    return () => {
      clearTimeout(timer);
      if (el) {
        el.removeEventListener('pointerdown', stop);
        el.removeEventListener('keydown', stop);
      }
    };
  }, [active]);
  return playing && active;
}

// ---------------------------------------------------------------- 动作

const SOURCE = Object.freeze({ view: HOME_TAB });

/** 「拾」：B 没写完 → 续写 B（D05）；否则 A 槽（续写 / 第一次练习 / 今天的练习 / 现在没有要写的字）。 */
export function startMain() {
  const state = getStore().getState();
  if (core.resumableSession(state, 'B', { now: envNow() })) {
    const r = resumeSlot('B');
    if (!r || r.ok === false || r.opened) return r;
  }
  return startA({ source: SOURCE });
}

/** S01 第二行：续写 A。 */
export function resumeOther() {
  const r = resumeSlot('A');
  if (r && r.ok !== false && !r.opened) return startA({ source: SOURCE });
  return r;
}

/**
 * 「这次先写平常的字」（D46 ④，交接 §1.2）：特别组顺延（一次 commit，失败返回 {ok:false}），然后点了即开始一组普通练习——
 * 今天已顺延，开出来的「今天的练习」是平常的组（core/sessions specialPlan 见 capitalDeferredDay === today 不出特别组）。
 * 特别组那天首页没有未写完的组（view=special 的前提），所以直接走 A 槽。Q2-2（复测 simB D3）。
 */
export function deferCapital() {
  const r = core.deferSpecial(getStore(), { now: envNow });
  if (!r || r.ok === false) return r;
  return startA({ source: SOURCE });
}

/**
 * 自己选字弹层的「练这 N 个字 / 练这个字」（R-H06）：开「这次选的字」（B）。
 * 返回 {ok:false} 时弹层就地显示三段式（M2-0 openQuery 约定）。
 */
export function pickAndStart(chars, api) {
  const store = getStore();
  const close = () => {
    if (api && typeof api.close === 'function') api.close();
  };
  if (core.s02Data(store.getState())) {
    // 旧 B 没写完：不写入，关弹层后弹 S02（原型 startB 的确认框盖在首页上）。
    close();
    return startPicked(chars, { source: SOURCE });
  }
  let r;
  try {
    r = core.startPicked(store, { keys: chars, source: SOURCE, deck: deckAdapter });
  } catch (error) {
    return { ok: false, error: { kind: 'invalid', reason: error && error.message ? error.message : String(error) } };
  }
  if (!r || !r.ok) return r || { ok: false };
  close();
  if (r.started) {
    openWrite('B');
    return { ok: true, opened: 'new' };
  }
  return startPicked(chars, { source: SOURCE });
}

/** 打开自己选字（查字组件 pick 模式）。必须在点击处理里同步调用（R-Q08）。 */
export function openPick() {
  return openQuery({ mode: 'pick', onPick: pickAndStart });
}

// 「现在没有要写的字」页的「自己选字」（R-H11；none.js 约定由拥有自己选字入口的卡注册）。
setNoneActions({ pick: () => openPick() });

// ---------------------------------------------------------------- 视图

/** 题记（D49）：日期下方一行横排小字，只有作者名跟在句后；整块 aria-hidden，读屏经 h1 的 aria-describedby 读到全句与《篇名》。 */
const EPIGRAPH_ID = 'sz-home-epigraph';

function Epigraph({ epigraph }) {
  const index = EPIGRAPHS.indexOf(epigraph);
  const label = `${epigraph.lines.join('')}${epigraph.source}`;
  return html`<figure class="sz-home__epi" id=${EPIGRAPH_ID} data-testid="home-epigraph" data-index=${index} aria-hidden="true" aria-label=${label}>
    <span class="sz-home__epitext">${epigraph.lines.join('')}</span><span class="sz-home__episrc">${epigraphAuthor(epigraph)}</span>
  </figure>`;
}

function FailBlock({ onCancel, onRetry }) {
  return html`<div class="sz-home__fail" data-testid="home-start-fail">
    <p class="sz-home__failnote" aria-live="polite">${t('X-HOME.startFailed')}</p>
    <div class="sz-home__failbtns">
      <${Button} variant="secondary" data-testid="home-start-fail-cancel" onClick=${onCancel}>${t('R-H06.cancel')}</${Button}>
      <${Button} variant="primary" data-testid="home-start-fail-retry" onClick=${onRetry}>${t('R-H06.retry')}</${Button}>
    </div>
  </div>`;
}

/** 题跋一句里的每个字单独一个 span（逐字淡入的延迟 --i 按顺序编号）。 */
function MottoChars({ text, from }) {
  return [...text].map((ch, i) => html`<span key=${i} class="sz-first__ch" style=${{ '--i': String(from + i) }}>${ch}</span>`);
}

/** 首次打开：书家「拾」+ 竖排题跋三列 + 一枚印（右列先读：第一句在最右）。AX 档改横排三行（ax = true），「拾」缩到 120。 */
function FirstOpen({ width, compact, ax }) {
  const lines = [t('X-HOME.mottoLine1'), t('X-HOME.mottoLine2'), t('X-HOME.mottoLine3')];
  if (ax) {
    return html`<div class="sz-first sz-first--ax" data-testid="home-first">
      <${BrandShi} size=${120} />
      <h1 class="sz-first__mottoh" tabindex="-1" data-page-title data-testid="home-motto" aria-label=${lines.join('')}>
        ${lines.map((line, i) => (i < lines.length - 1
          ? html`<span key=${i} class="sz-first__hline" aria-hidden="true">${line}</span>`
          : html`<span key=${i} class="sz-first__hline" aria-hidden="true">${line}<span class="sz-home__seal sz-first__seal" data-testid="home-seal"><span>${t('X-HOME.sealGlyph')}</span></span></span>`))}
      </h1>
    </div>`;
  }
  const c = compact ? 172 : firstShiSize(width);
  let from = 0;
  const cols = lines.map(line => {
    const start = from;
    from += [...line].length;
    return { line, start };
  });
  return html`<div class=${compact ? 'sz-first sz-first--compact' : 'sz-first'} data-testid="home-first">
    <${BrandShi} size=${c} />
    <h1 class="sz-first__motto" tabindex="-1" data-page-title data-testid="home-motto" aria-label=${lines.join('')}>
      ${cols.map((col, i) => (i < cols.length - 1
        ? html`<span key=${i} class="sz-first__col" aria-hidden="true"><${MottoChars} text=${col.line} from=${col.start} /></span>`
        : html`<span key=${i} class="sz-first__col sz-first__col--last" aria-hidden="true">
            <span class="sz-first__line"><${MottoChars} text=${col.line} from=${col.start} /></span>
            <span class="sz-home__seal sz-first__seal" data-testid="home-seal"><span>${t('X-HOME.sealGlyph')}</span></span>
          </span>`))}
    </h1>
  </div>`;
}

/**
 * AX 档字帖位可用高度（实现交接 §1.4）：Tab 面板高 − 页头（日期 / 题记 / 标题）− 按钮区 − 区域底内边（6% 宽）。
 * 只在 AX 档量；量不到（挂载前、没有面板）返回 0 = 不缩。页头 / 按钮区的高度与字帖位无关，不会回环。
 */
function useTieAvail(rootRef, headRef, footRef, active) {
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    if (!active) {
      setAvail(0);
      return undefined;
    }
    const root = rootRef.current;
    const panel = root ? root.parentElement : null;
    if (!panel) return undefined;
    const read = () => {
      const head = headRef.current ? headRef.current.offsetHeight : 0;
      const foot = footRef.current ? footRef.current.offsetHeight : 0;
      const top = parseFloat(getComputedStyle(root).paddingTop) || 0;
      const next = Math.max(0, Math.floor(panel.clientHeight - top - head - foot - root.clientWidth * 0.06));
      setAvail(prev => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(panel);
    if (headRef.current) ro.observe(headRef.current);
    if (footRef.current) ro.observe(footRef.current);
    return () => ro.disconnect();
  }, [active]);
  return avail;
}

function HomeScreen() {
  const state = useStoreState();
  useHomeClock();
  const compact = useCompact();
  const ax = useAxLevel();
  const rootRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const width = useElementWidth(rootRef);
  const [failed, setFailed] = useState(null); // 写入失败的那个动作（再试一次重跑它）
  useEffect(() => {
    ensureNavHooks(); // R-H10 轻提示的 router 订阅（刷新后直接恢复到写字页时也要有）
  }, []);

  const model = homeModel(state, envNow(), { inkRowMax: INK_ROW_MAX, deck: deckAdapter });
  const view = model.view;
  const brand = useBrandMoment(view === 'first' && ax === 0, rootRef);
  const avail = useTieAvail(rootRef, headRef, footRef, ax > 0 && view !== 'first');
  const resumeOn = model.resume !== 'none';
  const ctaLabel = resumeOn ? t('X-HOME.continue') : view === 'first' || (model.records !== 'record') ? t('X-HOME.start') : t('X-RESULT.again');
  const dateText = t('R-H02.line', {
    date: t('R-H02.dateFormat', model.dateParts),
    period: t(`R-H02.period.${model.period}`),
  });

  const run = action => {
    let r;
    try {
      r = action();
    } catch (error) {
      console.error('[shizi] home action failed', error);
      r = { ok: false };
    }
    setFailed(r && r.ok === false ? () => action : null);
  };

  const getInk = useMemo(() => record => {
    try {
      return getStore().getInk(record);
    } catch (error) {
      return null;
    }
  }, []);

  const b = Math.max(120, width - 40);
  /** 字帖格宽：普通按屏宽公式；AX 档再按剩余高度缩（下限 44）。 */
  const sizeOf = (n, normal) => (ax > 0 ? axTieCellSize(normal, Math.ceil(n / tieCols(n)), avail) : normal);

  // D49-7：字库计数只进读屏——字帖位块是一个 group，名称 =「字库里有 N 个字了」（没有记录时不设）
  const blockProps = model.libraryCount > 0
    ? { role: 'group', 'aria-label': t('X-HOME.libraryCount', { n: model.libraryCount }) }
    : {};

  let zone = null;
  if (view === 'first') {
    zone = html`<${FirstOpen} width=${width} compact=${compact} ax=${ax > 0} />`;
  } else if (model.hero === 'progress' && model.progress) {
    const cells = model.progress.cells.map(c => ({ index: c.index, state: c.state, record: c.record }));
    const size = sizeOf(cells.length, tieCellSize(cells.length, b));
    const p = model.primary;
    const left = p && p.position !== undefined && p.remaining === 0
      ? t('X-HOME.progressLast')
      : t('X-HOME.progressLeft', { n: p ? p.remaining : 0 });
    const doneChars = cells.filter(c => c.state === 'done' && c.record).map(c => c.record.char);
    // 读屏名称保留计数（D49-7、D36 口径：不含正在写的字）；没写的格子不泄题，只列已写过的字
    const label = doneChars.length ? t('X-HOME.progressLabel', { left, chars: doneChars.map(c => `「${c}」`).join('') }) : left;
    zone = html`<div class="sz-home__block" data-testid="home-zone" ...${blockProps}>
      <${HomeTie} cells=${cells} size=${size} kind="progress" getInk=${getInk} label=${label}
        attrs=${{ 'data-slot': p ? p.slot : '', 'data-kind': p ? p.kind : '', 'data-remaining': p ? String(p.remaining) : '' }} />
      ${model.other ? html`<${Button} variant="text" class="sz-home__other" data-testid="other-line" data-slot=${model.other.slot}
        data-kind=${model.other.kind} data-remaining=${String(model.other.remaining)} aria-label=${resumeLineAria(model.other, t)}
        onClick=${() => run(resumeOther)}>${resumeLineText(model.other, t)}</${Button}>` : null}
    </div>`;
  } else if (model.hero === 'today') {
    const cells = model.inkRow.map((r, i) => ({ index: i, state: 'ink', record: r }));
    const size = sizeOf(cells.length, tieCellSize(cells.length, b));
    zone = html`<div class="sz-home__block" data-testid="home-zone" ...${blockProps}>
      <${HomeTie} cells=${cells} size=${size} kind="today" count=${model.count} getInk=${getInk}
        label=${t('X-HOME.inkRowLabel', { n: model.count, chars: model.inkRow.map(r => `「${r.char}」`).join('') })} />
      ${view === 'special'
        ? html`<div class="sz-home__gap"></div><${CapitalHint} kind=${model.capital} />`
        : model.count > INK_ROW_MAX
          ? html`<div class="sz-home__gap"></div><p class="sz-home__line" data-testid="home-today-count">${t('R-H07.todayCount', { n: model.count })}</p>`
          : null}
    </div>`;
  } else {
    // shi：书家「拾」
    zone = html`<div class="sz-home__block" data-testid="home-zone" ...${blockProps}>
      <${BrandShi} size=${sizeOf(1, shiCellSize(b))} />
      ${view === 'special' ? html`<div class="sz-home__gap"></div><${CapitalHint} kind=${model.capital} />` : null}
      ${view === 'back' ? html`<div class="sz-home__gap"></div>
        <p class="sz-home__line" data-testid="home-back-note">${t('X-HOME.backNote', { n: model.libraryCount })}</p>` : null}
    </div>`;
  }

  const demo = getScreen(DEMO_SCREEN);
  const testHost = isTestHost();
  const classes = ['sz-home', compact ? 'sz-home--compact' : '', brand ? 'sz-home--brand' : ''].filter(Boolean).join(' ');

  return html`<section ref=${rootRef} class=${classes} data-testid="screen-home" data-view=${view} data-hero=${model.hero}
    data-records=${model.records} data-resume=${model.resume} data-period=${model.period} data-compact=${compact ? 'true' : 'false'}
    data-today=${model.today} data-brand=${brand ? 'playing' : 'off'} data-ax=${ax > 0 ? String(ax) : undefined}>
    ${view === 'first' ? html`<div class="sz-home__head" aria-hidden="true" style=${{ minHeight: '28px' }}></div>` : html`<header ref=${headRef} class="sz-home__head">
      <p class="sz-home__date" data-testid="home-date">${dateText}</p>
      <${Epigraph} epigraph=${model.epigraph} />
      <h1 class="sz-home__title" tabindex="-1" data-page-title data-testid="home-title" aria-describedby=${EPIGRAPH_ID}>${t('R-H01.title')}</h1>
    </header>`}
    <div class="sz-home__zone">${zone}</div>
    <div ref=${footRef} class="sz-home__foot">
      <${Button} variant="primary" class="sz-home__cta" data-testid="home-start" aria-label=${ctaLabel}
        onClick=${() => run(startMain)}>${ctaLabel}</${Button}>
      ${failed ? html`<${FailBlock} onCancel=${() => setFailed(null)} onRetry=${() => run(failed)} />` : null}
      ${view === 'first' ? html`<p class="sz-home__note" data-testid="home-first-tip">${t('R-H03.firstVisit')}</p>` : null}
      ${view === 'special'
        ? html`<${Button} variant="text" class="sz-home__side" data-testid="home-capital-defer" onClick=${() => run(deferCapital)}>${t('X-HOME.capitalDefer')}</${Button}>`
        : model.showPick
          ? html`<${Button} variant="text" class="sz-home__side" data-testid="home-pick" onClick=${() => openPick()}>${t('X-HOME.pick')}</${Button}>`
          : null}
    </div>
    ${demo || testHost ? html`<div class="sz-home__dev">
      ${demo ? html`<${Button} variant="secondary" data-testid="demo-push"
        onClick=${() => nav.push(DEMO_SCREEN, { level: 1 })}>${demo.label}</${Button}>` : null}
      ${testHost ? html`<${Button} variant="secondary" data-testid="write-test-entry"
        onClick=${() => nav.push('write', { slot: 'A' })}>${DEV_WRITE_ENTRY}</${Button}>` : null}
    </div>` : null}
  </section>`;
}

/** D40 大写数字特别组那天的一句提示（D49：只留「今天写两组大写数字，借条、红包上用得着。」，13 墨三）。 */
function CapitalHint({ kind }) {
  return html`<div data-testid="home-capital-hint" data-kind=${kind} style=${{ display: 'contents' }}>
    <p class="sz-home__line" data-testid="home-capital-body">${t('X-HOME.capitalBody')}</p>
  </div>`;
}

registerScreen(HOME_TAB, HomeScreen, { tab: true, order: 0, label: HOME_LABEL, icon: ICON });
