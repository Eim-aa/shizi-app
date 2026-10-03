// M5-4 迁移与旧备份导入（02 M5-4；01 §12、§3.5 photos、§3.6 旧键处理、§4 迁移写入点、§9；03 P10 / P35 / P53 / P07）。
//
// fixture：scripts/fixtures/legacy-v1/backup-300.json（按旧版 index.html 639f592 的 v1 数据模型构造的真实 v1 备份文件：
//   300 字 + 自定义字、fsrsReviewLog 含 hinted（hintCount 0 的「不太确定」与 hintCount>0）/ wrong / dontKnow、
//   120 天外只剩 memory 的字（含被拍字改写过 lastOutcome 的字）、只加过没练过的字、wild.captures 照片、
//   session.v1 带 compositeImage）+ device-only.json（只在设备上的 shizi.safety.v1、v1 时代的 shizi.corrupt.*）。
// 期望值由同一个纯函数 convertV1 在 node 里算（记录集合与「现在」无关），页面里只核对落盘与界面。
//
//   1. 预置 v1 键后启动：迁移一次写成（meta.migratedAt、单次 txn）→ session / safety / 旧坏值即删，其余 v1 键原样保留（P53）；
//      不变式 sched 存在 ⇒ 有 judged 记录；总占用低于 3.2MiB 目标；没有绕过 storage.js 的写入。
//   2. 界面：字库「有记录的字」数、写错过集合、练习记录日历（有记录的日子）、单字详情「旧版本的记录」照片可见。
//   3. 导出 v2：文件里照片与 legacy 仍在；导出一次后重启 → 其余 v1 键回收（P53 先到者）。
//   4. failNextWrite(1,{kind:'quota'}) 注入迁移失败：v1 键逐字节完好、没有任何 v2 键（没有 meta、没有 txn）；重启自动重试成功。
//   5. v1 备份文件经备份页导入：确认框字数 → 恢复 → 记录 / 照片 / legacy 与转换一致，meta 不带 migratedAt。
//   6. 启动时迁移撞配额（真实 QuotaExceededError）：app.js 把失败交给 R-B09 迁移变体（M5-6），没有 tab；v1 键完好；再启动重试成功。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

const TARGET_BYTES = 3.2 * 1024 * 1024; // 01 §9 合计目标（store/budget.js totalTargetBytes）

async function rawKeys(page, prefix = 'shizi.') {
  return page.evaluate(p => window.__shiziTest.getRawKeys(p), prefix);
}
async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}
async function presetV1(page, entries) {
  await page.evaluate(obj => {
    window.__shiziTest.reset();
    for (const key of Object.keys(obj)) localStorage.setItem(key, obj[key]); // 测试预置旧版数据（旧版自己写下的键）
  }, entries);
}
async function reloadApp(page) {
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
}
async function migrationResult(page) {
  return page.evaluate(async () => (await import('/src/store/migrate.js')).getMigrationResult());
}
async function push(page, mod, fn, arg) {
  await page.evaluate(async ({ m, f, a }) => (await import(m))[f](a), { m: mod, f: fn, a: arg });
  await waitNavIdle(page);
}

function recordsOf(s) {
  return Object.keys(s.records || {}).sort().flatMap(m => (Array.isArray(s.records[m]) ? s.records[m] : s.records[m].kept || []));
}

