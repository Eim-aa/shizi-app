// M2-0 查字 / 自己选字组件（02 §4 M2-0；决定-D21；04 R-Q01–R-Q06、R-Q08、R-H06；03 P42 / P43 / P45）。
//
// 开发路由 'query-demo'（src/ui/components/query/demo.js，只在 ?test=1 本机加载）上的两个按钮在点击处理里同步 openQuery：
//   pick：点击处理结束时焦点已在输入框（代理框，R-Q08）→ 挂上后焦点在查字框；标题「自己选字」；选中数 0、底栏
//     「先选一个字」disabled + aria-disabled，点了不回调；输入过滤三种提示（只能输入汉字 / 已去掉 N 个 / 重复只算一次）；
//     逐字行勾选默认不选，选 1 个「练这个字」、2 个「练这 2 个字」→ onPick(按输入顺序)；回调 {ok:false} → R-H06 三段式，
//     再试一次成功；不能练的字没有勾选圈、行尾「暂时不能练」、点开是不能练说明；整段 pick 流程零写入。
//   lookup：输入一个字直接看卡片、不自动选中、不自动加入（getWriteLog 为空、custom 不变）；多字没有勾选与底栏；
//     行尾记录情况（记录了 N 次 / 还没有记录 / 自选的字 · …，P43）；卡片记录行、查看记录置灰（无 onDetail）/ 可点；
//     「加入自选的字」只在点击时写一次 shizi.v2.custom（经 storage.js）→ 轻提示、按钮变「已在自选的字里」；
//     failNextWrite → 加入失败三段式（先不加 / 再试一次），custom 不变，再试一次成功；练这个字 → onPractice。
//   键盘避让：换一个假的 visualViewport（高度 852 → 516，派发 resize），输入框与底部按钮都在可见区里。
//   关闭弹层后焦点回到打开它的按钮。

import { bootTestHost, localDayOf, tid, waitNavIdle, PRESS_SETTLE_MS } from './helpers.mjs';

const COPY = {
  titleLookup: '查字',
  titlePick: '自己选字',
  placeholder: '输入一个字或一个词',
  hintEmpty: '输入一个字或一个词，再点你要的那个字。',
  hintRows: '点一个字，看标准写法、练它或加入自选字。',
  onlyHanzi: '只能输入汉字。',
  removed: n => `只能输入汉字，已去掉 ${n} 个其他字符。`,
  dup: c => `重复的「${c}」只算一次。`,
  none: '先选字',
  one: '练这个字',
  many: n => `练这 ${n} 个字`,
  rowCount: n => `写过 ${n} 次`,
  rowNone: '还没写过',
  rowBad: '暂不能练',
  rowCustomNone: '自选字 · 还没写过',
  rowCustomCount: n => `自选字 · 写过 ${n} 次`,
  add: '加入自选',
  inCustom: '已自选',
  addFailed: '没加进自选，输入的字还在。',
  addRetry: '再试一次',
  addCancel: '先不加',
  back: n => `‹ 回到这 ${n} 个字`,
  badTitle: c => `「${c}」暂时不能练。`,
  badReason: '拾字还没收录这个字的标准写法。',
  badSource: '字表参考《通用规范汉字表》，个别字未收。',
  viewRecords: '查看记录',
  saveFailed: '没保存上，输入的字还在。',
  notSave: '先不保存',
  retry: '再试一次',
  select: c => `选择「${c}」`,
  unselect: c => `取消选择「${c}」`,
};

const SHEET = '[data-testid="query-sheet"]';
const inSheet = id => `${SHEET} ${tid(id)}`;

async function openDemo(page) {
  await page.evaluate(async () => {
    await import('/src/ui/components/query/index.js');
    await import('/src/ui/components/query/demo.js');
    const { nav } = await import('/src/ui/router.js');
    nav.push('query-demo');
  });
  await page.waitForSelector(`.sz-layer[data-top="true"] ${tid('screen-query-demo')}`);
  await waitNavIdle(page);
}

