// QA 的「用户选中的文件」是一个超过 64MB 上限的文件（预检拒收：tooLarge → 网页侧 R-B06.notBackup，原生侧同一张说明框）。
// window.__qaBackupPick = {bytes}：原生备份页（QA 运行）造一个这么大的稀疏文件，再走正式预检（按真实文件大小判）。a: {bytes?}
// 默认取 64MB + 1（WebViewController.backupMaxBytes + 1，与原生正式上限一致）。
const bytes = typeof a.bytes === 'number' ? a.bytes : 64 * 1024 * 1024 + 1;
window.__qaBackupPick = { bytes };
