// 阶段 1 E9c（D49 减法修稿；实现交接 §14，03 P193）：字库页与「练习范围」迁移。
//
//   1. 版式（402 × 874）：大标题「字库」→ 查字（高 48，下面没有说明句）→ 写错过 / 快忘了两个同模板的块（名称 17 / 500 + 数 15 墨三，右侧文字按钮「练这些字」；
//      下面一排 5 个 30pt 样字、间距 8、wall1；查字下 28、两块之间 20）→ 题注「N 个字」（15 墨三，快忘了块下 36）→ 字墙（题注下 8）；
//      没有：搜索框下说明、练习范围行、「有记录的字」大数字与副统计、两栏说明与朱点、图例、「→」。
//   2. 朱色：页上唯一的朱是字墙上写错过的字的右上朱点；自选未写的空心字是 ink4。
//   3. 两块同一个格式（名称 / 数 / 按钮 / 样字的位置与尺寸一致），按钮读屏名带块名。
//   4. AX5：「练这些字」折到名称下方，样字 44，字墙格不放大。
//   （「练习范围」移到「我的 › 设置」见 79-e9c-settings-range；字库页没有这个入口在 30-library / 这里第 1 步断言。）

import { bootTestHost, setTextSize, tid, tokenRgb, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CHARS = '永和春大中国人天地山水火木金土日月星云风雨花草鸟鱼虫书画琴棋诗酒茶有的一是不了人在他这中大来上个国到说们为子和你地出道也时年得就那要下以生会自着去之过家学对'.split('').filter((c, i, a) => a.indexOf(c) === i);
const TONE_AGO = [1, 15, 60, 120];
const pad2 = n => (n < 10 ? `0${n}` : String(n));
const dayAgo = n => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

function seed() {
  const rows = CHARS.map((c, i) => {
    const day = dayAgo(TONE_AGO[i % 4] + (i >> 2));
    const at = new Date(`${day}T08:00:00`).getTime() + i * 60000;
    return { c, i, day, at, judgment: i % 5 === 0 ? 'wrong' : 'correct' };
  }).sort((a, b) => a.at - b.at);
  const records = {};
  rows.forEach((row, k) => {
    const r = { id: `r${k + 1}`, cardKey: `base:${row.c}`, char: row.c, sessionId: 's900', kind: 'judged', judgment: row.judgment, at: row.at, localDay: row.day, help: { hints: 0, answerSeen: false, traced: false } };
    (records[row.day.slice(0, 7)] || (records[row.day.slice(0, 7)] = [])).push(r);
  });
  const sched = {};
  rows.filter(r => r.judgment === 'correct' && r.i % 4 === 3).slice(0, 12).forEach(r => { sched[`base:${r.c}`] = { fsrs: { stability: 2 }, due: dayAgo(10), lastJudgedAt: r.at }; });
  return { records, sched, custom: { added: [{ char: '馨', at: 1000 }, { char: '鼎', at: 1001 }] } };
}

async function boot(page, ctx, { w = 402, h = 874, scheme = 'light', ax = null } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  if (ax) await setTextSize(page, ax);
  await page.evaluate(async s => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock('2026-09-24T09:00:00');
    window.__shiziTest.seed(s);
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('library');
  }, seed());
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"]'));
  await waitNavIdle(page, { settleMs: 200 });
  await page.waitForTimeout(500);
}

