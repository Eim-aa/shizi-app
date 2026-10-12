// 习字 tab 根页 · 首页（02 M2-1；阶段 1 P1-E5 / E9a / H1 / C3-H 屡经改版；H2 / D55：产品负责人选定「首页方向」E「极静」）。自注册，无中心路由表。
//
// 版式（D55，设计稿「首页方向.html」E 一节）：
//   首页只有：左上日期时段（13 墨三）、居中偏上的墨「拾」（128pt，品牌字形单一来源 ui/brand/shi.js ShiMark，--hand）、其右侧竖排题记
//   （每日题记两列：宋 15 墨二，右起；作者名小字：宋 13 墨三，在最左；沿用 config/epigraphs.js 的轮换，P23）、主按钮上方的文字按钮「自己选字」、主按钮（底边固定在
//   Tab 栏上沿上方 policy.mainButtonLine，24，六态同一个 y）。不放：写过的字 / 字帖行 / 数字 / 进度 / 说明句 / 标题「今天写几个字」（标题只作为 h1 留给读屏，
//   aria-describedby 指向题记，题记整块 aria-hidden）。首页没有朱色、不出任何「已保存」类提示；主操作都只要一次点击。
//   六态（today.js homeViewOf；状态只体现在主按钮的字与两处各多一句）：
//     first     首次打开：保持现有画面——框中「拾」+ 竖排题跋三列 + 一枚印，没有日期；主按钮「开始写字」，下面「先写三个大家常忘的字。」，不显示「自己选字」（D46 ②）；
//     fresh     今天还没写：「开始写字」；
//     progress  写到一半：「继续写字」（A、B 两组都没写完时，A 那一行留作文字按钮 other-line「今天的练习 · 接着写」，P196）；
//     today     今天写完：「再写一组」；
//     back      离开 ≥7 天回来（D41）：「拾」与题记组下面多一句「你写过的 N 个字都还在。」（13 墨三，N 是字库里写过的字数）；
//     special   大写数字特别组那天（D40）：多一句特别组说明，「自己选字」旁加文字按钮「这次先写平常的字」（D46 ④，session-start.deferSpecial，点了顺延）。
//   首次打开的品牌时刻 ≤1.2s：题跋逐字淡入 → 印，主按钮与说明句从第一帧起可见可点（不参与动画，H1 / I2-05）；点任意处立即静帧，「减少动态效果」直接静帧。
//     （测试宿主默认不放动画，URL 加 brand=1 才放。）AX1–AX5：题跋改横排三行（一行一句，宋 13 档，「拾」缩到 120，印跟在末句后，主按钮满宽，说明句在按钮下 4），不放品牌动画。
//   AX1–AX5（日常五态）：「拾」与题记缩放但不溢出——「拾」与题记上下排、居中，题记改横排（两句 + 作者，现有「AX 档改横排」规则）；「拾」按剩余高度缩（≤128、≥64，
//     useShiAvail 量页头 / 题记 / 一句话 / 按钮区；放不下时先收起题记，沿用 D49 的 AX 隐藏题记规则）；整页不滚动；主按钮满宽，文字按钮在它上面。
//
// data-testid：screen-home（data-view / data-records / data-resume / data-period / data-compact / data-today / data-ax）、home-date、home-title（只给读屏）、
//   home-epigraph（data-index）、home-brand-shi（日常态的墨「拾」；首次打开是框中的品牌「拾」）、home-group、home-start、home-first-tip、home-first、home-motto、home-seal、
//   other-line（data-slot / data-kind / data-remaining）、home-back-note、home-capital-hint（data-kind = capital1 | capital2；含 home-capital-body）、
//   home-capital-defer、home-pick、home-start-fail（+ -cancel / -retry）；测试宿主另有 demo-push、write-test-entry（开发入口，不是用户文案）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { markPaperSource } from '../../paper-transition.js'; // W2：主按钮点下时记下它的位置，写字页从它长出来（B1）
import { SealGlyph } from '../../components/marks.js';
import { injectStyles, T } from '../../components/styles.js';
import { M, prefersReducedMotion } from '../../../config/motion.js';
import { t } from '../../../config/copy/index.js';
import * as policy from '../../../config/policy.js';
import { EPIGRAPHS, epigraphAuthor } from '../../../config/epigraphs.js';
import { isTestHost, now as envNow } from '../../../platform/env.js';
import { getStore } from '../../../store/store.js';
import { deckAdapter } from '../../../data/deck.js';
import * as core from '../../../core/session-start.js';
import { localDay, periodOf } from '../../../core/dates.js';
import { openQuery } from '../../components/query/index.js';
import { useCompact } from '../write/compact.js';
import { expireStale, openWrite, resumeSlot, startA, startPicked } from '../session/index.js';
import { setNoneActions } from '../session/none.js';
import { homeModel, homeCtaKey, homeNoteOf, resumeLineText, resumeLineAria } from './today.js';
import { BrandShi, firstShiSize, useElementWidth } from './copybook.js';
import { ShiMark } from '../../brand/shi.js';
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
/** 首次打开品牌时刻的总长（ms；I2-05 建议 ≤ 1.2s，与 motion.moment.resultMax 同一上限）：题跋逐字淡入，印在最后落下。主按钮不参与动画，第一帧起可见可点（H1）。
 * 节奏全取 motion 令牌（P2-09；例外 E6 只免「不重演」，不免令牌）：起始 duration.xs，每字淡入 duration.fade、错开 ≤ moment.workStagger（17 个字按总长收紧），
 * 印 moment.sealDrop 落下、到 BRAND_TOTAL_MS 落定。 */
