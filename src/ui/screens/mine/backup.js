// 备份与恢复页（02 M4-4；决定-D24；需求 R12 / O04；04 R-B01–R-B08、T07 状态机、§4.3 边改 K04 / Z04；01 §3.6、§8.1、§9；
// 03 P26 / P32 / P44 / P53；原型 ShiziScreen-第十稿交接版 L166–L171（backup / backupDone）、L205–L210（替换 / 清空确认）、
// 逻辑 L470–L482，可点原型模板 L652–L687 / L763–L778；reference/J-proto-screen.md §2.3.20–2.3.21、§2.3.27–2.3.28）。
//
// registerScreen('backup')（「我的」菜单 MINE_ROUTES.backup、设置页入口按屏名 push；root.js import 本文件，刷新时能恢复）。
//
// 状态机（T07）：
//   顶部状态块 = 「上次备份」+ 日期（还没有备份 / {date}；替换、撤销不改这个日期，K02）+ 状态句（core/backup.js backupStatus：
//     有结论（替换 / 清空之后，撤销底栏还在时是现场结论，离开再进来撤销已失效、留下 backupMeta.lastConclusion，直到下次导出）→ 只写结论句（X03，D24）：
//       清空后「记录已清空。现在没有记录。」、替换后「已换成 {date}备份里的记录，一共 {n} 个字。」——重进时保留，只是不再有已失效的「离开这一页前可以撤销」（03 P183，E9c 改回）；
//     没有结论句时：没有记录 →「现在没有记录。」；从没备份 → 不写（N27）；
//     签名一致 →「现在的记录都已经备份了。」否则「上次备份以后记录有改动，还没有备份。」）。
//   没有记录：导出按钮与「清空所有记录」都灰（disabled + aria-disabled，V07 / Y06），不催导出。
// 导出备份文件：点击处理里同步打包（core/backup.js buildBackupV2）→ platform/share.js 三级（原生 shareBackup → Web Share → 下载）；
//   完成（原生 markBackupExported / Web Share resolve / 下载发起）后一次 commit 记 lastExportAt + 签名并清结论，轻提示（K04「导出成功给反馈」）；
//   取消分享不记（旧版「取消分享不误记」）。
// 从备份文件恢复：原生壳 postMessage pickBackup → shiziBackupPicked(text) / shiziBackupRejected({reason})；网页 <input type=file>。
//   文件取消 / 非备份文件 / 半坏备份 → 说明框（R-B06），什么都不写。
//   通过校验 → 页内确认框（R-B03；有记录「用备份替换现在的记录？」+ 丢失日期范围（P26 / K04）+ 取消 / 替换（危险操作不用主按钮，K04）；
//   没有记录「用这份备份恢复记录？」+ 取消 / 恢复）→ 保护副本（失败 → R-B04 说明框 + 「再试一次」回到确认框，记录不变）
//   → 替换（失败 → 已回滚、删副本 → R-B06「没能恢复」）→ 撤销底栏「已换成备份里的记录 / 离开这一页前可以撤销」。
// 清空所有记录：底部弹层（R-B03 清空正文 + 取消 / 清空）→ 保护副本 → 一次 commit 清空 → 撤销底栏「记录已清空 / …」（P44）；
//   失败（副本或清空）→ 弹层换成「没保存上，记录都还在。」+ 先不清空 / 再试一次。
// 撤销（R-B01 / R-B05）：副本 payload 原样写回并删副本（一次写入）；失败 → 底栏换字（按撤销种类）、仍可再点，副本保留。
//   成功 →「已撤销」2.4s（UndoBar）。
// 撤销寿命（D24 / P32）：直到离开本页（本页不再是最上层页面：返回、切 tab）——离开即删副本；结论已随替换 / 清空写进
//   backupMeta.lastConclusion（与替换同一次写入），离开后状态句仍是结论。刷新 / 进程被杀后仍落在本页 → 按 policy.undoAfterReload
//   （P32 过渡 'resume'）恢复撤销底栏；从别处重新推入本页时遗留的副本视为过期，删掉。
// 底栏排版（R-B08 / Z04）：撤销底栏放在页面底栏区（Page footer，占位 + 安全区），正文在它上方滚动，不靠自动滚动让位。
//
// data-testid（前缀 backup-）：backup-screen（Page；data-state=idle|undo|undone、data-records、data-undo-kind）、backup-status、
//   backup-last-label、backup-last-date（data-day）、backup-status-note（data-keys）、backup-intro、backup-note（data-kind、data-tone）、
//   backup-note-retry、backup-export、backup-list、backup-restore、backup-restore-title、backup-restore-sub、backup-clear、
//   backup-file-input、backup-undo（data-kind / data-state）+ UndoBar 的 undo-bar / undo-button；
//   确认框 backup-restore-confirm（data-mode=replace|restore）、backup-restore-confirm-title / -body / -loss、backup-restore-cancel、
//   backup-restore-ok；清空弹层 backup-clear-sheet（data-state=ask|failed）、backup-clear-body、backup-clear-cancel、backup-clear-ok、
//   backup-clear-stay、backup-clear-retry。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { Chevron } from '../../components/Chevron.js';
import { UndoBar } from '../../components/UndoBar.js';
import { Sheet, useDialogFocus } from '../../components/Sheet.js';
import { FailBlock } from '../../components/FailBlock.js';
import '../../components/Confirm.js'; // .sz-overlay / .sz-confirm 样式
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as policy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow, isNativeShell } from '../../../platform/env.js';
import { postNative, registerNativeHandler } from '../../../platform/bridge.js';
import { shareBackupFile } from '../../../platform/share.js';
import { onShareFailed } from '../../components/share-failed.js'; // P96（M6-6）：注册 shiziShareFailed；备份分享没打开 → 不记导出
import { monthDayParts, isValidDay } from '../../../core/dates.js';
import {
  BACKUP_MAX_BYTES, backupFileName, backupStatus, buildBackupV2, clearAllRecords, conclusionOfSafety, confirmModel,
  dropSafety, inspectBackup, markExported, recordsSignature, restoreFromBackup, safetyMatchesCurrent, safetyOf,
  serializeBackup, STAGES, undoFromSafety, judgedCharsOf,
} from '../../../core/backup.js';

