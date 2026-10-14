// C3-H ⑤（N3-03、N3-06、N3-07、T3-12；D53；P248）：首用口吻。
//   · 全写错的首练结果页：朱色 ≤ 2 处（实为 0）、不重复点名——参考字行格下不写状态字，下面各行只点一次名（中性的「写过了」）、不带朱点；
//     只要有一个字写对，行仍是「写错了」+ 朱点（朱点语法没变）；
//   · 首练标题固定「这三个字」（不随作品里有几格变）；
//   · 首练页：标题之外最多两句话（复现句 + 邀请的问句），邀请按钮写出结果「好，明天给我一个词」/「先不用」，没有邀请说明 body；
//   · 看答案：第一次也不预告（格下没有那行说明），「记为看过答案」整屏只出现一次。
import { bootTestHost, seedSession, tap, topSel, waitNavIdle, openWrite } from './helpers.mjs';
import { openResultPage, resultSnapshot, seedWork } from './work-helpers.mjs';

/* eslint-disable no-undef */
async function redCount(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const probe = name => { const e = document.createElement('i'); e.style.color = `var(--${name})`; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
    const reds = [probe('zhu'), probe('seal')];
    const hits = [];
    for (const el of top.querySelectorAll('*')) {
      if (!el.checkVisibility()) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        const vals = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.boxShadow, cs.fill, cs.stroke];
        if (vals.some(v => v && reds.some(r => v.includes(r)))) hits.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 30)}${pseudo || ''}`);
      }
    }
    return hits;
  });
}

async function firstPageFacts(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const body = top.querySelector('[data-testid="result-body"]');
    return {
      text: body.innerText,
      title: (q('result-title') || {}).textContent || null,
      preview: (q('result-preview') || {}).textContent || null,
      status: top.querySelectorAll('[data-testid="work-status"]').length,
      exrows: [...top.querySelectorAll('[data-testid="result-exrow"]')].map(r => ({ text: r.querySelector('.sz-exrow__t').textContent.trim(), dot: !!r.querySelector('[data-testid="result-exrow-dot"]'), btn: !!r.querySelector('[data-testid="result-add"]') })),
      inviteTitle: (q('result-invite-title') || {}).textContent || null,
      inviteBody: q('result-invite-body') ? q('result-invite-body').textContent : null,
      yes: (q('result-invite-yes') || {}).textContent || null,
      no: (q('result-invite-no') || {}).textContent || null,
    };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);

    step(`${scheme}: 全写错的首练结果页：朱色 ≤ 2 处、不重复点名、标题仍是「这三个字」`);
    const s1 = await seedWork(page, { id: 's60', kind: 'first', chars: ['尴', '赢', '拾'], steps: ['wrong', 'wrong', 'wrong'], clock: '2026-10-05T10:30:00' });
    await openResultPage(page, { slot: 'A', sessionId: s1.sessionId });
    let f = await firstPageFacts(page);
    const snap = await resultSnapshot(page);
    assert.equal(snap.work.variant, 'plain', 'no work: the plain row of reference chars');
    assert.equal(f.status, 0, 'the reference row has no status words under it');
    assert.ok(!/写错/.test(f.text), `nothing on the page says 「写错」 (${f.text.replace(/\s+/g, ' ').slice(0, 120)})`);
    assert.deepEqual(f.exrows.map(r => r.text), ['写过了', '写过了', '写过了'], 'each char is named once, neutrally');
    assert.ok(f.exrows.every(r => !r.dot), 'no red dot on the rows');
    assert.ok(f.exrows.every(r => r.btn), '「放进图里」 is still offered');
    const reds = await redCount(page);
    assert.ok(reds.length <= 2, `red marks on the screen ≤ 2 (${reds.length}: ${reds.join(', ')})`);
    assert.equal(f.title, '这三个字，很多人提笔就忘。', 'the title speaks about the group');
    assert.ok(f.preview && f.preview.startsWith('「拾」就是首页那个字。'), `the 复现句 says once that 拾 is the home-page char: ${f.preview}`);

    step(`${scheme}: 首练页标题之外两句话加一句锁屏隐私说明，邀请按钮写出结果`);
    await page.waitForSelector(`${topSel('result-invite')}[data-state="invite"]`, { timeout: 4000 });
    f = await firstPageFacts(page);
    assert.ok(f.inviteBody && f.inviteBody.startsWith('锁屏只显示词语和拼音'), `D54: the lock-screen privacy line stays on the first-practice invitation: ${f.inviteBody}`);
    const sentences = [f.preview, f.inviteTitle].filter(Boolean);
    assert.equal(sentences.length, 2, `two sentences besides the title: 「${sentences.join('」「')}」`);
    assert.deepEqual([f.yes, f.no], ['开启提醒', '先不用'], 'the buttons say what happens');
    // 邀请出现以后红点仍是 ≤ 2
    assert.ok((await redCount(page)).length <= 2, 'still ≤ 2 red marks with the invitation shown');

    step(`${scheme}: 有一个字写对时：写错的字行仍是「写错了」+ 朱点，标题不变`);
    const s2 = await seedWork(page, { id: 's61', kind: 'first', chars: ['尴', '赢', '拾'], steps: ['correct', 'wrong', 'correct'], clock: '2026-10-05T10:30:00' });
    await openResultPage(page, { slot: 'A', sessionId: s2.sessionId });
    f = await firstPageFacts(page);
    assert.deepEqual(f.exrows, [{ text: '写错了', dot: true, btn: true }], 'with a work on the page the wrong row keeps its word and dot (D46 ⑥)');
    assert.equal(f.title, '这三个字，很多人提笔就忘。', 'the title does not follow the number of cells (two here)');
    assert.ok(f.preview && f.preview.startsWith('你写下的第一个「拾」。'), `the 拾 sentence in the 复现句: ${f.preview}`);

    step(`${scheme}: 看答案第一次：格下没有预告，「记为看过答案」整屏只一处`);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await seedSession(page, { slot: 'A', kind: 'first', chars: ['尴', '赢', '拾'], cursor: 0 });
    await openWrite(page, { slot: 'A' });
    await tap(page, 'write-show-answer');
    await page.waitForSelector(topSel('write-trace-done'));
    await waitNavIdle(page);
    const t = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      return { text: top.innerText, note: (top.querySelector('[data-testid="write-note"]') || {}).textContent || '' };
    });
    assert.ok(!/以后点/.test(t.text), 'no 「以后点「看答案」会直接显示」');
    assert.equal((t.text.match(/记为看过答案/g) || []).length, 1, '「记为看过答案」 is said once on the screen');
    assert.equal(t.note, '记为看过答案。', 'in the single line under the grid (the footer is one row, D53 ②)');
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