export const BRAND_TOTAL_MS = M.moment.resultMax;
export const BRAND_SEAL_DELAY_MS = BRAND_TOTAL_MS - M.moment.sealDrop;
/** 题跋逐字错开（ms）：17 个字的最后一个在印落下之前淡入完。 */
export const BRAND_STAGGER_MS = Math.min(M.moment.workStagger, Math.floor((BRAND_SEAL_DELAY_MS - M.dur.xs - M.dur.fade) / 16));

/** 主按钮底边到 Tab 栏上沿的固定距离（pt，T3-01 / D53 ③「全 App 统一的底线」）：首页六态与首次打开同一条线。与写字页主按钮底线共用 policy.mainButtonLine（P258，R3-C3W）。 */
export const CTA_LINE = policy.mainButtonLine.gapAboveEdge;
/** 日常态的墨「拾」边长（pt，D55 / 设计稿 E：128，D51 定稿母版）；AX 档按剩余高度缩，不小于 SHI_MIN（再放不下就先收起题记，SHI_FLOOR 是题记也收起后的下限）。 */
export const SHI_SIZE = 128;
export const SHI_MIN = 64;
export const SHI_FLOOR = 44;

// 演示子页只在测试主机上加载（ui/root.js），生产形态里 getScreen 为 null，入口不出现。
const DEMO_SCREEN = '_demo/sub';

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 9.4 11 3l8 6.4V19H3V9.4M8.4 19v-6.6h5.2V19"></path></svg>`;

// .sz-home 用 isolation:isolate 自成层叠上下文：内部 z-index 不能越过 router 图层（转场 / 跟手返回时下层首页露出，
// 否则首页内容会盖在上层写字页上、吃掉书写格的指针事件）。

