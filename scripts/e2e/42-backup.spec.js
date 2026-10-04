// M4-4 备份与恢复（02 M4-4；决定-D24；需求 R12 / O04；04 R-B01–R-B08、T07、边改 K04 / Z04；01 §3.6 / §8.1 / §9；03 P26 / P32 / P44）。
//
//   1. 入口与空态：「我的」菜单 → 备份与恢复；没有记录：还没有备份 /「现在没有记录。」/ 导出与清空都真禁用、不催导出。
//   2. 导出（下载一级）：9 月 1 日那份旧备份（23 个字）→ 文件名、外壳、只含 v2 白名单键；导出后「现在的记录都已经备份了。」+ 轻提示。
//      300 字状态：「上次备份以后记录有改动…」→ 导出 → 文件 data 与落盘字串逐键相等（meta 缺失时补）。
//   3. R-B06：非备份文件 / 半坏备份 / 截断文件 / 坏了的 v1 文件（M5-4 转换器整单拒绝）/ 取消选文件 → 说明框文案，全部 v2 键与 getState 深相等。
//      好的 v1 文件经本页导入见 52-migrate。
//   4. 替换确认（R-B03 / K04）：标题、正文（9 月 1 日、23、300）、丢失日期范围、「替换」不是主按钮；取消不写。
//   5. R-B04：failNextWrite(2,{kind:'quota', matchKey:safety}) 与 failNextWrite(1,{kind:'generic'}) 让保护副本写失败 → 10.14 说明框 +
//      「再试一次」回到确认框；全部 v2 键深相等（没有预算回收）。
//   6. 覆盖失败已回滚：替换中途写失败 → 已回滚、副本删掉、R-B06「没能恢复」、全部键深相等。
//   7. K03（R-B07）：300 字 → 导出 → 用 9 月 1 日备份替换（进行中的组结束、原会话进保护副本（P79）、shizi.corrupt.* 清掉、结论句、
//      日期不变、撤销底栏在页底栏区）→ 撤销 →「已撤销」→ 全部 v2 键（含 sessions）与 getState 深相等。
//   8. R-B05：撤销失败 → 底栏换字、副本保留、可再点；再点成功 → 深相等。
//   9. P32：替换后刷新，仍在备份页 → 撤销底栏恢复 → 撤销 → 深相等。
//  10. 离开本页 → 副本删除、撤销失效；再进来只剩结论句（backupMeta.lastConclusion）。
//  11. 清空所有记录：弹层正文、取消不写；副本失败 → 「没保存上，记录都还在。」+ 先不清空 / 再试一次；成功 → 撤销底栏（P44）+
//      「记录已清空。现在没有记录。」、导出与清空变灰；撤销失败「没能撤销，记录还是空的」；撤销 → 深相等。
//  11b. P79：有未写完的 A 组时替换 → A/B 置空、首页无续练；撤销 → A 组回来且 current 深相等、全部 v2 键深相等。
//  12. 没有记录时恢复：「用这份备份恢复记录？」+ 只有第一句 +「恢复」（主按钮）。
//  13. 分发第二级 Web Share：files 分享完成才记导出；AbortError（取消）不记。
//  14. 原生壳（假 shiziNative）：导出发 shareBackup {name, payload}，markBackupExported() 之后才记；恢复发 pickBackup，
//      shiziBackupPicked(text) → 页内确认；shiziBackupRejected cancelled / tooLarge → R-B06 文案。
//  全程：没有绕过 storage.js 的写入（测试自己放的坏值键除外）。

import { readFileSync } from 'node:fs';
import { bootTestHost, installNativeStub, tid, topSel, waitNavIdle, PRESS_SETTLE_MS } from './helpers.mjs';

const BACKUP_MOD = '/src/ui/screens/mine/backup.js';
const T = {
  noBackup: '还没有备份',
  noRecords: '现在没有记录。',
  allBacked: '现在的记录都已经备份了。',
  changed: '上次备份以后记录有改动，还没有备份。',
  intro: '记录只存在这台手机上。换手机、清理浏览器或删掉拾字之前，先导出一份备份文件。',
  introEmpty: '记录只存在这台手机上。',
  restoreSubHas: '会替换现在的记录，离开这一页前可以撤销',
  exported: '已导出备份文件。',
  notBackup: '这个文件不是拾字的备份，没法恢复。你的记录没有变。',
  restoreFailed: '没能恢复，你的记录还是原来的。',
  cancelled: '没有选文件，你的记录没有变。',
  protectFailed: '没能换成备份，你现在的记录没有变。可以再试一次。',
  replaceTitle: '用备份替换现在的记录？',
  replaceBody: '这份备份是 9 月 1 日的，里面有 23 个字的记录。现在 300 个字的记录会被替换。离开这一页前可以撤销。',
  loss: '9 月 2 日到 9 月 24 日的记录会丢失，建议先导出备份文件。',
  restoreTitle: '用这份备份恢复记录？',
  restoreBody: '这份备份是 9 月 1 日的，里面有 23 个字的记录。',
  undoL1: '已换成备份里的记录',
  undoL2: '离开这一页前可以撤销',
  conclusion: '已换成 9 月 1 日备份里的记录，一共 23 个字。',
  undoFailRestore: '没能撤销，现在还是备份里的记录',
  undoFailClear: '没能撤销，记录还是空的',
  undoAgain: '可以再点一次撤销',
  clearTitle: '清空所有记录？',
  clearBody: '300 个字的记录都会被删掉。离开这一页前可以撤销。',
  clearFailed: '没保存上，记录都还在。',
  clearUndoL1: '记录已清空',
  clearConclusion: '记录已清空。现在没有记录。',
  undone: '已撤销',
};

