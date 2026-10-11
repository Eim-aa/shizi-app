// M6-2 显示矩阵（02 §8 M6「矩阵 e2e」；§8.1 反例 8「短屏、大字、长文本、键盘」；需求 R13「393×852、360×640、130% 文字、
// 长内容与键盘场景，允许滚动，关键操作不被遮挡」；acceptance M1 / M2 / M3-M4「未覆盖」里的 320×568 / 130% / 深色断言）。
//
// 矩阵：主组 2 视口（393×852、360×640）× 2 主题（prefers-color-scheme light / dark）× 2 字号（系统字号 L / XXXL：P1-E6 / D29 起
//       模拟原生 shiziContentSize，--k 1 / 1.35 + :root[data-text-large]；原 App 内大字 :root[data-large] 1.3 已删）
//       × 2 减少动态效果（prefers-reduced-motion no-preference / reduce）× PAGES（17 页：P1-E7 加了月字帖页）= 272 格；
//       附加组 A：320×568 × 2 主题 × 2 大字 × 2 减动 × 17 页 = 136 格；
//       附加组 B：浏览器基础字号 130%（CDP Page.setFontSizes standard 16 → 21px，整数最接近 20.8）× 393×852 浅色 /
//       360×640 深色 × 2 大字 × 17 页 = 68 格。
// 每页先用长文本 fixture（fixtures/long-text.mjs：题面最长的卡、最长词、300 字一年量级种子、说明句最长的结果页）造数，
// 再在同一页上逐格切大字 / 减动（视口与主题按 worker 固定），等有限时长动画跑完后，每格断言：
//   0. 条件生效：视口宽高、prefers-color-scheme、--k（1 / 1.35）、prefers-reduced-motion 与这一格一致；130% 组根字号 = 21px。
//   1. 无横向溢出 / 截断 / 互压：documentElement 与顶层图层（有模态弹层时只查弹层）里每个滚动容器 scrollWidth ≤ clientWidth；
//      每段文字（Range 矩形）不越出 0–视口宽，也不被 overflow:hidden / clip 的祖先截掉一截（读屏隐藏且整段在框外的有意隐藏
//      除外）；两段文字的字面（逐行中心 ±0.45em）不互相压住超过 2×2px（sticky 条与从它下面滚过的内容不比）。
//   2. 主操作可达：该页主按钮存在；滚到它（scrollIntoView nearest，允许滚动）后整块在可见区（键盘弹起时是 visualViewport
//      可见区）里，且中心与四边中点内缩 4px 的 elementFromPoint 都落在它自己身上（不被底栏 / tab 条 / 键盘 / 其它层盖住）。
//   3. 正文与底栏不遮挡：tab 根页 tabpanel 底 ≤ tab 条顶；子页 .sz-page__body 底 ≤ .sz-page__foot 顶；每个滚动容器滚到底时
//      最后一个文字块完整露在容器可见区（与键盘上沿取小）里且 elementFromPoint 命中自己。
//   4. 文字对比度 ≥ 4.5（WCAG 相对亮度；前景 alpha × 祖先 opacity 合成到背景，背景沿祖先链取「盒子盖住文字中心」的
//      background-color 逐层合成到不透明为止；input 的值与 ::placeholder 也算）。豁免见 EXEMPT（逐条写明依据）。
//   5. 可点控件 ≥ 44×44（button / a[href] / input / select / textarea / summary / role=button|tab|switch|checkbox|radio|
//      option|menuitem / 可 Tab 聚焦元素；输入框按包着它的 <label> 量；R-W27 / R-G09，base.css --tap）。
//   6. 截图：每格一张 jpeg，落 SHIZI_E2E_SHOTS（缺省 <系统临时目录>/shizi-e2e-matrix），命名
//      <组>-<宽>x<高>-<主题>-<N|L>-<M|R>-<页>.jpg；不进仓库、不做像素比对（reference/G-tests.md 第 7 条）。
// 130% 组说明：全站字号是 px × --k，浏览器基础字号不改变版式（P133：网页不读浏览器默认字号）；「约 130% 文字」在产品里由
// 系统字号 XXXL（--k 1.35，P130）实现，已在每组的 L 格覆盖；AX 档见 66-text-size.spec.js。iOS 真机系统字号矩阵是 DEVICE_QA Q24。
// 断言按格汇总：每格一条 ok（失败时列出该格全部问题），外加每组一条「全部格子通过」与零 console error。
//
// 实现：spec 拿 runner 给的 page 所在的 browser 另开 context（视口 / 主题 / dsf 1），各 worker 并行（MATRIX_CONCURRENCY，
// 缺省 8——大半时间在等页面，不按 CPU 数收；runner 每个 spec 限时 90s，本机 8 并发约 25s）；每个 context 自己收集
// console.error / pageerror / requestfailed / HTTP ≥400，最后断言为零。MATRIX_PAGES=home,write 只跑列出的页（调试用）。
// 键盘：查字弹层页装一个假的 visualViewport（与 20-query.spec.js 同法），高度 = 视口高 × 0.4（393×852 ≈ 341，接近 iPhone
// 键盘 + 候选栏 336）；Chromium 无软键盘，真机键盘避让仍是 M7 真机项。

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { longTextCatalog, seedLongText } from './fixtures/long-text.mjs';

