// 把「当前数据」打成备份文件文本，放进 QA 的「用户选中的文件」通道（window.__qaBackupPick）。
// 网页路径仍用 window.__qaBackupText（步骤里的 js 经 window.shiziBackupPicked(text) 送进备份页）；
// 原生备份页（QA 运行）读 window.__qaBackupPick，写成临时文件后走与系统选择器同一条预检。
// 用法：先 seed 一份数据 → stashBackupPick → 再 reset 并 seed 另一份（「现在的记录」），这样替换确认框里有「会丢失的日期范围」。a: {}
const { buildBackupV2, serializeBackup } = await import('/src/core/backup.js');
const { getStore } = await import('/src/store/store.js');
const st = getStore().getState();
const text = serializeBackup(buildBackupV2(st, { now: Date.parse('2026-10-22T09:00:00') }));
window.__qaBackupText = text;
window.__qaBackupPick = { text };
