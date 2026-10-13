// 阶段 1 P1-E1a（D33 / D43）：设计系统令牌在浏览器里真的生效——七页（首页 / 写字 / 判断 / 结果 / 字库 / 我的 / 设置）× 浅深：
//   · 页面底 = paper、主按钮 = btn-bg / btn-fg（读 tokens.json，不写死十六进制）；
//   · 渲染出来的字号全落在字阶（× --k）上，只有登记过的字面（字格里的楷体字、印章里的字）例外；
//   · 圆角只有 0 / 12 / 24 / 圆（嵌套内圆角 9 = 12 − 3）；
//   · 朱色（zhu / seal）只出现在白名单类名的元素上（写错朱点、印章）；
//   · 纸纹只在笺面（书写格 / 对照卡 / 字帖 / 月帖），页面底、按钮、弹层都没有；
//   · 原生 <button> 字帖格与首页「拾」按钮按下时走同一个 data-pressed 机制，背景换 field / btn-down，没有旧 :active 叠加。
//   · 焦点环取 ink1（不是朱）。

import { bootTestHost, openWrite, seedSession, drawStroke, HORIZONTAL, tid, tokenRgb, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const SCALE = [11, 13, 15, 17, 22, 28, 34];
const CHARS = '永和春大中国人天地山水火木金土日月星云风雨花草鸟鱼虫书画琴棋诗酒茶'.split('');
const TONE_AGO = [1, 15, 60, 120];

/** 登记过的字面例外（verify_tokens.mjs EXCEPTIONS 同一批）：字格里的楷体字、印章里的字、占位小字。 */
const FACE = '.sz-hcell__glyph, .sz-exrow__glyph, .sz-lib__char, .sz-lib__emptyglyph, .sz-rcell__glyph, .sz-glyph-fb, .sz-empty__cell, .sz-ann__glyph, .sz-ann__noink, .sz-scell__glyph, .sz-scell__noink, .sz-dcard__tiles, .sz-about__seal, .sz-seal, .sz-home__seal';
const ZHU_OK = '.sz-lib__dot, .sz-lib__mark, .sz-drow__dot, .sz-home__seal, .sz-about__seal, .sz-seal, .sz-work__dot--wrong';

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function dayAgo(n) { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function seedLibrary() {
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
  return { records, custom: { added: [{ char: '馨', at: 1000 }, { char: '鼎', at: 1001 }] } };
}

async function audit(page, sheetSel) {
  return page.evaluate(({ scale, face, zhuOk, sheetSel: sheets }) => {
    const top = document.querySelector('.sz-layer[data-top="true"]') || document.body;
    const out = { fonts: [], radii: [], zhu: [], tex: [], k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1 };
    const rgb = name => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const zhu = rgb('--zhu');
    const seal = rgb('--seal');
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || el.closest('canvas, svg, [aria-hidden="true"] svg')) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      const ok = scale.some(s => Math.abs(px - s * out.k) < 0.06) || !!el.closest(face);
      if (!ok) out.fonts.push(`${el.className || el.tagName}:${cs.fontSize}`);
    }
    for (const el of top.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
        const v = cs[corner];
        if (v === '0px' || v.endsWith('%')) continue;
        const px = parseFloat(v);
        const r = el.getBoundingClientRect();
        const pill = px >= Math.min(r.width, r.height) / 2 - 0.01; // 圆点 / 圆形（50% 解析成 px 的情况）
        if (![12, 24, 9].includes(px) && !pill) out.radii.push(`${el.className || el.tagName}:${corner}=${v}`);
      }
      for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
        if ((cs[prop] === zhu || cs[prop] === seal) && !el.matches(zhuOk)) out.zhu.push(`${el.className || el.tagName}:${prop}`);
      }
    }
    for (const el of top.querySelectorAll('.sz-btn, .sz-page, .sz-sheet, .sz-layer')) {
      if (getComputedStyle(el).backgroundImage !== 'none' && !el.matches('.sz-prompt *')) out.tex.push(el.className);
    }
    const tex = sheets ? top.querySelectorAll(sheets) : [];
    out.texOn = [...tex].filter(el => getComputedStyle(el).backgroundImage.includes('url(')).length;
    out.texTotal = tex.length;
    out.bodyBg = getComputedStyle(document.body).backgroundColor;
    out.bodyImage = getComputedStyle(document.body).backgroundImage;
    return out;
  }, { scale: SCALE, face: FACE, zhuOk: ZHU_OK, sheetSel });
}

