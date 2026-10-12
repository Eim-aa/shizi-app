// M5-6 存储不可用阻断页（R-B09；01 §4「存储不可用 → 阻断页，不允许写字」；01 §8.1 阻断页不可返回）。
//
// 三种来由（blockReasonOf）：
//   'unavailable'  store.status.available=false（探测读/写抛错、隐私模式、被禁用）——「再试一次」= store.reload() 重新探测；
//   'blocked'      store.status.blocked（写失败后回滚也失败，storage.js 进入阻断）——内存状态仍在，可导出；
//                  「再试一次」= 整页重新启动（阻断直到重启；下次启动 repair() 按活的 txn 回滚）；
//   'migration'    迁移变体：v1 → v2 导入失败（01 §12：回滚、不写 meta、v1 键完好、重启可重试）。
//                  由迁移方（M5-4 / app.js）调用 reportMigrationFailure(info) 置上；「再试一次」= 整页重新启动。
// 阻断期间 ui/root.js 只画本页，不画 tab 与页面栈 —— 写字入口不可达。
// 导出入口（可用时）：存储可读且有判断过的字（'blocked' 变体）时给「导出备份」，只打包内存状态，不写入。
//
// 文案：R-B09 三槽（copy/backup.js）；迁移变体补一句 X-SYS.blockMigration（P55 待文案）。
import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { t } from '../../../config/copy/index.js';
import { Button } from '../../components/Button.js';
import { announce } from '../../components/Toast.js';
import { FailBlock } from '../../components/FailBlock.js';
import { injectStyles, T } from '../../components/styles.js';
import { setBackGestureEnabled } from '../../../platform/bridge.js';
import { backGestureAllowed, getRouter } from '../../router.js';
import { now as envNow } from '../../../platform/env.js';
import { backupFileName, buildBackupV2, judgedCharsOf, serializeBackup } from '../../../core/backup.js';

// ---------------------------------------------------------------- 状态

let migrationFailure = null; // null 或 {reason}
const listeners = new Set();

function publish() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (error) {
      // 订阅者异常不影响
    }
  }
}

/** 迁移失败时由迁移方调用（M5-4）。之后根组件画迁移变体的阻断页，直到重新启动。 */
export function reportMigrationFailure(info = {}) {
  migrationFailure = { reason: info && info.reason ? String(info.reason) : 'unknown' };
  publish();
}

/** 测试 / 重新启动前清掉迁移失败标记。 */
export function clearMigrationFailure() {
  if (!migrationFailure) return;
  migrationFailure = null;
  publish();
}

/**
 * 当前阻断来由：null（不阻断）| {kind:'unavailable'|'blocked'|'migration', detail}。
 * @param {object|null} status  store.status；store 没建成（null）按不可用处理。
 */
export function blockReasonOf(status, migration = migrationFailure) {
  if (!status) return { kind: 'unavailable', detail: 'no-store' };
  if (!status.available) return { kind: 'unavailable', detail: status.unavailableKind || 'unknown' };
  if (status.blocked) return { kind: 'blocked', detail: status.blocked.reason || 'blocked' };
  if (migration) return { kind: 'migration', detail: migration.reason };
  return null;
}

function sameReason(a, b) {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.detail === b.detail;
}

/**
 * 根组件用：订阅 store 状态与迁移标记，返回当前阻断来由（null = 正常）与 store。
 * 首帧按同步可得的 store 判断（app.js 在挂根组件前已 bootStore），避免先闪一帧 tab。
 */
export function useBlockReason(getStoreSync) {
  const read = () => {
    let store = null;
    try {
      store = getStoreSync ? getStoreSync() : null;
    } catch (error) {
      store = null;
    }
    return { store, reason: blockReasonOf(store ? store.status : null) };
  };
  const [snap, setSnap] = useState(read);
  useEffect(() => {
    const sync = () => setSnap(prev => {
      const next = read();
      return next.store === prev.store && sameReason(next.reason, prev.reason) ? prev : next;
    });
    listeners.add(sync);
    const off = snap.store && typeof snap.store.subscribe === 'function' ? snap.store.subscribe(sync) : null;
    sync();
    return () => {
      listeners.delete(sync);
      if (off) off();
    };
  }, [snap.store]);
  return snap;
}

// ---------------------------------------------------------------- 页面

