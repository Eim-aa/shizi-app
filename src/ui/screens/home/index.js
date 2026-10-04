// 习字 tab 根页 · 首页（02 M2-1；阶段 1 P1-E5 按设计稿「首练与首页」重排：D43 首页方案 B、D46 ①②④；R-H01–R-H07、R-H11）。
// 自注册，无中心路由表。
//
// 版式（设计稿 §三「首页」；位置不动，只换内容）：
//   日期行（13 墨三，R-H02）+ 标题「今天写几个字」（宋 28）+ 右上竖排题记 → 字帖位（在标题下沿与主按钮上沿之间垂直居中）
//   → 说明一两行 → 固定位置的墨色主按钮（宽 240 居中，距 Tab 栏上沿 119，D43）→ 文字按钮。
//   五态（today.js homeViewOf，03 P155）：
//     fresh     今天还没写：字帖位 = 书家「拾」，下面一行「昨天写的字」（本人笔迹）+「字库里有 N 个字了 ›」；
//     today     今天写过：字帖位 = 今天写的字（本人笔迹，不画朱点 D46 ①），「今天写了 N 个字」，主按钮「再写一组」；
//     progress  有进行中的组：这一组的格子（写过的有墨，没写的空格不露答案，下一格墨框），「这一组还有 N 个字」，主按钮「继续写字」；
//     special   大写数字特别组那天（D40）：两行提示 + 文字按钮「这次先写平常的字」（点了顺延，D46 ④，session-start.deferSpecial）；
//     back      离开 ≥7 天回来（D41）：上次写的字 + 日期，「你写过的 N 个字都还在。这一组先写写旧字。」，不提缺了几天。
//   首次打开（first）：书家「拾」+ 竖排题跋三列 + 一枚印，没有日期和标题；主按钮「开始写字」，下面「先写三个大家常忘的字。」；
//     不显示「自己选字」，首练完成后出现（D46 ②）。品牌时刻 ≤1.8s：题跋逐字淡入 → 印 → 按钮；点任意处立即静帧，「减少动态效果」直接静帧。
//     （印的触觉与动效编排属阶段 2；测试宿主默认不放动画，URL 加 brand=1 才放。）
//   首页光影层（叶影 / 日光 / 夜灯）取消（D43，03 P143）：设计稿首页没有光影层，light.js 已删除。
//   紧凑版（系统字号 --k ≥ 1.3 即 :root[data-text-large]，或视口高 ≤ policy.compactMaxHeight，与写字页同一条件）：题记合成一列、首次打开的「拾」172。
//
// 行为：
//   主按钮：B 有没写完的组 → 续写 B（D05 B 优先）；否则 session.startA（A 有没写完 → 续写；否则第一次练习 / 今天的练习；
//     选不出字 →「现在没有要写的字」页，R-H11）。
//   A+B 两组都没写完：格子是 B 的，下面一行带 › 的是 A 的「今天的练习 · 还有 N 个字没写 ›」，点它续写 A（R-H04）。
//   「自己选字」：在点击处理里同步打开查字组件 pick 模式（R-Q08）；选好后开「这次选的字」（B）：旧 B 没写完 → 关弹层、S02（R-H05）；
//     否则一次 commit 开 B，成功才关弹层、打开写字页；失败（{ok:false}）弹层就地显示 R-H06 三段式、输入还在。
//   开组 / 续写写入失败：主按钮下方就地三段式「没保存上，刚才的选择没记下。」［先不保存 / 再试一次］（R-G04；文案待定 P55）。
//   「这次先写平常的字」：一次 commit 写 settings.capitalDeferredDay，随即开一组普通的今天的练习（Q2-2，交接 §1.2）。
//   跨天：挂载与回前台时 session.expireStale()（P37）；日期在回前台、每 30s 重算。
//
// data-testid：screen-home（data-view / data-hero / data-records / data-resume / data-period / data-compact / data-today）、home-date、
//   home-epigraph（data-index）、home-title、home-start、home-first-tip（首次打开按钮下一行）、home-first（首次打开字帖位 + 题跋）、
//   home-motto、home-seal、home-brand-shi、home-zone、home-today-count、home-ink-row / home-ink-item（今天写的字）、home-progress / home-cell、
//   resume-line（data-slot / data-kind）、other-line（data-slot）、home-last-row / home-last-label / home-last-item、home-library-link（data-count）、
//   home-back-note / home-back-old、home-capital-hint（data-kind = capital1 | capital2；含 home-capital-lead / home-capital-body）、
//   home-capital-defer、home-pick、home-start-fail（+ -cancel / -retry）；测试宿主另有 demo-push、write-test-entry（开发入口，不是用户文案）。