async function tab(page, name) {
  await page.evaluate(async n => { const { nav } = await import('/src/ui/router.js'); nav.switchTab(n); }, name);
  await page.waitForTimeout(400);
  await waitNavIdle(page, { settleMs: 250 });
}

async function openResult(page) {
  await page.evaluate(async () => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { skipInDraft } = await import('/src/ui/screens/write/skip.js');
    const { makeRecord } = await import('/src/core/records.js');
    const { advance, endSlot } = await import('/src/core/sessions.js');
    const { appendRecordToDraft } = await import('/src/ui/screens/write/answer.js');
    const { nav } = await import('/src/ui/router.js');
    const slot = 'A';
    const chars = ['永', '和', '春', '大', '中'];
    const now = window.__shiziTest.now();
    const d = new Date(now);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const session = { id: 's50', slot, kind: 'daily', source: { view: 'home' }, queue: chars.map(c => 'base:' + c), cursor: 0, items: [],
      current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, lastLine: null, startedAt: now, startedDay: day, updatedAt: now };
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: session, B: null, lastEnded: {} } };
    let n = 100; const nextId = p => p + (n += 1);
    const st = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    ['correct', 'seen', 'wrong', 'skip', 'correct'].forEach((p, i) => {
      const s = draft.sessions[slot]; const key = s.queue[s.cursor];
      if (p === 'correct' || p === 'wrong') judgeInDraft(draft, { slot, cardKey: key, judgment: p, strokes: st, at: now + i, nextId });
      else if (p === 'skip') skipInDraft(draft, { slot, cardKey: key, at: now + i, nextId });
      else { const r = makeRecord({ id: nextId('r'), cardKey: key, sessionId: s.id, kind: 'answer-seen', at: now + i, help: { hints: 0, answerSeen: true, traced: false } }); appendRecordToDraft(draft, r); draft.sessions[slot] = advance(s, { cardKey: key, recordId: r.id, kind: 'answer-seen', at: now + i }); }
    });
    draft.sessions = endSlot(draft.sessions, slot, { at: now + 10, early: false });
    window.__shiziTest.reset();
    const res = window.__shiziTest.seed(draft);
    if (!res.ok) throw new Error(JSON.stringify(res));
    nav.push('result', { slot, sessionId: 's50' });
  });
  await page.waitForSelector('.sz-layer[data-top="true"] [data-testid="result-screen"]');
  await page.waitForTimeout(700);
}