const FSRS = { stability: 5, difficulty: 5, state: 2 };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function dayOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12));
}
function ms(day, hour = 9) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
}

/** events [{char, day, kind?, judgment?}] → {records:{月:[…]}, sched}；按日期排序后分配 r1… */
function buildRecords(events, serialBase = 0) {
  const sorted = events.map((e, i) => ({ ...e, i })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i));
  const records = {};
  const sched = {};
  sorted.forEach((e, k) => {
    const serial = serialBase + k + 1;
    const at = ms(e.day) + k * 1000;
    const kind = e.kind || 'judged';
    const r = { id: `r${serial}`, cardKey: `base:${e.char}`, char: e.char, sessionId: 's1', kind, at, localDay: e.day,
      help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
    if (kind === 'judged') {
      r.judgment = e.judgment || 'correct';
      sched[`base:${e.char}`] = { fsrs: FSRS, due: addDays(e.day, 10), lastJudgedAt: at };
    }
    const month = e.day.slice(0, 7);
    (records[month] || (records[month] = [])).push(r);
  });
  const sortedRecords = {};
  for (const m of Object.keys(records).sort()) sortedRecords[m] = records[m];
  return { records: sortedRecords, sched };
}

/** 9 月 1 日那份旧备份里的状态：23 个字，8 月的记录。 */
function oldState() {
  const events = [];
  for (let i = 0; i < 23; i += 1) events.push({ char: String.fromCodePoint(0x5e00 + i * 5), day: addDays('2026-08-01', i), judgment: i % 6 === 0 ? 'wrong' : 'correct' });
  const { records, sched } = buildRecords(events);
  return { records, sched, settings: { library: 'core3500' } };
}

/** 300 字：2 月 10 日到 9 月 24 日，部分字写过两次、有写错、有看过答案；自选、换词、旧照片、设置、B 会话（不进备份）。 */
function bigState() {
  const chars = [];
  for (let i = 0; chars.length < 300; i += 1) chars.push(String.fromCodePoint(0x4e00 + 7 * i));
  const events = [];
  chars.forEach((c, i) => {
    const day = addDays('2026-02-10', Math.floor((i * 220) / 300));
    events.push({ char: c, day, judgment: i % 7 === 0 ? 'wrong' : 'correct' });
    if (i % 5 === 0) {
      const again = addDays(day, 15);
      if (again <= '2026-09-23') events.push({ char: c, day: again });
    }
    if (i % 50 === 0) events.push({ char: c, day, kind: 'answer-seen' });
  });
  events.push({ char: chars[0], day: '2026-09-02' });
  events.push({ char: chars[1], day: '2026-09-24', judgment: 'wrong' });
  const { records, sched } = buildRecords(events);
  const at = ms('2026-09-20');
  return {
    records,
    sched,
    custom: { added: [{ char: '鲜', at }, { char: '境', at: at + 1 }] },
    wordOff: { [`base:${chars[3]}`]: at },
    settings: { library: 'core3500', sound: true, large: false, appearance: 'auto' },
    photos: { 户: { day: '2025-05-01', at: ms('2025-05-01'), dataURL: PNG } },
    backupMeta: { lastExportAt: ms('2026-09-10', 21), lastExportSig: 'stale', lastConclusion: null },
    sessions: {
      A: null,
      B: {
        id: 's900', slot: 'B', kind: 'picked', source: { view: 'home' }, queue: ['base:鲜', 'base:境'], cursor: 0, items: [],
        current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
        lastLine: null, startedAt: at, startedDay: '2026-09-20', updatedAt: at,
      },
      lastEnded: {},
    },
  };
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canon(value[k]);
    return out;
  }
  return value;
}

const S = s => JSON.stringify(canon(s));

async function raw(page) {
  return page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'));
}
async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}
async function seed(page, s) {
  const r = await page.evaluate(x => window.__shiziTest.seed(x), s);
  if (!r || !r.ok) throw new Error(`seed failed: ${JSON.stringify(r)}`);
}
async function setClock(page, iso) {
  await page.evaluate(i => window.__shiziTest.setClock(i), iso);
}
async function settle(page) {
  await page.waitForTimeout(PRESS_SETTLE_MS);
}
async function openBackup(page) {
  await page.evaluate(async mod => (await import(mod)).openBackup(), BACKUP_MOD);
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
}
async function back(page) {
  await page.click(topSel('page-back'));
  await waitNavIdle(page);
}