injectStyles('block', `
.sz-block{flex:1;min-height:0;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;justify-content:center;
  gap:${T.groupGap};padding:calc(${T.s8} + env(safe-area-inset-top, 0px)) ${T.gutter} calc(${T.s8} + env(safe-area-inset-bottom, 0px));
  background:${T.paper};color:${T.ink1}}
.sz-block__title{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1}}
.sz-block__title:focus{outline:none}
.sz-block__body{display:flex;flex-direction:column;gap:8px}
.sz-block__line{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-block__actions{display:flex;flex-direction:column;gap:12px}
`);

function hasJudged(store) {
  try {
    return judgedCharsOf(store.getState().records).size > 0;
  } catch (error) {
    return false;
  }
}

/**
 * @param {{reason: {kind:string, detail:string}, store: object|null, win?: Window}} props
 */
export function BlockScreen({ reason, store, win = typeof window !== 'undefined' ? window : null }) {
  const [busy, setBusy] = useState(false);
  const [still, setStill] = useState(false); // 「再试一次」之后仍不可用：说明句换成「还是存不了」（S1，审计 P1-31：原先没有任何反馈）
  const [exportFail, setExportFail] = useState(false); // 导出没成：就地三段式（审计 P1-31）
  const kind = reason ? reason.kind : 'unavailable';
  const canExport = kind === 'blocked' && !!store && store.status.available && hasJudged(store);

  // 阻断页不可返回（01 §7）；离开时交还按栈的值（tab 根页 false、子页 true；写字页会再自己设，根组件也会再同步一次）。
  useEffect(() => {
    setBackGestureEnabled(false);
    return () => {
      const router = getRouter();
      setBackGestureEnabled(router ? backGestureAllowed(router.getState()) : true);
    };
  }, []);

  // 读屏与键盘：焦点落到标题。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector('[data-testid="block-title"]');
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, [kind]);

  const retry = () => {
    if (busy) return;
    if (kind === 'unavailable' && store && typeof store.reload === 'function') {
      setBusy(true);
      try {
        store.reload(); // 重新探测；恢复后 store 通知 → 根组件换回 tab
      } catch (error) {
        // 仍不可用：留在本页
      }
      setBusy(false);
      if (!(store.status && store.status.available)) {
        setStill(true);
        announce(t('X-SYS.blockStill'));
      }
      return;
    }
    // 'blocked' / 'migration' / 没有 store：整页重新启动（阻断状态只在重启后解除；迁移在启动时重试）
    if (win && win.location && typeof win.location.reload === 'function') win.location.reload();
  };

  const doExport = async () => {
    if (!canExport) return;
    setExportFail(false);
    try {
      const share = await import('../../../platform/share.js');
      const at = envNow();
      const text = serializeBackup(buildBackupV2(store.getState(), { now: at, serial: store.serial }));
      const res = await share.shareBackupFile({ name: backupFileName(at), text });
      // 导出成功不提示（F5，I3 P0-09）：系统分享面板 / 下载本身就是反馈
      if (res && !res.done && !res.cancelled && res.via !== 'native') setExportFail(true);
    } catch (error) {
      setExportFail(true); // 原先被吞：就地三段式
    }
  };

  const lines = t('R-B09.body');
  return html`<section class="sz-block" role="alertdialog" aria-modal="true" aria-labelledby="sz-block-title"
    data-testid="block-screen" data-block-kind=${kind}>
    <h1 class="sz-block__title" id="sz-block-title" tabindex="-1" data-testid="block-title" data-page-title>${t('R-B09.title')}</h1>
    <div class="sz-block__body" data-testid="block-body">
      ${(Array.isArray(lines) ? lines : [lines]).map(line => html`<p class="sz-block__line">${line}</p>`)}
      ${kind === 'migration' ? html`<p class="sz-block__line" data-testid="block-migration">${t('X-SYS.blockMigration')}</p>` : null}
      ${still ? html`<p class="sz-block__line" data-testid="block-still">${t('X-SYS.blockStill')}</p>` : null}
    </div>
    <div class="sz-block__actions">
      <${Button} variant="primary" data-testid="block-retry" disabled=${busy} onClick=${retry}>${t('R-B09.retry')}</${Button}>
      ${canExport && exportFail
        ? html`${FailBlock({ testid: 'block-export-fail', text: t('X-BACKUP.exportFailed'), cancelLabel: t('X-BACKUP.exportStay'), onCancel: () => setExportFail(false), onRetry: doExport })}`
        : canExport ? html`<${Button} variant="secondary" data-testid="block-export" onClick=${doExport}>${t('R-B02.export')}</${Button}>` : null}
    </div>
  </section>`;
}