async function visitPages(page, scheme, ctx) {
  const { assert, step } = ctx;
  const check = async (name, { sheets = null } = {}) => {
    const a = await audit(page, sheets);
    assert.deepEqual(a.fonts, [], `${scheme} ${name}: every rendered font-size is on the scale (× --k) or a registered glyph face`);
    assert.deepEqual(a.radii, [], `${scheme} ${name}: radii are 0 / 12 / 24 / round (nested 9 = 12 − 3)`);
    assert.deepEqual(a.zhu, [], `${scheme} ${name}: zhu / seal only on the wrong-dot and seal marks`);
    assert.equal(a.bodyBg, tokenRgb(scheme, 'paper'), `${scheme} ${name}: page background = paper token`);
    assert.equal(a.bodyImage, 'none', `${scheme} ${name}: the page background has no dot-grid texture`);
    assert.deepEqual(a.tex, [], `${scheme} ${name}: buttons / pages / sheets carry no paper texture`);
    if (sheets) assert.ok(a.texTotal > 0 && a.texOn === a.texTotal, `${scheme} ${name}: sheet surfaces carry the texture (${a.texOn}/${a.texTotal})`);
  };

  step(`${scheme}: home`);
  await page.evaluate(iso => window.__shiziTest.setClock(iso), `${TODAY}T09:00:00`);
  await page.waitForTimeout(300);
  await check('home');
  const cta = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-start"]');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, image: cs.backgroundImage, shadow: cs.boxShadow };
  });
  assert.equal(cta.bg, tokenRgb(scheme, 'btnBg'), `${scheme}: home 「拾」 button = ink button (btn-bg), no longer zhu`);
  assert.equal(cta.color, tokenRgb(scheme, 'btnFg'), `${scheme}: home button label = btn-fg`);
  assert.equal(cta.image, 'none', `${scheme}: home button has no dot texture`);

  step(`${scheme}: write (recall) and judge`);
  await seedSession(page, { slot: 'A', chars: ['永', '和', '春', '大', '中'], cursor: 0, at: new Date(`${TODAY}T09:00:00`).getTime() });
  await tab(page, 'home');
  await openWrite(page, { slot: 'A' });
  await page.waitForTimeout(600);
  await check('write', { sheets: '.sz-inkgrid' }); // D49：题面不再有笺面底（已给的字不装框、没有词语块）
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await page.click(topSel('write-done'));
  await page.waitForTimeout(1000);
  await check('judge', { sheets: '.sz-compare__card' });
  const judge = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] .sz-judge__btn');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
  });
  assert.equal(judge.radius, '12px', `${scheme}: judge buttons are controls (radius 12)`);

  step(`${scheme}: result`);
  await openResult(page);
  await check('result', { sheets: '.sz-work__sheet' }); // E9c（D49）：结果页没有作品纸，笺面是作品格后面的 sheet
  const primary = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] .sz-btn--primary');
    const cs = el ? getComputedStyle(el) : null;
    return cs ? { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, h: el.getBoundingClientRect().height } : null;
  });
  assert.ok(primary, `${scheme}: result has a primary button`);
  assert.equal(primary.bg, tokenRgb(scheme, 'btnBg'), `${scheme}: primary button = btn-bg`);
  assert.equal(primary.color, tokenRgb(scheme, 'btnFg'), `${scheme}: primary label = btn-fg`);
  assert.equal(primary.radius, '12px', `${scheme}: primary radius = control (12)`);
  assert.ok(primary.h >= 54, `${scheme}: primary height ≥ 54 (btn-h, got ${primary.h})`);
  // E9c（D49）：写错的朱点在字的右上（作品朱点同一个符号），不再是状态字前的 ::before
  const wrongDot = await page.evaluate(() => {
    const dot = document.querySelector('.sz-layer[data-top="true"] [data-testid="result-exrow-dot"]');
    if (!dot) return null;
    const row = dot.closest('[data-testid="result-exrow"]');
    const st = getComputedStyle(dot);
    return {
      text: getComputedStyle(row.querySelector('[data-testid="result-exrow-text"]')).color, dot: st.backgroundColor, w: st.width, radius: st.borderTopLeftRadius,
      before: getComputedStyle(row.querySelector('[data-testid="result-exrow-text"]'), '::before').content,
    };
  });
  assert.ok(wrongDot, `${scheme}: a wrong row is below the work`);
  assert.equal(wrongDot.dot, tokenRgb(scheme, 'zhu'), `${scheme}: 「写错」 is marked by a zhu dot on the glyph`);
  assert.equal(wrongDot.before, 'none', `${scheme}: nothing in front of the status word any more`);
  assert.equal(wrongDot.text, tokenRgb(scheme, 'ink2'), `${scheme}: the status text itself is ink2, not red`);
  assert.deepEqual([wrongDot.w, wrongDot.radius], ['5px', '50%'], `${scheme}: the wrong dot is a circle (5pt for the 36pt row glyph)`);

  // 原生 <button> 字帖格：按下 → data-pressed、背景 field；松手收回
  step(`${scheme}: result cell (native <button>) press feedback`);
  const cell = topSel('work-cell'); // P1-E7：日常结果页的格子是作品格
  const box = await page.locator(cell).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const down = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return { attr: el.getAttribute('data-pressed'), bg: getComputedStyle(el).backgroundColor };
  }, cell);
  assert.equal(down.attr, 'true', `${scheme}: result cell gets data-pressed on pointerdown`);
  assert.equal(down.bg, tokenRgb(scheme, 'field'), `${scheme}: pressed cell background = field`);
  await page.mouse.move(box.x + box.width / 2, box.y - 300);
  await page.mouse.up();
  const up = await page.evaluate(sel => document.querySelector(sel).getAttribute('data-pressed'), cell);
  assert.equal(up, null, `${scheme}: data-pressed cleared on release`);
  await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.back(); });
  await page.waitForTimeout(600);

  step(`${scheme}: library, mine, settings`);
  await page.evaluate(({ iso, s }) => { window.__shiziTest.reset(); window.__shiziTest.setClock(iso); const r = window.__shiziTest.seed(s); if (!r.ok) throw new Error(JSON.stringify(r)); }, { iso: `${TODAY}T09:00:00`, s: seedLibrary() });
  await page.waitForTimeout(300);
  await tab(page, 'library');
  await page.waitForTimeout(500);
  await check('library');
  // r7-L1（D60）：墨墙在「全部」页，写错的朱点在那里查
  await page.evaluate(async () => { (await import('/src/ui/router.js')).nav.push('library-all', { sort: 'age' }); });
  await page.waitForSelector('.sz-layer[data-top="true"] [data-testid="all-cell"]');
  await page.waitForTimeout(600);
  const dots = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] .sz-lib__mark')].map(el => getComputedStyle(el).backgroundColor));
  assert.ok(dots.length > 0 && dots.every(c => c === dots[0]), `${scheme}: wall wrong-marks all share one colour`);
  assert.equal(dots[0], tokenRgb(scheme, 'zhu'), `${scheme}: the wall's wrong dot = zhu`);
  await page.evaluate(async () => { (await import('/src/ui/router.js')).nav.back(); });
  await page.waitForTimeout(600);
  await tab(page, 'mine');
  await page.waitForTimeout(500);
  await check('mine', { sheets: '.sz-month__sheet' }); // D57 · C1：字帖格是一张笺面（没有 .sz-mine__paper 卡片了）
  await page.evaluate(async () => { (await import('/src/ui/screens/mine/settings.js')).openSettings(); });
  await page.waitForTimeout(700);
  await waitNavIdle(page, { settleMs: 250 });
  await check('settings');
  await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.back(); });
  await page.waitForTimeout(500);
}

