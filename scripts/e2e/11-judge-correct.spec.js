// M1-5 判断页、记录写入、结果行、跳过（02 §3 M1-5；决定-D03 / D07 / D19 / D20 / D23；01 §3.2 / §3.3 / §4 / §5 / §6.6；
// 04 R-W09 / R-W10 / R-W14 / R-W16 / R-W17 / R-W20；02 §8.1 场景 6、反例 2 / 3 / 6）。
//
// seed 一个 A 会话（永 / 和 / 春 / 大 / 中）：
//   空格子「写好了」disabled 且强点不进 compare → 写一笔 → 判断页（两键同样式、无 aria-pressed、焦点不在判断键、
//   对照区无判定类名、「接着写」回书写格不记录）→ failNextWrite 判断失败留在判断页、三段式、不记录 → 再试一次成功推进
//   （一条 judged、fsrsBefore、sched、结果行 record；D27 起 perRecordInk 默认开启，同一次提交写记录月份的 ink 月键）→
//   第二字用提示后「修改」上一判断：失败可重试、同一记录追加 corrections、due 重放更新、session.current 深相等；
//   再改回来 due 回到原值（重放确定）→ 落笔后入口收起 → 判断第二字后上一字的行消失 →
//   第三字用提示写了几笔时（钩子）修改上一判断，current 深相等、入口保持收起 →
//   跳过：skipped 记录不算有效记录、结果行清空、5 秒撤销轻提示；撤销 = 记录数不变、字回原位、提示次数放回；
//   跳过写失败不推进、可重试；撤销写失败可重试；3 秒后轻提示消失 →
//   钩子：空笔画判断 commit 被拒；seed 的 compare + 空笔画按 recall 显示；显式 perRecordInk:true 写 ink 月键 →
//   最后一个字判断后会话走完 → 直接换成结果页（M2-3，会话移入 lastEnded）→ 全部写入经 storage.js。

import {
  bootTestHost, drawStroke, HORIZONTAL, VERTICAL, PRESS_SETTLE_MS, seedSession, tid, topSel, waitNavIdle, writeSnapshot,
  openWrite,
} from './helpers.mjs';

const COPY = {
  titleRecall: '凭记忆写出这个字',
  titleCompare: '写对了吗？', // D49：判断页页头只问一次
  wrong: '写错了',
  correct: '写对了',
  mine: '你的书写',
  ref: '参考字形',
  cont: '接着写',
  saveFailed: '没保存上，你写的字还在。',
  retry: '再试一次',
  notNow: '先不保存',
  changeTitle: c => `修改「${c}」的判断`,
  changeBodyCorrect: '刚才记的是写对。改了只换掉这一次，不会多算一次。',
  changeBodyWrong: '刚才记的是写错。改了只换掉这一次，不会多算一次。',
  changeFailed: '没改成，还是原来的判断。',
  changeRetry: '再试一次',
  changeCancel: '先不改',
  toWrong: '改为写错',
  toCorrect: '改为写对',
  lineRecordedCorrect: c => `「${c}」记为写对`,
  lineRecordedWrong: c => `「${c}」记为写错`,
  lineChangedWrong: c => `「${c}」已改为写错`,
  lineChangedCorrect: c => `「${c}」已改为写对`,
  skip: '跳过',
  skipped: c => `已跳过「${c}」`,
  undo: '撤销',
};

const CHARS = ['永', '和', '春', '大', '中'];
const VERDICT_CLASS = /correct|wrong|right|suggest|verdict|good|bad|pass|fail|selected|pressed|active|primary|chosen/i;

/** 记录（全部月份展平）、会话 A、今日 N、sched、ink 键。 */
async function facts(page) {
  return page.evaluate(async () => {
    const { todayCount } = await import('/src/core/records.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const m of Object.keys(st.records || {})) {
      const v = st.records[m];
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    }
    const d = new Date(window.__shiziTest.now());
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const raw = window.__shiziTest.getRawKeys('shizi.v2.');
    return {
      records,
      judged: records.filter(r => r.kind === 'judged'),
      session: st.sessions ? st.sessions.A || (st.sessions.lastEnded || {}).A || null : null, // 写完后移入 lastEnded（M2-3）
      todayN: todayCount(records, today),
      sched: st.sched || {},
      inkKeys: Object.keys(raw).filter(k => k.startsWith('shizi.v2.ink.')),
      rawKeys: Object.keys(raw),
    };
  });
}

async function text(page, id) {
  const el = page.locator(topSel(id));
  return (await el.count()) ? (await el.first().textContent()).trim() : null;
}

async function present(page, id) {
  return (await page.locator(topSel(id)).count()) > 0;
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS); // 换阶段 = 新状态，按钮 0.4s 不响应
}