async function view(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const txt = id => (q(id) ? q(id).textContent : null);
    const btn = id => (q(id) ? { disabled: q(id).disabled, aria: q(id).getAttribute('aria-disabled'), text: q(id).textContent.trim(), tag: q(id).tagName } : null);
    const body = q('backup-body');
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      state: body ? body.dataset.state : null,
      records: body ? Number(body.dataset.records) : null,
      label: txt('backup-last-label'),
      date: txt('backup-last-date'),
      line: txt('backup-status-note'),
      intro: txt('backup-intro'),
      note: txt('backup-note'),
      noteKind: q('backup-note') ? q('backup-note').dataset.kind : null,
      noteTone: q('backup-note') ? q('backup-note').dataset.tone : null,
      retry: btn('backup-note-retry'),
      export: btn('backup-export'),
      restore: btn('backup-restore'),
      restoreSub: txt('backup-restore-sub'),
      clear: btn('backup-clear'),
      undo: q('backup-undo') ? { kind: q('backup-undo').dataset.kind, state: q('backup-undo').dataset.state, text: q('undo-bar').textContent } : null,
      undoBtn: btn('undo-button'),
      confirm: q('backup-restore-confirm') ? {
        mode: q('backup-restore-confirm').dataset.mode,
        title: txt('backup-restore-confirm-title'),
        body: txt('backup-restore-confirm-body'),
        loss: txt('backup-restore-confirm-loss'),
        ok: btn('backup-restore-ok'),
        okPrimary: q('backup-restore-ok').classList.contains('sz-btn--primary'),
        cancel: btn('backup-restore-cancel'),
        role: q('backup-restore-confirm').getAttribute('role'),
      } : null,
      sheet: q('backup-clear-sheet') ? {
        body: txt('backup-clear-body'),
        state: q('backup-clear-body').dataset.state,
        ok: btn('backup-clear-ok'),
        cancel: btn('backup-clear-cancel'),
        stay: btn('backup-clear-stay'),
        retry: btn('backup-clear-retry'),
        okPrimary: q('backup-clear-ok') ? q('backup-clear-ok').classList.contains('sz-btn--primary') : null,
      } : null,
      toast: document.querySelector('[data-testid="toast"]') ? document.querySelector('[data-testid="toast"]').textContent : null,
    };
  });
}

async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(topSel('backup-export'))]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(file, 'utf8') };
}

async function pickFile(page, { name, mimeType = 'application/json', text = null, buffer = null }) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(topSel('backup-restore'))]);
  await chooser.setFiles({ name, mimeType, buffer: buffer || Buffer.from(text, 'utf8') });
}

async function waitConfirm(page) {
  await page.waitForSelector(topSel('backup-restore-confirm'));
  await waitNavIdle(page);
}
async function waitNote(page, kind) {
  await page.waitForFunction(k => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-note"]');
    return !!el && el.dataset.kind === k;
  }, kind);
}
async function confirmOk(page) {
  await page.click(topSel('backup-restore-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-restore-confirm"]'));
  await waitNavIdle(page);
}
async function writeLogLen(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}
/** 本页面（上次加载以来）没有绕过 storage.js 的写入；测试自己放的坏值键除外。 */
async function bypassWrites(page) {
  const log = await page.evaluate(() => window.__shiziTest.getWriteLog());
  return log.filter(e => e.via !== 'storage' && e.key !== 'shizi.corrupt.shizi.v2.custom').map(e => `${e.op}:${e.key}`);
}

