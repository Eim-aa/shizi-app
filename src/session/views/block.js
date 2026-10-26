// 阻断页的视图模型（B3.13；网页 src/ui/screens/block/index.js 与 App API 的 view.block 同一组函数）。
//
// 只给文案引用（键 + 参数）与数据，不拼句子（B3.4 规则）：网页用 tRef 渲染、原生用 ShiziCopy 渲染，两边的渲染规则一样。
// 三种来由（blockReasonOf）：
//   'unavailable'  store.status.available=false（探测读 / 写抛错、隐私模式、被禁用）——「再试一次」= store.reload() 重新探测；
//   'blocked'      store.status.blocked（写失败后回滚也失败，storage.js 进入阻断）——内存状态仍在，可导出；
//   'migration'    v1 → v2 导入失败——回滚、不写 meta、v1 键完好、重启可重试。
// 阻断期间只画这一页，不画 tab 与页面栈（写字入口不可达）；不可返回（01 §8.1）。
//
// 引擎不可用时（store 没建成 / WebContent 被回收）这一页仍要能画：原生版不依赖 JS 回包——
// 文案全在 ShiziCopy（构建期生成），来由取 ShiziEngine.status（blocked(reason)），可导出与否由 block.exportable op 补。

import { ref, tRef } from '../../config/copy/index.js';
import { backupFileName, buildBackupV2, judgedCharsOf, serializeBackup } from '../../core/backup.js';
import { measureLines } from './lines.js';

export const BLOCK_SCREEN = 'block';

/** 阻断来由：null（不阻断）| {kind:'unavailable'|'blocked'|'migration', detail}。status 为 null（store 没建成）按不可用处理。 */
export function blockReasonOf(status, migration = null) {
  if (!status) return { kind: 'unavailable', detail: 'no-store' };
  if (!status.available) return { kind: 'unavailable', detail: status.unavailableKind || 'unknown' };
  if (status.blocked) return { kind: 'blocked', detail: status.blocked.reason || 'blocked' };
  if (migration) return { kind: 'migration', detail: migration.reason };
  return null;
}

/** 有没有判断过的字（决定能不能导出备份：内存状态可读且有判断过的字时给「导出备份」）。 */
export function hasJudged(store) {
  try {
    return judgedCharsOf(store.getState().records).size > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 阻断页的视图模型（view.block）：
 *   kind        来由（unavailable / blocked / migration）
 *   canExport   能否导出备份（'blocked' 且内存状态可读且有判断过的字）
 *   still       「再试一次」之后仍不可用：说明句多一句「还是存不了」（S1 三段式）
 *   exportFail  导出没成：就地三段式（说明 + 「先不导出」/「再试一次」）
 */
export function blockView({ kind = 'unavailable', canExport = false, still = false, exportFail = false } = {}) {
  const bodyText = tRef(ref('R-B09.body'));
  const bodyLines = Array.isArray(bodyText) ? bodyText : [bodyText];
  const migrationText = kind === 'migration' ? tRef(ref('X-SYS.blockMigration')) : null;
  const stillText = still ? tRef(ref('X-SYS.blockStill')) : null;
  return {
    kind,
    title: ref('R-B09.title'),
    body: ref('R-B09.body'), // 多行文案（数组值）
    migration: kind === 'migration' ? ref('X-SYS.blockMigration') : null,
    still: still ? ref('X-SYS.blockStill') : null,
    retry: ref('R-B09.retry'),
    export: canExport ? ref('R-B02.export') : null,
    exportFail: exportFail ? { text: ref('X-BACKUP.exportFailed'), cancel: ref('X-BACKUP.exportStay'), retry: ref('R-B09.retry') } : null,
    // 折行点（网页量；见 src/session/views/lines.js）：每一行从第几个字开始。原生按这些位置换行。
    lines: {
      body: bodyLines.map(t => measureLines({ text: t, variant: 'block-line' })),
      migration: migrationText ? measureLines({ text: migrationText, variant: 'block-line' }) : null,
      still: stillText ? measureLines({ text: stillText, variant: 'block-line' }) : null,
    },
  };
}

/**
 * 导出备份的内容（只读：打包内存状态，不写入任何键）。与网页阻断页的「导出备份」是同一个函数。
 * @returns {{name: string, text: string}}
 */
export function blockBackup(store, now = Date.now()) {
  const at = Number.isFinite(now) ? now : Date.now();
  const text = serializeBackup(buildBackupV2(store.getState(), { now: at, serial: store.serial }));
  return { name: backupFileName(at), text };
}
