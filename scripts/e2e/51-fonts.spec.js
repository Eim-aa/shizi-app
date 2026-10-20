// M5-2 字体接入（决定-D13；01-架构设计 §8.4；02 M5-2）。
//
// 场景：
//   1. 打开首页：fonts/fonts.css 已链入；三个 @font-face 都是 font-display: swap、精确字重（400 / 400 / 500）。
//   2. requireFont 三个 face（src/data/font-loader.js）：都 resolve、不降级；之后 document.fonts.check 三个精确字重都命中，
//      document.fonts 里本包只有三个 face 且全部 loaded；三份 WOFF2 都由同源 fonts/ 返回 200，没有别的字体请求。
//   3. 实际渲染用的字体（CDP CSS.getPlatformFontsForNode）：首页标题 = ShiziSerifSC-Medium（500），题记 = ShiziSerifSC-Regular，
//      印 = ShiziKai-Regular，且这些节点里每个字都由本包字体画出（没有回退系统字体 = 该段文字无缺字）；
//      阶段 1 P1-E5：首次打开的竖排题跋 = ShiziSerifSC-Regular，书家「拾」占位 = ShiziKai-Regular。
//   4. 覆盖：copy/ 全文（宋体语料不含只用黑体显示的 HEI_ONLY_COPY，scripts/fonts/build_corpus.mjs）与题库 word / py 在 coverage-manifest 里缺字为 0
//      （浏览器里再核一遍，主判定在单测）。
//   5. canvas：core/images/render.js 经 requireCanvasFont 注入口画单字图片——印字 ShiziKai 400 先 loaded 再建画布，无「font not ready」警告。
//   6. 降级：coverage-manifest 取不到（404）→ requireFont 仍经 document.fonts.load 精确加载，degraded:true；
//      缺字 / 400 冒充 500 的拒绝在单测（test/core/font-loader.test.mjs）。
// Safari / WKWebView 与真机字体渲染不在本 spec（M7 真机清单）。

import { bootTestHost, tid } from './helpers.mjs';
import { HEI_ONLY_COPY } from '../fonts/build_corpus.mjs';

const FACES = [
  { key: 'ShiziKai:400', family: 'ShiziKai', weight: '400', file: 'ShiziKai-Regular.woff2', ps: 'ShiziKai-Regular' },
  { key: 'ShiziSerifSC:400', family: 'ShiziSerifSC', weight: '400', file: 'ShiziSerifSC-Regular.woff2', ps: 'ShiziSerifSC-Regular' },
  { key: 'ShiziSerifSC:500', family: 'ShiziSerifSC', weight: '500', file: 'ShiziSerifSC-Medium.woff2', ps: 'ShiziSerifSC-Medium' },
];

async function platformFonts(cdp, selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  // 字体按文本节点统计：取元素下所有文字（CSS.getPlatformFontsForNode 对元素返回其直接文本子节点的字体）。
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts;
}