const SHOTS = process.env.SHIZI_E2E_SHOTS || join(tmpdir(), 'shizi-e2e-matrix');
const CONCURRENCY = Math.max(1, Number(process.env.MATRIX_CONCURRENCY) || 8);
const ONLY_PAGES = (process.env.MATRIX_PAGES || '').split(',').filter(Boolean);
const TOP = '.sz-layer[data-top="true"]';
const PRESS_MS = 450; // 要点按钮前：新页面 / 新状态后 0.4s 按钮不响应（01 §6.6）
const SETTLE_MS = 200; // 进页后稍等再量；动画另由 applyCell 等 getAnimations() 跑完（本 spec 不点按钮，不需 01 §6.6 的 0.4s）
const MIN_CONTRAST = 4.5;
const MIN_TAP = 44;
const KEYBOARD_RATIO = 0.4;

// 对比度豁免（报告里逐条列）。disabled 是 WCAG 1.4.3 自带的例外；其余是「字形当图形 / 印章」——都必须在 aria-hidden 子树里
// （读屏与文字说明另有出处），且对比度值已登记待设计确认，不在这里裁决颜色：
//   glyph-wall   字库墨墙 / 小墙的字形（wall.js Glyph）：墨色四档透明度即信息（R-L03「墨色越浅，越久没写」、P81；最淡档 .55，
//                D36：非文字对比度 ≥ 3:1 由 test/ui/wall-tone.test.mjs 按令牌实算保证，这里仍按字形当图形豁免 4.5:1 文字线），自选未写是
//                透明填充 + 描边；格子按钮有无障碍名「{字}，{状态}」，图例有文字。
//   glyph-result 没有本人笔迹的格子里的衬底字面（结果页看过答案 / 跳过格、详情与记录页的无笔迹格、年报与空态的占位字、首页墨迹行的占位字；
//                R-R02 / 10.12，色 --under = tokens.json「答案衬底 / 没有本人墨的字格」，对笺 ≥ 3:1 由 test/ui/contrast.test.mjs 实算；D43 起 P101
//                不再按旧 --i4 逐项豁免，这里只是 4.5:1 文字线对大字面 / 图形的豁免）：字面都在 aria-hidden 里，格子的无障碍名与格下文字说明另有。
//   seal         首页题记印章、关于页印章、字帖落款印章（「拾」白文印，--seal 底 --on-seal 字形；深色 3.7:1，tokens.json contrast onSeal/seal）：
//                印章 / 标识类装饰（WCAG 1.4.3 logotype 例外，P101 已决定 D43）。
export const EXEMPT = Object.freeze([
  { id: 'disabled', sel: 'button:disabled, [aria-disabled="true"], input:disabled, fieldset:disabled', hidden: false },
  { id: 'glyph-wall', sel: '.sz-lib__g', hidden: true },
  { id: 'glyph-result', sel: '.sz-rcell__glyph, .sz-dcell__glyph, .sz-scell__glyph, .sz-ann__glyph, .sz-ann__eglyph, .sz-list-empty__glyph, .sz-inkrow__glyph', hidden: true },
  { id: 'seal', sel: '.sz-home__seal, .sz-seal, .sz-about__seal', hidden: true },
]);

// ---------------------------------------------------------------------------------------------- 页面清单

async function waitTopScreen(page, name) {
  await page.waitForFunction(n => {
    const app = document.querySelector('.sz-app');
    return !!app && app.dataset.topScreen === n && app.dataset.navAnim === 'idle';
  }, name, { timeout: 15000 });
  await page.waitForTimeout(SETTLE_MS);
}

async function switchTab(page, name) {
  await page.evaluate(async n => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(n);
  }, name);
  await waitTopScreen(page, name);
}

async function push(page, name, params = {}) {
  await page.evaluate(async ({ n, p }) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, { n: name, p: params });
  await waitTopScreen(page, name);
}

