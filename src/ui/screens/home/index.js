// 习字 tab 根页 · 首页（02 M2-1；R-H01–R-H07、R-H11；原型 docs/design/v10/extracted/首页壳-v3-第十稿交接版.dc.html）。
// 自注册，无中心路由表。
//
// 版式（原型标准版 393×852 L37–L89、紧凑版 360×640 L90–L127；绝对坐标改成流式布局，间距取原型差值）：
//   纸纹层 + 光影层（light.js）→ 日期行「{M} 月 {D} 日 · {时段}」（R-H02）+ 右上竖排题记（R-H13，epigraphs.js 按日 doy % 3，P23）
//   → 大标题「今天写几个字」（R-H01）→「拾」主入口（开始写字 / 继续写字）→ 第一次来说明（R-H03）、大写数字特别组提示（D40 / P129）或 S01 两行（R-H04）
//   → 墨迹行 +「今天记录了 N 个字」（R-H07 / D12；P16 有未完成组时仍显示）→「自己选字 →」（R-H06）；三 tab 由 ui/root.js 画。
//   紧凑版（系统字号 --k ≥ 1.3 即 :root[data-text-large]（P131，D29 起替代 App 内更大字体）或视口高 ≤ policy.compactMaxHeight，P69，与写字页同一条件）：字大一档、墨迹与计数合成一行只放
//   最近 4 个字（A09，today.js INK_ROW_COMPACT_MAX）；「拾」主按钮不随字号缩小，始终 196×190（D36，覆盖旧「紧凑版 141×120」）。
//
// 状态 = 两个正交维度（01 §2；today.js homeModel）：records first|empty|record × resume none|A|B|A+B。
//
// 行为：
//   「拾」：B 有没写完的组 → 续写 B（D05 B 优先，原型 homeNav start）；否则 session.startA（A 有没写完 → 续写；否则第一次练习 /
//     今天的练习；选不出字 →「现在没有要写的字」页，R-H11）。
//   S01 第二行「… ›」：续写 A（原型 otherSlot）。
//   「自己选字 →」：在点击处理里同步打开查字组件 pick 模式（R-Q08）；选好后开「这次选的字」（B）：旧 B 没写完 → 关弹层、S02（R-H05）；
//     否则一次 commit 开 B，成功才关弹层、打开写字页；失败（{ok:false}）弹层就地显示 R-H06 三段式、输入还在。
//     原型 lkGo 开组前先关弹层（template L713 `ui.lk=null`），所以练完返回首页时弹层不在（R-Q07 的「回到弹层」只对查字卡片）。
//   「现在没有要写的字」页的「自己选字」也注册到这里（none.js setNoneActions）。
//   开组 / 续写写入失败：主入口下方就地三段式「没保存上，刚才的选择没记下。」［先不保存 / 再试一次］（R-G04；文案待定 P55）。
//   跨天：挂载与回前台时 session.expireStale()（P37）；时段 / 日期在回前台、每 30s 重算，变化时光影层淡入 600ms（减动直接切）。
//
// data-testid：screen-home（data-records / data-resume / data-period / data-compact）、home-date、home-epigraph（data-index）、
//   home-title、home-start、home-first-tip、home-capital-hint（D40 大写数字特别组提示，data-kind = capital1 | capital2）、resume-line（data-slot / data-kind）、other-line（data-slot）、home-ink-row、home-ink-item、
//   home-today-count、home-record（紧凑版合成行）、home-pick、home-start-fail（+ -cancel / -retry）、home-light；
//   测试宿主另有 demo-push、write-test-entry（开发入口，不是用户文案）。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen, getScreen, nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { EPIGRAPHS } from '../../../config/epigraphs.js';
import { isTestHost, now as envNow } from '../../../platform/env.js';
import { getStore } from '../../../store/store.js';
import { deckAdapter } from '../../../data/deck.js';
import * as core from '../../../core/session-start.js';
import { localDay, periodOf } from '../../../core/dates.js';
import { openQuery } from '../../components/query/index.js';
import { useCompact } from '../write/compact.js';
import { ensureNavHooks, expireStale, openWrite, resumeSlot, startA, startPicked } from '../session/index.js';
import { setNoneActions } from '../session/none.js';
import { homeModel, resumeLineText, epigraphColumnHeight, INK_ROW_MAX, INK_ROW_COMPACT_MAX } from './today.js';
import { LightLayer, LIGHT_CSS } from './light.js';
import { InkRow, INK_ROW_CSS } from './ink-row.js';
// 写字页自注册（M1-1）：首页是它的入口页，随首页一起加载。
import '../write/index.js';