export default async function fontsSpec(page, ctx) {
  const { assert } = ctx;
  const fontResponses = [];
  page.on('response', res => {
    const url = res.url();
    if (/\.(woff2?|ttf|otf)(\?|$)/.test(url) || /fonts\//.test(url)) fontResponses.push({ url: url.replace(ctx.baseURL, ''), status: res.status() });
  });
  const warnings = [];
  page.on('console', msg => {
    if (msg.type() === 'warning' && /font not ready/.test(msg.text())) warnings.push(msg.text());
  });

  ctx.step('fonts.css linked; three exact swap faces');
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(() => window.__shiziTest.reset());
  const declared = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find(s => s.href && s.href.endsWith('/fonts/fonts.css'));
    if (!sheet) return null;
    return [...sheet.cssRules].filter(r => r instanceof CSSFontFaceRule).map(r => ({
      family: r.style.getPropertyValue('font-family').replace(/"/g, ''),
      weight: r.style.getPropertyValue('font-weight'),
      display: r.style.getPropertyValue('font-display'),
      src: r.style.getPropertyValue('src'),
    }));
  });
  assert.ok(Array.isArray(declared), 'fonts/fonts.css is a loaded stylesheet');
  assert.deepEqual(declared.map(f => `${f.family}:${f.weight}`), FACES.map(f => f.key), 'three faces, exact weights');
  assert.ok(declared.every(f => f.display === 'swap'), 'font-display: swap on every face');
  assert.ok(declared.every((f, i) => f.src.includes(FACES[i].file)), 'each face points at its own WOFF2');

  ctx.step('requireFont three faces → document.fonts.check exact weights');
  const loaded = await page.evaluate(async () => {
    const m = await import('/src/data/font-loader.js');
    const out = [];
    for (const key of ['ShiziKai:400', 'ShiziSerifSC:400', 'ShiziSerifSC:500']) {
      try {
        const r = await m.requireFont(key, '拾字');
        out.push({ key, ok: true, degraded: r.degraded, weight: r.weight });
      } catch (e) {
        out.push({ key, ok: false, error: String(e && e.message) });
      }
    }
    return out;
  });
  for (const r of loaded) {
    assert.ok(r.ok, `requireFont(${r.key}) resolves ${r.error || ''}`);
    assert.equal(r.degraded, false, `${r.key}: coverage manifest used (not degraded)`);
  }
  const checks = await page.evaluate(() => ({
    kai: document.fonts.check('400 16px "ShiziKai"', '拾字'),
    serif400: document.fonts.check('400 16px "ShiziSerifSC"', '拾字'),
    serif500: document.fonts.check('500 16px "ShiziSerifSC"', '拾字'),
    faces: [...document.fonts].filter(f => /Shizi/.test(f.family)).map(f => ({
      family: f.family.replace(/"/g, ''), weight: String(f.weight), style: f.style, status: f.status, display: f.display,
    })),
  }));
  assert.equal(checks.kai, true, 'document.fonts.check 400 ShiziKai');
  assert.equal(checks.serif400, true, 'document.fonts.check 400 ShiziSerifSC');
  assert.equal(checks.serif500, true, 'document.fonts.check 500 ShiziSerifSC');
  assert.deepEqual(checks.faces.map(f => `${f.family}:${f.weight}:${f.style}:${f.status}:${f.display}`).sort(),
    FACES.map(f => `${f.family}:${f.weight}:normal:loaded:swap`).sort(), 'exactly three Shizi FontFaces, all loaded');
  const woff = fontResponses.filter(r => /\.woff2$/.test(r.url));
  assert.deepEqual([...new Set(woff.map(r => r.url))].sort(), FACES.map(f => `/fonts/${f.file}`).sort(), 'only the three shipped WOFF2 requested (same origin)');
  assert.ok(woff.every(r => r.status === 200 || r.status === 304), 'WOFF2 served 200');
  assert.ok(fontResponses.some(r => r.url === '/fonts/coverage-manifest.json' && r.status === 200), 'coverage manifest fetched from fonts/');
  assert.ok(!fontResponses.some(r => /\.(ttf|otf)$/.test(r.url)), 'no TTF / OTF requests');

  ctx.step('rendered fonts on home (CDP platform fonts): title 500, epigraph 400 (the seal is on the first-open page only, D49)');
  // 首次打开没有标题（P1-E5）：先 seed 一条昨天的判断，首页回到「今天还没写」，再量标题 / 题记 / 印
  await page.evaluate(async () => {
    window.__shiziTest.reset();
    const at = window.__shiziTest.now() - 24 * 3600 * 1000;
    const d = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    const day = (await import('/src/core/dates.js')).localDay(at); // 练习日（凌晨 4 点分界，D66 ⑦）
    const rec = { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at, localDay: day, help: { hints: 0, answerSeen: false, traced: false } };
    window.__shiziTest.seed({ records: { [day.slice(0, 7)]: [rec] } });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector(tid('home-epigraph'));
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const cases = [
    // H2（D55）：首页标题只给读屏（视觉隐藏），不再量它的字体；题记是「拾」右侧竖排的两列句子 + 作者名（都是宋 400），日常首页没有印，印的字体在下面首次打开一步量
    { sel: '.sz-home__epicol:not(.sz-home__episrc)', ps: 'ShiziSerifSC-Regular', what: 'epigraph couplet column (vertical) → ShiziSerifSC 400' },
    { sel: '.sz-home__episrc', ps: 'ShiziSerifSC-Regular', what: 'epigraph author (vertical) → ShiziSerifSC 400' },
  ];
  for (const c of cases) {
    let selector = c.sel;
    if (c.deep) {
      // 题记分两行：取第一个含文字的后代
      selector = await page.evaluate(sel => {
        const root = document.querySelector(sel);
        if (!root) return null;
        const el = [...root.querySelectorAll('*')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        if (!el) return null;
        el.setAttribute('data-font-probe', '1');
        return '[data-font-probe="1"]';
      }, c.sel);
    }
    const fonts = selector ? await platformFonts(cdp, selector) : null;
    assert.ok(Array.isArray(fonts) && fonts.length > 0, `${c.what}: node has rendered text`);
    const names = (fonts || []).map(f => f.postScriptName || f.familyName);
    assert.deepEqual(names, [c.ps], `${c.what}: every glyph from ${c.ps} (no system fallback) — got ${JSON.stringify(fonts)}`);
    if (c.deep) await page.evaluate(() => document.querySelector('[data-font-probe]').removeAttribute('data-font-probe'));
  }

  ctx.step('first open (P1-E5): vertical motto → ShiziSerifSC 400 (the brand 「拾」 and the seal 「拾」 are vector marks, no font)');
  await page.evaluate(() => { window.__shiziTest.reset(); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForSelector(tid('home-motto'));
  await page.evaluate(() => document.fonts.ready);
  for (const c of [
    { sel: '[data-testid="home-motto"] .sz-first__col', ps: 'ShiziSerifSC-Regular', what: 'first-open motto column → ShiziSerifSC 400' },
  ]) {
    const fonts = await platformFonts(cdp, c.sel);
    assert.ok(Array.isArray(fonts) && fonts.length > 0, `${c.what}: node has rendered text`);
    assert.deepEqual((fonts || []).map(f => f.postScriptName || f.familyName), [c.ps], `${c.what}: no system fallback — got ${JSON.stringify(fonts)}`);
  }

  assert.deepEqual(await page.evaluate(() => { const s = document.querySelector('.sz-home__seal'); return { text: s.textContent.trim(), paths: s.querySelectorAll('svg path').length }; }), { text: '', paths: 9 }, 'R2-S2: the seal is a drawing (nine paths), not text in any font');

  ctx.step('coverage: copy/ full text and deck word/py against the coverage manifest');
  const cov = await page.evaluate(async heiOnly => {
    const m = await import('/src/data/font-loader.js');
    const { COPY } = await import('/src/config/copy/index.js');
    const manifest = await (await fetch('fonts/coverage-manifest.json')).json();
    const { allCards } = await import('/src/data/deck.js');
    const cards = allCards();
    const copy = Object.values(COPY).join('\n');
    const copySerifText = Object.entries(COPY).filter(([key]) => !heiOnly.includes(key)).map(([, v]) => v).join('\n');
    const deck = cards.map(c => c.word + c.py).join('\n');
    const miss = (key, text) => m.inspectText(manifest, key, text).missing.map(x => x.char).join('');
    return {
      cards: cards.length,
      copyKai: miss('ShiziKai:400', copy),
      copySerif: miss('ShiziSerifSC:400', copySerifText),
      copySerifM: miss('ShiziSerifSC:500', copySerifText),
      deckKai: miss('ShiziKai:400', deck),
    };
  }, [...HEI_ONLY_COPY]);
  assert.ok(cov.cards > 7000, `deck loaded in page (${cov.cards} cards)`);
  assert.equal(cov.copyKai, '', 'copy/ full text: ShiziKai missing 0');
  assert.equal(cov.copySerif, '', 'copy/ text (minus the HEI_ONLY_COPY keys that render in the system sans): ShiziSerifSC 400 missing 0');
  assert.equal(cov.copySerifM, '', 'copy/ full text: ShiziSerifSC 500 missing 0');
  assert.equal(cov.deckKai, '', 'deck word / py: ShiziKai missing 0');

  ctx.step('canvas: render.js requireFont injection loads ShiziKai before drawing the image');
  const img = await page.evaluate(async () => {
    const { renderSingleGlyph } = await import('/src/core/images/render.js');
    const { requireCanvasFont } = await import('/src/data/font-loader.js');
    const seen = [];
    const out = await renderSingleGlyph({
      points: [[{ x: 80, y: 80, w: 12 }, { x: 260, y: 260, w: 12 }]],
      caption: 'yǒng · 9月22日', signatureText: '拾字',
      requireFont: async (stack, text) => {
        const r = await requireCanvasFont(stack, text);
        seen.push({ face: r.face || null, ok: r.ok, skipped: !!r.skipped });
        return r;
      },
    });
    return { status: out.status, w: out.canvas && out.canvas.width, seen };
  });
  assert.equal(img.status, 'ready', 'single-glyph image rendered');
  assert.deepEqual(img.seen, [{ face: null, ok: true, skipped: true }],
    'label stack (system) skipped; the seal 「拾」 is a Path2D drawing, no font is loaded for it (R2-S2)');
  assert.equal(warnings.length, 0, 'no "font not ready" warnings');

  ctx.step('degraded: coverage manifest unavailable → document.fonts.load only');
  ctx.allowConsoleError(/coverage-manifest|status of 404|Failed to load resource/);
  await page.route('**/fonts/coverage-manifest.json', route => route.fulfill({ status: 404, body: 'nope' }));
  const degraded = await page.evaluate(async () => {
    const m = await import('/src/data/font-loader.js');
    m.resetFontLoader();
    try {
      const r = await m.requireFont('ShiziSerifSC:500', '拾字');
      return { ok: true, degraded: r.degraded, weight: r.weight };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  });
  await page.unroute('**/fonts/coverage-manifest.json');
  assert.deepEqual(degraded, { ok: true, degraded: true, weight: 500 }, 'manifest 404 → degraded exact-weight load still resolves');
  await page.evaluate(async () => (await import('/src/data/font-loader.js')).resetFontLoader());
}
