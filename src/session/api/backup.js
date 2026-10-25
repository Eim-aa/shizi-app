// App API · 备份（B3.10；计划 §3.4、§3.7）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（core/backup.js），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-backup.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.10 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
//   view.backup {}              → {ok, view}：core/backup.js 的 backupView（= 网页备份页渲染用的同一个模型）
//                                 同回包还有 lines（网页量出的折行点，原生照它断行；见 src/platform/text-lines.js）
//   backup.export {}            打包一份备份（网页 doExport 的打包那一半）：回 {name, text, sig, at}，原生拿去分享
//   backup.exportDone {sig}     分享完成，记账「上次备份」（网页 finishExport → markExported）
//   backup.picked {text}        原生选好了文件（网页 shiziBackupPicked 的同一件事）：预检 → 回预览模型或说明框（同回包带 lines）
//   backup.restorePreview {text} 预检（网页 receiveText → inspectBackup）：回预览模型或失败原因
//   backup.restore {text}       确认后替换（网页 runRestore → restoreFromBackup）
//   backup.clear {}             确认后清空（网页 openClear 的 onConfirm → clearAllRecords）
//   backup.undoRestore {}       撤销（网页 doUndo → undoFromSafety）
//   backup.undoClear {}         撤销（同一批函数；副本里记着是哪一种）
//
// 分享与选文件是系统能力，原生直接做（UIActivityViewController / UIDocumentPicker，WebViewController.swift 里已有同一套做法）；
// 校验、结论、撤销与「写 store」全在 core/backup.js，网页与原生调的是同一批函数。

import {
  backupFileName, backupView, buildBackupV2, clearAllRecords, conclusionOfSafety, dropSafety, inspectBackup,
  markExported, recordsSignature, restoreConfirmView, restoreFromBackup, safetyOf, serializeBackup, undoFromSafety,
} from '../../core/backup.js';
import { now as envNow } from '../../platform/env.js';
import { tRef } from '../../config/copy/index.js';
import { textLineStarts } from '../../platform/text-lines.js';

/** store 提交结果 → 回包（D07：失败回 {ok:false, error:{kind}}）；备份的失败还带阶段（保护副本 / 替换 / 清空）。 */
function replyOf(r) {
  if (r && r.ok === false) {
    const error = r.error && typeof r.error === 'object' ? r.error : {};
    const out = { ok: false, error: { kind: String(error.kind || 'generic') } };
    if (r.stage) out.stage = String(r.stage);
    return out;
  }
  return { ok: true };
}

/** 预检一份备份文件 → {ok, preview} 或 {ok:false, error:{kind}}（kind = notBackup / restoreFailed）。 */
function previewOf(state, text) {
  const report = inspectBackup(text);
  if (!report.ok) return { ok: false, error: { kind: report.kind } };
  return { ok: true, preview: restoreConfirmView(state, report) };
}

export const OPS = Object.freeze({
  'view.backup': (args, ctx) => {
    const state = ctx.getStore().getState();
    // 撤销底栏在时的现场结论（网页 live：撤销条在 → 用副本推的结论；不在 → 用 backupMeta.lastConclusion）
    const safety = safetyOf(state);
    const conclusion = safety ? conclusionOfSafety(safety, state) : null;
    const view = backupView(state, { conclusion });
    // 网页量出的折行点（原生要跟网页折在同一处）：正文首句与确认框正文都是 text-wrap: pretty，
    // WebKit 的折法不是贪心折行。量法在网页侧登记（src/ui/screens/mine/backup.js），这里只取结果。
    return {
      ok: true,
      view,
      lines: {
        intro: textLineStarts('backup.intro', tRef(view.intro)),
        clearBody: textLineStarts('backup.confirmBody', tRef(view.clearSheet.body)),
        clearBodyFailed: textLineStarts('backup.confirmBody', tRef(view.clearSheet.failed.body)),
      },
    };
  },

  'backup.export': (args, ctx) => {
    const store = ctx.getStore();
    const state = store.getState();
    if (!state) return { ok: false, error: { kind: 'unavailable' } };
    const at = envNow();
    const sig = recordsSignature(state.records);
    const text = serializeBackup(buildBackupV2(state, { now: at, serial: store.serial }));
    return { ok: true, name: backupFileName(at), text, sig, at };
  },

  'backup.exportDone': (args, ctx) => replyOf(markExported(ctx.getStore(), { at: envNow(), sig: args.sig })),

  'backup.picked': (args, ctx) => {
    const state = ctx.getStore().getState();
    const r = previewOf(state, typeof args.text === 'string' ? args.text : '');
    if (r.ok) {
      // lines：网页量出的折行点（确认框的正文是 text-wrap: pretty，WebKit 的折法不是贪心折行）
      return { ok: true, preview: r.preview, lines: { body: textLineStarts('backup.confirmBody', tRef(r.preview.body)) } };
    }
    // 预检没过：网页显示说明框（R-B04 / R-B06），什么都不写
    return { ok: true, note: { kind: r.error.kind } };
  },

  'backup.restorePreview': (args, ctx) => previewOf(ctx.getStore().getState(), typeof args.text === 'string' ? args.text : ''),

  'backup.restore': (args, ctx) => {
    const store = ctx.getStore();
    const text = typeof args.text === 'string' ? args.text : '';
    const report = inspectBackup(text);
    if (!report.ok) return { ok: false, error: { kind: report.kind } };
    return replyOf(restoreFromBackup(store, report, { now: envNow() }));
  },

  'backup.clear': (args, ctx) => replyOf(clearAllRecords(ctx.getStore(), { now: envNow() })),

  'backup.undoRestore': (args, ctx) => replyOf(undoFromSafety(ctx.getStore())),

  'backup.undoClear': (args, ctx) => replyOf(undoFromSafety(ctx.getStore())),

  // 原生页自己持有撤销条（网页路径由页面状态持有）；这两个 op 让原生页知道「现在有没有可撤销的副本」与「离开这一页就把副本删掉」（D24 / P32）。
  'backup.undoState': (args, ctx) => {
    const safety = safetyOf(ctx.getStore().getState());
    return { ok: true, kind: safety ? (safety.kind === 'clear' ? 'clear' : 'restore') : null };
  },
  'backup.dropSafety': (args, ctx) => replyOf(dropSafety(ctx.getStore())),
});