export default async function tokensSpec(page, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await visitPages(page, scheme, ctx);
  }

  // ------------------------------------------------------------------ 首页主按钮按下：只有 data-pressed，没有旧 :active 叠加
  step('home 「拾」 button: pressed = btn-down via data-pressed only (no stacked :active)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await page.waitForSelector(tid('home-start'));
  const sel = topSel('home-start');
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(260);
  const pressed = await page.evaluate(s => {
    const el = document.querySelector(s);
    return { attr: el.getAttribute('data-pressed'), bg: getComputedStyle(el).backgroundColor, transform: getComputedStyle(el).transform };
  }, sel);
  assert.equal(pressed.attr, 'true', 'CTA: data-pressed while down');
  assert.equal(pressed.bg, tokenRgb('light', 'btnDown'), 'CTA pressed background = btn-down');
  assert.equal(pressed.transform, 'matrix(0.97, 0, 0, 0.97, 0, 0)', 'CTA pressed scale .97');
  await page.mouse.move(box.x + box.width / 2, box.y - 300);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const rest = await page.evaluate(s => getComputedStyle(document.querySelector(s)).backgroundColor, sel);
  assert.equal(rest, tokenRgb('light', 'btnBg'), 'CTA released background = btn-bg');
  const activeRules = await page.evaluate(() => {
    const hits = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (error) { continue; }
      for (const r of rules) if (/:active/.test(r.cssText || '')) hits.push(r.selectorText);
    }
    return hits;
  });
  assert.deepEqual(activeRules, [], 'no :active rules in any stylesheet (iOS WebKit relies on data-pressed)');

  // ------------------------------------------------------------------ 焦点环 = ink1（不是朱）
  step('keyboard focus ring uses ink1, not zhu');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = el ? getComputedStyle(el) : null;
    return cs ? { style: cs.outlineStyle, color: cs.outlineColor, width: cs.outlineWidth } : null;
  });
  assert.ok(ring && ring.style === 'solid', 'a focused control shows an outline');
  assert.equal(ring.color, tokenRgb('light', 'ink1'), 'focus ring colour = ink1');
}