async function waitCursor(page, cursor) {
  await page.waitForFunction(c => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && Number(top.dataset.cursor) === c;
  }, cursor);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function settle(page) {
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function lineInfo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-line"]');
    if (!el) return null;
    const txt = el.querySelector('[data-testid="write-line-text"]');
    const btn = el.querySelector('[data-testid="write-line-change"]');
    return {
      state: el.dataset.state,
      kind: el.dataset.kind || null,
      text: txt ? txt.textContent : '',
      change: btn ? btn.textContent.trim() : null,
      all: el.textContent,
    };
  });
}

async function sheetInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="write-change-sheet"]');
    if (!panel) return null;
    const q = id => panel.querySelector(`[data-testid="${id}"]`);
    return {
      title: panel.querySelector('.sz-sheet__title') ? panel.querySelector('.sz-sheet__title').textContent : null,
      note: q('write-change-note') ? q('write-change-note').textContent : null,
      flip: q('write-change-flip') ? q('write-change-flip').textContent.trim() : null,
      failCancel: q('write-change-fail-cancel') ? q('write-change-fail-cancel').textContent.trim() : null,
      failRetry: q('write-change-fail-retry') ? q('write-change-fail-retry').textContent.trim() : null,
      mine: !!q('write-change-mine'),
      noink: !!q('write-change-noink'),
      ref: !!q('write-change-ref'),
      role: panel.getAttribute('role'),
    };
  });
}

async function canvasPixels(page, selector) {
  return page.evaluate(sel => {
    const c = document.querySelector(sel);
    if (!c) return -1;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
    return n;
  }, selector);
}

/** 写一笔并等书写格计数。 */
async function write(page, pts, expectCount) {
  await drawStroke(page, pts);
  await page.waitForFunction(n => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === n;
  }, expectCount);
}

async function toCompare(page) {
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitPhase(page, 'compare');
  await page.mouse.move(2, 2); // 鼠标移开，避免悬停影响样式比较
}

async function openSheet(page) {
  await page.click(topSel('write-line-change'));
  await page.waitForSelector(tid('write-change-sheet'));
  await waitNavIdle(page);
}

async function sheetClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-change-sheet"]'));
  await waitNavIdle(page);
}