import { html, useEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { EPIGRAPHS } from '../../../config/epigraphs.js';
import { isTestHost, now as envNow } from '../../../platform/env.js';
import { getStore } from '../../../store/store.js';
import { deckAdapter } from '../../../data/deck.js';
import * as core from '../../../core/session-start.js';
import { localDay, monthDayParts, periodOf } from '../../../core/dates.js';
import { openQuery } from '../../components/query/index.js';
import { useCompact } from '../write/compact.js';
import { ensureNavHooks, expireStale, openWrite, resumeSlot, startA, startPicked } from '../session/index.js';
import { setNoneActions } from '../session/none.js';
import { homeModel, lastWrittenRow, resumeLineText, epigraphColumnHeight, epigraphReserve, tieIntrudesEpigraph, INK_ROW_MAX } from './today.js';
import { recordsOf } from '../../../core/session-start.js';
import { BrandShi, HomeTie, MiniRow, firstShiSize, shiCellSize, tieCellSize, tieCols, useElementWidth } from './copybook.js';
import { recordInkPoints } from './ink-row.js';
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

const CHEVRON = () => html`<svg class="sz-home__chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.5 1.5 6.5 6.5l-5 5"></path></svg>`;

// .sz-home 用 isolation:isolate 自成层叠上下文：内部 z-index 不能越过 router 图层（转场 / 跟手返回时下层首页露出，
// 否则首页内容会盖在上层写字页上、吃掉书写格的指针事件）。

injectStyles('home', `
.sz-home{position:relative;isolation:isolate;min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  padding:calc(12px + env(safe-area-inset-top, 0px)) 20px 0;color:${T.ink1}}
.sz-home__head{position:relative;flex:none;min-height:84px}
.sz-home__date{margin:0;font-size:${T.fs13};line-height:${T.lh13};white-space:nowrap;color:${T.ink3}}
.sz-home__epi{position:absolute;right:0;top:4px;display:flex;align-items:flex-start;gap:4px}
.sz-home__src{display:flex;flex-direction:column;align-items:center;gap:8px}
.sz-home__srctext{writing-mode:vertical-rl;font-family:${T.song};font-size:${T.fs13};line-height:${T.lh13};letter-spacing:.12em;
  color:${T.ink3}}
.sz-home__seal{width:16px;height:16px;box-sizing:border-box;border-radius:${T.rWork};display:grid;place-items:center;flex:none}
.sz-home__seal>span{display:grid;place-items:center;font-family:${T.kai};font-size:${T.fs11};line-height:1}
.sz-home__quote{margin:0;display:flex;flex-direction:row-reverse;gap:4px;font-family:${T.song};font-weight:400;font-size:${T.fs15};
  color:${T.ink2}}
.sz-home__col{writing-mode:vertical-rl;line-height:26px;letter-spacing:.2em}
.sz-home__title{margin:10px 0 0;width:300px;max-width:calc(100% - 96px);font-family:${T.song};font-weight:500;font-size:${T.fs28};
  line-height:${T.lh28};color:${T.ink1}}
.sz-home__title:focus{outline:none}
.sz-home__zone{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:0 0 28px}
.sz-home__block{display:flex;flex-direction:column;align-items:center;max-width:100%}
.sz-home__gap{flex:none;height:16px}
.sz-home__gap--sm{height:4px}
.sz-home__line{margin:0;text-align:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:balance}
.sz-home__line--sub{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__label{margin:0 0 6px;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__link.sz-btn{min-height:${T.hit};padding:0 12px;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-decoration:none;
  display:inline-flex;align-items:center;gap:6px}
.sz-home__chev{width:6px;height:10px;color:${T.ink4}}
.sz-home__other.sz-btn{min-height:${T.hit};padding:0 12px;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__foot{flex:none;min-height:119px;display:flex;flex-direction:column;align-items:center}
.sz-home__cta.sz-btn{width:240px;max-width:100%}
.sz-home__side.sz-btn{margin-top:4px;min-height:${T.hit};justify-content:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
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
.sz-home--compact .sz-home__epi{right:0;top:0}
.sz-home--compact .sz-home__col{line-height:22px}
.sz-home__col--one{writing-mode:vertical-rl;font-size:${T.fs13};letter-spacing:.12em;white-space:nowrap}
@keyframes szBrandIn{from{opacity:0}to{opacity:1}}
@keyframes szBrandSeal{0%{opacity:0;transform:scale(1.25)}60%{opacity:1;transform:scale(.92)}100%{opacity:1;transform:scale(1)}}
.sz-home--brand .sz-first__ch{opacity:0;animation:szBrandIn 200ms ease-out both;animation-delay:calc(150ms + var(--i) * 62ms)}
.sz-home--brand .sz-first__seal{opacity:0;animation:szBrandSeal 300ms ease-out 1350ms both}
.sz-home--brand .sz-home__foot{opacity:0;animation:szBrandIn 200ms ease-out 1650ms both}
@media (prefers-reduced-motion: reduce){
  .sz-home--brand .sz-first__ch,.sz-home--brand .sz-first__seal,.sz-home--brand .sz-home__foot{animation:none;opacity:1}
}
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

function Epigraph({ epigraph, compact }) {
  const colH = epigraphColumnHeight(epigraph);
  const index = EPIGRAPHS.indexOf(epigraph);
  // 读屏：竖排两列按视觉顺序是右列先读，整句读序会错；整张 figure 给一句话的名称，子节点 aria-hidden（A9）。
  const label = `${epigraph.lines.join('')}${epigraph.source}`;
  if (compact) {
    // 紧凑版：题记合成一列、不放出处（设计稿 §六 SE 3），印落在下面
    return html`<figure class="sz-home__epi" data-testid="home-epigraph" data-index=${index} style=${{ margin: 0 }} aria-label=${label}>
      <div class="sz-home__src" aria-hidden="true">
        <blockquote class="sz-home__quote" style=${{ margin: 0 }}>
          <span class="sz-home__col sz-home__col--one">${epigraph.lines.join('')}</span>
        </blockquote>
        <span class="sz-home__seal"><span>${t('X-HOME.sealGlyph')}</span></span>
      </div>
    </figure>`;
  }
  const padTop = 44 + (colH - 96) / 2;
  return html`<figure class="sz-home__epi" data-testid="home-epigraph" data-index=${index} style=${{ margin: 0 }} aria-label=${label}>
    <figcaption class="sz-home__src" aria-hidden="true" style=${{ paddingTop: `${padTop}px` }}>
      <span class="sz-home__srctext">${epigraph.source}</span>
      <span class="sz-home__seal"><span>${t('X-HOME.sealGlyph')}</span></span>
    </figcaption>
    <blockquote class="sz-home__quote" aria-hidden="true" style=${{ margin: 0 }}>
      ${epigraph.lines.map((line, i) => html`<span key=${i} class="sz-home__col" style=${{ height: `${colH}px` }}>${line}</span>`)}
    </blockquote>
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

/** 首次打开：书家「拾」+ 竖排题跋三列 + 一枚印（右列先读：第一句在最右）。 */
function FirstOpen({ width, compact }) {
  const c = compact ? 172 : firstShiSize(width);
  const lines = [t('X-HOME.mottoLine1'), t('X-HOME.mottoLine2'), t('X-HOME.mottoLine3')];
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

function HomeScreen() {
  const state = useStoreState();
  useHomeClock();
  const compact = useCompact();
  const rootRef = useRef(null);
  const width = useElementWidth(rootRef);
  const [failed, setFailed] = useState(null); // 写入失败的那个动作（再试一次重跑它）
  useEffect(() => {
    ensureNavHooks(); // R-H10 轻提示的 router 订阅（刷新后直接恢复到写字页时也要有）
  }, []);

  const model = homeModel(state, envNow(), { inkRowMax: INK_ROW_MAX, deck: deckAdapter });
  const view = model.view;
  const brand = useBrandMoment(view === 'first', rootRef);
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
  const records = useMemo(() => recordsOf(state), [state && state.records]);
  // 「昨天写的字」一行：今天还没写 / 离开 ≥7 天回来时有；只放有本人墨迹的字
  const lastRow = useMemo(() => {
    if (view !== 'fresh' && view !== 'back') return null;
    return lastWrittenRow(records, model.today, { hasInk: r => { const p = recordInkPoints(r, getInk); return !!(p && p.length); } });
  }, [records, model.today, view, state && state.ink]);
  const dateOf = day => t('R-H02.dateFormat', monthDayParts(day));

  const library = model.libraryCount > 0
    ? html`<div class="sz-home__gap sz-home__gap--sm"></div>
      <${Button} variant="plain" class="sz-home__link" data-testid="home-library-link" data-count=${model.libraryCount}
        onClick=${() => nav.switchTab('library')}>${t('X-HOME.libraryCount', { n: model.libraryCount })}<${CHEVRON} /></${Button}>`
    : null;

  let zone = null;
  if (view === 'first') {
    zone = html`<${FirstOpen} width=${width} compact=${compact} />`;
  } else if (model.hero === 'progress' && model.progress) {
    const cells = model.progress.cells.map(c => ({ index: c.index, state: c.state, record: c.record }));
    const size = tieCellSize(cells.length, b);
    const p = model.primary;
    const caption = p && p.position !== undefined && p.remaining === 0
      ? t('X-HOME.progressLast')
      : t('X-HOME.progressLeft', { n: p ? p.remaining : 0 });
    const doneChars = cells.filter(c => c.state === 'done' && c.record).map(c => c.record.char);
    zone = html`<div class="sz-home__block" data-testid="home-zone">
      <${HomeTie} cells=${cells} size=${size} kind="progress" getInk=${getInk}
        label=${t('X-HOME.progressLabel', { chars: doneChars.map(c => `「${c}」`).join('') || '—' })} />
      <div class="sz-home__gap"></div>
      <p class="sz-home__line" data-testid="resume-line" data-slot=${p ? p.slot : ''} data-kind=${p ? p.kind : ''}>${caption}</p>
      ${model.other ? html`<${Button} variant="text" class="sz-home__other" data-testid="other-line" data-slot=${model.other.slot}
        data-kind=${model.other.kind} onClick=${() => run(resumeOther)}
        >${resumeLineText(model.other, t)} ${t('X-HOME.more')}</${Button}>` : null}
      ${library}
    </div>`;
  } else if (model.hero === 'today') {
    const cells = model.inkRow.map((r, i) => ({ index: i, state: 'ink', record: r }));
    const size = tieCellSize(cells.length, b);
    zone = html`<div class="sz-home__block" data-testid="home-zone">
      <${HomeTie} cells=${cells} size=${size} kind="today" count=${model.count} getInk=${getInk}
        label=${t('X-HOME.inkRowLabel', { chars: model.inkRow.map(r => `「${r.char}」`).join('') })} />
      <div class="sz-home__gap"></div>
      ${view === 'special'
        ? html`<${CapitalHint} kind=${model.capital} />`
        : html`<p class="sz-home__line" data-testid="home-today-count">${t('R-H07.todayCount', { n: model.count })}</p>${library}`}
    </div>`;
  } else {
    // shi：书家「拾」
    const lastLabel = lastRow
      ? (lastRow.yesterday && view === 'fresh' ? t('X-HOME.lastYesterday') : t('X-HOME.lastBefore', { date: dateOf(lastRow.day) }))
      : '';
    zone = html`<div class="sz-home__block" data-testid="home-zone">
      <${BrandShi} size=${shiCellSize(b)} />
      ${lastRow ? html`<div class="sz-home__gap"></div>
        <p class="sz-home__label" data-testid="home-last-label">${lastLabel}</p>
        <${MiniRow} items=${lastRow.items} day=${lastRow.day} getInk=${getInk}
          label=${t('X-HOME.lastRowLabel', { label: lastLabel, chars: lastRow.items.map(i => `「${i.char}」`).join('') })} />` : null}
      ${view === 'special' ? html`<div class="sz-home__gap"></div><${CapitalHint} kind=${model.capital} />` : null}
      ${view === 'back' ? html`<div class="sz-home__gap"></div>
        <p class="sz-home__line" data-testid="home-back-note">${t('X-HOME.backNote', { n: model.libraryCount })}</p>
        <p class="sz-home__line sz-home__line--sub" data-testid="home-back-old">${t('X-HOME.backOld')}</p>` : null}
      ${view === 'fresh' ? library : null}
    </div>`;
  }

  // 字帖位的右缘伸到右上角题记下面时（今天写的字 / 进行中的格子），区域顶部让出题记的高度，免得格子压到出处的末字
  const tieCount = model.hero === 'today' ? model.inkRow.length : model.hero === 'progress' && model.progress ? model.progress.cells.length : 0;
  const tieWidth = tieCount ? tieCols(tieCount) * tieCellSize(tieCount, b) : 0;
  const zonePush = tieCount && view !== 'first' && tieIntrudesEpigraph({ width, tieWidth, compact })
    ? Math.max(0, epigraphReserve(model.epigraph, { compact }) - 96) : 0;
  const demo = getScreen(DEMO_SCREEN);
  const testHost = isTestHost();
  const classes = ['sz-home', compact ? 'sz-home--compact' : '', brand ? 'sz-home--brand' : ''].filter(Boolean).join(' ');

  return html`<section ref=${rootRef} class=${classes} data-testid="screen-home" data-view=${view} data-hero=${model.hero}
    data-records=${model.records} data-resume=${model.resume} data-period=${model.period} data-compact=${compact ? 'true' : 'false'}
    data-today=${model.today} data-brand=${brand ? 'playing' : 'off'}>
    ${view === 'first' ? html`<div class="sz-home__head" aria-hidden="true" style=${{ minHeight: '28px' }}></div>` : html`<header class="sz-home__head">
      <p class="sz-home__date" data-testid="home-date">${dateText}</p>
      <${Epigraph} epigraph=${model.epigraph} compact=${compact} />
      <h1 class="sz-home__title" tabindex="-1" data-page-title data-testid="home-title">${t('R-H01.title')}</h1>
    </header>`}
    <div class="sz-home__zone" style=${{ paddingTop: `${zonePush}px` }}>${zone}</div>
    <div class="sz-home__foot">
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

/** D40 大写数字特别组那天的两行提示（设计稿 §四 ④）。 */
function CapitalHint({ kind }) {
  return html`<div data-testid="home-capital-hint" data-kind=${kind} style=${{ display: 'contents' }}>
    <p class="sz-home__line" data-testid="home-capital-lead">${t('X-HOME.capitalLead')}</p>
    <p class="sz-home__line sz-home__line--sub" data-testid="home-capital-body">${t('X-HOME.capitalBody')}</p>
  </div>`;
}

registerScreen(HOME_TAB, HomeScreen, { tab: true, order: 0, label: HOME_LABEL, icon: ICON });
