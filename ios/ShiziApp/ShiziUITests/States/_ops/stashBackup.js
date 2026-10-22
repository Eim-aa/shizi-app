// 把「当前数据」打成备份文件文本，存在 window.__qaBackupText（之后的步骤里 js 用它当「选中的备份文件」，经 window.shiziBackupPicked(text) 送进备份页，与原生文件选择器回包同一个入口）。
// 用法：先 seed 一份数据 → stashBackup → 再 reset 并 seed 另一份（「现在的记录」），这样替换确认框里有「会丢失的日期范围」。a: {}
const { buildBackupV2, serializeBackup } = await import('/src/core/backup.js');
const { getStore } = await import('/src/store/store.js');
const st = getStore().getState();
window.__qaBackupText = serializeBackup(buildBackupV2(st, { now: Date.parse('2026-10-22T09:00:00') }));
