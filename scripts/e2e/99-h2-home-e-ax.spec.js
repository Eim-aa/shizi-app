// H2（D55，首页方向 E 极静）：AX 档。
//   「拾」与题记随字号缩放但不溢出：AX1–AX5 题记改横排（两句 + 作者，居中在「拾」下面），「拾」按剩余高度缩（≤ 128、≥ 64）；放不下时先收起题记（D49 的 AX 隐藏题记规则）、「拾」再缩（≥ 44）；
//   五态（不含首次打开，它沿用现有 AX 画面）整页不滚动、没有横向溢出、每个元素都在视口内；主按钮满宽，「自己选字」在它上面。
//   390×844 与 375×667，浅色；深色抽 AX5。

import { bootTestHost, setTextSize, waitNavIdle } from './helpers.mjs';
import { HOME_STATES, seedHomeState } from './home-helpers.mjs';

const VIEWS = [{ id: '390x844', width: 390, height: 844 }, { id: '375x667', width: 375, height: 667 }];
const STATES = Object.keys(HOME_STATES).filter(s => s !== 'first');

/* eslint-disable no-undef */
function measure() {
  const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
  const q = id => root.querySelector(`[data-testid="${id}"]`);
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; };
  const panel = document.querySelector('.sz-tabroot__panel');
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.checkVisibility() || el.closest('.sz-home__dev')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.left < -0.5 || r.right > window.innerWidth + 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 30)} ${Math.round(r.left)}…${Math.round(r.right)}`);
  }
  const epi = q('home-epigraph');
  const cols = epi ? [...epi.children].map(c => ({ mode: getComputedStyle(c).writingMode, w: c.getBoundingClientRect().width, text: c.textContent.trim() })) : [];
  const pick = q('home-pick') || q('home-capital-defer');
  return {
    view: root.dataset.view,
    ax: root.dataset.ax,
    scrollable: root.offsetHeight > panel.clientHeight + 1,
    scrollGap: root.offsetHeight - panel.clientHeight,
    outside: out,
    shi: rect(q('home-brand-shi')),
    epi: rect(epi), epiHidden: epi ? epi.dataset.hide || null : null, cols,
    start: rect(q('home-start')), pick: rect(pick),
    date: rect(q('home-date')),
    note: rect(q('home-back-note') || q('home-capital-body')),
    width: root.clientWidth,
  };
}
/* eslint-enable no-undef */

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const shots = process.env.SHIZI_E2E_SHOTS;
  await bootTestHost(page, ctx.baseURL);
  for (const view of VIEWS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    for (const [scheme, sizes] of [['light', ['AX1', 'AX5']], ['dark', ['AX5']]]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const size of sizes) {
        step(`${view.id} ${scheme} ${size}: 五态——「拾」缩放、题记横排、不溢出、整页不滚动`);
        for (const name of STATES) {
          await page.goto('about:blank');
          await bootTestHost(page, ctx.baseURL);
          await seedHomeState(page, name);
          await setTextSize(page, size);
          await waitNavIdle(page, { settleMs: 150 });
          const m = await page.evaluate(measure);
          const t = `${view.id} ${scheme} ${size} ${name}`;
          if (shots) await page.screenshot({ path: `${shots}/h2-ax-${name}-${view.id}-${scheme}-${size}.png` });
          assert.equal(m.view, name, `${t}: view`);
          assert.equal(m.scrollable, false, `${t}: the page does not scroll (gap ${m.scrollGap})`);
          assert.deepEqual(m.outside, [], `${t}: nothing sticks out of the viewport`);
          const epiShown = m.epi.h > 1;
          assert.ok(m.shi.w >= (epiShown ? 64 : 44) - 0.5 && m.shi.w <= 128 + 0.5 && Math.abs(m.shi.w - m.shi.h) < 0.5, `${t}: 「拾」 scales to fit (${m.shi.w}; ≥ 64 with the epigraph, ≥ 44 once the epigraph is folded away)`);
          assert.ok(m.cols.length === 3 && m.cols.every(c => c.mode === 'horizontal-tb'), `${t}: the epigraph is horizontal in AX (existing rule: horizontal, like the first-open motto)`);
          if (epiShown) assert.ok(m.epi.y >= m.shi.b - 0.5, `${t}: the epigraph sits under 「拾」`);
          else assert.equal(m.epiHidden, 'true', `${t}: when it cannot fit, the epigraph is folded away (D49's AX rule), not squeezed`);
          assert.ok(m.start.w >= m.width - 40 - 1, `${t}: the main button is full width (${m.start.w})`);
          assert.ok(m.pick.b <= m.start.y + 0.5, `${t}: the text buttons sit above the main button`);
          assert.ok(m.shi.y >= m.date.b - 0.5, `${t}: 「拾」 starts below the date`);
          if (m.note) assert.ok(m.note.y >= (epiShown ? m.epi.b : m.shi.b) - 0.5 && m.note.b <= m.pick.y + 0.5, `${t}: the one line sits between the epigraph and the buttons`);
        }
      }
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await setTextSize(page, 'L');
}