export default async function run(page, { baseURL, assert, step, root }) {
  const fixtureDir = join(root, 'scripts/fixtures/legacy-v1');
  const backupText = readFileSync(join(fixtureDir, 'backup-300.json'), 'utf8');
  const backup = JSON.parse(backupText);
  const deviceOnly = JSON.parse(readFileSync(join(fixtureDir, 'device-only.json'), 'utf8'));
  const M = await import(pathToFileURL(join(root, 'src/store/migrate.js')).href);
  const R = await import(pathToFileURL(join(root, 'src/core/records.js')).href);

  // 期望（纯转换；记录、写错过、日子与迁移时刻无关）
  const read = M.readV1(backup.data);
  const conv = M.convertV1(read.values, { now: Date.now(), present: read.present });
  const expRecords = recordsOf(conv.state);
  const expJudged = expRecords.filter(r => r.kind === 'judged');
  const expChars = new Set(expJudged.map(r => r.char));
  const expWrong = R.wrongList(expRecords).map(r => r.char).sort();
  const expPhotos = conv.state.photos;
  const photoChar = Object.keys(expPhotos).sort()[0];
  const monthDays = month => [...new Set(expJudged.filter(r => r.localDay.slice(0, 7) === month).map(r => r.localDay))].sort();
  const busiest = Object.keys(conv.state.records).sort((a, b) => monthDays(b).length - monthDays(a).length)[0];
  assert.ok(expChars.size >= 290, `fixture: ${expChars.size} chars with judged records (300 字量级)`);
  assert.ok(conv.report.sched.droppedNoJudged > 0, 'fixture: chars without any judgment (sched not migrated)');
  assert.ok(conv.report.events.uncertain > 0 && conv.report.events.hintedWithHints > 0, 'fixture: hinted / uncertain events present');
  assert.ok(conv.report.synthesized.correct > 0 && conv.report.synthesized.fromLastReview > 0, 'fixture: chars with memory but no events');
  assert.ok(expWrong.length > 0 && photoChar, 'fixture: wrong list and photos non-empty');

  // Web Share 关掉，导出走下载一级（同 42-backup）
  await page.addInitScript(() => {
    for (const k of ['share', 'canShare']) {
      try {
        Object.defineProperty(Navigator.prototype, k, { value: undefined, configurable: true, writable: true });
      } catch (error) {
        // ignore
      }
    }
  });
  // 第 6 步：sessionStorage 标记在时让 shizi.v2.txn 写不进（真实 QuotaExceededError），模拟启动时迁移撞配额
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (this === window.localStorage && key === 'shizi.v2.txn' && window.sessionStorage.getItem('e2e.failMigrationTxn') === '1') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return orig.call(this, key, value);
    };
  });
  await bootTestHost(page, baseURL);

  // ------------------------------------------------------------ 1
  step('preset v1 keys → start → one-shot migration');
  const v1Entries = { ...backup.data, ...deviceOnly };
  await presetV1(page, v1Entries);
  await reloadApp(page);
  const result = await migrationResult(page);
  assert.equal(result && result.action, 'migrated', 'boot migration ran');
  assert.equal(result.metaVerified, true, 'meta written and verified');
  assert.deepEqual(result.removed.slice().sort(), ['shizi.corrupt.shizi.topic.v1', 'shizi.safety.v1', 'shizi.session.v1'], 'big v1 keys + v1 quarantine removed right away');
  let raw = await rawKeys(page);
  const meta = JSON.parse(raw['shizi.v2.meta']);
  assert.ok(Number.isFinite(meta.migratedAt), 'v2.meta.migratedAt');
  assert.equal(raw['shizi.v2.txn'], undefined, 'no txn left behind');
  assert.ok(Object.keys(backup.data).filter(k => k !== 'shizi.session.v1').every(k => raw[k] === backup.data[k]), 'other v1 keys kept byte-identical (rollback window)');
  const log = await page.evaluate(() => window.__shiziTest.getWriteLog());
  assert.deepEqual(log.filter(e => e.via !== 'storage').map(e => `${e.op}:${e.key}`), [], 'no writes bypassing storage.js');
  const txns = log.filter(e => e.op === 'set' && e.key === 'shizi.v2.txn');
  assert.equal(txns.length, 1, 'all v2 keys in a single writeAll (one txn)');
  const metaSeq = log.find(e => e.op === 'set' && e.key === 'shizi.v2.meta').seq;
  assert.ok(log.filter(e => e.op === 'set' && /^shizi\.v2\.(records|sched|photos|legacy|custom|settings)/.test(e.key)).every(e => e.seq < metaSeq), 'meta written after the data keys');
  let s = await state(page);
  const recs = recordsOf(s);
  assert.equal(recs.length, expRecords.length, `records: ${recs.length}`);
  assert.ok(recs.every(r => r.legacy === true), 'migrated records are legacy');
  const judgedKeys = new Set(recs.filter(r => r.kind === 'judged').map(r => r.cardKey));
  assert.ok(Object.keys(s.sched).every(k => judgedKeys.has(k)), 'invariant: sched exists ⇒ judged record');
  assert.equal(s.legacy.report.source, 'device', 'import report stored in legacy.report');
  assert.equal(s.settings.large, true, 'fontScale → settings.large');
  assert.equal('scene' in s.settings, false, 'sound.scene dropped (P07)');
  const status = await page.evaluate(() => window.__shiziTest.getStatus());
  assert.ok(status.usage.total < TARGET_BYTES, `total usage ${status.usage.total} < 3.2MiB target`);

  // ------------------------------------------------------------ 2
  step('UI: chars count, wrong list, calendar, legacy photo');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForSelector(tid('library-home'));
  await waitNavIdle(page);
  const lib = await page.evaluate(() => {
    const home = document.querySelector('[data-testid="library-home"]');
    const wrong = document.querySelector('[data-testid="library-card-wrong"]');
    return { recorded: Number(home.dataset.recorded), wrong: wrong ? Number(wrong.dataset.n) : null };
  });
  assert.equal(lib.recorded, expChars.size, `字库: ${lib.recorded} chars with records`);
  assert.equal(lib.wrong, expWrong.length, `写错过 card: ${lib.wrong}`);
  await push(page, '/src/ui/screens/library/list.js', 'openList', 'wrong');
  await page.waitForSelector(topSel('list-screen'));
  await page.click(topSel('list-rest-toggle')); // B4：默认只露最该练的 5 行，其余折叠
  const wrongChars = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row"]')].map(el => el.dataset.char).sort());
  assert.deepEqual(wrongChars, expWrong, 'wrong list = chars whose latest judged record is wrong');

  await push(page, '/src/ui/screens/mine/records.js', 'openRecords', { month: busiest });
  await page.waitForSelector(topSel('records-calendar'));
  const days = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="records-day"][data-has="true"]')].map(el => el.dataset.day).sort());
  assert.deepEqual(days, monthDays(busiest), `calendar ${busiest}: days with judged records`);

  await push(page, '/src/ui/screens/detail/index.js', 'openDetail', photoChar);
  await page.waitForSelector(topSel('detail-legacy'));
  await page.click(topSel('detail-legacy'));
  await page.waitForSelector(topSel('photo-image'));
  await waitNavIdle(page);
  const src = await page.getAttribute(topSel('photo-image'), 'src');
  assert.equal(src, expPhotos[photoChar].dataURL, `photo of ${photoChar} visible on the old-record page`);
  const natural = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="photo-image"]').naturalWidth);
  assert.ok(natural > 0, 'photo decodes');

  // ------------------------------------------------------------ 3
  step('export v2 keeps photos; export releases the rest of the v1 keys on next start (P53)');
  await push(page, '/src/ui/screens/mine/backup.js', 'openBackup');
  await page.waitForSelector(topSel('backup-export'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(topSel('backup-export'))]);
  const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.deepEqual([file.app, file.version], ['shizi', 2], 'v2 envelope');
  assert.deepEqual(JSON.parse(file.data['shizi.v2.photos']), expPhotos, 'photos still in the exported v2 file');
  assert.equal(JSON.parse(file.data['shizi.v2.legacy']).report.source, 'device', 'legacy (days + report) exported');
  assert.ok(Object.keys(file.data).every(k => k.indexOf('shizi.v2.') === 0), 'no v1 keys in the v2 file');
  raw = await rawKeys(page);
  assert.ok(raw['shizi.memory.v1'] !== undefined, 'v1 keys still there before restart');
  await reloadApp(page);
  const rel = await migrationResult(page);
  assert.equal(rel.action, 'none', 'already migrated');
  raw = await rawKeys(page);
  assert.deepEqual(Object.keys(raw).filter(k => k.indexOf('shizi.v2.') !== 0), [], 'after a v2 export the v1 keys are released');
  s = await state(page);
  assert.equal(recordsOf(s).length, expRecords.length, 'records unchanged by the release');

  // ------------------------------------------------------------ 4
  step('failNextWrite quota → migration fails cleanly; restart retries');
  await presetV1(page, v1Entries);
  const before = await rawKeys(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'quota' }));
  const failed = await page.evaluate(async () => (await import('/src/store/migrate.js')).bootMigration());
  assert.deepEqual([failed.ok, failed.error && failed.error.kind], [false, 'quota'], 'migration reports a quota failure');
  let after = await rawKeys(page);
  assert.deepEqual(after, before, 'v1 keys intact (session / safety kept), nothing else written');
  assert.deepEqual(Object.keys(after).filter(k => k.indexOf('shizi.v2.') === 0), [], 'no v2.meta, no v2 keys, no txn');
  assert.equal((await state(page)).meta, null, 'store has no meta');
  // 中途失败（records 已写）也回滚干净
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'quota', matchKey: 'shizi.v2.sched' }));
  const failed2 = await page.evaluate(async () => (await import('/src/store/migrate.js')).bootMigration());
  assert.equal(failed2.ok, false, 'mid-write failure reported');
  after = await rawKeys(page);
  assert.deepEqual(after, before, 'mid-write failure rolled back: v1 intact, no v2 keys');
  await reloadApp(page);
  const retried = await migrationResult(page);
  assert.equal(retried.action, 'migrated', 'next start retries and succeeds');
  raw = await rawKeys(page);
  assert.ok(raw['shizi.v2.meta'] && JSON.parse(raw['shizi.v2.meta']).migratedAt, 'meta written on retry');
  assert.equal(raw['shizi.session.v1'], undefined, 'big key removed after the successful retry');
  assert.equal(recordsOf(await state(page)).length, expRecords.length, 'same records after retry');

  // ------------------------------------------------------------ 5
  step('v1 backup file through the backup page import path');
  await page.evaluate(() => window.__shiziTest.reset());
  await reloadApp(page);
  await push(page, '/src/ui/screens/mine/backup.js', 'openBackup');
  await page.waitForSelector(topSel('backup-restore'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(topSel('backup-restore'))]);
  await chooser.setFiles({ name: 'shizi-backup-2026-09-20.json', mimeType: 'application/json', buffer: Buffer.from(backupText, 'utf8') });
  await page.waitForSelector(topSel('backup-restore-confirm'));
  await waitNavIdle(page);
  const confirm = await page.evaluate(() => {
    const q = id => document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
    return { mode: q('backup-restore-confirm').dataset.mode, body: q('backup-restore-confirm-body').textContent };
  });
  assert.equal(confirm.mode, 'restore', 'no records yet → restore wording');
  assert.ok(confirm.body.indexOf(`${expChars.size} 个字`) >= 0, `confirm names ${expChars.size} chars: ${confirm.body}`);
  await page.click(topSel('backup-restore-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-restore-confirm"]'));
  await waitNavIdle(page);
  s = await state(page);
  const imported = recordsOf(s);
  assert.equal(imported.length, expRecords.length, 'records from the v1 file');
  assert.deepEqual(R.wrongList(imported).map(r => r.char).sort(), expWrong, 'same wrong list as the conversion');
  assert.deepEqual(s.photos, expPhotos, 'photos imported from the v1 file');
  assert.equal(s.legacy.report.source, 'backup', 'import report (backup) in legacy.report');
  assert.equal(s.meta.migratedAt, undefined, 'a backup import is not a device migration');
  assert.ok(Object.keys(s.sched).every(k => new Set(imported.filter(r => r.kind === 'judged').map(r => r.cardKey)).has(k)), 'invariant holds after backup import');
  raw = await rawKeys(page);
  assert.deepEqual(Object.keys(raw).filter(k => k.indexOf('shizi.v2.') !== 0), [], 'no v1 keys written by a backup import');

  // ------------------------------------------------------------ 6
  step('boot-time failure → R-B09 migration variant (app.js → M5-6 reportMigrationFailure); next start retries');
  await presetV1(page, v1Entries);
  const beforeBoot = await rawKeys(page);
  await page.evaluate(() => sessionStorage.setItem('e2e.failMigrationTxn', '1'));
  await reloadApp(page);
  const bootFail = await migrationResult(page);
  assert.deepEqual([bootFail.ok, bootFail.error && bootFail.error.kind], [false, 'quota'], 'boot migration failed with quota');
  assert.equal(await page.getAttribute('.sz-app', 'data-blocked'), 'migration', 'blocking page, migration variant');
  assert.ok(!!(await page.$(tid('block-migration'))), 'migration line shown');
  assert.equal(await page.$('[role="tablist"]'), null, 'no tabs: writing is unreachable');
  assert.deepEqual(await rawKeys(page), beforeBoot, 'v1 keys intact, no v2 keys after the failed boot');
  await page.evaluate(() => sessionStorage.removeItem('e2e.failMigrationTxn'));
  await reloadApp(page);
  assert.equal((await migrationResult(page)).action, 'migrated', 'restart retries and migrates');
  assert.equal(await page.getAttribute('.sz-app', 'data-blocked'), null, 'no blocking page after the retry');
}
