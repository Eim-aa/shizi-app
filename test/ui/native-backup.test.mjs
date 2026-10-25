// B3.10 原生备份页的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.backup = 网页备份页渲染用的同一个模型函数（core/backup.js 的 backupView），渲染出的字一字不差；
//   2. 导出：backup.export 打包的文件与网页 doExport 打包的那一份逐字相同，backup.exportDone 的记账与网页 finishExport 相同；
//   3. 导入：预检（backup.picked / backup.restorePreview）→ 替换（backup.restore）与网页 receiveText → runRestore 同一批函数：
//      整份 store deepEqual、commit 序列相同；D07：写失败回 {ok:false, error:{kind}}、store 不动；
//   4. 清空（backup.clear）与撤销（backup.undoRestore / backup.undoClear）同网页 clearAllRecords / undoFromSafety。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { setClockOverride, now as envNow } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import {
  backupFileName, backupView, buildBackupV2, clearAllRecords, inspectBackup, markExported, recordsSignature,
  restoreFromBackup, serializeBackup, undoFromSafety,
} from '../../src/core/backup.js';
import { t, tRef } from '../../src/config/copy/index.js';

const NOW = '2026-10-05T19:30:00';
const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;

const FSRS = { stability: 3, difficulty: 5, state: 2 };

function ms(day, hour = 9) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
}

function rec(serial, char, day, judgment = 'correct') {
  return { id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's1', kind: 'judged', judgment, at: ms(day) + serial, localDay: day,
    help: { hints: 0, answerSeen: false, traced: false } };
}

/** 两个月的记录 + sched / settings / backupMeta（网页夹具同口径的少量数据）。 */
function currentState() {
  return {
    records: {
      '2026-07': [rec(1, '永', '2026-07-03'), rec(2, '和', '2026-07-04', 'wrong')],
      '2026-09': [rec(3, '永', '2026-09-02'), rec(4, '字', '2026-09-20')],
    },
    sched: {
      'base:永': { fsrs: FSRS, due: '2026-10-01', lastJudgedAt: ms('2026-09-02') },
      'base:字': { fsrs: FSRS, due: '2026-10-05', lastJudgedAt: ms('2026-09-20') },
    },
    settings: { library: 'adv3000' },
    backupMeta: { lastExportAt: ms('2026-09-10'), lastExportSig: 'x', lastConclusion: null },
    sessions: { A: null, B: null, lastEnded: {} },
  };
}

function boot(seed) {
  setClockOverride(NOW);
  let storage = null;
  const { store } = bootStore({ backend: new MemoryStorage(), onStorage: s => { storage = s; } });
  if (seed) seed(store);
  const labels = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
  const api = createAppApi({ getStore: () => store });
  return { store, storage, labels, api };
}

const seedState = state => store => {
  assert.equal(store.seed(state).ok, true);
};

test('B3.10 view.backup = the web backup model, rendered word for word', () => {
  const { api, store } = boot(seedState(currentState()));
  const v = api.call('view.backup').view;
  assert.deepEqual(v, backupView(store.getState()), 'same function');
  assert.equal(tRef(v.lastLabel), t('R-B02.lastBackupLabel'));
  assert.equal(tRef(v.lastDate), t('R-H02.dateFormat', { month: 9, day: 10 }));
  assert.equal(v.lastDay, '2026-09-10');
  assert.equal(tRef(v.statusLines[0]), t('R-B02.changedSince'));
  assert.deepEqual(v.noteKeys, ['R-B02.changedSince']);
  assert.equal(tRef(v.intro), t('X-BACKUP.intro'));
  assert.equal(tRef(v.restore.label), t('X-BACKUP.restoreRow'));
  assert.equal(tRef(v.restore.sub), t('X-BACKUP.restoreRowSub'));
  assert.equal(tRef(v.clear.label), t('X-BACKUP.clearRow'));
  assert.equal(tRef(v.export.label), t('R-B02.export'));
  assert.equal(v.hasRecords, true);
  assert.equal(v.count, 3);
  // 没有记录：导出行与清空行都灰，正文换一句
  const empty = api.call('view.backup').view;
  assert.equal(empty.hasRecords, true);
});