export const BACKUP_SCREEN = 'backup';
export const RESTORE_OVERLAY = 'backup-restore';
export const CLEAR_OVERLAY = 'backup-clear';

// ---------------------------------------------------------------- 文案小工具

/** 界面日期「{month} 月 {day} 日」（R-H02.dateFormat）。 */
export function dateText(day) {
  if (!isValidDay(day)) return '';
  return t('R-H02.dateFormat', monthDayParts(day));
}

/** 状态句一行（core backupStatus 的 {key, vars}）→ 文字。 */
export function lineText(line) {
  if (!line) return '';
  if (line.key === 'R-B01.conclusionRestore') return t(line.key, { date: dateText(line.vars && line.vars.day), n: line.vars ? line.vars.n : 0 });
  return t(line.key, line.vars);
}

/** 说明框（R-B04 / R-B06）的文案键。 */
export const NOTE_KEYS = Object.freeze({
  protectFailed: 'R-B04.protectFailed',
  notBackup: 'R-B06.notBackup',
  restoreFailed: 'R-B06.restoreFailed',
});

/** 撤销底栏两行（R-B01 / R-B05 / P44）。 */
export function undoLines(kind, failed) {
  if (failed) return [t(kind === 'clear' ? 'R-B05.undoFailedClear' : 'R-B05.undoFailedRestore'), t('R-B05.undoAgain')];
  return kind === 'clear' ? [t('R-B01.clearUndoL1'), t('R-B01.clearUndoL2')] : [t('R-B01.undoL1'), t('R-B01.undoL2')];
}