async function facts(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = s => top.querySelector(s);
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
    const block = kind => {
      const el = q(`[data-testid="library-card-${kind}"]`);
      const name = el.querySelector('[data-testid="library-card-name"]');
      const count = el.querySelector('[data-testid="library-card-count"]');
      const btn = el.querySelector('[data-testid="library-card-practice"]');
      const samples = [...el.querySelectorAll('[data-testid="library-card-mini-cell"]')];
      return {
        rect: rect(el), name: rect(name), count: rect(count), btn: rect(btn), samples: samples.map(rect),
        nameFs: cs(name, 'fontSize'), nameFw: cs(name, 'fontWeight'), nameColor: cs(name, 'color'), countFs: cs(count, 'fontSize'), countColor: cs(count, 'color'),
        btnText: btn ? btn.textContent.trim() : null, btnAria: btn ? btn.getAttribute('aria-label') : null, btnColor: cs(btn, 'color'),
        sampleColor: cs(el.querySelector('.sz-lib__char'), 'color'),
        paragraphs: el.querySelectorAll('p').length,
      };
    };
    const zhu = getComputedStyle(document.documentElement).getPropertyValue('--zhu').trim();
    // 页上所有「朱」：背景色是 --zhu 的元素
    const probe = document.createElement('span');
    probe.style.color = 'var(--zhu)';
    document.body.appendChild(probe);
    const zhuRgb = getComputedStyle(probe).color;
    probe.remove();
    const reds = [...top.querySelectorAll('*')].filter(el => getComputedStyle(el).backgroundColor === zhuRgb);
    return {
      title: rect(q('[data-page-title]')), titleFs: cs(q('[data-page-title]'), 'fontSize'),
      query: rect(q('[data-testid="library-query-open"]')),
      wrong: block('wrong'), forget: block('forget'),
      caption: rect(q('[data-testid="library-caption"]')), captionText: q('[data-testid="library-caption"]').textContent.trim(),
      captionFs: cs(q('[data-testid="library-caption"]'), 'fontSize'), captionColor: cs(q('[data-testid="library-caption"]'), 'color'),
      wall: rect(q('[data-testid="library-wall"]')),
      cell0: rect(q('[data-testid="library-wall-cell"]')),
      redInWall: reds.filter(el => el.closest('[data-testid="library-wall"]')).length,
      redElsewhere: reds.filter(el => !el.closest('[data-testid="library-wall"]')).map(el => el.className),
      text: q('[data-testid="library-home"]').innerText,
      removed: {
        queryNote: !!q('[data-testid="library-query-note"]'), scope: !!q('[data-testid="library-switch"]'), count: !!q('[data-testid="library-count"]'),
        facts: top.querySelectorAll('[data-testid="library-fact"]').length, legend: top.querySelectorAll('[data-testid="library-legend"]').length,
      },
      hollowColor: cs(q('[data-kind="hollow"] .sz-lib__char'), 'color'),
      hscroll: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;

export default async function (page, ctx) {
  const { assert } = ctx;

  // ---------------------------------------------------------------- 1. 版式
  ctx.step('402 × 874: title → query (48) → 写错过 / 快忘了 blocks → caption → wall; the spacing of the hand-off §14.1');
  await boot(page, ctx);
  let f = await facts(page);
  assert.equal(f.titleFs, '28px', 'the big title 字库 is t28');
  assert.ok(near(f.query.h, 48, 2) && near(f.query.x, 20) && near(f.query.r, 382), `the query box is 48 high on the gutter (${Math.round(f.query.h)})`);
  assert.deepEqual(f.removed, { queryNote: false, scope: false, count: false, facts: 0, legend: 0 }, 'no note under the query, no scope row, no big number, no facts, no legend');
  assert.ok(!/→|更换字库|练习范围|有记录的字|你判断写错的字|有一阵没写/.test(f.text), `none of the removed sentences / arrows is on the page: ${f.text.slice(0, 80)}`);
  assert.ok(near(f.wrong.rect.y - f.query.b, 28), `query → first block 28 (${Math.round(f.wrong.rect.y - f.query.b)})`);
  assert.ok(near(f.forget.rect.y - f.wrong.rect.b, 20), `block → block 20 (${Math.round(f.forget.rect.y - f.wrong.rect.b)})`);
  assert.ok(near(f.caption.y - f.forget.rect.b, 36), `forget block → caption 36 (${Math.round(f.caption.y - f.forget.rect.b)})`);
  assert.ok(near(f.wall.y - f.caption.b, 8), `caption → wall 8 (${Math.round(f.wall.y - f.caption.b)})`);
  assert.deepEqual([f.captionText, f.captionFs, f.captionColor], ['72 个字', '15px', tokenRgb('light', 'ink3')], 'the caption 「72 个字」 is t15 ink3');
  for (const [kind, b, title] of [['wrong', f.wrong, '写错过'], ['forget', f.forget, '快忘了']]) {
    assert.deepEqual([b.nameFs, b.nameFw, b.nameColor], ['17px', '500', tokenRgb('light', 'ink1')], `${kind}: name t17m ink1`);
    assert.deepEqual([b.countFs, b.countColor], ['15px', tokenRgb('light', 'ink3')], `${kind}: count t15 ink3`);
    assert.ok(near(b.count.x - b.name.r, 8), `${kind}: name → count 8 (${Math.round(b.count.x - b.name.r)})`);
    assert.ok(near(b.name.x, 20), `${kind}: the name starts on the gutter`);
    assert.equal(b.btnText, '练这些字', `${kind}: the text button 练这些字 (no arrow)`);
    assert.equal(b.btnAria, `${title}，练这些字`, `${kind}: the button is named per block for screen readers`);
    assert.ok(b.btn.h >= 44 - 0.5, `${kind}: the button is 44 high (${b.btn.h})`);
    assert.ok(near(b.btn.r, 382, 1), `${kind}: the button sits on the right edge`);
    assert.equal(b.samples.length, 5, `${kind}: five samples`);
    assert.ok(b.samples.every(s => near(s.w, 30) && near(s.h, 30)), `${kind}: samples are 30pt`);
    assert.ok(b.samples.slice(1).every((s, i) => near(s.x - b.samples[i].r, 8)), `${kind}: sample gap 8`);
    assert.ok(near(b.samples[0].y - b.btn.b, 6), `${kind}: samples 6 below the first row (${Math.round(b.samples[0].y - b.btn.b)})`);
    assert.equal(b.sampleColor, tokenRgb('light', 'wall1'), `${kind}: samples are wall1`);
    assert.equal(b.paragraphs, 0, `${kind}: no note sentence`);
  }
  assert.deepEqual(
    [f.wrong.name.x, f.wrong.btn.r, f.wrong.samples[0].x, f.wrong.btn.h, f.wrong.samples[0].h],
    [f.forget.name.x, f.forget.btn.r, f.forget.samples[0].x, f.forget.btn.h, f.forget.samples[0].h],
    'the two blocks share one template (same x / right edge / sample origin / sizes)',
  );
  assert.equal(f.hscroll, false, 'no horizontal scroll');

  // ---------------------------------------------------------------- 2. 朱色
  ctx.step('vermilion only means wrong: the only red on the page is the dot on written-wrong chars in the wall; hollow chars are ink4');
  assert.deepEqual(f.redElsewhere, [], 'no vermilion outside the wall (no title dot, no sample dots, no legend)');
  assert.ok(f.redInWall > 0, `the wall keeps its wrong dots (${f.redInWall})`);
  assert.equal(f.hollowColor, tokenRgb('light', 'ink4'), 'hollow chars are ink4');
  await boot(page, ctx, { scheme: 'dark' });
  f = await facts(page);
  assert.equal(f.hollowColor, tokenRgb('dark', 'ink4'), 'dark: hollow chars are ink4');
  assert.equal(f.wrong.sampleColor, tokenRgb('dark', 'wall1'), 'dark: samples are wall1');
  assert.deepEqual(f.redElsewhere, [], 'dark: no vermilion outside the wall');

  // ---------------------------------------------------------------- 3. SE
  ctx.step('SE 375 × 667: same structure, no horizontal scroll, the wall has 7 columns');
  await boot(page, ctx, { w: 375, h: 667 });
  f = await facts(page);
  assert.equal(f.hscroll, false, 'SE: no horizontal scroll');
  assert.equal(f.wrong.samples.length, 5, 'SE: five samples');
  assert.ok(near(f.wrong.btn.r, 375 - 20, 1), 'SE: the button is on the right edge');

  // ---------------------------------------------------------------- 4. AX5
  ctx.step('AX5: 练这些字 folds under the name, samples 44, wall cells do not grow');
  await boot(page, ctx, { ax: 'AX5' });
  const cellDefault = 402 - 40;
  f = await facts(page);
  for (const [kind, b] of [['wrong', f.wrong], ['forget', f.forget]]) {
    assert.ok(b.btn.y >= b.name.b - 1 && near(b.btn.x, 20, 6), `AX5 ${kind}: the button is below the name, left-aligned (${Math.round(b.btn.y)} ≥ ${Math.round(b.name.b)})`);
    assert.ok(b.samples.every(s => near(s.w, 44) && near(s.h, 44)), `AX5 ${kind}: samples 44`);
  }
  assert.ok(f.cell0.w <= cellDefault / 6 + 1 && f.cell0.w >= 44, `AX5: the wall keeps cells ≥ 44 and does not grow with the text (${Math.round(f.cell0.w)}, ≤ 6 columns)`);
  assert.equal(f.hscroll, false, 'AX5: no horizontal scroll');
}