async function openSheet(page, which) {
  await page.click(`.sz-layer[data-top="true"] ${tid(`query-demo-${which}`)}`);
  await page.waitForSelector(inSheet('query-input'));
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function closeSheet(page) {
  await page.evaluate(() => history.back());
  await page.waitForSelector(SHEET, { state: 'detached' });
  await waitNavIdle(page);
}

async function typeInto(page, text) {
  const input = page.locator(inSheet('query-input'));
  await input.fill('');
  if (text) await input.fill(text);
  await page.waitForTimeout(60);
}

async function sheetInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="query-sheet"]');
    if (!panel) return null;
    const q = id => panel.querySelector(`[data-testid="${id}"]`);
    const all = id => [...panel.querySelectorAll(`[data-testid="${id}"]`)];
    const body = q('query-body');
    const go = q('query-go');
    return {
      title: panel.querySelector('.sz-sheet__title') ? panel.querySelector('.sz-sheet__title').textContent : null,
      role: panel.getAttribute('role'),
      modal: panel.getAttribute('aria-modal'),
      mode: body ? body.dataset.mode : null,
      view: body ? body.dataset.view : null,
      cur: body ? body.dataset.cur || null : null,
      placeholder: q('query-input') ? q('query-input').getAttribute('placeholder') : null,
      inputLabel: q('query-input') ? q('query-input').getAttribute('aria-label') : null,
      inputValue: q('query-input') ? q('query-input').value : null,
      notes: all('query-note').map(n => n.textContent.trim()),
      hint: q('query-hint') ? q('query-hint').textContent : null,
      rows: all('query-row').map(r => ({
        char: r.dataset.char,
        practicable: r.dataset.practicable,
        selected: r.dataset.selected || null,
        status: r.querySelector('[data-testid="query-row-status"]').textContent,
        py: r.querySelector('.sz-qrow__py') ? r.querySelector('.sz-qrow__py').textContent : '',
        openAria: r.querySelector('[data-testid="query-row-open"]').getAttribute('aria-label'),
        select: r.querySelector('[data-testid="query-row-select"]')
          ? { checked: r.querySelector('[data-testid="query-row-select"]').getAttribute('aria-checked'),
              label: r.querySelector('[data-testid="query-row-select"]').getAttribute('aria-label'),
              tag: r.querySelector('[data-testid="query-row-select"]').tagName }
          : null,
      })),
      bar: q('query-bar') ? Number(q('query-bar').dataset.count) : null,
      go: go ? { text: go.textContent.trim(), disabled: go.disabled, aria: go.getAttribute('aria-disabled') } : null,
      goFail: q('query-go-fail') ? q('query-go-fail').textContent : null,
      back: q('query-back') ? q('query-back').textContent.trim() : null,
      card: q('query-card') ? {
        char: q('query-card').dataset.char,
        custom: q('query-card').dataset.custom,
        stat: q('query-card-stat') ? q('query-card-stat').textContent : null,
        meta: q('query-card-meta') ? q('query-card-meta').textContent : null,
        practice: q('query-card-practice') ? q('query-card-practice').textContent.trim() : null,
        add: q('query-card-add') ? { text: q('query-card-add').textContent.trim(), disabled: q('query-card-add').disabled } : null,
        inCustom: q('query-card-in-custom')
          ? { text: q('query-card-in-custom').textContent.trim(), disabled: q('query-card-in-custom').disabled,
              aria: q('query-card-in-custom').getAttribute('aria-disabled') } : null,
        detail: q('query-card-detail')
          ? { text: q('query-card-detail').textContent.trim(), disabled: q('query-card-detail').disabled,
              aria: q('query-card-detail').getAttribute('aria-disabled') } : null,
        addFail: q('query-card-add-fail') ? q('query-card-add-fail').textContent : null,
        mineEmpty: !!q('query-card-mine-empty'),
        ref: !!q('query-card-ref'),
      } : null,
      bad: q('query-bad') ? {
        title: q('query-bad-title').textContent,
        reason: q('query-bad-reason').textContent,
        source: q('query-bad-source').textContent,
      } : null,
    };
  });
}