/** 丢失日期范围句（P26 / K04）。 */
export function lossText(loss) {
  if (!loss) return '';
  if (loss.from === loss.to) return t('X-BACKUP.lossDay', { date: dateText(loss.from) });
  return t('X-BACKUP.lossRange', { from: dateText(loss.from), to: dateText(loss.to) });
}

/** 「我的」菜单右侧（R-M03）：上次备份 {date} › / 还没有备份。M4-1 可直接用。 */
export function backupMenuStatus(state) {
  const status = backupStatus(state);
  return status.date.kind === 'never'
    ? { kind: 'never', day: null, text: t('R-M03.noBackup') }
    : { kind: 'day', day: status.date.day, text: t('R-M03.lastBackup', { date: dateText(status.date.day) }) };
}

// ---------------------------------------------------------------- 样式

injectStyles('mine-backup', `
.sz-bk{display:flex;flex-direction:column;gap:${T.groupGap}}
.sz-bk__status{display:flex;flex-direction:column;gap:8px}
.sz-bk__label{font-size:${T.fs13};color:${T.ink3}}
.sz-bk__date{font-family:${T.song};font-size:${T.fs28};font-weight:500;color:${T.ink1}}
.sz-bk__line{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-bk__intro{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-bk__note{display:flex;gap:${T.s3};align-items:flex-start;padding:${T.s3} ${T.s4};border-radius:${T.rCtl};background:${T.field}}
.sz-bk__dot{width:6px;height:6px;margin-top:calc(8px * ${T.k});flex:none;border-radius:50%;background:${T.ink2}}
.sz-bk__note[data-tone="error"] .sz-bk__dot{background:${T.ink1}}
.sz-bk__notetext{flex:1;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-bk__note[data-tone="error"] .sz-bk__notetext{color:${T.ink1}}
.sz-bk__retry.sz-btn--text{min-height:0;margin:-10px 0 -10px 6px;padding:10px 0;display:inline-block;line-height:inherit;vertical-align:baseline;white-space:nowrap}
.sz-bk__export.sz-btn--primary[disabled]{background:${T.field};color:${T.ink4}}
.sz-bk__list{display:flex;flex-direction:column;border-top:${T.hair} solid ${T.line}}
.sz-bk__row.sz-btn{width:100%;min-height:52px;padding:${T.s3} 0;display:flex;align-items:center;justify-content:space-between;gap:${T.s3};
  text-align:left;border-bottom:${T.hair} solid ${T.line}}
.sz-bk__rowl{display:flex;flex-direction:column;gap:3px;min-width:0}
/* 列表行（设计系统 v1）：主文字 17 / 22 墨一，副文字 15 墨三，chevron 8×13 墨四 */
.sz-bk__rowt{font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink1}}
.sz-bk__rows{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3}}
.sz-bk__rowr{flex:none;display:flex}
/* 危险操作（P142）：不变色。危险入口单独成组（与上面的常规行隔开一个组间距，自带上下发丝线）；确认层里取消是主按钮、危险键是次按钮，正文用墨一 */
.sz-bk__row--danger{margin-top:${T.groupGap};border-top:${T.hair} solid ${T.line}}
.sz-bk__danger{box-shadow:inset 0 0 0 1px ${T.ink1}}
.sz-bk__sheetbody[data-state="ask"],.sz-confirm[data-mode="replace"] .sz-confirm__body{color:${T.ink1}}
.sz-bk__row[disabled] .sz-bk__rowt{color:${T.ink4}}
.sz-bk__file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden}
.sz-bk__undo{position:relative;margin:0 -8px}
.sz-bk__undo .sz-undobar{position:relative;left:auto;right:auto;bottom:auto}
.sz-bk__sheetbody{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-bk__actions{margin-top:4px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-bk__loss{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink1}}
`);

