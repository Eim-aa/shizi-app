// 阶段 1 Q2-12（复测 simC D9）：纸上写的格下脚注「这个字记下时会标注「纸上」，不留笔迹。」里的「纸上」不被断成两行
// （脚注的可用宽度被空着的撤销 / 清空槽吃掉）。默认字号 375×667 与 393×852，及 XXXL。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

/** 「纸」「上」两个字所在的行盒顶：同一行才算没被断开。 */
async function paperWordRows(page) {
  return page.evaluate(sel => {
    const note = document.querySelector(sel);
    if (!note) return null;
    const walker = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
    const tops = [];
    let n;
    while ((n = walker.nextNode())) {
      const i = n.textContent.indexOf('纸上');
      if (i < 0) continue;
      for (const k of [i, i + 1]) {
        const r = document.createRange();
        r.setStart(n, k);
        r.setEnd(n, k + 1);
        tops.push(Math.round(r.getBoundingClientRect().top));
      }
    }
    const nb = note.getBoundingClientRect();
    return { tops, noteW: Math.round(nb.width), lines: Math.round(nb.height / parseFloat(getComputedStyle(note).lineHeight)), text: note.textContent.trim() };
  }, sel_);
}
const sel_ = topSel('write-paper-note');

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [w, h, size] of [[375, 667, 'L'], [393, 852, 'L'], [375, 667, 'XXXL']]) {
    await page.setViewportSize({ width: w, height: h });
    await bootTestHost(page, ctx.baseURL);
    await setTextSize(page, size);
    step(`${w}×${h} · ${size}：纸上写的格下脚注，「纸上」在同一行`);
    await seedSession(page, { kind: 'daily', chars: ['尴', '赢'], extraState: { settings: { writeMode: 'paper', firstTipSeen: true } } });
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
    await page.waitForSelector(topSel('write-screen'));
    await waitNavIdle(page);
    await page.waitForSelector(topSel('write-paper-note'));
    await waitNavIdle(page);
    const f = await paperWordRows(page);
    assert.equal(f.text, '这个字记下时会标注「纸上」，不留笔迹。', 'note text');
    assert.equal(f.tops.length, 2, 'found 纸 and 上');
    assert.equal(f.tops[0], f.tops[1], `「纸」「上」on one line (${f.tops.join(' / ')}; note ${f.noteW}pt wide, ${f.lines} line(s))`);
    if (size === 'L') assert.ok(f.noteW >= 200, `the note has room (${f.noteW}pt) once the empty tools slot no longer eats the width`);
  }
}