export default async function run(page, { baseURL, assert, step }) {
  // Web Share 默认关掉（第 13 步再按需装假的），保证下载一级可测
  await page.addInitScript(() => {
    for (const k of ['share', 'canShare']) {
      try {
        Object.defineProperty(Navigator.prototype, k, { value: undefined, configurable: true, writable: true });
      } catch (error) {
        // ignore
      }
    }
  });
  await bootTestHost(page, baseURL);
  await page.evaluate(() => window.__shiziTest.reset());
  await setClock(page, '2026-09-24T20:00:00');

  // ------------------------------------------------------------ 1
  step('entry from 我的 menu and the empty state');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  await waitNavIdle(page);
  if (await page.$(topSel('mine-menu-backup'))) {
    await page.click(topSel('mine-menu-backup'));
    await page.waitForSelector(topSel('backup-screen'));
    await waitNavIdle(page);
    assert.ok(true, 'mine menu row 备份与恢复 opens the backup screen');
  } else {
    await openBackup(page);
  }
  let v = await view(page);
  assert.equal(v.screen, 'backup', 'top screen is backup');
  assert.equal(await page.textContent(topSel('backup-screen') + ' [data-page-title]'), '备份与恢复', 'page title');
  assert.equal(v.label, '上次备份', 'status label');
  assert.equal(v.date, T.noBackup, 'never backed up');
  assert.equal(v.line, T.noRecords, 'no records → 现在没有记录。');
  assert.equal(v.intro, T.introEmpty, 'intro without records');
  assert.deepEqual([v.export.disabled, v.export.aria, v.export.text, v.export.tag], [true, 'true', '导出备份文件', 'BUTTON'], 'export disabled (V07)');
  assert.deepEqual([v.clear.disabled, v.clear.aria, v.clear.text], [true, 'true', '清空所有记录'], 'clear disabled + aria-disabled (Y06)');
  assert.equal(v.restore.disabled, false, 'restore row usable without records');
  // Q2-8（P183，复测 simA S3）：没有记录时「从备份文件恢复」下面不再放孤零零的「离开这一页前可以撤销」（那是上一次清空留下的措辞，此时没有可撤销的东西）。
  assert.equal(v.restoreSub, null, 'no restore sub without records (Q2-8; was X07 「离开这一页前可以撤销」)');
  assert.equal(v.note, null, 'no note box without an error');
  assert.equal(v.undo, null, 'no undo bar');
  const names = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] button')]
    .filter(b => !(b.textContent.trim() || b.getAttribute('aria-label'))).length);
  assert.equal(names, 0, 'every button has an accessible name');

  // ------------------------------------------------------------ 2
  step('export (download tier): the 9-1 backup and the 300-char backup');
  await seed(page, oldState());
  await setClock(page, '2026-09-01T20:00:00');
  await waitNavIdle(page);
  v = await view(page);
  assert.equal(v.date, T.noBackup, '23 chars, never backed up');
  assert.equal(v.line, null, 'N27: no sentence when never backed up');
  assert.equal(v.intro, T.intro, 'intro with records');
  assert.equal(v.restoreSub, T.restoreSubHas, 'restore sub with records');
  assert.equal(v.export.disabled, false, 'export enabled');
  const fileA = await download(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-last-date"]');
    return el && el.dataset.day === '2026-09-01';
  });
  assert.equal(fileA.name, '拾字备份-2026-09-01.json', 'file name');
  const objA = JSON.parse(fileA.text);
  assert.deepEqual([objA.app, objA.version, objA.date.slice(0, 4)], ['shizi', 2, '2026'], 'v2 envelope');
  assert.ok(Object.keys(objA.data).every(k => k.indexOf('shizi.v2.') === 0), 'only shizi.v2.* keys');
  assert.ok(!('shizi.v2.sessions' in objA.data) && !('shizi.v2.safety' in objA.data), 'no sessions / safety in the file');
  assert.ok('shizi.v2.meta' in objA.data, 'meta synthesized');
  v = await view(page);
  assert.equal(v.date, '9 月 1 日', 'last backup date');
  assert.equal(v.line, T.allBacked, '现在的记录都已经备份了。');
  assert.equal(v.toast, T.exported, 'export feedback toast (K04)');
  let st = await state(page);
  assert.equal(st.backupMeta.lastExportAt > 0 && typeof st.backupMeta.lastExportSig === 'string', true, 'backupMeta recorded');

  await setClock(page, '2026-09-24T20:00:00');
  await seed(page, bigState());
  // 一个启动隔离留下的坏值键（替换成功后应清掉）
  await page.evaluate(() => localStorage.setItem('shizi.corrupt.shizi.v2.custom', '"broken"'));
  await waitNavIdle(page);
  v = await view(page);
  assert.equal(v.records, 300, '300 chars with records');
  assert.equal(v.date, '9 月 10 日', 'last backup from backupMeta');
  assert.equal(v.line, T.changed, '上次备份以后记录有改动，还没有备份。');
  const rawBeforeExport = await raw(page);
  await settle(page);
  const fileB = await download(page);
  const objB = JSON.parse(fileB.text);
  const expectKeys = Object.keys(rawBeforeExport).filter(k => !/^shizi\.v2\.(sessions|funnel|safety|txn|probe)$/.test(k)).sort();
  assert.deepEqual(Object.keys(objB.data).filter(k => k !== 'shizi.v2.meta').sort(), expectKeys, 'file keys = stored whitelist keys');
  assert.ok(expectKeys.every(k => objB.data[k] === rawBeforeExport[k]), 'every value is the stored raw string');
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-last-date"]');
    return el && el.dataset.day === '2026-09-24';
  });
  v = await view(page);
  assert.equal(v.line, T.allBacked, 'after export: all backed up');
  const S0raw = await raw(page);
  const S0 = await state(page);
  assert.equal(S0.safety, null, 'no safety copy yet');

  // ------------------------------------------------------------ 3
  step('R-B06: non-backup / half-broken / truncated / v1 / cancelled change nothing');
  const bad = JSON.parse(fileA.text);
  const recKey = Object.keys(bad.data).find(k => k.indexOf('shizi.v2.records.') === 0);
  bad.data[recKey] = '[{"id":"x"}]';
  const cases = [
    [{ name: '照片.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) }, 'notBackup', T.notBackup, 'jpeg → not a 拾字 backup'],
    [{ name: 'notes.json', text: '{"hello":"world"}' }, 'notBackup', T.notBackup, 'other JSON → not a backup'],
    [{ name: 'half.json', text: JSON.stringify(bad) }, 'restoreFailed', T.restoreFailed, 'half-broken backup (bad records key) → 没能恢复'],
    [{ name: 'cut.json', text: fileB.text.slice(0, 600) }, 'restoreFailed', T.restoreFailed, 'truncated 拾字 file → 没能恢复'],
    [{ name: 'v1.json', text: JSON.stringify({ app: 'shizi', version: 1, date: '2026-08-01T00:00:00Z', data: { 'shizi.memory.v1': '[1,2]' } }) }, 'restoreFailed', T.restoreFailed, 'broken v1 file (memory not an object) → 没能恢复'],
  ];
  for (const [file, kind, text, msg] of cases) {
    const before = await writeLogLen(page);
    await pickFile(page, file);
    await waitNote(page, kind);
    v = await view(page);
    assert.equal(v.note, text, msg);
    assert.equal(v.noteTone, 'error', `${kind}: error style (K04)`);
    assert.equal(v.confirm, null, `${kind}: no confirm`);
    assert.equal(await writeLogLen(page), before, `${kind}: nothing written`);
    assert.equal(S(await raw(page)), S(S0raw), `${kind}: all v2 keys deep-equal`);
    assert.equal(S(await state(page)), S(S0), `${kind}: getState deep-equal`);
    await settle(page);
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(topSel('backup-restore'))]);
  assert.ok(!!chooser, 'restore row opens the file chooser');
  await page.dispatchEvent(topSel('backup-file-input'), 'cancel');
  await waitNote(page, 'cancelled');
  v = await view(page);
  assert.equal(v.note, T.cancelled, 'cancel → 没有选文件');
  assert.equal(v.noteTone, 'info', 'cancel is not an error');
  assert.equal(S(await raw(page)), S(S0raw), 'cancel: deep-equal');
  await settle(page);

  // ------------------------------------------------------------ 4
  step('replace confirm (R-B03 / K04) and cancel');
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  v = await view(page);
  assert.equal(v.note, null, 'picking clears the previous note');
  assert.equal(v.confirm.mode, 'replace', 'replace mode with records');
  assert.equal(v.confirm.role, 'alertdialog', 'dialog role');
  assert.equal(v.confirm.title, T.replaceTitle, 'title');
  assert.equal(v.confirm.body, T.replaceBody, 'body: date, n, m');
  assert.equal(v.confirm.loss, T.loss, 'loss range (P26 / K04)');
  assert.deepEqual([v.confirm.cancel.text, v.confirm.ok.text], ['取消', '替换'], 'buttons');
  assert.equal(v.confirm.okPrimary, false, 'dangerous 替换 is not a primary button (K04)');
  let logBefore = await writeLogLen(page);
  await page.click(topSel('backup-restore-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-restore-confirm"]'));
  await waitNavIdle(page);
  assert.equal(await writeLogLen(page), logBefore, 'cancel writes nothing');
  assert.equal(S(await raw(page)), S(S0raw), 'cancel: deep-equal');

  // ------------------------------------------------------------ 5
  step('R-B04: the protection copy fails → nothing replaced, 10.14 note + 再试一次');
  await page.evaluate(() => window.__shiziTest.failNextWrite(2, { kind: 'quota', matchKey: 'shizi.v2.safety' }));
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await waitNote(page, 'protectFailed');
  v = await view(page);
  assert.equal(v.note, T.protectFailed + '再试一次', 'R-B04 note + retry link');
  assert.equal(v.retry && v.retry.text, '再试一次', 'retry link is a button');
  assert.equal(v.undo, null, 'no undo bar');
  assert.equal(S(await raw(page)), S(S0raw), 'quota x2 (1st): all v2 keys deep-equal, no recovery folding');
  assert.equal(S(await state(page)), S(S0), 'quota x2 (1st): getState deep-equal');
  await page.click(topSel('backup-note-retry'));
  await waitConfirm(page);
  v = await view(page);
  assert.equal(v.confirm.body, T.replaceBody, 're-try reopens the same confirm');
  await confirmOk(page);
  await waitNote(page, 'protectFailed');
  assert.equal(S(await raw(page)), S(S0raw), 'quota x2 (2nd): deep-equal');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await settle(page);
  await page.click(topSel('backup-note-retry'));
  await waitConfirm(page);
  await confirmOk(page);
  await waitNote(page, 'protectFailed');
  assert.equal(S(await raw(page)), S(S0raw), 'generic: deep-equal');
  assert.equal(S(await state(page)), S(S0), 'generic: getState deep-equal');

  // ------------------------------------------------------------ 6
  step('replace fails midway → rolled back, safety dropped, R-B06 没能恢复');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.records.*' }));
  await settle(page);
  await page.click(topSel('backup-note-retry'));
  await waitConfirm(page);
  await confirmOk(page);
  await waitNote(page, 'restoreFailed');
  v = await view(page);
  assert.equal(v.note, T.restoreFailed, 'R-B06 restoreFailed');
  assert.equal(v.retry, null, 'no retry link after a failed replace');
  assert.equal(S(await raw(page)), S(S0raw), 'rolled back: all v2 keys deep-equal (safety removed)');
  assert.equal(S(await state(page)), S(S0), 'rolled back: getState deep-equal');
  assert.ok(await page.evaluate(() => localStorage.getItem('shizi.corrupt.shizi.v2.custom') !== null), 'corrupt key untouched when the import failed');
  await settle(page);

  // ------------------------------------------------------------ 7
  step('K03: 300 chars → exported → replace with the 9-1 backup → undo → all v2 keys deep-equal');
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  v = await view(page);
  assert.equal(v.note, null, 'no note after success');
  assert.deepEqual([v.undo.kind, v.undo.state], ['restore', 'on'], 'undo bar on');
  assert.equal(v.undo.text, `${T.undoL1}${T.undoL2}撤销`, 'undo bar lines (R-B01)');
  assert.equal(v.line, T.conclusion, 'status says only the conclusion (X03)');
  assert.equal(v.date, '9 月 24 日', 'last backup date unchanged by replace (K02)');
  assert.equal(v.intro, null, 'no intro paragraph while undo is on');
  assert.equal(v.restoreSub, null, 'no restore sub while undo is on');
  assert.equal(v.records, 23, '23 chars now');
  st = await state(page);
  // P79：替换结束进行中的组（A/B 置 null；M6-6 lastEnded 一并清空），原会话随保护副本保存、撤销时还原
  assert.deepEqual([st.sessions.A, st.sessions.B], [null, null], 'P79: the unfinished B group ended by the replace');
  assert.equal(S(st.sessions.lastEnded), S({}), 'M6-6: lastEnded cleared by the replace');
  assert.equal(S(JSON.parse(st.safety.payload['shizi.v2.sessions'])), S(S0.sessions), 'P79: original sessions saved in the protection copy');
  assert.equal(st.safety && st.safety.kind, 'restore', 'protection copy present');
  assert.deepEqual(st.backupMeta.lastConclusion, { kind: 'restore', date: '2026-09-01', count: 23 }, 'conclusion persisted with the replace');
  assert.equal(st.backupMeta.lastExportAt, S0.backupMeta.lastExportAt, 'device lastExportAt kept');
  assert.equal(S(st.records), S(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(objA.data).filter(([k]) => k.indexOf('shizi.v2.records.') === 0).map(([k, val]) => [k.slice(17), JSON.parse(val)]))))), 'records = the backup');
  assert.equal(await page.evaluate(() => Object.keys(window.__shiziTest.getRawKeys('shizi.corrupt.')).length), 0, 'shizi.corrupt.* cleaned after import');
  const layout = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const bar = top.querySelector('[data-testid="undo-bar"]').getBoundingClientRect();
    const scroller = top.querySelector('.sz-page__body').getBoundingClientRect();
    return { barTop: bar.top, barBottom: bar.bottom, bodyBottom: scroller.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  assert.ok(layout.bodyBottom <= layout.barTop + 0.5, 'R-B08: content area ends above the undo bar (no overlap)');
  assert.ok(layout.barBottom <= layout.vh, 'undo bar inside the viewport');
  assert.ok(layout.sw <= layout.cw, 'no horizontal scroll');
  await settle(page);
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  v = await view(page);
  assert.equal(v.undo.text, T.undone, '已撤销');
  assert.equal(S(await raw(page)), S(S0raw), 'K03: all v2 keys deep-equal after undo');
  assert.equal(S(await state(page)), S(S0), 'K03: getState deep-equal after undo');
  assert.equal(v.records, 300, 'record count back to 300');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 5000 });
  v = await view(page);
  assert.equal(v.line, T.allBacked, 'status back to all backed up (payload backupMeta)');

  // ------------------------------------------------------------ 8
  step('R-B05: undo fails → bar changes, safety kept, can press again');
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  const replacedRaw = await raw(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await settle(page);
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'failed';
  });
  v = await view(page);
  assert.equal(v.undo.text, `${T.undoFailRestore}${T.undoAgain}撤销`, 'R-B05 restore wording');
  assert.equal(v.undoBtn.disabled, false, 'undo still pressable');
  assert.equal(S(await raw(page)), S(replacedRaw), 'still the backup data, safety kept');
  await settle(page);
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  assert.equal(S(await raw(page)), S(S0raw), 'second undo: deep-equal');
  assert.equal(S(await state(page)), S(S0), 'second undo: getState deep-equal');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 5000 });
  await settle(page);

  // ------------------------------------------------------------ 9
  step('P32: reload while still on the backup page → undo bar comes back');
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  assert.deepEqual(await bypassWrites(page), [], 'steps 1–9: no write bypassed storage.js');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await setClock(page, '2026-09-24T20:05:00');
  await page.waitForSelector(topSel('backup-undo'));
  await waitNavIdle(page);
  v = await view(page);
  assert.equal(v.screen, 'backup', 'router restored the backup page');
  assert.deepEqual([v.undo.kind, v.undo.state], ['restore', 'on'], 'undo bar resumed (P32 undoAfterReload=resume)');
  assert.equal(v.line, T.conclusion, 'conclusion after reload');
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  assert.equal(S(await raw(page)), S(S0raw), 'undo after reload: all v2 keys deep-equal');
  assert.equal(S(await state(page)), S(S0), 'undo after reload: getState deep-equal');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 5000 });
  await settle(page);

  // ------------------------------------------------------------ 10
  step('leaving the page ends the undo: safety dropped; coming back recomputes the status sentence (Q2-8)');
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  await back(page);
  st = await state(page);
  assert.equal(st.safety, null, 'safety removed after leaving');
  assert.ok(!('shizi.v2.safety' in (await raw(page))), 'no shizi.v2.safety key');
  assert.equal(st.backupMeta.lastConclusion && st.backupMeta.lastConclusion.kind, 'restore', 'conclusion persisted');
  await openBackup(page);
  v = await view(page);
  assert.equal(v.undo, null, 'no undo bar after coming back');
  // Q2-8（P183，复测 simA S3；D24「状态句只按现在的记录和上次导出时间算」）：离开再进来，撤销早已失效，状态句按现在的记录与上次导出时间重算，
  // 不再留着「已换成…备份里的记录」；旧断言（T.conclusion 留结论句）改成重算结果：恢复后的记录与上次导出的签名不同 → 「上次备份以后记录有改动」。
  assert.equal(v.line, T.changed, 'recomputed from the current records and the last export time (Q2-8)');
  assert.equal(v.restoreSub, T.restoreSubHas, 'with records the sub still describes a future restore');
  assert.equal(v.intro, T.intro, 'intro shown again');

  // ------------------------------------------------------------ 11
  step('clear all records: sheet, safety failure, success, undo failure, undo');
  await seed(page, S0);
  await waitNavIdle(page);
  const S0rawAgain = await raw(page);
  assert.equal(S(S0rawAgain), S(S0raw), 're-seeded S0');
  await page.click(topSel('backup-clear'));
  await page.waitForSelector(topSel('backup-clear-sheet'));
  await waitNavIdle(page);
  v = await view(page);
  assert.equal(await page.textContent(topSel('backup-clear-sheet') + ' .sz-sheet__title'), T.clearTitle, 'clear title');
  assert.equal(v.sheet.body, T.clearBody, 'clear body with n = 300');
  assert.deepEqual([v.sheet.cancel.text, v.sheet.ok.text, v.sheet.okPrimary], ['取消', '清空', false], 'clear buttons; 清空 is not primary');
  logBefore = await writeLogLen(page);
  await page.click(topSel('backup-clear-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-clear-sheet"]'));
  await waitNavIdle(page);
  assert.equal(await writeLogLen(page), logBefore, 'cancel clear writes nothing');
  await page.click(topSel('backup-clear'));
  await page.waitForSelector(topSel('backup-clear-sheet'));
  await waitNavIdle(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'quota', matchKey: 'shizi.v2.safety' }));
  await page.click(topSel('backup-clear-ok'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-clear-body"]');
    return el && el.dataset.state === 'failed';
  });
  await waitNavIdle(page);
  v = await view(page);
  assert.equal(v.sheet.body, T.clearFailed, '没保存上，记录都还在。');
  assert.deepEqual([v.sheet.stay.text, v.sheet.retry.text], ['先不清空', '再试一次'], 'failed sheet buttons');
  assert.equal(S(await raw(page)), S(S0raw), 'clear safety failure: deep-equal');
  await page.click(topSel('backup-clear-retry'));
  await page.waitForSelector(topSel('backup-undo'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-clear-sheet"]'));
  await waitNavIdle(page);
  v = await view(page);
  assert.deepEqual([v.undo.kind, v.undo.text], ['clear', `${T.clearUndoL1}${T.undoL2}撤销`], 'clear undo bar (P44)');
  assert.equal(v.line, T.clearConclusion, '记录已清空。现在没有记录。');
  assert.deepEqual([v.export.disabled, v.clear.disabled, v.clear.aria], [true, true, 'true'], 'export / clear greyed after clear');
  st = await state(page);
  assert.deepEqual([Object.keys(st.records).length, st.sched, st.custom, st.wordOff, st.photos], [0, null, null, null, null], 'record domains cleared');
  assert.equal(S(st.settings), S(S0.settings), 'settings kept');
  assert.deepEqual([st.sessions.A, st.sessions.B], [null, null], 'P79: clear ends the unfinished group');
  assert.equal(S(JSON.parse(st.safety.payload['shizi.v2.sessions'])), S(S0.sessions), 'P79: original sessions in the protection copy');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'failed';
  });
  v = await view(page);
  assert.equal(v.undo.text, `${T.undoFailClear}${T.undoAgain}撤销`, 'R-B05 clear wording');
  assert.equal(Object.keys((await state(page)).records).length, 0, 'records still empty');
  await settle(page);
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  assert.equal(S(await raw(page)), S(S0raw), 'clear undo: all v2 keys deep-equal');
  assert.equal(S(await state(page)), S(S0), 'clear undo: getState deep-equal');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 5000 });
  await settle(page);

  // ------------------------------------------------------------ 11a（Q2-8）
  step('Q2-8: clear → leave → come back: 「现在没有记录。」, no 「记录已清空」, no 「离开这一页前可以撤销」 anywhere');
  await seed(page, S0);
  await waitNavIdle(page);
  await page.click(topSel('backup-clear'));
  await page.waitForSelector(topSel('backup-clear-sheet'));
  await waitNavIdle(page);
  await page.click(topSel('backup-clear-ok'));
  await page.waitForSelector(topSel('backup-undo'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-clear-sheet"]'));
  await waitNavIdle(page);
  assert.equal((await view(page)).line, T.clearConclusion, 'while the undo is live: the conclusion');
  await back(page);
  await openBackup(page);
  v = await view(page);
  assert.equal(v.undo, null, 'no undo bar after coming back');
  assert.equal(v.line, T.noRecords, 'recomputed: only 「现在没有记录。」');
  assert.equal(v.restoreSub, null, 'no restore sub without records');
  const stale = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-screen"]').textContent);
  assert.ok(!/记录已清空|离开这一页前可以撤销/.test(stale), 'nothing on the page mentions the expired undo: ' + stale);
  await seed(page, S0);
  await waitNavIdle(page);

  // ------------------------------------------------------------ 11b
  step('P79: an unfinished A group is ended by the replace (home shows no resume); undo brings it back deep-equal');
  const A0 = {
    id: 's950', slot: 'A', kind: 'daily', source: { view: 'home' }, queue: ['base:永', 'base:字', 'base:和'], cursor: 1,
    items: [{ cardKey: 'base:永', recordId: 'r1', kind: 'judged' }],
    current: { phase: 'recall', strokes: [[3, 600, 1700, 0, 1700, 1710, 60, 2800, 1720, 60]], hints: 1, answerSeen: false, hintRange: null, referenceReady: false },
    lastLine: null, startedAt: ms('2026-09-24', 19), startedDay: '2026-09-24', updatedAt: ms('2026-09-24', 19),
  };
  const SA = { ...S0, sessions: { A: A0, B: null, lastEnded: { B: { ...S0.sessions.B, endedAt: ms('2026-09-23'), endedEarly: true } } } };
  await seed(page, SA);
  await waitNavIdle(page);
  const SAraw = await raw(page);
  const resumeNow = () => page.evaluate(async () => {
    const { resumeOf } = await import('/src/ui/screens/home/today.js');
    const { now } = await import('/src/platform/env.js');
    const home = document.querySelector('[data-testid="screen-home"]');
    return { resume: resumeOf(window.__shiziTest.getState(), now()).resume, dom: home ? home.dataset.resume : null };
  });
  let rs = await resumeNow();
  assert.ok(rs.resume === 'A' && (rs.dom === null || rs.dom === 'A'), `before: home would resume A (${JSON.stringify(rs)})`);
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  st = await state(page);
  assert.deepEqual([st.sessions.A, st.sessions.B], [null, null], 'P79: A ended by the replace');
  assert.equal(S(st.sessions.lastEnded), S({}), 'M6-6: lastEnded (B ended yesterday) cleared by the replace');
  rs = await resumeNow();
  assert.ok(rs.resume === 'none' && (rs.dom === null || rs.dom === 'none'), `after replace: no resume on home (${JSON.stringify(rs)})`);
  await settle(page);
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  st = await state(page);
  assert.equal(S(st.sessions.A), S(A0), 'undo: A back, current (strokes / hints) deep-equal');
  assert.equal(S(await raw(page)), S(SAraw), 'undo: all v2 keys (incl. sessions) deep-equal');
  rs = await resumeNow();
  assert.equal(rs.resume, 'A', 'undo: home would resume A again');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 5000 });
  await settle(page);
  // 再替换一次并离开：真实首页不显示续写
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  await back(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForSelector(topSel('screen-home'));
  await waitNavIdle(page);
  const homeAfter = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
    return { resume: el.dataset.resume, line: !!el.querySelector('[data-testid="resume-line"]') };
  });
  assert.deepEqual(homeAfter, { resume: 'none', line: false }, 'home after the replace: data-resume=none, no resume line');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  await waitNavIdle(page);
  await openBackup(page);

  // ------------------------------------------------------------ 12
  step('no records: restore wording (Y04)');
  await page.evaluate(() => window.__shiziTest.reset());
  await setClock(page, '2026-09-24T20:10:00');
  await waitNavIdle(page);
  await pickFile(page, { name: fileA.name, text: fileA.text });
  await waitConfirm(page);
  v = await view(page);
  assert.deepEqual([v.confirm.mode, v.confirm.title, v.confirm.body, v.confirm.loss], ['restore', T.restoreTitle, T.restoreBody, null], 'restore wording');
  assert.deepEqual([v.confirm.ok.text, v.confirm.okPrimary], ['恢复', true], '恢复 is the primary button');
  await confirmOk(page);
  await page.waitForSelector(topSel('backup-undo'));
  v = await view(page);
  assert.equal(v.records, 23, 'restored 23 chars');
  assert.equal(v.date, T.noBackup, 'still never backed up on this device');
  await back(page);
  await openBackup(page);

  // ------------------------------------------------------------ 13
  step('distribution tier 2: Web Share (done → recorded, AbortError → not recorded)');
  await page.evaluate(() => {
    window.__shared = [];
    window.__shareMode = 'ok';
    Object.defineProperty(navigator, 'canShare', { value: d => !!(d && d.files && d.files.length), configurable: true, writable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      writable: true,
      value: async d => {
        window.__shared.push({ name: d.files[0].name, type: d.files[0].type, size: d.files[0].size });
        if (window.__shareMode === 'abort') throw new DOMException('cancelled', 'AbortError');
      },
    });
  });
  const beforeShare = (await state(page)).backupMeta;
  await page.evaluate(() => { window.__shareMode = 'abort'; });
  await page.click(topSel('backup-export'));
  await page.waitForFunction(() => window.__shared.length === 1);
  await settle(page);
  assert.equal(S((await state(page)).backupMeta), S(beforeShare), 'AbortError: export not recorded');
  await page.evaluate(() => { window.__shareMode = 'ok'; });
  await page.click(topSel('backup-export'));
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-last-date"]');
    return el && el.dataset.day === '2026-09-24';
  });
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual([shared[1].name, shared[1].type, shared[1].size > 100], ['拾字备份-2026-09-24.json', 'application/json', true], 'shared a JSON file');
  v = await view(page);
  assert.equal(v.line, T.allBacked, 'Web Share done → recorded, conclusion cleared');

  // ------------------------------------------------------------ 14
  step('native shell: shareBackup / markBackupExported, pickBackup / shiziBackupPicked / shiziBackupRejected');
  assert.deepEqual(await bypassWrites(page), [], 'steps 9–13: no write bypassed storage.js');
  await installNativeStub(page);
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await setClock(page, '2026-09-25T09:00:00');
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  // M5-5 起 app.js 启动序列自己调 bridge.markReady(store)（幂等）；这里只核对桥已就绪且持有 store，不再手动 markReady
  // （旧的 markReady(null) 会把桥的 store 置 null）。
  await page.waitForFunction(() => window.__shiziBridge.isReady());
  assert.ok(await page.evaluate(() => window.__shiziBridge.getStore() !== null), 'bridge is ready with the store (app.js markReady)');
  await seed(page, S0);
  await waitNavIdle(page);
  const metaBeforeNative = (await state(page)).backupMeta;
  await page.click(topSel('backup-export'));
  const msgs = await page.evaluate(() => window.__nativeMsgs.filter(m => m.type === 'shareBackup'));
  assert.equal(msgs.length, 1, 'posted shareBackup');
  assert.equal(msgs[0].name, '拾字备份-2026-09-25.json', 'native file name');
  assert.equal(JSON.parse(msgs[0].payload).version, 2, 'native payload is the v2 file text');
  assert.equal(S((await state(page)).backupMeta), S(metaBeforeNative), 'not recorded until markBackupExported');
  await page.evaluate(() => window.markBackupExported());
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-last-date"]');
    return el && el.dataset.day === '2026-09-25';
  });
  v = await view(page);
  assert.equal(v.line, T.allBacked, 'markBackupExported → recorded');
  await settle(page);
  await page.click(topSel('backup-restore'));
  assert.equal(await page.evaluate(() => window.__nativeMsgs.filter(m => m.type === 'pickBackup').length), 1, 'posted pickBackup (no web file chooser)');
  await page.evaluate(text => window.shiziBackupPicked(text), fileA.text);
  await waitConfirm(page);
  v = await view(page);
  assert.equal(v.confirm.title, T.replaceTitle, 'shiziBackupPicked → in-page confirm');
  await page.click(topSel('backup-restore-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-restore-confirm"]'));
  await waitNavIdle(page);
  await page.evaluate(() => window.shiziBackupRejected({ reason: 'cancelled' }));
  await waitNote(page, 'cancelled');
  assert.equal((await view(page)).note, T.cancelled, 'rejected cancelled → 没有选文件');
  await page.evaluate(() => window.shiziBackupRejected({ reason: 'tooLarge' }));
  await waitNote(page, 'notBackup');
  assert.equal((await view(page)).note, T.notBackup, 'rejected tooLarge → 不是拾字的备份');

  assert.deepEqual(await bypassWrites(page), [], 'step 14: no write bypassed storage.js');
}