// ---------------------------------------------------------------- store / router 小工具

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(() => {
    const st = storeOrNull();
    return st ? st.getState() : null;
  });
  useEffect(() => {
    const st = storeOrNull();
    if (!st) return undefined;
    setState(st.getState());
    return st.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 本页是不是刷新 / 冷启动时由 history 恢复出来的（P32「重载后仍在备份页」）。 */
function mountedByRestore(entryId) {
  const router = getRouter();
  const snap = router ? router.getState() : null;
  const tr = snap && snap.transition;
  return !!tr && tr.cause === 'restore' && !!tr.to && tr.to.id === entryId;
}

// ---------------------------------------------------------------- 原生桥与挂着的页面

// 挂着的备份页（最多一个）：{picked(text), rejected(info)}；没挂时原生回调先存着，推入本页后交付。
let livePage = null;
let pendingNative = null;
// 进行中的导出（原生壳等 markBackupExported）：{sig}。
let pendingExport = null;

function openBackupIfNeeded() {
  const router = getRouter();
  if (!router || !getScreen(BACKUP_SCREEN)) return;
  const snap = router.getState();
  if (snap.top && snap.top.n === BACKUP_SCREEN) return;
  nav.push(BACKUP_SCREEN, {});
}

/** 原生 shiziBackupPicked(text) / 测试：把选到的文件文本交给备份页（没挂着就先推入本页）。 */
export function receivePickedText(text) {
  if (livePage) {
    livePage.picked(typeof text === 'string' ? text : '');
    return true;
  }
  pendingNative = { type: 'picked', arg: typeof text === 'string' ? text : '' };
  openBackupIfNeeded();
  return true;
}

/** 原生 shiziBackupRejected({reason:'tooLarge'|'invalid'|'cancelled'})。 */
export function receivePickRejected(info) {
  const reason = info && typeof info.reason === 'string' ? info.reason : 'invalid';
  if (livePage) {
    livePage.rejected(reason);
    return true;
  }
  pendingNative = { type: 'rejected', arg: reason };
  openBackupIfNeeded();
  return true;
}

/** 导出完成记账（页面上的「上次备份」与状态句随之更新，不弹提示，D58 / I3 P0-09）。 */
function finishExport(sig) {
  const store = storeOrNull();
  if (!store) return false;
  const r = markExported(store, { at: envNow(), sig });
  return !!(r && r.ok);
}

/** 原生 markBackupExported()：系统分享面板完成（取消不回调）。 */
export function receiveExported() {
  const sig = pendingExport ? pendingExport.sig : null;
  pendingExport = null;
  return finishExport(sig);
}

registerNativeHandler('shiziBackupPicked', receivePickedText);
registerNativeHandler('shiziBackupRejected', receivePickRejected);
registerNativeHandler('markBackupExported', receiveExported);
// P96（M6-6）：原生分享面板没打开（shiziShareFailed kind=backup）→ 这次导出作废，轻提示由 share-failed.js 发。
onShareFailed(kind => {
  if (kind === 'backup') pendingExport = null;
});

// ---------------------------------------------------------------- 确认框与清空弹层

let dialogSeq = 0;

/** 替换 / 恢复确认框（居中；root 注入 close / active）。不预选按钮。 */
export function RestoreConfirm({ model, onConfirm, close, active = true }) {
  const panelRef = useRef(null);
  const idsRef = useRef(null);
  if (!idsRef.current) {
    dialogSeq += 1;
    idsRef.current = { title: `sz-bk-title-${dialogSeq}`, body: `sz-bk-body-${dialogSeq}` };
  }
  useDialogFocus(panelRef, active);
  const ids = idsRef.current;
  const replace = model.mode === 'replace';
  const date = dateText(model.day);
  const body = replace ? t('R-B03.replaceBody', { date, n: model.n, m: model.m }) : t('R-B03.restoreBody', { date, n: model.n });
  const loss = replace ? lossText(model.loss) : '';
  const cancel = () => close && close();
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid="backup-restore-confirm"
      data-mode=${model.mode} aria-labelledby=${ids.title} aria-describedby=${ids.body}>
      <h2 class="sz-confirm__title" id=${ids.title} data-testid="backup-restore-confirm-title">${
        t(replace ? 'X-BACKUP.replaceTitle' : 'R-B03.restoreTitle')}</h2>
      <div id=${ids.body}>
        <p class="sz-confirm__body" data-testid="backup-restore-confirm-body">${body}</p>
        ${loss ? html`<p class="sz-bk__loss" data-testid="backup-restore-confirm-loss" data-from=${model.loss.from} data-to=${model.loss.to}>${loss}</p>` : null}
      </div>
      <div class="sz-confirm__actions">
        <${Button} variant=${replace ? 'primary' : 'secondary'} data-testid="backup-restore-cancel" onClick=${cancel}>${t('X-BACKUP.confirmCancel')}</${Button}>
        ${replace
          ? html`<${Button} variant="secondary" class="sz-bk__danger" data-testid="backup-restore-ok" onClick=${() => onConfirm && onConfirm()}>${t('X-BACKUP.replaceOk')}</${Button}>`
          : html`<${Button} variant="primary" data-testid="backup-restore-ok" onClick=${() => onConfirm && onConfirm()}>${t('R-B03.restoreBtn')}</${Button}>`}
      </div>
    </div>
  </div>`;
}

/** 清空确认底部弹层（原型 L208）；failed 时换成「没保存上，记录都还在。」+ 先不清空 / 再试一次。 */
export function ClearSheet({ n, failed = false, onConfirm, close, active = true }) {
  const cancel = () => close && close();
  return html`<${Sheet} title=${t('X-BACKUP.clearTitle')} onClose=${cancel} active=${active} testid="backup-clear-sheet" dismiss="own">
    <p class="sz-bk__sheetbody" data-testid="backup-clear-body" data-state=${failed ? 'failed' : 'ask'} role=${failed ? 'alert' : undefined}>${
      failed ? t('X-BACKUP.clearFailed') : t('R-B03.clearBody', { n })}</p>
    <div class="sz-bk__actions">
      ${failed
        ? html`${FailBlock({ layout: 'dialog', text: '', testid: 'backup-clear-fail', cancelTestid: 'backup-clear-stay', retryTestid: 'backup-clear-retry', cancelLabel: t('X-BACKUP.clearStay'), retryLabel: t('X-BACKUP.retry'), onCancel: cancel, onRetry: () => onConfirm && onConfirm() })}`
        : html`<${Button} variant="primary" data-testid="backup-clear-cancel" onClick=${cancel}>${t('X-BACKUP.confirmCancel')}</${Button}>
            <${Button} variant="secondary" class="sz-bk__danger" data-testid="backup-clear-ok" onClick=${() => onConfirm && onConfirm()}>${t('X-BACKUP.clearOk')}</${Button}>`}
    </div>
  </${Sheet}>`;
}

// ---------------------------------------------------------------- 页面

function BackupScreen({ entry }) {
  const entryId = entry && entry.id;
  const state = useStoreState();
  const [note, setNote] = useState(null); // {kind:'protectFailed'|'notBackup'|'restoreFailed', retry?:boolean}
  const [undo, setUndo] = useState(null); // {kind:'restore'|'clear', failed:boolean, done:boolean}
  const [exportFail, setExportFail] = useState(false); // 导出没成（网页分享 / 下载都不行、或出错）：就地三段式（S1，审计 P1-30）
  const pendingRef = useRef(null); // 保护副本失败后「再试一次」要用的那份备份（inspectBackup 结果）
  const fileRef = useRef(null);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const handlersRef = useRef(null); // 原生回调交给最新一次渲染的处理函数

  // ---- 恢复流程
  const runRestore = report => {
    const store = storeOrNull();
    if (!store) return;
    const had = safetyOf(store.getState());
    const result = restoreFromBackup(store, report, { now: envNow() });
    if (result.ok) {
      pendingRef.current = null;
      setNote(null);
      setUndo({ kind: 'restore', failed: false, done: false });
      return;
    }
    if (result.stage === STAGES.safety) {
      pendingRef.current = report;
      setNote({ kind: 'protectFailed', retry: true });
      return;
    }
    pendingRef.current = report; // 三段式「再试一次」用同一份备份（S1，审计 P1-28：原先没有再试）
    setNote({ kind: 'restoreFailed', retry: true });
    if (had && !safetyOf(store.getState())) setUndo(null); // 上一轮的撤销随副本一起没了
  };

  const openConfirm = report => {
    const store = storeOrNull();
    const model = confirmModel(store ? store.getState() : null, report, { showLoss: policy.replaceConfirmShowsLostRange !== false });
    let overlayId = null;
    let done = false;
    const onConfirm = () => {
      if (done) return;
      done = true;
      nav.closeOverlay(overlayId);
      runRestore(report);
    };
    overlayId = nav.openOverlay(RestoreConfirm, { model, onConfirm }, { name: RESTORE_OVERLAY });
  };

  const receiveText = text => {
    const report = inspectBackup(text);
    if (!report.ok) {
      pendingRef.current = null;
      setNote({ kind: report.kind });
      return;
    }
    setNote(null);
    openConfirm(report);
  };

  const receiveRejected = reason => {
    pendingRef.current = null;
    setNote(reason === 'cancelled' ? null : { kind: 'notBackup' }); // 自己点了取消：什么都不显示（D58 / I3 P0-12）
  };

  handlersRef.current = { picked: text => receiveText(text), rejected: reason => receiveRejected(reason) };

  const pick = () => {
    setNote(null);
    pendingRef.current = null;
    if (isNativeShell() && postNative('pickBackup', {})) return; // 结果经 shiziBackupPicked / shiziBackupRejected 回来
    const input = fileRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  const onFile = async event => {
    const input = event.currentTarget;
    const file = input && input.files && input.files[0];
    if (!file) {
      setNote(null); // 没选文件 = 用户取消，不显示说明
      return;
    }
    if (file.size > BACKUP_MAX_BYTES) {
      setNote({ kind: 'notBackup' });
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch (error) {
      setNote({ kind: 'notBackup' });
      return;
    }
    receiveText(text);
  };

  const retry = () => {
    const report = pendingRef.current;
    setNote(null);
    if (report) openConfirm(report);
  };

  // ---- 清空
  const openClear = () => {
    const store = storeOrNull();
    if (!store) return;
    const n = judgedCharsOf(store.getState().records).size;
    if (!n) return;
    let overlayId = null;
    let done = false;
    const onConfirm = () => {
      if (done) return;
      const s = storeOrNull();
      const result = s ? clearAllRecords(s, { now: envNow() }) : { ok: false };
      if (result.ok) {
        done = true;
        nav.closeOverlay(overlayId);
        setNote(null);
        setUndo({ kind: 'clear', failed: false, done: false });
        return;
      }
      if (s && !safetyOf(s.getState()) && undoRef.current) setUndo(null);
      nav.updateOverlay(overlayId, { failed: true });
    };
    overlayId = nav.openOverlay(ClearSheet, { n, failed: false, onConfirm }, { name: CLEAR_OVERLAY });
  };

  // ---- 撤销
  const doUndo = () => {
    const store = storeOrNull();
    const cur = undoRef.current;
    if (!store || !cur || cur.done) return;
    const result = undoFromSafety(store);
    if (result.ok) setUndo({ kind: cur.kind, failed: false, done: true });
    else setUndo({ kind: cur.kind, failed: true, done: false });
  };

  // ---- 导出
  const doExport = () => {
    const store = storeOrNull();
    if (!store) return;
    const s = store.getState();
    if (!judgedCharsOf(s.records).size) return;
    const at = envNow();
    const sig = recordsSignature(s.records);
    const text = serializeBackup(buildBackupV2(s, { now: at, serial: store.serial }));
    pendingExport = { sig };
    setExportFail(false);
    shareBackupFile({ name: backupFileName(at), text }).then(res => {
      if (res.via === 'native') return; // 等 markBackupExported
      if (pendingExport && pendingExport.sig === sig) pendingExport = null;
      if (res.done) finishExport(sig);
      else if (!res.cancelled) setExportFail(true); // 用户自己取消不算失败（F3：不出说明）
    }, () => {
      pendingExport = null;
      setExportFail(true);
    });
  };

  // ---- 挂载：P32 恢复撤销底栏 / 删过期副本；交付挂载前到达的原生回调
  useEffect(() => {
    const store = storeOrNull();
    if (store) {
      const st = store.getState();
      const safety = safetyOf(st);
      if (safety) {
        const resume = policy.undoAfterReload === 'resume' && mountedByRestore(entryId) && !safetyMatchesCurrent(st);
        if (resume) setUndo({ kind: safety.kind === 'clear' ? 'clear' : 'restore', failed: false, done: false });
        else dropSafety(store);
      }
    }
    const mine = { picked: text => handlersRef.current.picked(text), rejected: reason => handlersRef.current.rejected(reason) };
    livePage = mine;
    // 原生分享面板没打开（shiziShareFailed kind=backup）：本页还在屏上 → 就地三段式，不另出提示条（F3 ①，审计 P1-30）
    const offShare = onShareFailed(kind => {
      if (kind !== 'backup') return false;
      setExportFail(true);
      return true;
    });
    if (pendingNative) {
      const p = pendingNative;
      pendingNative = null;
      if (p.type === 'picked') receiveText(p.arg);
      else receiveRejected(p.arg);
    }
    return () => {
      offShare();
      if (livePage === mine) livePage = null;
    };
  }, []);

  // ---- 离开本页（本页不再是最上层页面；遮罩不算）→ 撤销失效、删副本（D24 / 01 §9）
  useEffect(() => {
    const router = getRouter();
    if (!router || !entryId) return undefined;
    return router.subscribe(snap => {
      if (snap.top && snap.top.id === entryId) return;
      const store = storeOrNull();
      if (store && safetyOf(store.getState())) dropSafety(store);
      if (undoRef.current) setUndo(null);
      setNote(null);
      pendingRef.current = null;
    });
  }, [entryId]);

  const live = undo && !undo.done ? conclusionOfSafety(safetyOf(state), state) : null;
  // D24 / 03 P183：撤销底栏还在时用现场结论（live）；离开再进来留下 backupMeta.lastConclusion（结论句保留到下次导出）；没有结论句才按现在的记录与上次导出时间算。
  // 已失效的「离开这一页前可以撤销」不再出现：没有记录时「从备份文件恢复」下面不放它（Q2-8 留下的这一半保留）。
  const status = backupStatus(state, { conclusion: live });
  const undoOn = !!undo && !undo.done;
  const has = status.hasRecords;
  const lines = status.lines.map(lineText);
  const noteTone = 'error';
  const [l1, l2] = undo ? undoLines(undo.kind, undo.failed) : ['', ''];

  const footer = undo
    ? html`<div class="sz-bk__undo" data-testid="backup-undo" data-kind=${undo.kind} data-state=${undo.done ? 'done' : undo.failed ? 'failed' : 'on'}>
        <${UndoBar} line1=${l1} line2=${l2} onUndo=${doUndo} done=${undo.done}
          onDoneEnd=${() => setUndo(u => (u && u.done ? null : u))} />
      </div>`
    : null;

  return html`<${Page} title=${t('R-M03.backup')} testid="backup-screen" footer=${footer}>
    <div class="sz-bk" data-testid="backup-body" data-state=${undo ? (undo.done ? 'undone' : 'undo') : 'idle'}
      data-records=${status.count} data-undo-kind=${undo ? undo.kind : ''}>
      <div class="sz-bk__status" data-testid="backup-status">
        <span class="sz-bk__label" data-testid="backup-last-label">${t('R-B02.lastBackupLabel')}</span>
        <span class="sz-bk__date" data-testid="backup-last-date" data-day=${status.date.kind === 'day' ? status.date.day : ''}>${
          status.date.kind === 'day' ? dateText(status.date.day) : t('R-B02.noBackup')}</span>
        ${lines.length ? html`<span class="sz-bk__line" data-testid="backup-status-note" role="status"
          data-keys=${status.lines.map(l => l.key).join(' ')}>${lines.join('')}</span>` : null}
      </div>
      ${undoOn ? null : html`<p class="sz-bk__intro" data-testid="backup-intro">${t(has ? 'X-BACKUP.intro' : 'X-BACKUP.introEmpty')}</p>`}
      ${note && note.retry
        ? html`<div class="sz-bk__note" data-testid="backup-note" data-kind=${note.kind} data-tone="error">
            ${FailBlock({ testid: 'backup-note-fail', noteTestid: 'backup-note-text', retryTestid: 'backup-note-retry', cancelTestid: 'backup-note-cancel', text: t(NOTE_KEYS[note.kind]), retryLabel: t('X-BACKUP.retry'), cancelLabel: t('X-BACKUP.restoreStay'), onRetry: retry, onCancel: () => { pendingRef.current = null; setNote(null); } })}
          </div>`
        : note ? html`<div class="sz-bk__note" data-testid="backup-note" data-kind=${note.kind} data-tone=${noteTone}
          role=${noteTone === 'error' ? 'alert' : 'status'}>
          <span class="sz-bk__dot" aria-hidden="true"></span>
          <span class="sz-bk__notetext">${t(NOTE_KEYS[note.kind])}</span>
        </div>` : null}
      ${exportFail && has
        ? html`${FailBlock({ testid: 'backup-export-fail', text: t('X-BACKUP.exportFailed'), cancelLabel: t('X-BACKUP.exportStay'), onCancel: () => setExportFail(false), onRetry: doExport })}`
        : html`<${Button} variant="primary" class="sz-bk__export" data-testid="backup-export" disabled=${!has} onClick=${doExport}>${t('R-B02.export')}</${Button}>`}
      <div class="sz-bk__list" data-testid="backup-list" data-bk-end="1">
        <${Button} variant="plain" class="sz-bk__row" data-testid="backup-restore" aria-haspopup="dialog" onClick=${pick}>
          <span class="sz-bk__rowl">
            <span class="sz-bk__rowt" data-testid="backup-restore-title">${t('X-BACKUP.restoreRow')}</span>
            ${undoOn || !has ? null : html`<span class="sz-bk__rows" data-testid="backup-restore-sub">${t('X-BACKUP.restoreRowSub')}</span>`}
          </span>
          <span class="sz-bk__rowr" aria-hidden="true"><${Chevron} /></span>
        </${Button}>
        <${Button} variant="plain" class="sz-bk__row sz-bk__row--danger" data-testid="backup-clear" disabled=${!has}
          aria-haspopup="dialog" onClick=${openClear}>
          <span class="sz-bk__rowl"><span class="sz-bk__rowt">${t('X-BACKUP.clearRow')}</span></span>
        </${Button}>
      </div>
      <input ref=${fileRef} class="sz-bk__file" type="file" accept="application/json,.json" tabindex="-1" aria-hidden="true"
        data-testid="backup-file-input" onChange=${onFile} onCancel=${() => setNote(null)} />
    </div>
  </${Page}>`;
}

registerScreen(BACKUP_SCREEN, BackupScreen, { label: t('R-M03.backup') });

/** 推入备份与恢复页。 */
export function openBackup() {
  nav.push(BACKUP_SCREEN, {});
}