/** 每页：seed（phase）→ 进入 → 主按钮选择器（在顶层图层 / 弹层里找第一个可见的）。 */
const PAGES = [
  { id: 'home', go: page => switchTab(page, 'home'), primary: ['home-start'] },
  {
    id: 'write',
    go: page => push(page, 'write', { slot: 'A' }),
    ready: `${TOP} [data-testid="write-hint"][data-state]`,
    primary: ['write-done', 'write-hint', 'write-show-answer', 'write-skip'],
  },
  {
    id: 'judge',
    phase: 'compare',
    go: page => push(page, 'write', { slot: 'A' }),
    ready: `${TOP} .sz-write[data-phase="compare"]`,
    primary: ['write-judge-correct', 'write-judge-wrong'],
  },
  { id: 'result', go: (page, info) => push(page, 'result', { slot: 'B', sessionId: info.resultSessionId }), primary: ['result-leave'] },
  { id: 'library', go: page => switchTab(page, 'library'), primary: ['library-query-slot'], primaryDeep: true },
  {
    id: 'list',
    go: async page => {
      await switchTab(page, 'library');
      await page.evaluate(async () => {
        const { openList } = await import('/src/ui/screens/library/list.js');
        openList('wrong');
      });
      await waitTopScreen(page, 'library-list');
    },
    primary: ['list-go'],
  },
  // 「练这些字」只在筛选后出现；默认视图的主操作是页头尾端的「排序 · 筛选」与格子（点格子进单字详情，H1）。
  { id: 'all', go: page => push(page, 'library-all'), ready: `${TOP} [data-testid="all-cell"]`, primary: ['all-menu-open', 'all-cell'] },
  { id: 'switch', go: page => push(page, 'library-switch'), primary: ['libswitch-row'] },
  {
    id: 'detail',
    go: async (page, info) => {
      await page.evaluate(async c => {
        const { openDetail } = await import('/src/ui/screens/detail/index.js');
        openDetail(c);
      }, info.detailChar);
      await waitTopScreen(page, 'detail');
    },
    primary: ['detail-practice'],
  },
  {
    id: 'query',
    go: async (page, info) => {
      await switchTab(page, 'home');
      await page.evaluate(ratio => {
        class FakeVV extends EventTarget {}
        const vv = new FakeVV();
        vv.width = window.innerWidth;
        vv.height = window.innerHeight;
        vv.offsetTop = 0;
        vv.offsetLeft = 0;
        vv.scale = 1;
        window.__fakeVV = vv;
        window.__kbRatio = ratio;
        Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
      }, KEYBOARD_RATIO);
      await page.waitForTimeout(PRESS_MS);
      await page.click(`${TOP} [data-testid="home-pick"]`);
      await page.waitForSelector('[data-testid="query-sheet"] [data-testid="query-input"]');
      await page.fill('[data-testid="query-sheet"] [data-testid="query-input"]', info.queryText);
      await page.waitForSelector('[data-testid="query-sheet"] [data-testid="query-row-select"]');
      await page.waitForTimeout(PRESS_MS);
      await page.click('[data-testid="query-sheet"] [data-testid="query-row-select"]');
      await page.waitForSelector('[data-testid="query-sheet"] [data-testid="query-row-select"][aria-checked="true"]');
      await page.evaluate(() => {
        window.__fakeVV.height = Math.round(window.innerHeight * (1 - window.__kbRatio));
        window.__fakeVV.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => {
        const s = document.querySelector('.sz-sheet');
        return !!s && s.dataset.keyboard === 'true';
      });
      await page.waitForTimeout(SETTLE_MS);
    },
    keyboard: true,
    primary: ['query-input', 'query-go'],
  },
  { id: 'mine', go: page => switchTab(page, 'mine'), primary: ['mine-records'] },
  { id: 'records', go: page => push(page, 'records'), primary: ['records-prev'] },
  // 阶段 1 P1-E7：月字帖页（本月，长文本种子里有 300 字一年量级的记录）
  { id: 'month', go: page => push(page, 'month'), ready: `${TOP} [data-testid="month-cell"]`, primary: ['month-save'] },
  { id: 'settings', go: page => push(page, 'settings'), primary: ['.sz-set__row'] },
  { id: 'backup', go: page => push(page, 'backup'), primary: ['backup-export'] },
  { id: 'annual', go: page => push(page, 'annual'), primary: ['page-back'] },
  { id: 'about', go: page => push(page, 'about'), primary: ['about-rows'], primaryDeep: true },
].filter(p => !ONLY_PAGES.length || ONLY_PAGES.includes(p.id));

// ---------------------------------------------------------------------------------------------- 组与 worker

const MAIN_VIEWS = [{ width: 393, height: 852 }, { width: 360, height: 640 }];
const THEMES = ['light', 'dark'];
const BOOL = [false, true];

function workers() {
  const list = [];
  for (const view of MAIN_VIEWS) {
    for (const theme of THEMES) list.push({ group: 'main', view, theme, larges: BOOL, motions: BOOL });
  }
  for (const theme of THEMES) list.push({ group: '320', view: { width: 320, height: 568 }, theme, larges: BOOL, motions: BOOL });
  list.push({ group: 'font130', view: MAIN_VIEWS[0], theme: 'light', larges: BOOL, motions: [false], baseFont: 21 });
  list.push({ group: 'font130', view: MAIN_VIEWS[1], theme: 'dark', larges: BOOL, motions: [false], baseFont: 21 });
  return list;
}

// ---------------------------------------------------------------------------------------------- 每格测量（页面里执行）

/* eslint-disable no-undef */
function measureInPage({ minContrast, minTap, exempt, expect }) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // 这一格的条件真的生效了（视口 / 主题 / 大字 --k / 减少动态效果）。
  const env = {
    w: vw, h: vh, dark: matchMedia('(prefers-color-scheme: dark)').matches,
    k: getComputedStyle(document.documentElement).getPropertyValue('--k').trim(),
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const want = { w: expect.w, h: expect.h, dark: expect.dark, k: expect.large ? '1.35' : '1', reduce: expect.reduce };
  const envProblems = Object.keys(want).filter(key => env[key] !== want[key]).map(key => `env ${key}=${env[key]} (want ${want[key]})`);
  const vv = window.__fakeVV && window.__fakeVV.height < vh ? window.__fakeVV : null;
  const visBottom = vv ? vv.offsetTop + vv.height : vh;
  const problems = [...envProblems];
  const top = document.querySelector('.sz-layer[data-top="true"]');
  if (!top) return { problems: ['no top layer'], vw, vh };
  // 有模态弹层时下面的页面在遮罩后面、不可操作（inert），只查弹层本身（与轻提示）。
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(el => el.checkVisibility());
  const toasts = [...document.querySelectorAll('[aria-live]')].filter(el => el.checkVisibility());
  const roots = [...(dialogs.length ? dialogs : [top]), ...toasts]
    .filter((el, i, all) => all.indexOf(el) === i && !all.some(o => o !== el && o.contains(el)));
  const desc = el => {
    const tidv = el.getAttribute && el.getAttribute('data-testid');
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    const txt = (el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 14);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${tidv ? `[${tidv}]` : ''}${txt ? `「${txt}」` : ''}`;
  };
  const visible = el => {
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const all = [];
  for (const root of roots) for (const el of [root, ...root.querySelectorAll('*')]) all.push(el);

  // ---- 1. 横向溢出
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) problems.push(`document scrollWidth ${de.scrollWidth} > ${de.clientWidth}`);
  const hScrollers = new Set();
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) {
      if (el.scrollWidth > el.clientWidth + 1 && visible(el)) problems.push(`h-overflow ${desc(el)} ${el.scrollWidth}>${el.clientWidth}`);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) hScrollers.add(el);
    }
  }
  const textEls = [];
  const textNodes = []; // {el, r}：每段非空文字节点自己的矩形（Range），不是所在元素的盒子
  for (const el of all) {
    if (!visible(el)) continue;
    const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (nodes.length || isField) textEls.push(el);
    const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      // ink：逐行矩形收到字面中心 ±0.45em（汉字字面约 0.9em；内容区含上下留白，互相挨着的两行不算压住）。
      const ink = [...range.getClientRects()].filter(x => x.width > 0 && x.height > 0).map(x => {
        const cy = x.top + x.height / 2;
        const half = Math.min(x.height / 2, fs * 0.45);
        return { left: x.left, right: x.right, top: cy - half, bottom: cy + half };
      });
      if (r.width > 0 && r.height > 0) textNodes.push({ el, r, ink });
    }
    if (isField) {
      const r = el.getBoundingClientRect();
      textNodes.push({ el, r, ink: [r] });
    }
  }
  // 文字越出视口宽，或被 overflow:hidden / clip 的祖先截掉一截（滚动容器除外——滚得到；它自己的 scrollWidth 上面已查）。
  const f1 = v => v.toFixed(1);
  for (const { el, r } of textNodes) {
    let scrollAncestor = null;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const scrolls = /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
      if (scrolls) {
        scrollAncestor = scrollAncestor || p;
        continue;
      }
      if (scrollAncestor) continue;
      const pr = p.getBoundingClientRect();
      const cutX = /(hidden|clip)/.test(cs.overflowX) && (r.left < pr.left - 0.5 || r.right > pr.right + 0.5);
      const cutY = /(hidden|clip)/.test(cs.overflowY) && (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5);
      // 读屏隐藏且整段都在裁切框外的是有意藏起来的（例：字库事实行每行行首的「·」用负边距推出框外），不算截断。
      const whollyOut = r.right <= pr.left + 0.5 || r.left >= pr.right - 0.5 || r.bottom <= pr.top + 0.5 || r.top >= pr.bottom - 0.5;
      if ((cutX || cutY) && whollyOut && el.closest('[aria-hidden="true"]')) break;
      if (cutX || cutY) {
        problems.push(`clipped ${desc(el)} [${f1(r.left)},${f1(r.top)},${f1(r.right)},${f1(r.bottom)}] by ${desc(p)} [${f1(pr.left)},${f1(pr.top)},${f1(pr.right)},${f1(pr.bottom)}]`);
        break;
      }
    }
    if (!scrollAncestor && (r.left < -0.5 || r.right > vw + 0.5)) problems.push(`off-x ${desc(el)} [${f1(r.left)}, ${f1(r.right)}]`);
  }

  // ---- 1b. 文字互相压住：两段文字（不同元素）的字面矩形（逐行，见上）交叠超过 2px × 2px。只比看得见的部分（与所在
  //         滚动 / 裁切容器的可见框求交）；一方在 position:sticky 的条里、另一方不在时不比（内容本来就从它下面滚过，
  //         能否滚出来由 reachInPage 的「滚到底」检查）。
  // 所在滚动容器之内最近的 sticky 祖先（没有则 null）：同一滚动容器里 sticky 条与从它下面滚过的内容不比。
  const pinned = el => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'sticky') return p;
      if (p !== el && /(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return null;
    }
    return null;
  };
  const visRect = (el, r) => {
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        box = { left: Math.max(box.left, pr.left), top: Math.max(box.top, pr.top), right: Math.min(box.right, pr.right), bottom: Math.min(box.bottom, pr.bottom) };
      }
    }
    return box;
  };
  const vis = [];
  for (const t of textNodes) {
    const pin = pinned(t.el);
    for (const x of t.ink) {
      const v = visRect(t.el, x);
      if (v.right - v.left > 1 && v.bottom - v.top > 1) vis.push({ el: t.el, v, pin });
    }
  }
  const overlaps = [];
  const seenPairs = new Set();
  for (let i = 0; i < vis.length; i += 1) {
    for (let j = i + 1; j < vis.length; j += 1) {
      const a = vis[i];
      const b = vis[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || a.pin !== b.pin) continue;
      const w = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left);
      const h = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top);
      if (w > 2 && h > 2) {
        const key = `${desc(a.el)} × ${desc(b.el)}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        overlaps.push(`overlap ${key} (${w.toFixed(1)}×${h.toFixed(1)})`);
      }
    }
  }
  problems.push(...overlaps.slice(0, 6));
  if (overlaps.length > 6) problems.push(`… ${overlaps.length - 6} more overlaps`);

  // ---- 3. 正文与底栏
  const rect = el => (el ? el.getBoundingClientRect() : null);
  const tabs = top.querySelector('[role="tablist"]');
  const panel = top.querySelector('.sz-tabroot__panel');
  if (tabs && panel && rect(panel).bottom > rect(tabs).top + 0.5) problems.push(`tabpanel bottom ${rect(panel).bottom} > tab bar top ${rect(tabs).top}`);
  const pageBody = top.querySelector('.sz-page__body');
  const pageFoot = top.querySelector('.sz-page__foot');
  if (pageBody && pageFoot && visible(pageFoot) && rect(pageBody).bottom > rect(pageFoot).top + 0.5) {
    problems.push(`page body bottom ${rect(pageBody).bottom} > foot top ${rect(pageFoot).top}`);
  }

  // ---- 4. 对比度
  const parse = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = k => (fg[k] * fg.a + bg[k] * bg.a * (1 - fg.a)) / a;
    return { r: mix('r'), g: mix('g'), b: mix('b'), a };
  };
  const lum = c => {
    const ch = v => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const bgAt = (el, cx, cy) => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (!c || c.a === 0) continue;
      const pr = p.getBoundingClientRect();
      if (p !== el && (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom)) continue;
      layers.push(c);
      if (c.a >= 1) break;
    }
    let bg = { ...pageBg, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg);
    return bg;
  };
  const exemptOf = el => exempt.find(x => el.closest(x.sel) && (!x.hidden || el.closest('[aria-hidden="true"]')));
  let minRatio = Infinity;
  let checked = 0;
  const exempted = {};
  for (const el of textEls) {
    const ex = exemptOf(el);
    if (ex) {
      exempted[ex.id] = (exempted[ex.id] || 0) + 1;
      continue;
    }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let opacity = 1;
    for (let p = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
    const samples = [];
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (!isField || el.value) samples.push({ color: cs.color, what: isField ? 'value' : 'text' });
    if (isField && !el.value && el.placeholder) samples.push({ color: getComputedStyle(el, '::placeholder').color, what: 'placeholder' });
    for (const s of samples) {
      const fg0 = parse(s.color);
      if (!fg0) continue;
      const bg = bgAt(el, cx, cy);
      const fg = over({ ...fg0, a: fg0.a * opacity }, bg);
      const q = ratio(fg, bg);
      checked += 1;
      if (q < minRatio) minRatio = q;
      if (q < minContrast - 1e-6) {
        const hex = c => `#${[c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
        problems.push(`contrast ${q.toFixed(2)} ${desc(el)} ${s.what} ${hex(fg)} on ${hex(bg)}`);
      }
    }
  }

  // ---- 5. 可点控件 ≥ 44
  const tapSel = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], '
    + '[role="switch"], [role="checkbox"], [role="radio"], [role="option"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  let taps = 0;
  for (const el of all) {
    if (!el.matches(tapSel) || !visible(el)) continue;
    // 输入框的点按区域是包着它的 <label>（点 label 任何位置都聚焦输入框）。
    const hit = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.closest('label') ? el.closest('label') : el;
    const r = hit.getBoundingClientRect();
    taps += 1;
    // H1：文字按钮的点击区宽度由 ::after 补到 ≥ 44（盒子只有字宽 + 内边距），所以宽度也按「中心左右各 minTap/2 − 0.5 处仍命中它」算
    const cxm = r.left + r.width / 2;
    const cym = r.top + r.height / 2;
    const reach = minTap / 2 - 0.5;
    const hitsIt = x => { const top = document.elementFromPoint(x, cym); return !!top && (top === hit || hit.contains(top)); };
    const wideEnough = r.width >= minTap - 0.5 || (el.matches('.sz-btn--text') && hitsIt(cxm - reach) && hitsIt(cxm + reach));
    if (!wideEnough || r.height < minTap - 0.5) problems.push(`tap ${desc(el)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
  }
  return { problems, vw, vh, visBottom, minRatio: Number.isFinite(minRatio) ? Number(minRatio.toFixed(2)) : null, checked, taps, exempted };
}

/** 主操作可达 + 滚到底时最后一块文字不被盖住（页面里执行；会滚动，之后把滚动复原）。 */
function reachInPage({ primary, deep }) {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const vv = window.__fakeVV && window.__fakeVV.height < vh ? window.__fakeVV : null;
  const visBottom = vv ? vv.offsetTop + vv.height : vh;
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const sheet = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find(el => el.checkVisibility()) || null;
  const scope = sheet || top;
  const saved = [];
  const scrollers = [...(sheet ? sheet.querySelectorAll('*') : top.querySelectorAll('*'))].filter(el => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
  });
  for (const el of scrollers) saved.push([el, el.scrollTop]);
  const hits = (el, x, y) => {
    const h = document.elementFromPoint(x, y);
    return !!h && (h === el || el.contains(h));
  };
  const desc = el => `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') || el.className}]`;
  const find = s => {
    const sel = s.startsWith('.') ? s : `[data-testid="${s}"]`;
    const list = [...scope.querySelectorAll(sel)];
    let el = list.find(e => e.checkVisibility({ visibilityProperty: true }));
    if (el && deep) {
      const inner = el.matches('button, input, a[href]') ? el : el.querySelector('button, input, a[href]');
      if (inner) el = inner;
    }
    return el || null;
  };
  let reached = 0;
  for (const s of primary) {
    const el = find(s);
    if (!el) {
      problems.push(`primary ${s} missing`);
      continue;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > visBottom + 0.5) {
      problems.push(`primary ${s} outside visible area ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(v => Math.round(v)))} (visible 0–${vw} × 0–${Math.round(visBottom)})`);
      continue;
    }
    const inset = Math.min(4, r.width / 4, r.height / 4);
    // 中心 + 四条边的中点内缩 4px（不取四角：圆角按钮的角不在命中区里）。
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pts = [[cx, cy], [cx, r.top + inset], [cx, r.bottom - inset], [r.left + inset, cy], [r.right - inset, cy]];
    const covered = pts.filter(([x, y]) => !hits(el, x, y));
    if (covered.length) {
      const [x, y] = covered[0];
      const h = document.elementFromPoint(x, y);
      problems.push(`primary ${s} covered at (${Math.round(x)},${Math.round(y)}) by ${h ? desc(h) : 'nothing'}`);
      continue;
    }
    reached += 1;
  }
  // 滚到底：每个滚动容器最后一个可见文字块完整露出、不被盖住。
  for (const sc of scrollers) {
    if (!sc.checkVisibility({ visibilityProperty: true })) continue;
    sc.scrollTop = sc.scrollHeight;
    const cr = sc.getBoundingClientRect();
    const viewBottom = Math.min(cr.bottom, visBottom);
    let last = null;
    for (const el of sc.querySelectorAll('*')) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (!last || r.bottom > last.r.bottom) last = { el, r };
    }
    if (!last) continue;
    const { el, r } = last;
    if (r.bottom > viewBottom + 0.5) {
      problems.push(`scroll-end ${desc(sc)}: last text ${desc(el)} bottom ${Math.round(r.bottom)} > visible bottom ${Math.round(viewBottom)} (exact ${r.bottom.toFixed(2)} vs ${viewBottom.toFixed(2)}; scrollTop ${sc.scrollTop.toFixed(2)} / ${sc.scrollHeight} / ${sc.clientHeight})`);
    } else if (!hits(el, Math.min(Math.max(r.left + 2, 0), vw - 1), r.top + r.height / 2)
      && !hits(el, r.left + r.width / 2, r.top + r.height / 2)
      // 折成多行的行内文字，整体外框的中心可能落在两行之间的空隙里（命中的是它的父元素，不是别的东西盖住了它）：
      // 逐行外框各取中心点再试一次，只有每一行都被别的元素盖着才算被盖住（P1-E1a：字阶行高变了，折行位置跟着变）。
      && ![...el.getClientRects()].some(q => q.width > 1 && q.height > 1 && hits(el, q.left + q.width / 2, q.top + q.height / 2))) {
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      problems.push(`scroll-end ${desc(sc)}: last text ${desc(el)} covered by ${h ? desc(h) : 'nothing'}`);
    }
  }
  for (const [el, y] of saved) el.scrollTop = y;
  for (const el of scrollers) if (!saved.some(([e]) => e === el)) el.scrollTop = 0;
  return { problems, reached };
}
/* eslint-enable no-undef */

// ---------------------------------------------------------------------------------------------- 驱动

async function applyCell(page, { large, motion, theme }) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion ? 'reduce' : 'no-preference' });
  // 模拟原生 shiziContentSize（P130）：XXXL → --k 1.35、:root[data-text-large]；L → 系统默认。
  await page.evaluate(on => window.shiziContentSize({ category: on ? 'XXXL' : 'L' }), large);
  // 两帧 + 一点时间：让 Preact（useCompact 的 MutationObserver 重渲染）与布局稳定。切字号 / 减动不触发页面转场。
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(80);
  // 等正在跑的有限时长动画 / 过渡（参考字形淡入、弹层随键盘上移…）跑完再量，最多 2s。
  await page.evaluate(() => {
    const finite = document.getAnimations().filter(a => {
      const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity;
      return Number.isFinite(end) && a.playState === 'running';
    });
    return Promise.race([Promise.all(finite.map(a => a.finished.catch(() => null))), new Promise(r => setTimeout(r, 2000))]);
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function runWorker(browser, ctx, w, catalog, results) {
  const { baseURL } = ctx;
  const context = await browser.newContext({
    viewport: w.view, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: w.theme, reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error && error.message}`));
  page.on('requestfailed', req => errors.push(`requestfailed: ${req.url()} ${req.failure() && req.failure().errorText}`));
  page.on('response', res => {
    if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  const tag = `${w.group}-${w.view.width}x${w.view.height}-${w.theme}`;
  let stage = 'start';
  try {
    if (w.baseFont) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: w.baseFont, fixed: Math.round(w.baseFont * 13 / 16) } });
    }
    for (const p of PAGES) {
      // 每页一个干净的页面（查字页换过 visualViewport；写字 / 结果页改过会话）。
      stage = `${p.id}: boot`;
      await page.goto('about:blank');
      await page.goto(`${baseURL}/?test=1`);
      await page.waitForSelector('.sz-app');
      await page.waitForFunction(() => typeof window.__shiziTest === 'object');
      await waitTopScreen(page, 'home');
      const info = await seedLongText(page, catalog, { phase: p.phase || 'recall' });
      if (!info.ok) throw new Error(`${tag} ${p.id}: seed failed ${JSON.stringify(info.r)}`);
      await page.waitForTimeout(80);
      stage = `${p.id}: open`;
      await p.go(page, info);
      if (p.ready) await page.waitForSelector(p.ready, { timeout: 15000 });
      await page.mouse.move(1, 1);
      const baseFontPx = w.baseFont ? await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) : null;
      for (const large of w.larges) {
        for (const motion of w.motions) {
          await applyCell(page, { large, motion, theme: w.theme });
          const m = await page.evaluate(measureInPage, {
            minContrast: MIN_CONTRAST, minTap: MIN_TAP, exempt: EXEMPT,
            expect: { w: w.view.width, h: w.view.height, dark: w.theme === 'dark', large, reduce: motion },
          });
          const name = `${tag}-${large ? 'L' : 'N'}-${motion ? 'R' : 'M'}-${p.id}`;
          await page.screenshot({ path: join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 70 });
          const reach = await page.evaluate(reachInPage, { primary: p.primary, deep: !!p.primaryDeep });
          const problems = [...m.problems, ...reach.problems];
          if (w.baseFont && baseFontPx !== `${w.baseFont}px`) problems.push(`base font not applied (${baseFontPx})`);
          results.push({
            name, group: w.group, page: p.id, problems, minRatio: m.minRatio, checked: m.checked, taps: m.taps, reached: reach.reached,
            exempted: m.exempted,
          });
        }
      }
    }
  } catch (error) {
    throw new Error(`[${stage}] ${error && error.message}`);
  } finally {
    results.push({ worker: tag, errors: [...errors] });
    await context.close();
  }
}

export default async function matrix(page, ctx) {
  const { assert, step } = ctx;
  mkdirSync(SHOTS, { recursive: true });
  const browser = page.context().browser();
  step(`long-text catalog (screenshots → ${SHOTS})`);
  await page.goto(`${ctx.baseURL}/?test=1`);
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  const catalog = await longTextCatalog(page);
  assert.ok(catalog.chars300.length === 300, `300-char seed source (${catalog.total} base cards scanned)`);
  assert.ok(catalog.longest.hint.length > 0, `longest prompt: ${catalog.longest.word} (${catalog.longest.cells} cells, hint ${catalog.longest.hint.length} chars)`);
  assert.ok(catalog.longWords[0].word.length >= 5, `longest word: ${catalog.longWords[0].word}`);

  const list = workers();
  const results = [];
  step(`${list.length} workers × ${PAGES.length} pages (concurrency ${CONCURRENCY})`);
  const queue = [...list];
  const failures = [];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const w = queue.shift();
      try {
        await runWorker(browser, ctx, w, catalog, results);
      } catch (error) {
        failures.push(`${w.group}-${w.view.width}x${w.view.height}-${w.theme}: ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`);
      }
    }
  });
  await Promise.all(runners);
  assert.deepEqual(failures, [], 'every worker ran to the end');

  const cells = results.filter(r => r.name);
  // 失败时先把所有不过的格子一次列全（断言在第一条失败处就停）。
  const bad = cells.filter(c => c.problems.length).sort((a, b) => a.name.localeCompare(b.name));
  if (bad.length) {
    console.log(`    matrix: ${bad.length} failing cell(s)`);
    for (const c of bad) console.log(`      ${c.name}\n        ${c.problems.join('\n        ')}`);
  }
  for (const group of ['main', '320', 'font130']) {
    const gc = cells.filter(c => c.group === group).sort((a, b) => a.name.localeCompare(b.name));
    step(`group ${group}: ${gc.length} cells`);
    for (const c of gc) {
      const ex = Object.entries(c.exempted || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      assert.deepEqual(c.problems, [], `${c.name}: overflow / overlap / reach / cover / contrast (min ${c.minRatio} over ${c.checked} texts${ex ? `; exempt ${ex}` : ''}) / tap (${c.taps}) / primary (${c.reached})`);
    }
  }
  const expect = { main: 2 * 2 * 2 * 2 * PAGES.length, 320: 2 * 2 * 2 * PAGES.length, font130: 2 * 2 * PAGES.length };
  for (const [g, n] of Object.entries(expect)) assert.equal(cells.filter(c => c.group === g).length, n, `group ${g}: ${n} cells measured`);
  const errs = results.filter(r => r.worker).flatMap(r => r.errors.map(e => `${r.worker}: ${e}`));
  assert.deepEqual(errs, [], 'matrix contexts: no console errors, page errors, failed requests or HTTP errors');
}
