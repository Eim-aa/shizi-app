// QA 的「用户选中的文件」是一个不是备份文件的文本（预检拒收：网页侧 R-B06.notBackup，原生侧同一张说明框）。
// window.__qaBackupPick = {text}：原生备份页（QA 运行）写成临时文件后走正式预检；网页侧用步骤里的 js 经 window.shiziBackupPicked(text)。a: {}
window.__qaBackupPick = { text: '{"not":"a backup"}' };