export default async function judgeCorrect(page, ctx) {
  const { assert } = ctx;

  ctx.step('seed an A session (永 / 和 / 春 / 大 / 中) and open the write screen');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seed accepted');
  await openWrite(page, { slot: 'A' });
  let s = await writeSnapshot(page);
  assert.equal(s.phase, 'recall', 'starts in recall');
  assert.equal(await present(page, 'write-line'), false, 'first character: no result line (nothing before it)');
  assert.equal(await text(page, 'write-skip'), COPY.skip, 'recall shows the 「跳过」 text button (R-W14)');

  // ------------------------------------------------------------------ 空格子
  ctx.step('empty grid: 「写好了」 disabled + aria-disabled; a forced click does not enter compare');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '写好了 disabled with aria-disabled on an empty grid');
  await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-done"]');
    b.disabled = false; // 绕过 disabled 强行派发点击：onDone 自己还要挡住空格子
    b.click();
    b.disabled = true;
  });
  await settle(page);
  s = await writeSnapshot(page);
  assert.equal(s.phase, 'recall', 'still recall after the forced click');
  assert.equal(await present(page, 'write-compare'), false, 'no compare area');
  let f = await facts(page);
  assert.equal(f.session.current.phase, 'recall', 'stored phase unchanged');
  assert.equal(f.records.length, 0, 'no record');

  // ------------------------------------------------------------------ 判断页
  ctx.step('write one stroke → 写好了 → compare page (D03 / D20 / R-W09)');
  await write(page, HORIZONTAL, 1);
  s = await writeSnapshot(page);
  assert.deepEqual(s.done, { disabled: false, ariaDisabled: null }, '写好了 enabled after a stroke');
  await toCompare(page);
  s = await writeSnapshot(page);
  assert.equal(s.title, COPY.titleCompare, 'title 写对了吗？ (R-W03, D49: 去掉「对照一下，」)');
  assert.equal(await present(page, 'write-judge-note'), false, 'D49: no 「你来判断，点一下就记下。」 sentence on the judge page');
  assert.equal(await present(page, 'write-grid'), false, 'grid replaced by the compare cards');
  assert.equal(await present(page, 'write-skip'), false, 'no skip on the judge page');
  assert.equal(await present(page, 'write-show-answer'), false, 'no 看答案 on the judge page');
  const cmp = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const area = top.querySelector('[data-testid="write-compare"]');
    const w = top.querySelector('[data-testid="write-judge-wrong"]');
    const c = top.querySelector('[data-testid="write-judge-correct"]');
    const cw = getComputedStyle(w);
    const cc = getComputedStyle(c);
    const diffs = [];
    for (let i = 0; i < cw.length; i += 1) {
      const name = cw[i];
      if (cw.getPropertyValue(name) !== cc.getPropertyValue(name)) diffs.push(name);
    }
    const classes = [area, ...area.querySelectorAll('*')].map(el => el.getAttribute('class') || '').join(' ');
    const attrs = [area, ...area.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => a.name.startsWith('data-') || a.name.startsWith('aria-')).map(a => `${a.name}=${a.value}`));
    const rw = w.getBoundingClientRect();
    const rc = c.getBoundingClientRect();
    const mineLabel = top.querySelector('[data-testid="write-compare-mine"]');
    const refCard = top.querySelector('[data-testid="write-compare-ref"]');
    const cont = top.querySelector('[data-testid="write-continue"]');
    return {
      wText: w.textContent.trim(),
      cText: c.textContent.trim(),
      wClass: w.className,
      cClass: c.className,
      diffs,
      pressed: [w.hasAttribute('aria-pressed'), c.hasAttribute('aria-pressed'), w.hasAttribute('autofocus'), c.hasAttribute('autofocus')],
      active: document.activeElement === w || document.activeElement === c,
      activeTag: document.activeElement ? `${document.activeElement.tagName}${document.activeElement.hasAttribute('data-page-title') ? '[data-page-title]' : ''}` : null,
      classes,
      attrs,
      leftOfCorrect: rw.right <= rc.left,
      sameSize: Math.abs(rw.width - rc.width) < 0.5 && Math.abs(rw.height - rc.height) < 0.5,
      mineAria: mineLabel ? mineLabel.getAttribute('aria-label') : null,
      refAria: refCard ? refCard.getAttribute('aria-label') : null,
      // D46 ⑪（P1-E1b）：上下两格，本人书写在上、参考字形在下（共用一条格线，下格上沿与上格下沿相差 1px 的重叠）
      mineAbove: mineLabel && refCard ? mineLabel.getBoundingClientRect().bottom <= refCard.getBoundingClientRect().top + 1.5 : false,
      labels: [...area.querySelectorAll('.sz-compare__aside')].map(el => el.textContent),
      pageText: top.innerText,
      cont: cont ? { text: cont.textContent.trim(), aria: cont.getAttribute('aria-label'), icon: !!cont.querySelector('svg') } : null,
      pageBack: !!top.querySelector('[data-testid="page-back"]'),
      toolsPresent: !!top.querySelector('[data-testid="write-tools"]'),
      fill: top.querySelector('.sz-prompt__fill') ? top.querySelector('.sz-prompt__fill').textContent : null,
    };
  });
  assert.equal(cmp.wText, COPY.wrong, 'left button 写错了');
  assert.equal(cmp.cText, COPY.correct, 'right button 写对了');
  assert.ok(cmp.leftOfCorrect, '写错了 is to the left of 写对了 (D20)');
  assert.ok(cmp.sameSize, 'both judge buttons have the same size');
  assert.equal(cmp.wClass, cmp.cClass, 'both judge buttons carry the same class list');
  assert.deepEqual(cmp.diffs, [], 'getComputedStyle of the two judge buttons is identical (D03: equally prominent)');
  assert.deepEqual(cmp.pressed, [false, false, false, false], 'no aria-pressed and no autofocus on the judge buttons');
  assert.equal(cmp.active, false, 'activeElement is not a judge button (no preselection, D03)');
  assert.equal(cmp.activeTag, 'H1[data-page-title]', 'focus moved to the page title');
  assert.equal(VERDICT_CLASS.test(cmp.classes), false, `compare area has no verdict class names (${cmp.classes})`);
  assert.equal(cmp.attrs.some(a => VERDICT_CLASS.test(a.split('=')[1] || '')), false, 'compare area has no verdict data / aria values');
  assert.ok(cmp.mineAbove, '你的书写 above, 参考字形 below (D46 ⑪)');
  assert.deepEqual(cmp.labels, [], 'D49: no 「你的书写 / 参考字形」 side notes (the names live on the cards)');
  assert.ok(!cmp.pageText.includes(COPY.mine) && !cmp.pageText.includes(COPY.ref), 'D49: neither label is rendered as text anywhere on the judge page');
  // A9：读屏名称带上信息——本人卡「你的书写，N 笔」，参考卡「参考字形：字，拼音，N 画[，结构 / 部件数]」（视觉标签不变；R2-A1 起补结构，A2-09）
  assert.equal(cmp.mineAria, `${COPY.mine}，1 笔`, 'my card is role=img: 「你的书写，1 笔」 (one stroke drawn)');
  assert.ok(new RegExp(`^${COPY.ref}：${CHARS[0]}，[^，]+，\\d+ 画(，[^，]+)?$`).test(cmp.refAria), `reference card is role=img: 「参考字形：字，拼音，N 画」 (${cmp.refAria})`);
  assert.deepEqual(cmp.cont, { text: '', aria: COPY.cont, icon: true }, 'top-left is the ‹ icon (same as the write page), screen-reader name 接着写 (R-W09, D49)');
  assert.equal(cmp.pageBack, false, 'the default back button is replaced by the continue icon on the judge page (same icon, different action)');
  assert.equal(cmp.toolsPresent, false, 'no undo / clear row on the judge page (the stacked cards take the grid\'s place)');
  assert.equal(cmp.fill, null, 'D49: the prompt blank does NOT reveal the target on the judge page (the answer shows once, in the reference card)');
  await page.waitForFunction(() => {
    const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]');
    return !!r && r.dataset.state === 'ready';
  });
  await page.waitForTimeout(80);
  assert.ok(await canvasPixels(page, '.sz-layer[data-top="true"] [data-testid="write-compare-mine"] canvas') > 50, '你的书写 card shows the learner ink');
  assert.ok(await canvasPixels(page, '.sz-layer[data-top="true"] [data-testid="write-compare-ref"] canvas') > 500, '参考字形 card shows the reference glyph');
  f = await facts(page);
  assert.equal(f.session.current.phase, 'compare', 'entering compare is written to the session (phase)');
  assert.equal(f.session.current.strokes.length, 1, '…together with the raw strokes (encodeRawStrokes)');
  assert.equal(f.records.length, 0, 'entering compare records nothing');

  ctx.step('接着写 → back to the grid, strokes kept, nothing recorded (W09)');
  await page.click(topSel('write-continue'));
  await waitPhase(page, 'recall');
  s = await writeSnapshot(page);
  assert.equal(s.title, COPY.titleRecall, 'title back to recall');
  assert.equal(s.strokes, 1, 'the stroke is still on the grid');
  f = await facts(page);
  assert.equal(f.records.length, 0, 'no record after 接着写');
  assert.equal(f.session.current.phase, 'recall', 'stored phase back to recall');
  assert.equal(await present(page, 'page-back'), true, 'back arrow is back');

  // ------------------------------------------------------------------ 判断失败三段式
  ctx.step('failNextWrite → 写对了 fails → stays on the judge page, R-W16 three-part copy, nothing recorded');
  await toCompare(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-judge-correct'));
  await page.waitForSelector(`${topSel('write-judge-foot')}[data-failed="true"]`);
  await settle(page);
  s = await writeSnapshot(page);
  assert.equal(s.phase, 'compare', 'still on the judge page');
  assert.equal(s.cursor, 0, 'did not advance');
  assert.equal(await text(page, 'write-judge-note'), COPY.saveFailed, 'note 没保存上，你写的字还在。');
  assert.deepEqual([await text(page, 'write-judge-fail-cancel'), await text(page, 'write-judge-fail-retry')], [COPY.notNow, COPY.retry], '[先不保存 / 再试一次]');
  assert.equal(await present(page, 'write-judge-correct'), false, 'judge buttons replaced while failed');
  f = await facts(page);
  assert.equal(f.records.length, 0, 'no record after the failed write (atomic)');
  assert.deepEqual(f.sched, {}, 'sched untouched');
  assert.equal(f.session.cursor, 0, 'stored cursor unchanged');

  ctx.step('先不保存 → judge buttons back; fail again → 再试一次 succeeds once');
  await page.click(topSel('write-judge-fail-cancel'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await settle(page);
  assert.equal(await present(page, 'write-judge-note'), false, 'the failure sentence is gone again (and still no instruction sentence)');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'quota' }));
  await page.click(topSel('write-judge-correct'));
  await page.waitForSelector(`${topSel('write-judge-foot')}[data-failed="true"]`);
  await settle(page);
  f = await facts(page);
  assert.equal(f.records.length, 0, 'quota failure: still no record');
  await page.click(topSel('write-judge-fail-retry'));
  await waitCursor(page, 1);
  f = await facts(page);
  assert.equal(f.judged.length, 1, 'exactly one judged record after retry (no double count, D07)');
  assert.equal(f.records.length, 1, 'no other record');
  const r1 = f.judged[0];
  assert.equal(r1.cardKey, `base:${CHARS[0]}`, 'record is for 永');
  assert.equal(r1.judgment, 'correct', 'judgment correct');
  assert.deepEqual(r1.help, { hints: 0, answerSeen: false, traced: false }, 'help facts as they happened');
  assert.equal(r1.sessionId, f.session.id, 'record carries the session id');
  assert.equal('inkId' in r1, false, 'no inkId (ink is keyed by the record id itself, 01 §3.6)');
  // D27（阶段 1 P1-E3）：perRecordInk 默认开启——判断 commit 同时写这条记录月份的 ink 月键（关闭时不写，见 47-ink-promises 的关闭态）
  assert.deepEqual(f.inkKeys, [`shizi.v2.ink.${r1.localDay.slice(0, 7)}`], 'perRecordInk on (D27 default): ink month key written with the record');
  assert.equal(f.todayN, 1, 'today N = 1');
  assert.equal(f.session.cursor, 1, 'session advanced');
  assert.equal(f.session.items.length, 1, 'one item');
  assert.equal(f.session.items[0].kind, 'judged', 'item kind judged');
  assert.equal(f.session.items[0].recordId, r1.id, 'item points at the record');
  assert.ok(f.session.items[0].fsrsBefore && typeof f.session.items[0].fsrsBefore.stability === 'number', 'item keeps fsrsBefore for in-session correction replay');
  assert.deepEqual(f.session.lastLine, { recordId: r1.id, kind: 'record' }, "lastLine {kind:'record'}");
  assert.equal(f.session.current.phase, 'recall', 'next character starts in recall');
  assert.deepEqual(f.session.current.strokes, [], 'next character starts with an empty grid');
  const sched1 = f.sched[`base:${CHARS[0]}`];
  assert.ok(sched1 && /^\d{4}-\d{2}-\d{2}$/.test(sched1.due), 'FSRS sched entry written (Good)');
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 0, 'grid empty on the next character');
  assert.equal(s.progress, '2 / 5', 'progress 2 / 5');

  // ------------------------------------------------------------------ 结果行 + 修改
  ctx.step('result line on the next character: 「永」记为写对 · 修改 › (R-W10)');
  let line = await lineInfo(page);
  assert.deepEqual([line.state, line.kind], ['judged', 'record'], 'line state judged / record');
  assert.equal(line.text, COPY.lineRecordedCorrect(CHARS[0]), 'line text 「永」记为写对');
  assert.equal(line.change, '修改›', '修改 › action');

  ctx.step('use a hint on 和, then 修改 the previous judgment: failure, retry, same record, due replayed, current unchanged');
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`);
  await page.click(topSel('write-hint'));
  await page.waitForFunction(() => {
    const st = window.__shiziTest.getState();
    return st.sessions.A.current.hints === 1;
  });
  await settle(page);
  line = await lineInfo(page);
  assert.ok(line && line.state === 'judged', 'using a hint does not collapse the line (only pen-down does)');
  f = await facts(page);
  const currentBefore = f.session.current;
  assert.equal(currentBefore.hints, 1, 'current has hints 1');
  assert.ok(currentBefore.hintRange && currentBefore.hintRange.to > currentBefore.hintRange.from, 'current has a hint range');
  await openSheet(page);
  let sheet = await sheetInfo(page);
  assert.equal(sheet.role, 'dialog', 'bottom sheet role=dialog');
  assert.equal(sheet.title, COPY.changeTitle(CHARS[0]), 'sheet title 修改「永」的判断');
  assert.equal(sheet.note, COPY.changeBodyCorrect, 'sheet note 刚才记的是写对。…');
  assert.equal(sheet.flip, COPY.toWrong, 'main button 改为写错');
  assert.ok(sheet.mine && !sheet.noink && sheet.ref, 'mini cards: 你的书写 (in-page memory) and 参考字形');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(tid('write-change-flip'));
  await page.waitForSelector(tid('write-change-fail-retry'));
  await waitNavIdle(page);
  sheet = await sheetInfo(page);
  assert.equal(sheet.note, COPY.changeFailed, 'failure note 没改成，还是原来的判断。');
  assert.deepEqual([sheet.failCancel, sheet.failRetry], [COPY.changeCancel, COPY.changeRetry], '[先不改 / 再试一次]');
  f = await facts(page);
  assert.equal(f.judged[0].judgment, 'correct', 'record unchanged after the failed correction');
  assert.equal('corrections' in f.judged[0], false, 'no corrections after the failed write');
  assert.deepEqual(f.sched[`base:${CHARS[0]}`], sched1, 'FSRS unchanged after the failed correction');
  await page.click(tid('write-change-fail-retry'));
  await sheetClosed(page);
  f = await facts(page);
  assert.equal(f.records.length, 1, 'correction does not add a record (D19)');
  const c1 = f.judged[0];
  assert.equal(c1.id, r1.id, 'same record id');
  assert.equal(c1.judgment, 'wrong', 'judgment now wrong');
  assert.equal(c1.at, r1.at, 'at unchanged');
  assert.equal(c1.localDay, r1.localDay, 'localDay unchanged');
  assert.deepEqual(c1.help, r1.help, 'help facts unchanged');
  assert.equal(c1.corrections.length, 1, 'corrections appended');
  assert.equal(c1.corrections[0].from, 'correct', "corrections[0].from = 'correct'");
  const expected1 = await page.evaluate(async ({ before, record }) => {
    const { replay } = await import('/src/core/fsrs.js');
    return replay(before, [record]);
  }, { before: f.session.items[0].fsrsBefore, record: c1 });
  assert.deepEqual(f.sched[`base:${CHARS[0]}`], expected1, 'sched = replay(fsrsBefore, [corrected record])');
  assert.ok(f.sched[`base:${CHARS[0]}`].due < sched1.due || f.sched[`base:${CHARS[0]}`].fsrs.lapses > sched1.fsrs.lapses, 'due / card changed by the replay (Again)');
  assert.equal(f.todayN, 1, 'today N unchanged');
  assert.deepEqual(f.session.current, currentBefore, 'session.current deep-equal before / after the correction');
  assert.deepEqual(f.session.lastLine, { recordId: r1.id, kind: 'changed' }, "lastLine {kind:'changed'}");
  line = await lineInfo(page);
  assert.equal(line.text, COPY.lineChangedWrong(CHARS[0]), 'line text 「永」已改为写错');
  assert.equal(line.kind, 'changed', 'line kind changed');

  ctx.step('change it back → corrections grow, due replays to the original value (deterministic)');
  await openSheet(page);
  sheet = await sheetInfo(page);
  assert.equal(sheet.note, COPY.changeBodyWrong, 'sheet note 刚才记的是写错。…');
  assert.equal(sheet.flip, COPY.toCorrect, 'main button 改为写对');
  await page.click(tid('write-change-flip'));
  await sheetClosed(page);
  f = await facts(page);
  assert.equal(f.records.length, 1, 'still one record');
  assert.equal(f.judged[0].judgment, 'correct', 'back to correct');
  assert.deepEqual(f.judged[0].corrections.map(c => c.from), ['correct', 'wrong'], 'corrections history kept');
  assert.deepEqual(f.sched[`base:${CHARS[0]}`], sched1, 'sched equals the original judgment (replay is deterministic)');
  assert.deepEqual(f.session.current, currentBefore, 'session.current still deep-equal');
  line = await lineInfo(page);
  assert.equal(line.text, COPY.lineChangedCorrect(CHARS[0]), 'line text 「永」已改为写对');

  ctx.step('pen-down on 和 → the line collapses and stays collapsed after undo (D19)');
  await write(page, VERTICAL, 1);
  assert.equal(await lineInfo(page), null, 'line collapsed after pen-down');
  await page.click(topSel('write-undo'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount) === 0);
  await settle(page);
  assert.equal(await lineInfo(page), null, 'still collapsed with an empty grid (pen went down on this character)');
  f = await facts(page);
  assert.deepEqual(f.session.lastLine, { recordId: r1.id, kind: 'changed' }, 'the stored line is still there (entry only collapsed)');

  ctx.step('judge 和 as wrong (hint used) → the previous line disappears, the new line is 「和」记为写错');
  await write(page, HORIZONTAL, 1);
  await toCompare(page);
  await page.click(topSel('write-judge-wrong'));
  await waitCursor(page, 2);
  f = await facts(page);
  assert.equal(f.judged.length, 2, 'two judged records');
  const r2 = f.judged[1];
  assert.equal(r2.judgment, 'wrong', 'second record wrong');
  assert.equal(r2.help.hints, 1, 'hint count recorded as it happened (help.hints = 1)');
  assert.equal(f.todayN, 2, 'today N = 2');
  line = await lineInfo(page);
  assert.equal(line.text, COPY.lineRecordedWrong(CHARS[1]), 'line now 「和」记为写错');
  assert.ok(!line.all.includes(CHARS[0]), 'the 「永」 line is gone after the current character was committed');

  // ------------------------------------------------------------------ 当前字已用提示写了几笔时修改上一判断（钩子）
  ctx.step('on 春: hint + a few strokes, then correct the previous judgment through the hook → current deep-equal');
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`);
  await page.click(topSel('write-hint'));
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.hints === 1);
  await settle(page);
  await write(page, HORIZONTAL, 1);
  await write(page, VERTICAL, 2);
  assert.equal(await lineInfo(page), null, 'entry collapsed while the current character has strokes');
  // 把本字的原始笔画也写进会话现场（M1-6 的抬笔写入之前，用 store.commit 模拟「写了几笔」的已存现场）
  await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    const { encodeRawStrokes } = await import('/src/core/ink-math.js');
    const store = getStore();
    const res = store.commit('test:strokes', d => {
      const a = d.sessions.A;
      const strokes = encodeRawStrokes([[{ x: 60, y: 170, t: 0 }, { x: 280, y: 172, t: 90 }], [{ x: 170, y: 60, t: 0 }, { x: 172, y: 280, t: 90 }]]);
      d.sessions = { ...d.sessions, A: { ...a, current: { ...a.current, strokes } } };
    });
    if (!res.ok) throw new Error('seed strokes failed');
  });
  await settle(page); // D53 ⑧：这两笔盖过了提示范围 {0,2}，页面收掉提示笔并把 hintRange 写成 null；等它写完再取现场
  f = await facts(page);
  const cur3 = f.session.current;
  assert.ok(cur3.hints === 1 && cur3.strokes.length === 2, 'current: hints 1 and 2 strokes stored');
  const hookRes = await page.evaluate(async id => {
    const { getStore } = await import('/src/store/store.js');
    const { commitCorrection } = await import('/src/ui/screens/write/result-row.js');
    const r = commitCorrection(getStore(), { slot: 'A', recordId: id });
    return { ok: r.ok, kind: r.error ? r.error.kind : null };
  }, r2.id);
  assert.deepEqual(hookRes, { ok: true, kind: null }, 'commitCorrection ok');
  await settle(page);
  f = await facts(page);
  assert.deepEqual(f.session.current, cur3, 'session.current deep-equal (hints, hintRange, strokes, phase)');
  assert.equal(f.records.length, 2, 'no extra record');
  assert.equal(f.judged[1].judgment, 'correct', '和 corrected to correct');
  assert.equal(await lineInfo(page), null, 'entry stays collapsed (strokes on the grid)');
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 2, 'the learner strokes on the grid are untouched');

  // ------------------------------------------------------------------ 跳过
  ctx.step('跳过 春 → skipped record (not a valid record), line cleared, 5s undo hint (W16 / R-W20; D36)');
  const beforeSkip = await facts(page);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 3);
  f = await facts(page);
  assert.equal(f.records.length, beforeSkip.records.length + 1, 'one skipped record appended');
  const sk = f.records[f.records.length - 1];
  assert.equal(sk.kind, 'skipped', "kind 'skipped'");
  assert.equal('judgment' in sk, false, 'skipped carries no judgment');
  assert.equal(sk.help.hints, 1, 'hint fact kept on the skipped record');
  assert.equal(f.todayN, beforeSkip.todayN, 'today N unchanged (skip is not a valid record, D23)');
  assert.equal(f.judged.length, beforeSkip.judged.length, 'judged count unchanged');
  assert.equal(f.sched[`base:${CHARS[2]}`], undefined, 'no FSRS entry for the skipped character');
  assert.deepEqual(f.session.items[f.session.items.length - 1], { cardKey: `base:${CHARS[2]}`, kind: 'skipped', recordId: sk.id }, "item kind 'skipped'");
  assert.equal(f.session.lastLine, null, 'lastLine cleared by the skip');
  line = await lineInfo(page);
  assert.equal(line && line.state, 'skipped', "result line state 'skipped' (empty)");
  assert.equal(line.all, '', 'the skipped line is empty (跳过后清空)');
  assert.equal(await text(page, 'write-skip-undo-text'), COPY.skipped(CHARS[2]), 'bottom hint 已跳过「春」');
  assert.equal(await text(page, 'write-skip-undo-btn'), COPY.undo, '撤销 button');

  ctx.step('撤销 → second commit: record count back, 春 back at the cursor in recall, hint count restored');
  await page.click(topSel('write-skip-undo-btn'));
  await waitCursor(page, 2);
  f = await facts(page);
  assert.equal(f.records.length, beforeSkip.records.length, 'record count back to before the skip');
  assert.equal(f.records.some(r => r.id === sk.id), false, 'the skipped record is deleted');
  assert.equal(f.session.cursor, 2, '春 back at the cursor');
  assert.equal(f.session.items.length, beforeSkip.session.items.length, 'items back');
  assert.equal(f.session.current.phase, 'recall', 'current back to recall');
  assert.equal(f.session.current.hints, 1, 'hint count restored from the removed record (help facts kept)');
  assert.equal(await present(page, 'write-skip-undo'), false, 'undo hint gone');

  ctx.step('跳过 write fails → does not advance, three-part copy; 再试一次 advances');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-skip'));
  await page.waitForSelector(topSel('write-skip-fail-retry'));
  await settle(page);
  s = await writeSnapshot(page);
  assert.equal(s.cursor, 2, 'cursor unchanged after the failed skip');
  assert.equal(await text(page, 'write-note'), COPY.saveFailed, 'note 没保存上，你写的字还在。');
  assert.deepEqual([await text(page, 'write-skip-fail-cancel'), await text(page, 'write-skip-fail-retry')], [COPY.notNow, COPY.retry], '[先不保存 / 再试一次]');
  f = await facts(page);
  assert.equal(f.records.length, beforeSkip.records.length, 'no record after the failed skip');
  await page.click(topSel('write-skip-fail-retry'));
  await waitCursor(page, 3);
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'skipped').length, 1, 'exactly one skipped record after retry');

  ctx.step('撤销 write fails → hint stays with 再试一次; retry undoes');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-skip-undo-btn'));
  await page.waitForSelector(`${topSel('write-skip-undo')}[data-state="failed"]`);
  await settle(page);
  assert.equal(await text(page, 'write-skip-undo-text'), COPY.saveFailed, 'undo failure copy');
  f = await facts(page);
  assert.equal(f.session.cursor, 3, 'undo failed: still advanced');
  assert.equal(f.records.filter(r => r.kind === 'skipped').length, 1, 'skipped record still there');
  await page.waitForTimeout(5300);
  assert.equal(await present(page, 'write-skip-undo'), true, 'failed undo hint does not auto-hide');
  await page.click(topSel('write-skip-undo-retry'));
  await waitCursor(page, 2);
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'skipped').length, 0, 'retry undid the skip');

  ctx.step('skip again and wait 5s → the undo hint disappears; the skip stays');
  await page.click(topSel('write-skip'));
  await waitCursor(page, 3);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo hint shown');
  await page.waitForTimeout(5100);
  assert.equal(await present(page, 'write-skip-undo'), false, 'undo hint gone after 5s');
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'skipped').length, 1, 'skipped record kept');
  assert.equal(f.todayN, 2, 'today N still 2');

  // ------------------------------------------------------------------ 钩子：空笔画 / compare 空笔画 / perRecordInk
  ctx.step('hook: a judge commit with empty strokes is rejected');
  const before = await facts(page);
  const empty = await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    const { commitJudgment } = await import('/src/ui/screens/write/compare.js');
    const out = [];
    for (const strokes of [[], [[]], undefined]) {
      const r = commitJudgment(getStore(), { slot: 'A', cardKey: 'base:大', judgment: 'correct', strokes });
      out.push(r.ok ? 'ok' : r.error.kind);
    }
    return out;
  });
  assert.deepEqual(empty, ['empty-strokes', 'empty-strokes', 'empty-strokes'], 'empty strokes → {ok:false, kind:empty-strokes}');
  f = await facts(page);
  assert.equal(f.records.length, before.records.length, 'no record written');
  assert.equal(f.session.cursor, before.session.cursor, 'no advance');

  ctx.step('hook: seeded compare with empty strokes shows recall (01 §3.3), no judge buttons');
  const cur = f.session;
  const seededCmp = await page.evaluate(({ sess }) => {
    const st = window.__shiziTest.getState();
    const A = { ...sess, current: { ...sess.current, phase: 'compare', strokes: [] } };
    return window.__shiziTest.seed({ ...st, sessions: { ...st.sessions, A } });
  }, { sess: cur });
  assert.ok(seededCmp.ok, 'seed compare + empty strokes accepted by the shape check');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  s = await writeSnapshot(page);
  assert.equal(s.phase, 'recall', 'page shows recall');
  assert.equal(await present(page, 'write-judge-correct'), false, 'no judge buttons');
  assert.equal(await present(page, 'write-compare'), false, 'no compare area');

  ctx.step('explicit perRecordInk:true → ink written under the record month key (same as the D27 default)');
  const inkRes = await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    const { commitJudgment } = await import('/src/ui/screens/write/compare.js');
    const { isInkV3 } = await import('/src/core/ink-math.js');
    const strokes = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    const r = commitJudgment(getStore(), { slot: 'A', cardKey: 'base:大', judgment: 'correct', strokes, perRecordInk: true });
    const rec = r.record;
    const ink = window.__shiziTest.getInk(rec);
    const month = rec.localDay.slice(0, 7);
    return { ok: r.ok, id: rec.id, month, ink: isInkV3(ink), keys: Object.keys(window.__shiziTest.getRawKeys('shizi.v2.ink.')), inTable: !!(window.__shiziTest.getState().ink[month] || {})[rec.id] };
  });
  assert.ok(inkRes.ok && inkRes.ink && inkRes.inTable, 'ink stored as packed Ink v3 for the record (P78)');
  assert.deepEqual(inkRes.keys, [`shizi.v2.ink.${inkRes.month}`], 'ink lives under shizi.v2.ink.<record month>');
  await waitCursor(page, 4);

  // ------------------------------------------------------------------ 最后一个字
  ctx.step('last character 中: judge → session complete → result page (M2-3)');
  await write(page, HORIZONTAL, 1);
  await toCompare(page);
  await page.click(topSel('write-judge-correct'));
  await page.waitForSelector(topSel('result-screen'));
  f = await facts(page);
  assert.equal(f.session.cursor, CHARS.length, 'cursor at the end of the queue');
  assert.equal(f.judged.length, 4, '4 judged records (永 和 大 中)');
  assert.equal(f.todayN, 4, 'today N = 4');

  ctx.step('all localStorage writes went through storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'no direct localStorage writes');
}