async function demoLog(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__shiziQueryDemo || {})));
}

async function writes(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.op !== 'clear'));
}

async function clearLog(page) {
  // 写日志只能随 reset 清；这里记下当前长度，之后取增量。
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function writesSince(page, n) {
  return page.evaluate(k => window.__shiziTest.getWriteLog().slice(k), n);
}

async function toastText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="toast"]');
    return el ? el.textContent.trim() : null;
  });
}

function record(id, char, judgment, at, sessionId = 's1') {
  return {
    id, cardKey: `base:${char}`, char, sessionId, kind: 'judged', judgment, at, localDay: localDayOf(at),
    help: { hints: 0, answerSeen: false, traced: false },
  };
}

export default async function run(page, { baseURL, assert, step }) {
  await bootTestHost(page, baseURL);
  await page.evaluate(() => window.__shiziTest.reset());

  // 永：两条 judged（9月20日 / 9月24日）；和：没有记录。
  const t1 = new Date(2026, 8, 20, 10, 0).getTime();
  const t2 = new Date(2026, 8, 24, 10, 0).getTime();
  const seeded = await page.evaluate(({ recs }) => {
    const r = window.__shiziTest.seed({ records: { '2026-09': recs } });
    return r && r.ok;
  }, { recs: [record('r1', '永', 'wrong', t1), record('r2', '永', 'correct', t2)] });
  assert.ok(seeded, 'seed: 永 has two judged records');
  await page.reload();
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  const baseLog = await clearLog(page);

  await openDemo(page);

  // ---------------------------------------------------------------- pick
  step('pick: opens with 0 selected, bottom button truly disabled; input focused synchronously (R-Q06 / R-Q08)');
  await openSheet(page, 'pick');
  let log = await demoLog(page);
  assert.equal(log.focusAtClick && log.focusAtClick.tag, 'INPUT', 'at the end of the click handler an input already has focus (sync focus)');
  assert.equal(log.focusAtClick && log.focusAtClick.proxy, true, '… the focus proxy input (keyboard opens inside the tap)');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'query-input', 'after mount the query input has focus');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-query-focus-proxy]').length), 0, 'focus proxy removed after hand-off');
  let info = await sheetInfo(page);
  assert.equal(info.role, 'dialog', 'sheet role=dialog');
  assert.equal(info.modal, 'true', 'sheet aria-modal');
  assert.equal(info.title, COPY.titlePick, 'pick title 「自己选字」');
  assert.equal(info.mode, 'pick', 'mode pick');
  assert.equal(info.view, 'hint', 'empty input → hint view');
  assert.equal(info.placeholder, COPY.placeholder, 'placeholder');
  assert.equal(info.inputLabel, COPY.titlePick, 'input aria-label = title');
  assert.equal(info.hint, COPY.hintEmpty, 'hint 「输入一个字或一个词，再点你要的那个字。」');
  assert.equal(info.bar, 0, 'selected count 0');
  assert.deepEqual(info.go, { text: COPY.none, disabled: true, aria: 'true' }, 'bottom 「先选字」 disabled + aria-disabled');
  await page.locator(inSheet('query-go')).click({ force: true });
  await page.waitForTimeout(100);
  log = await demoLog(page);
  assert.equal(log.picks.length, 0, 'clicking the disabled button does not call onPick');

  step('pick: input filter notes (R-Q03)');
  await typeInto(page, 'a1!');
  info = await sheetInfo(page);
  assert.deepEqual(info.notes, [COPY.onlyHanzi], 'digits / symbols and no Han → 「只能输入汉字。」');
  assert.equal(info.view, 'hint', 'no Han → still hint view');

  step('pick: pinyin letters list matching chars (r7-Q1 / D3): written first, tones ignored, v = ü, pick + card like Han input');
  await typeInto(page, 'yong');
  info = await sheetInfo(page);
  assert.deepEqual(info.notes, [], 'pinyin letters → no 「只能输入汉字」');
  assert.equal(info.view, 'rows', 'pinyin with several matches → rows');
  assert.ok(info.rows.length > 1, 'several chars read yong');
  assert.equal(info.rows[0].char, '永', '永 (written, 2 records) is first');
  assert.equal(info.rows[0].status, COPY.rowCount(2), 'same row tail as Han input');
  await typeInto(page, 'yǒng');
  const toned = await sheetInfo(page);
  assert.deepEqual(toned.rows.map(r => r.char), info.rows.map(r => r.char), 'tone marks do not change the result');
  await typeInto(page, 'nv');
  info = await sheetInfo(page);
  assert.ok(info.rows.some(r => r.char === '女') || info.card?.char === '女', 'v typed as ü: nv lists 女');
  await typeInto(page, 'yong');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-select"]`).click();
  info = await sheetInfo(page);
  assert.deepEqual(info.go, { text: COPY.one, disabled: false, aria: null }, 'pinyin rows are selectable: 「练这个字」');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-open"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="query-body"]').dataset.view === 'card');
  info = await sheetInfo(page);
  assert.equal(info.card.char, '永', 'a pinyin row opens the char card');
  await page.locator(inSheet('query-back')).click();
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-select"]`).click();
  info = await sheetInfo(page);
  assert.equal(info.bar, 0, 'unselected again (keeps the later steps at 0 selected)');
  await typeInto(page, 'qqqq');
  info = await sheetInfo(page);
  assert.deepEqual(info.notes, ['没有读音是「qqqq」的字。'], 'no reading matches → one note');
  assert.equal(info.view, 'hint', 'no match → hint view');
  await typeInto(page, '永a和!永');
  info = await sheetInfo(page);
  assert.deepEqual(info.notes, [COPY.removed(2), COPY.dup('永')], 'mixed → 「已去掉 2 个字母或符号」 + 「重复的「永」只算一次」');
  assert.equal(info.inputValue, '永a和!永', 'raw input kept, not truncated (P45)');
  assert.equal(info.view, 'rows', 'two unique chars → rows');
  assert.equal(info.hint, COPY.hintRows, 'rows hint');
  assert.deepEqual(info.rows.map(r => r.char), ['永', '和'], 'rows deduplicated in input order');
  assert.ok(info.rows.every(r => r.select && r.select.checked === 'false' && r.select.tag === 'BUTTON'),
    'typing selects nothing: every checkbox aria-checked=false (a <button role=checkbox>)');
  assert.deepEqual(info.rows.map(r => r.select.label), [COPY.select('永'), COPY.select('和')], 'checkbox aria-labels');
  assert.deepEqual(info.rows.map(r => r.status), [COPY.rowCount(2), COPY.rowNone], 'row tail: 写过 2 次 / 还没写过');
  assert.ok(info.rows.every(r => r.py), 'rows show pinyin');
  assert.deepEqual(info.rows.map(r => r.openAria), info.rows.map(r => `${r.char} ${r.py}，${r.status}`),
    'H3: row open buttons are named 「字 拼音，记录情况」');
  assert.equal(info.rows[0].openAria, `永 ${info.rows[0].py}，${COPY.rowCount(2)}`, 'H3: 永 row name');
  assert.equal(info.bar, 0, 'still 0 selected after typing');
  assert.equal(info.go.disabled, true, 'bottom still disabled');

  step('pick: select 1 → 「练这个字」, 2 → 「练这些字」 → onPick in input order');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="和"] [data-testid="query-row-select"]`).click();
  info = await sheetInfo(page);
  assert.equal(info.bar, 1, '1 selected');
  assert.deepEqual(info.go, { text: COPY.one, disabled: false, aria: null }, '「练这个字」 enabled');
  assert.equal(info.rows[1].select.label, COPY.unselect('和'), 'selected checkbox label 「取消选择「和」」');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-select"]`).click();
  info = await sheetInfo(page);
  assert.deepEqual(info.go, { text: COPY.many(2), disabled: false, aria: null }, '「练这些字」');
  await page.evaluate(() => { window.__shiziQueryDemo.nextResult = { ok: false }; });
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(inSheet('query-go-fail'));
  info = await sheetInfo(page);
  log = await demoLog(page);
  assert.deepEqual(log.picks, [['永', '和']], 'onPick([永, 和]) in input order');
  assert.ok(info.goFail.includes(COPY.saveFailed) && info.goFail.includes(COPY.notSave) && info.goFail.includes(COPY.retry),
    'onPick {ok:false} → R-H06 三段式 in the bar');
  assert.equal(info.inputValue, '永a和!永', 'input kept after failure');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-go-fail-retry')).click();
  await page.waitForSelector(inSheet('query-go'));
  log = await demoLog(page);
  assert.deepEqual(log.picks, [['永', '和'], ['永', '和']], 'retry calls onPick again with the same chars');

  step('pick: unpracticable char has no checkbox, 「暂不能练」, opens the can\'t-practise state');
  await typeInto(page, '永龘');
  info = await sheetInfo(page);
  const bad = info.rows.find(r => r.char === '龘');
  assert.ok(bad && bad.practicable === 'false' && bad.select === null && bad.status === COPY.rowBad, '龘: no checkbox, 「暂不能练」');
  assert.equal(bad.openAria, bad.py ? `龘 ${bad.py}，${COPY.rowBad}` : `龘，${COPY.rowBad}`, 'H3: unpracticable row still named');
  assert.equal(info.bar, 1, 'selection kept for chars still in the input (永)');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="龘"] [data-testid="query-row-open"]`).click();
  info = await sheetInfo(page);
  assert.equal(info.view, 'bad', 'bad view');
  assert.deepEqual(info.bad, { title: COPY.badTitle('龘'), reason: COPY.badReason, source: COPY.badSource }, 'can\'t-practise three lines');
  assert.equal(info.back, COPY.back(2), '「‹ 回到这 2 个字」');
  assert.equal(info.bar, null, 'no bottom bar on the card views');
  await page.locator(inSheet('query-back')).click();
  info = await sheetInfo(page);
  assert.equal(info.view, 'rows', 'back to rows');
  await typeInto(page, '龘');
  info = await sheetInfo(page);
  assert.equal(info.view, 'bad', 'single unpracticable char → bad view directly');
  assert.equal(info.back, null, 'no back link for a single char');

  let w = await writesSince(page, baseLog);
  assert.deepEqual(w, [], 'the whole pick flow wrote nothing to storage');
  await closeSheet(page);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid), 'query-demo-pick',
    'closing returns focus to the opener');

  // ---------------------------------------------------------------- lookup
  step('lookup: single char → card, nothing auto-selected, nothing auto-added (D21)');
  await openSheet(page, 'lookup');
  info = await sheetInfo(page);
  assert.equal(info.title, COPY.titleLookup, 'lookup title 「查字」');
  assert.equal(info.bar, null, 'lookup has no multi-select bar');
  await typeInto(page, '永');
  await page.waitForSelector(inSheet('query-card'));
  info = await sheetInfo(page);
  assert.equal(info.view, 'card', 'one char → card');
  assert.equal(info.card.char, '永', 'card for 永');
  assert.equal(info.card.custom, 'false', 'not in custom');
  assert.equal(info.card.stat, '写过 2 次 · 最近 9月24日', 'card record line');
  assert.equal(info.card.practice, COPY.one, '「练这个字」');
  assert.deepEqual(info.card.add, { text: COPY.add, disabled: false }, '「加入自选」 enabled');
  assert.deepEqual(info.card.detail, { text: COPY.viewRecords, disabled: true, aria: 'true' }, '「查看记录」 greyed before M3-6 (no onDetail)');
  assert.ok(info.card.mineEmpty && info.card.ref, 'your writing (no ink, P31) + reference glyph');
  let st = await page.evaluate(() => window.__shiziTest.getState());
  assert.equal(st.custom, null, 'custom untouched after typing');
  await typeInto(page, '永和');
  info = await sheetInfo(page);
  assert.equal(info.view, 'rows', 'two chars → rows');
  assert.ok(info.rows.every(r => r.select === null && r.selected === null), 'lookup rows have no checkboxes (no auto selection)');
  assert.equal(info.bar, null, 'no bottom bar in lookup');
  w = await writesSince(page, baseLog);
  assert.deepEqual(w, [], 'opening, typing and viewing wrote nothing');

  step('lookup: 「加入自选」 writes only on click, once, via storage.js');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(inSheet('query-card'));
  info = await sheetInfo(page);
  assert.equal(info.back, COPY.back(2), 'card from rows shows 「‹ 回到这 2 个字」');
  const before = (await page.evaluate(() => window.__shiziTest.getWriteLog().length));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-card-add')).click();
  await page.waitForSelector(inSheet('query-card-in-custom'));
  w = await writesSince(page, before);
  const customWrites = w.filter(e => e.key === 'shizi.v2.custom' && e.op === 'set');
  assert.equal(customWrites.length, 1, 'exactly one write of shizi.v2.custom');
  assert.ok(w.every(e => e.via === 'storage' && e.ok), 'all writes via storage.js and ok');
  assert.ok(w.every(e => ['shizi.v2.custom', 'shizi.v2.meta', 'shizi.v2.txn'].includes(e.key)), 'only custom (+ meta / txn) touched');
  st = await page.evaluate(() => window.__shiziTest.getState());
  assert.deepEqual(st.custom.added.map(e => e.char), ['永'], 'custom.added = [永]');
  assert.equal(typeof st.custom.added[0].at, 'number', 'added entry has at');
  info = await sheetInfo(page);
  assert.deepEqual(info.card.inCustom, { text: COPY.inCustom, disabled: true, aria: 'true' }, '「已自选」 disabled');
  assert.equal(info.card.custom, 'true', 'card marked custom');
  assert.equal(await toastText(page), null, 'I3 P0-14: adding shows no toast — the card button itself became 「已自选」');

  step('lookup: add failure → 三段式, custom unchanged, retry succeeds');
  await page.locator(inSheet('query-back')).click();
  info = await sheetInfo(page);
  assert.deepEqual(info.rows.map(r => r.status), [COPY.rowCustomCount(2), COPY.rowNone], 'row tail 「自选字 · 写过 2 次」 (P43)');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="和"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(inSheet('query-card-add'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.custom' }));
  await page.locator(inSheet('query-card-add')).click();
  await page.waitForSelector(inSheet('query-card-add-fail'));
  info = await sheetInfo(page);
  assert.ok(info.card.addFail.includes(COPY.addFailed) && info.card.addFail.includes(COPY.addCancel) && info.card.addFail.includes(COPY.addRetry),
    'add failure: 「没加进自选，输入的字还在。」［先不加 / 再试一次］');
  assert.equal(info.inputValue, '永和', 'input kept');
  st = await page.evaluate(() => window.__shiziTest.getState());
  assert.deepEqual(st.custom.added.map(e => e.char), ['永'], 'custom unchanged after the failed add');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-card-add-fail-cancel')).click();
  info = await sheetInfo(page);
  assert.ok(info.card.add && !info.card.addFail, '先不加 → back to the card buttons');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.custom' }));
  await page.locator(inSheet('query-card-add')).click();
  await page.waitForSelector(inSheet('query-card-add-fail-retry'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-card-add-fail-retry')).click();
  await page.waitForSelector(inSheet('query-card-in-custom'));
  st = await page.evaluate(() => window.__shiziTest.getState());
  assert.deepEqual(st.custom.added.map(e => e.char), ['永', '和'], 'retry adds 和 once');
  await page.locator(inSheet('query-back')).click();
  info = await sheetInfo(page);
  assert.deepEqual(info.rows.map(r => r.status), [COPY.rowCustomCount(2), COPY.rowCustomNone], 'row tail 「自选字 · 还没写过」');

  step('lookup: 练这个字 → onPractice; sheet stays with the same input');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(inSheet('query-card-practice'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-card-practice')).click();
  await page.waitForTimeout(100);
  log = await demoLog(page);
  assert.deepEqual(log.practices, ['永'], 'onPractice(永)');
  info = await sheetInfo(page);
  assert.equal(info.inputValue, '永和', 'input unchanged');
  await closeSheet(page);

  step('lookup with onDetail: 「查看记录」 enabled → onDetail');
  await openSheet(page, 'lookup-detail');
  await typeInto(page, '永');
  await page.waitForSelector(inSheet('query-card-detail'));
  info = await sheetInfo(page);
  assert.deepEqual(info.card.detail, { text: COPY.viewRecords, disabled: false, aria: null }, '「查看记录」 enabled');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(inSheet('query-card-detail')).click();
  log = await demoLog(page);
  assert.deepEqual(log.details, ['永'], 'onDetail(永)');
  await closeSheet(page);

  // ---------------------------------------------------------------- keyboard avoidance
  step('keyboard: visualViewport shrinks → input and bottom button stay visible');
  await page.evaluate(() => {
    class FakeVV extends EventTarget {}
    const vv = new FakeVV();
    vv.height = window.innerHeight;
    vv.width = window.innerWidth;
    vv.offsetTop = 0;
    vv.offsetLeft = 0;
    vv.scale = 1;
    window.__fakeVV = vv;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  });
  await openSheet(page, 'pick');
  await typeInto(page, '永和春大中天地人');
  const kbHeight = 336;
  await page.evaluate(h => {
    window.__fakeVV.height = window.innerHeight - h;
    window.__fakeVV.dispatchEvent(new Event('resize'));
  }, kbHeight);
  await page.waitForFunction(() => document.querySelector('.sz-sheet') && document.querySelector('.sz-sheet').dataset.keyboard === 'true');
  const geo = await page.evaluate(() => {
    const vv = window.__fakeVV;
    const r = sel => document.querySelector(sel).getBoundingClientRect();
    const input = r('[data-testid="query-input"]');
    const go = r('[data-testid="query-go"]');
    const panel = r('.sz-sheet');
    return { visTop: vv.offsetTop, visBottom: vv.offsetTop + vv.height, input: { top: input.top, bottom: input.bottom },
      go: { top: go.top, bottom: go.bottom }, panel: { top: panel.top, bottom: panel.bottom } };
  });
  assert.ok(geo.input.top >= geo.visTop && geo.input.bottom <= geo.visBottom + 0.5,
    `input inside the visible area (${Math.round(geo.input.top)}–${Math.round(geo.input.bottom)} within 0–${geo.visBottom})`);
  assert.ok(geo.go.top >= geo.visTop && geo.go.bottom <= geo.visBottom + 0.5,
    `bottom button inside the visible area (${Math.round(geo.go.top)}–${Math.round(geo.go.bottom)})`);
  assert.ok(Math.abs(geo.panel.bottom - geo.visBottom) <= 1, 'sheet bottom sits on the keyboard top');
  await page.evaluate(() => {
    window.__fakeVV.height = window.innerHeight;
    window.__fakeVV.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => document.querySelector('.sz-sheet').dataset.keyboard === 'false');
  const panelBottom = await page.evaluate(() => document.querySelector('.sz-sheet').getBoundingClientRect().bottom);
  assert.ok(Math.abs(panelBottom - 852) <= 1, 'keyboard closed → sheet back at the bottom');
  await closeSheet(page);
}