injectStyles('home', `
.sz-home{text-spacing-trim:trim-start;position:relative;isolation:isolate;min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;
  padding:calc(12px + env(safe-area-inset-top, 0px)) 20px 0;color:${T.ink1}}
.sz-home__head{position:relative;flex:none}
.sz-home__date{margin:0;font-size:${T.fs13};line-height:${T.lh13};white-space:nowrap;color:${T.ink3}}
.sz-home__seal{width:16px;height:16px;box-sizing:border-box;border-radius:${T.rWork};display:block;flex:none} /* 印是图形：固定 seal16，白文「拾」是铺满的 svg（SealGlyph），不随 --k（Q2-10） */
.sz-home__title{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;font-size:${T.fs13};line-height:${T.lh13}} /* 标题「今天写几个字」只给读屏（D55：首页不放标题）；h1 + data-page-title 仍是页面标题与焦点目标 */
.sz-home__title:focus{outline:none}
.sz-home__stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.sz-home__main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center} /* 「拾」+ 题记这一组在页头与主按钮区之间居中（设计稿 E：.main 居中，组底留 8% 让视觉略偏上） */
.sz-home__group{flex:none;display:flex;align-items:flex-end;gap:18px;margin-bottom:8%;max-width:100%}
.sz-home__shi{flex:none;position:relative;display:block;width:var(--shi);height:var(--shi);color:${T.hand}} /* 日常态的「拾」：没有框的墨「拾」，--hand（深色是夜间纸上的暖白墨） */
.sz-home__shi>svg{position:absolute;left:-12%;top:-12%;width:124%;height:124%;max-width:none} /* 设计稿 E 的 128pt 是 1024 母版视框（墨框长边占 77%）；ShiMark 的视框是 1270（占 62%），放大 124% 回到同一字面大小 */
.sz-home__epi{margin:0;display:flex;flex-direction:row-reverse;gap:4px} /* 竖排题记：右起，第一句在最右；作者名在最左 */
.sz-home__epicol{flex:none;width:26px;white-space:nowrap;writing-mode:vertical-rl;font-family:${T.song};font-weight:400;font-size:${T.fs15};line-height:26px;letter-spacing:.2em;color:${T.ink2}}
.sz-home__epicol.sz-home__episrc{writing-mode:vertical-rl;font-size:${T.fs13};letter-spacing:.12em;color:${T.ink3}}
.sz-home__line{margin:-4% 0 4%;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:balance} /* 离开一周 / 特别组那天多出的那一句：在「拾」与题记组下面 */
.sz-home__noteblk{flex:none;max-width:100%}
.sz-home__other.sz-btn{--bx:12px;margin-top:4px;min-height:${T.hit}}
.sz-home__foot{flex:none;width:100%;display:flex;flex-direction:column;align-items:center;padding:0 0 ${CTA_LINE}px} /* 主按钮底边固定在 Tab 栏上沿上方 24pt（T3-01 / D53 ③）：文字按钮 / 首次说明 / 失败提示都在它上面，不论哪一态主按钮 y 不变 */
.sz-home__cta.sz-btn{width:240px;max-width:100%}
.sz-home__row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 12px}
.sz-home__side.sz-btn{margin-bottom:4px;min-height:${T.hit};justify-content:center}
.sz-home__note{margin:0 0 12px;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-home__fail{margin-bottom:12px;width:100%;max-width:345px;display:flex;flex-direction:column;gap:10px}
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
.sz-home--brand .sz-first__ch{opacity:0;animation:szBrandIn ${T.dFade} ${T.eOut} both;animation-delay:calc(${M.dur.xs}ms + var(--i) * ${BRAND_STAGGER_MS}ms)} /* 17 个字逐字淡入 */
.sz-home--brand .sz-first__seal{opacity:0;animation:szBrandSeal ${M.moment.sealDrop}ms ${T.eOut} ${BRAND_SEAL_DELAY_MS}ms both} /* 印最后落下；主按钮与说明句不参与动画：第一帧起可见可点（H1 / I2-05）。减少动态效果下不加 sz-home--brand（brandAllowed），直接是静帧（T1：直接终态） */
:root[data-ax] .sz-home__group{flex-direction:column;align-items:center;gap:0;margin-bottom:0} /* AX1–AX5：「拾」在上、题记在下，居中；「拾」的边长由 useShiAvail 按剩余高度给 */
:root[data-ax] .sz-home__epi{flex-direction:column;align-items:center;gap:0;box-sizing:border-box;padding-top:8px}
:root[data-ax] .sz-home__epi[data-hide="true"]{height:0;padding:0;overflow:hidden;visibility:hidden} /* 放不下时收起题记（D49 原规则：AX 档题记隐藏，读屏经标题的 describedby 照样读到全句）；height:0 仍能量到它的 scrollHeight */
:root[data-ax] .sz-home__epicol{writing-mode:horizontal-tb;width:auto;max-width:100%;white-space:normal;line-height:${T.lh13};letter-spacing:0;text-align:center;text-wrap:balance;font-size:${T.fs13}} /* 题记 AX 档改横排（现有规则）：两句 + 作者，都用 t13 档 */
:root[data-ax] .sz-home__line{margin:0}
:root[data-ax] .sz-home__cta.sz-btn{width:100%}
:root[data-ax] .sz-home__note{margin-bottom:4px}
:root[data-ax] .sz-home__row{flex-direction:column;gap:0}
:root[data-ax][data-text-large] .sz-home__foot .sz-btn--text{text-align:center} /* AX 档的文字按钮默认左对齐（ax.js）；首页的按钮区整体居中，折行时也居中 */
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
  return prefersReducedMotion(); // P2-13：全 App 唯一的判断
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

/** 竖排题记（D55 / 设计稿 E）：两句各一列，右起，作者名小字在最左；整块 aria-hidden，读屏经 h1 的 aria-describedby 读到全句与《篇名》；AX 档改横排（CSS）。 */
const EPIGRAPH_ID = 'sz-home-epigraph';

function Epigraph({ epigraph, epiRef, hide }) {
  const index = EPIGRAPHS.indexOf(epigraph);
  const label = `${epigraph.lines.join('')}${epigraph.source}`;
  return html`<figure ref=${epiRef} class="sz-home__epi" id=${EPIGRAPH_ID} data-testid="home-epigraph" data-index=${index} data-hide=${hide ? 'true' : undefined} aria-hidden="true" aria-label=${label}>
    ${epigraph.lines.map((line, i) => html`<span key=${i} class="sz-home__epicol">${line}</span>`)}
    <span class="sz-home__epicol sz-home__episrc">${epigraphAuthor(epigraph)}</span>
  </figure>`;
}

/** 日常态的墨「拾」：没有框，ShiMark 矢量，--hand；读屏名称 X-HOME.shiLabel。 */
function HomeShi({ size }) {
  return html`<div class="sz-home__shi" style=${{ '--shi': `${size}px` }} role="img" aria-label=${t('X-HOME.shiLabel')} data-testid="home-brand-shi">
    <${ShiMark} />
  </div>`;
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
          : html`<span key=${i} class="sz-first__hline" aria-hidden="true">${line}<span class="sz-home__seal sz-first__seal" data-testid="home-seal"><${SealGlyph} /></span></span>`))}
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
            <span class="sz-home__seal sz-first__seal" data-testid="home-seal"><${SealGlyph} /></span>
          </span>`))}
    </h1>
  </div>`;
}

/**
 * AX 档「拾」的边长与题记收放：剩余高度 = Tab 面板高 − 页头（日期）− 那一句话 − 按钮区 − 题记 − 留白；够 SHI_MIN 就「拾」按剩余高度缩（≤ SHI_SIZE），
 * 题记横排放在它下面；不够就先收起题记（height:0，仍给读屏），「拾」再按没有题记的剩余高度缩（≥ SHI_FLOOR）。只在 AX 档量；量不到（挂载前）= 不缩、不收。
 * 页头 / 题记 / 一句话 / 按钮区的高度与「拾」的大小无关，不会回环。题记收起时用 scrollHeight 量它放出来该有的高度，免得来回抖。
 */
function useShiAvail(rootRef, refs, active) {
  const [fit, setFit] = useState({ size: SHI_SIZE, hideEpi: false });
  useLayoutEffect(() => {
    if (!active) {
      setFit(prev => (prev.size === SHI_SIZE && !prev.hideEpi ? prev : { size: SHI_SIZE, hideEpi: false }));
      return undefined;
    }
    const root = rootRef.current;
    const panel = root ? root.parentElement : null;
    if (!panel) return undefined;
    const h = ref => (ref.current ? ref.current.offsetHeight : 0);
    const read = () => {
      const top = parseFloat(getComputedStyle(root).paddingTop) || 0;
      const epi = refs.epi.current ? refs.epi.current.scrollHeight : 0;
      const base = panel.clientHeight - top - h(refs.head) - h(refs.foot) - h(refs.note) - 12;
      const withEpi = Math.floor(base - epi);
      const next = withEpi >= SHI_MIN
        ? { size: Math.min(SHI_SIZE, withEpi), hideEpi: false }
        : { size: Math.max(SHI_FLOOR, Math.min(SHI_SIZE, Math.floor(base))), hideEpi: true };
      setFit(prev => (prev.size === next.size && prev.hideEpi === next.hideEpi ? prev : next));
    };
    read();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(panel);
    for (const ref of Object.values(refs)) if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [active, refs.note.current, refs.epi.current]);
  return fit;
}

function HomeScreen() {
  const state = useStoreState();
  useHomeClock();
  const compact = useCompact();
  const ax = useAxLevel();
  const rootRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const epiRef = useRef(null);
  const noteRef = useRef(null);
  const refs = { head: headRef, foot: footRef, epi: epiRef, note: noteRef };
  const width = useElementWidth(rootRef);
  const [failed, setFailed] = useState(null); // 写入失败的那个动作（再试一次重跑它）

  const model = homeModel(state, envNow(), { deck: deckAdapter });
  const view = model.view;
  const brand = useBrandMoment(view === 'first' && ax === 0, rootRef);
  const { size: shiSize, hideEpi } = useShiAvail(rootRef, refs, ax > 0 && view !== 'first');
  const ctaLabel = t(homeCtaKey(model));
  const note = homeNoteOf(model);
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

  const zone = view === 'first'
    ? html`<${FirstOpen} width=${width} compact=${compact} ax=${ax > 0} />`
    : html`<div class="sz-home__group" data-testid="home-group">
        <${HomeShi} size=${shiSize} />
        <${Epigraph} epigraph=${model.epigraph} epiRef=${epiRef} hide=${hideEpi} />
      </div>
      ${note ? html`<div ref=${noteRef} class="sz-home__noteblk">${view === 'special'
        ? html`<${CapitalHint} kind=${model.capital} />`
        : html`<p class="sz-home__line" data-testid="home-back-note">${t(note.key, note.vars)}</p>`}</div>` : null}`;

  const demo = getScreen(DEMO_SCREEN);
  const testHost = isTestHost();
  const classes = ['sz-home', compact ? 'sz-home--compact' : '', brand ? 'sz-home--brand' : '', view === 'first' ? 'sz-home--first' : ''].filter(Boolean).join(' ');

  return html`<section ref=${rootRef} class=${classes} data-testid="screen-home" data-view=${view}
    data-records=${model.records} data-resume=${model.resume} data-period=${model.period} data-compact=${compact ? 'true' : 'false'}
    data-today=${model.today} data-brand=${brand ? 'playing' : 'off'} data-ax=${ax > 0 ? String(ax) : undefined}>
    ${view === 'first' ? html`<div class="sz-home__head" aria-hidden="true" style=${{ minHeight: '28px' }}></div>` : html`<header ref=${headRef} class="sz-home__head">
      <p class="sz-home__date" data-testid="home-date">${dateText}</p>
    </header>`}
    ${view === 'first' ? null : html`<h1 class="sz-home__title sz-page__title--hidden" tabindex="-1" data-page-title data-testid="home-title" aria-describedby=${EPIGRAPH_ID}>${t('R-H01.title')}</h1>`}
    <div class="sz-home__stage">
    <div class="sz-home__main" data-testid="home-main">
      ${zone}
    </div>
    <div ref=${footRef} class="sz-home__foot" data-testid="home-foot">
      ${failed ? html`<${FailBlock} onCancel=${() => setFailed(null)} onRetry=${() => run(failed)} />` : null}
      ${view === 'first' ? html`<p class="sz-home__note" data-testid="home-first-tip">${t('R-H03.firstVisit')}</p>` : null}
      ${model.other ? html`<${Button} variant="text" class="sz-home__other" data-testid="other-line" data-slot=${model.other.slot}
        data-kind=${model.other.kind} data-remaining=${String(model.other.remaining)} aria-label=${resumeLineAria(model.other, t)}
        onClick=${() => run(resumeOther)}>${resumeLineText(model.other, t)}</${Button}>` : null}
      ${model.showPick || view === 'special' ? html`<div class="sz-home__row">
        ${model.showPick ? html`<${Button} variant="text" class="sz-home__side" data-testid="home-pick" onClick=${() => openPick()}>${t('X-HOME.pick')}</${Button}>` : null}
        ${view === 'special' ? html`<${Button} variant="text" class="sz-home__side" data-testid="home-capital-defer" onClick=${() => run(deferCapital)}>${t('X-HOME.capitalDefer')}</${Button}>` : null}
      </div>` : null}
      <${Button} variant="primary" class="sz-home__cta" data-testid="home-start" data-paper-source="home-start" aria-label=${ctaLabel}
        onClick=${event => { markPaperSource(event && event.currentTarget, 'home-start'); run(startMain); }}>${ctaLabel}</${Button}>
    </div>
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
