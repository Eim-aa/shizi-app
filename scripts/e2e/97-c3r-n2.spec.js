// 第三轮 C3-R（D53 ⑤；N2-12 / N2-13 / N2-14 收尾）：
//   · 设置里「按键音」改「声音」，副标题「判断和落款时的轻声，书写时不出声。」，读屏名 = 标题、说明 = 副标题；
//   · 年报页首屏与册页卷首同一句汉字数字「这一年，你拾回两百一十八个字。」（页面上没有阿拉伯数字，数按实际）；
//   · （邀请示例的描边方框在 72-p1e5-home-first 里核对；锁屏通知「＿尬（gān）」在 test/platform/reminder.test.mjs 里核对）。

import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedMonthRecords } from './work-helpers.mjs';

async function go(page, fn, arg) {
  await page.evaluate(fn, arg);
  await waitNavIdle(page);
  await page.waitForTimeout(150);
}

export default async function c3rN2(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  step('settings: 「声音」 with a subtitle that says which two moments make a sound');
  await go(page, async () => (await import('/src/ui/router.js')).nav.push('settings', {}));
  await page.waitForSelector(topSel('settings-sound'));
  const s = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const row = top.querySelector('[data-testid="settings-sound"]');
    const name = document.getElementById(row.getAttribute('aria-labelledby')).textContent.trim();
    const sub = top.querySelector('[data-testid="settings-sound-sub"]');
    const described = row.getAttribute('aria-describedby');
    return {
      name, sub: sub && sub.textContent.trim(), describedBy: described && document.getElementById(described) === sub,
      text: top.innerText, role: row.getAttribute('role'),
    };
  });
  assert.equal(s.name, '声音', 'the switch is named 「声音」');
  assert.equal(s.sub, '点写对写错时有轻声，写字时无声。', 'subtitle');
  assert.ok(s.describedBy, 'the subtitle is the switch’s description for screen readers');
  assert.ok(!s.text.includes('按键音'), 'no 「按键音」 anywhere on the page');
  assert.equal(s.role, 'switch', 'still a switch');
  await go(page, async () => (await import('/src/ui/router.js')).nav.back());

  step('annual: the page head and the album cover are one sentence, in Chinese numerals, with 拾回');
  await seedMonthRecords(page, {
    entries: [{ day: '2026-04-26', chars: '春夏秋冬水火土木金' }, { day: '2026-09-02', chars: '永和春大中山' }],
    clock: '2026-10-05T20:00:00',
  });
  await go(page, async () => (await import('/src/ui/router.js')).nav.push('annual', {}));
  await page.waitForSelector(topSel('annual-head'));
  const a = await page.evaluate(async () => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const head = top.querySelector('[data-testid="annual-head"]');
    const { annualCoverLine } = await import('/src/ui/work-text.js');
    const n = Number(head.dataset.n);
    return { text: head.textContent.trim(), n, expected: annualCoverLine(n), hasDigit: /[0-9]/.test(head.textContent), year: top.querySelector('[data-testid="annual-year"]').textContent.trim() };
  });
  assert.equal(a.n, 14, 'the real count of the year (9 + 6 chars, 春 twice counts once)');
  assert.equal(a.text, '这一年，你拾回十四个字。', 'Chinese numerals, 拾回');
  assert.equal(a.text, a.expected, 'the same function the album cover uses (images-annual.js annualCoverLine)');
  assert.ok(!a.hasDigit, 'no Arabic digits in the sentence');
  assert.equal(a.year, '二〇二六', 'the year is also Chinese numerals, like the cover');
  const big = await page.evaluate(async () => {
    const { annualCoverLine } = await import('/src/ui/work-text.js');
    return [218, 2, 102, 1000].map(n => annualCoverLine(n));
  });
  assert.deepEqual(big, ['这一年，你拾回两百一十八个字。', '这一年，你拾回两个字。', '这一年，你拾回一百零二个字。', '这一年，你拾回一千个字。'], 'numbers follow the real count (2 reads 两)');
}