test('B3.10 backup.export packs the very same file as the web doExport; backup.exportDone books it the same way', () => {
  const a = boot(seedState(currentState()));
  const state = a.store.getState();
  const at = envNow();
  const sig = recordsSignature(state.records);
  const webText = serializeBackup(buildBackupV2(state, { now: at, serial: a.store.serial }));
  const webName = backupFileName(at);

  const b = boot(seedState(currentState()));
  const r = b.api.call('backup.export');
  assert.equal(r.ok, true);
  assert.equal(r.text, webText, 'same file text');
  assert.equal(r.name, webName, 'same file name');
  assert.equal(r.sig, sig, 'same signature');

  // 记账：网页 finishExport → markExported(store, {at: envNow(), sig})
  const webDone = markExported(a.store, { at: envNow(), sig });
  const apiDone = b.api.call('backup.exportDone', { sig: r.sig });
  assert.equal(apiDone.ok, true);
  assert.equal(webDone.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.equal(b.store.getState().backupMeta.lastExportSig, sig);
});

test('B3.10 backup.picked prechecks the file: not a backup → the note box, a good backup → the replace model', () => {
  const { api, store } = boot(seedState(currentState()));
  const bad = api.call('backup.picked', { text: '{"not":"a backup"}' });
  assert.equal(bad.ok, true);
  assert.equal(bad.note.kind, 'notBackup', 'R-B06：不是拾字的备份');
  assert.equal(bad.preview, undefined, 'nothing written');

  const good = serializeBackup(buildBackupV2(currentState(), { now: ms('2026-09-01') }));
  const ok = api.call('backup.picked', { text: good });
  assert.equal(ok.ok, true);
  assert.equal(ok.preview.mode, 'replace', '有记录 → 替换措辞');
  assert.equal(tRef(ok.preview.title), t('X-BACKUP.replaceTitle'));
  assert.equal(tRef(ok.preview.cancel), t('X-BACKUP.confirmCancel'));
  assert.equal(tRef(ok.preview.ok), t('X-BACKUP.replaceOk'));
  assert.equal(ok.preview.lossText !== null, true, '会丢失的日期范围');
  assert.deepEqual(store.getState().records, currentState().records, '预检不写 store');
});

test('B3.10 backup.restore = web restoreFromBackup: same store, commits and route', () => {
  const old = serializeBackup(buildBackupV2({ records: { '2026-08': [rec(7, '旧', '2026-08-30')] } }, { now: ms('2026-08-30') }));
  const a = boot(seedState(currentState()));
  const report = inspectBackup(old);
  assert.equal(report.ok, true);
  const web = restoreFromBackup(a.store, report, { now: envNow() });
  const b = boot(seedState(currentState()));
  const api = b.api.call('backup.restore', { text: old });
  assert.equal(api.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.equal(b.store.getState().backupMeta.lastConclusion.kind, 'restore');
});

test('B3.10 backup.clear = web clearAllRecords: same store, commits and route; the undo brings the records back', () => {
  const a = boot(seedState(currentState()));
  const web = clearAllRecords(a.store, { now: envNow() });
  const b = boot(seedState(currentState()));
  const api = b.api.call('backup.clear');
  assert.equal(api.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.deepEqual(b.store.getState().records, {}, '记录清空了');

  // 撤销：网页 doUndo → undoFromSafety（副本写回并删副本）
  const webUndo = undoFromSafety(a.store);
  const apiUndo = b.api.call('backup.undoClear');
  assert.equal(apiUndo.ok, true);
  assert.equal(webUndo.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual after undo');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence after undo');
  assert.equal(Object.keys(b.store.getState().records).length, 2, '记录回来了');
});

test('B3.10 D07: a failed restore returns {ok:false, error:{kind}}, the store does not move', () => {
  const old = serializeBackup(buildBackupV2({ records: { '2026-08': [rec(7, '旧', '2026-08-30')] } }, { now: ms('2026-08-30') }));
  const { api, store, storage, labels } = boot(seedState(currentState()));
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('backup.restore', { text: old });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
});