// M1-1：测试宿主（?test=1 且 localhost）才出现的写字页入口，e2e 与走查用；开发标签不是用户文案（同 _demo）。
const DEV_WRITE_ENTRY = '写字（测试）';

// tab 名取自文案表（copy/common.js X-TABS）。
export const HOME_LABEL = t('X-TABS.write');
export const HOME_TAB = 'home';
/** 时段 / 日期重算间隔（ms）：只在时段或日期真的变了时重画。 */
export const CLOCK_TICK_MS = 30000;

// 演示子页只在测试主机上加载（ui/root.js），生产形态里 getScreen 为 null，入口不出现。
const DEMO_SCREEN = '_demo/sub';

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const ICON = () => html`<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 9.4 11 3l8 6.4V19H3V9.4M8.4 19v-6.6h5.2V19"></path></svg>`;

// .sz-home 用 isolation:isolate 自成层叠上下文：内部 z-index 不能越过 router 图层（转场 / 跟手返回时下层首页露出，
// 否则首页内容会盖在上层写字页上、吃掉书写格的指针事件）。

injectStyles('home', `
.sz-home{position:relative;isolation:isolate;min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;
  padding:calc(20px + env(safe-area-inset-top, 0px)) 24px 16px;color:${T.ink1}}
.sz-home>.paper-layer{z-index:0}
.sz-home>.sz-light{z-index:0}
.sz-home__head,.sz-home__main,.sz-home__dev{position:relative;z-index:1}
.sz-home__head{flex:none}
.sz-home__date{margin:0;font-size:${T.fs15};line-height:${T.lh15};white-space:nowrap;color:${T.ink2}}
.sz-home__epi{position:absolute;right:4px;top:36px;display:flex;align-items:flex-start;gap:12px}
.sz-home__src{display:flex;flex-direction:column;align-items:center;gap:10px}
.sz-home__srcline{display:block;width:20px;height:1px;background:${T.line}}
.sz-home__srctext{writing-mode:vertical-rl;font-family:${T.song};font-size:${T.fs13};line-height:${T.lh13};letter-spacing:.2em;
  color:${T.ink2}}
.sz-home__seal{margin-top:-6px;width:16px;height:16px;box-sizing:border-box;border-radius:${T.rWork};
  display:grid;place-items:center}
.sz-home__seal>span{display:grid;place-items:center;font-family:${T.kai};font-size:${T.fs11};line-height:1}
.sz-home__quote{margin:0;display:flex;flex-direction:row-reverse;gap:12px;font-family:${T.song};font-weight:400;font-size:${T.fs15};
  color:${T.ink2}}
.sz-home__col{writing-mode:vertical-rl;line-height:1;letter-spacing:.2em}
.sz-home__title{margin:123px 0 0;width:300px;max-width:calc(100% - 96px);font-family:${T.song};font-weight:500;font-size:${T.fs34};
  line-height:${T.lh34};color:${T.ink1}}
.sz-home__title:focus{outline:none}
.sz-home__gap{flex:3 1 24px;min-height:24px}
.sz-home__gap--end{flex:2 1 16px;min-height:16px}
.sz-home__main{flex:none;display:flex;flex-direction:column;align-items:center}
.sz-home__cta.sz-btn{position:relative;width:196px;height:190px;padding:0;border-radius:${T.rCtl};background-color:${T.btnBg};
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:${T.btnFg}}
.sz-home__cta.sz-btn[data-pressed]{background-color:${T.btnDown};filter:none}
.sz-home__glyph{font-family:${T.kai};font-size:64px;line-height:1;color:${T.btnFg}}
.sz-home__label{position:relative;font-size:${T.fs15};line-height:${T.lh15}}
.sz-home__arrow{position:absolute;left:100%;top:0;margin-left:6px}
.sz-home__rows{margin-top:12px;width:100%;display:flex;flex-direction:column;align-items:center}
.sz-home__line{margin:0;min-height:22px;text-align:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-home__other.sz-btn{min-height:44px;padding:0 12px;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};
  text-decoration:underline;text-underline-offset:4px;text-decoration-color:${T.ink4}}
.sz-home__record{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:0 12px;min-height:44px} /* M6-2：放不下一行（320 宽 + 大字）时计数换到下一行，不越出屏幕 */
.sz-home__pick.sz-btn{margin-top:14px;width:196px;min-height:44px;justify-content:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-home__fail{margin-top:12px;width:100%;max-width:345px;display:flex;flex-direction:column;gap:10px}
.sz-home__failnote{margin:0;text-align:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-home__failbtns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-home__dev{flex:none;display:flex;flex-direction:column;gap:8px;margin-top:12px}
.sz-home--compact{padding:calc(14px + env(safe-area-inset-top, 0px)) 20px 12px}
.sz-home--compact .sz-home__date{font-size:${T.fs17};line-height:${T.lh17s}}
.sz-home--compact .sz-home__epi{right:2px;top:30px;gap:10px}
.sz-home--compact .sz-home__src{gap:8px}
.sz-home--compact .sz-home__srcline{width:16px}
.sz-home--compact .sz-home__quote{gap:10px}
.sz-home--compact .sz-home__title{margin-top:68px;font-size:${T.fs34};line-height:${T.lh34}}
.sz-home--compact .sz-home__label{font-size:${T.fs17};line-height:${T.lh17s}}
.sz-home--compact .sz-home__rows{margin-top:10px}
.sz-home--compact .sz-home__line{min-height:44px;display:flex;align-items:center;justify-content:center;font-size:${T.fs17};line-height:${T.lh17s}}
.sz-home--compact .sz-home__other.sz-btn{font-size:${T.fs17};line-height:${T.lh17s};white-space:nowrap}
.sz-home--compact .sz-home__record .sz-home__line{white-space:nowrap}
.sz-home--compact .sz-home__pick.sz-btn{margin-top:6px;font-size:${T.fs17};line-height:${T.lh17s}}
${LIGHT_CSS}
${INK_ROW_CSS}
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
 * 时段 / 日期时钟：回前台（visibilitychange / pageshow）与每 CLOCK_TICK_MS 重算，只在日期或时段变了时触发重画；
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
  const padTop = (compact ? 56 : 70) + (colH - 96) / 2;
  const index = EPIGRAPHS.indexOf(epigraph);
  // 读屏：竖排两列按视觉顺序是右列先读，整句读序会错；整张 figure 给一句话的名称，子节点 aria-hidden（A9）。
  const label = `${epigraph.lines.join('')}${epigraph.source}`;
  return html`<figure class="sz-home__epi" data-testid="home-epigraph" data-index=${index} style=${{ margin: 0 }} aria-label=${label}>
    <figcaption class="sz-home__src" aria-hidden="true" style=${{ paddingTop: `${padTop}px` }}>
      <span class="sz-home__srcline" aria-hidden="true"></span>
      <span class="sz-home__srctext">${epigraph.source}</span>
      <span class="sz-home__seal" aria-hidden="true"><span>${t('X-HOME.sealGlyph')}</span></span>
    </figcaption>
    <blockquote class="sz-home__quote" aria-hidden="true">
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

function HomeScreen() {
  const state = useStoreState();
  useHomeClock();
  const compact = useCompact();
  const [failed, setFailed] = useState(null); // 写入失败的那个动作（再试一次重跑它）
  useEffect(() => {
    ensureNavHooks(); // R-H10 轻提示的 router 订阅（刷新后直接恢复到写字页时也要有）
  }, []);

  const model = homeModel(state, envNow(), { inkRowMax: compact ? INK_ROW_COMPACT_MAX : INK_ROW_MAX, deck: deckAdapter });
  const resumeOn = model.resume !== 'none';
  const ctaLabel = t(resumeOn ? 'X-HOME.continue' : 'X-HOME.start');
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

  const getInk = record => {
    try {
      return getStore().getInk(record);
    } catch (error) {
      return null;
    }
  };

  const countText = t('R-H07.todayCount', { n: model.count });
  let recordBlock = null;
  if (model.showRecord) {
    recordBlock = compact
      ? html`<div class="sz-home__record" data-testid="home-record">
          <${InkRow} records=${model.inkRow} count=${model.count} getInk=${getInk} inline=${true} />
          <p class="sz-home__line" data-testid="home-today-count">${countText}</p>
        </div>`
      : html`<${InkRow} records=${model.inkRow} count=${model.count} getInk=${getInk} />
        <p class="sz-home__line" data-testid="home-today-count">${countText}</p>`;
  }

  const demo = getScreen(DEMO_SCREEN);
  const testHost = isTestHost();

  return html`<section class=${compact ? 'sz-home sz-home--compact' : 'sz-home'} data-testid="screen-home"
    data-records=${model.records} data-resume=${model.resume} data-period=${model.period} data-compact=${compact ? 'true' : 'false'}
    data-today=${model.today}>
    <div class="paper-layer" aria-hidden="true"></div>
    <${LightLayer} period=${model.period} />
    <header class="sz-home__head">
      <p class="sz-home__date" data-testid="home-date">${dateText}</p>
      <${Epigraph} epigraph=${model.epigraph} compact=${compact} />
      <h1 class="sz-home__title" tabindex="-1" data-page-title data-testid="home-title">${t('R-H01.title')}</h1>
    </header>
    <div class="sz-home__gap" aria-hidden="true"></div>
    <div class="sz-home__main">
      <${Button} variant="plain" class="sz-home__cta" data-testid="home-start" aria-label=${ctaLabel}
        onClick=${() => run(startMain)}>
        <span class="sz-home__glyph" aria-hidden="true">${t('X-HOME.ctaGlyph')}</span>
        <span class="sz-home__label" aria-hidden="true">${ctaLabel}<span class="sz-home__arrow">${t('X-HOME.arrow')}</span></span>
      </${Button}>
      ${failed ? html`<${FailBlock} onCancel=${() => setFailed(null)} onRetry=${() => run(failed)} />` : null}
      <div class="sz-home__rows">
        ${model.showFirstTip ? html`<p class="sz-home__line" data-testid="home-first-tip">${t('R-H03.firstVisit')}</p>` : null}
        ${model.capital ? html`<p class="sz-home__line" data-testid="home-capital-hint" data-kind=${model.capital}>${t('X-HOME.capitalHint')}</p>` : null}
        ${model.primary ? html`<p class="sz-home__line" data-testid="resume-line" data-slot=${model.primary.slot}
          data-kind=${model.primary.kind}>${resumeLineText(model.primary, t)}</p>` : null}
        ${model.other ? html`<${Button} variant="text" class="sz-home__other" data-testid="other-line" data-slot=${model.other.slot}
          data-kind=${model.other.kind} onClick=${() => run(resumeOther)}
          >${resumeLineText(model.other, t)} ${t('X-HOME.more')}</${Button}>` : null}
        ${recordBlock}
      </div>
      <${Button} variant="text" class="sz-home__pick" data-testid="home-pick" onClick=${() => openPick()}>${t('X-HOME.pick')}</${Button}>
    </div>
    <div class="sz-home__gap sz-home__gap--end" aria-hidden="true"></div>
    ${demo || testHost ? html`<div class="sz-home__dev">
      ${demo ? html`<${Button} variant="secondary" data-testid="demo-push"
        onClick=${() => nav.push(DEMO_SCREEN, { level: 1 })}>${demo.label}</${Button}>` : null}
      ${testHost ? html`<${Button} variant="secondary" data-testid="write-test-entry"
        onClick=${() => nav.push('write', { slot: 'A' })}>${DEV_WRITE_ENTRY}</${Button}>` : null}
    </div>` : null}
  </section>`;
}

registerScreen(HOME_TAB, HomeScreen, { tab: true, order: 0, label: HOME_LABEL, icon: ICON });
