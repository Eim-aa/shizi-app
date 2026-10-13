// 文案 · 备份与恢复、存储不可用（R-B）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-B01（已定）
  'R-B01.undoL1': '已换成备份里的记录',
  'R-B01.undoL2': '离开这一页前可以撤销',
  'R-B01.conclusionRestore': '已恢复 {date}的备份，共 {n} 个字。',
  'R-B01.conclusionClear': '记录已清空。现在没有记录。',
  'R-B01.clearUndoL1': '记录已清空',
  'R-B01.clearUndoL2': '离开这一页前可以撤销',
  // R-B02（已定）
  'R-B02.lastBackupLabel': '上次备份',
  'R-B02.noBackup': '还没有备份',
  'R-B02.noRecords': '现在没有记录。',
  'R-B02.allBackedUp': '记录都已备份。',
  'R-B02.changedSince': '上次备份后又有新记录，还没备份。',
  'R-B02.export': '导出备份',
  // R-B03（已定；K04（写明会丢哪段、危险操作不用主按钮、导出成功反馈、错误样式）边开发边改）
  'R-B03.replaceBody': '备份有 {n} 个字，现有 {m} 个字将被替换。',
  'R-B03.restoreTitle': '恢复备份',
  'R-B03.restoreBody': '{date}的备份，共 {n} 个字。',
  'R-B03.restoreBtn': '恢复',
  'R-B03.clearBody': '{n} 个字的记录会删掉，离开前可撤销。',
  'R-B03.restoreRowSub': '离开这一页前可以撤销',
  // R-B04（已定）
  'R-B04.protectFailed': '没换成，现有记录没变。可以再试。',
  // R-B05（已定）
  'R-B05.undoFailedRestore': '没能撤销，现在还是备份里的记录',
  'R-B05.undoFailedClear': '没能撤销，记录还是空的',
  'R-B05.undoAgain': '可以再点一次撤销',
  // R-B06（已定）
  'R-B06.notBackup': '这不是拾字的备份，记录没有变。',
  'R-B06.restoreFailed': '没能恢复，你的记录还是原来的。',
  // R-B09（已定（"怎么解决 ›"那句为原型专用））
  'R-B09.title': '无法保存',
  'R-B09.body': ['可能是空间不够，或浏览器不让保存。', '解决前暂不能写字，免得白写。'],
  'R-B09.retry': '再试一次',
  // R-B10（已定）
  'R-B10.savedToAlbum': '已保存到相册。',
  'R-B10.albumDenied': '没存进相册。请在手机设置允许添加照片。',
  'R-B10.share': '分享',
  // X-BACKUP（M4-4 备份页：原型 ShiziScreen L166–L171 / L205–L210 里 04 没收录的字样；丢失范围句 P26 / 边改 K04；导出反馈待文案 P55）
  'X-BACKUP.intro': '记录只在这台手机上，换手机前先导出备份。',
  'X-BACKUP.introEmpty': '记录只存在这台手机上。',
  'X-BACKUP.restoreRow': '恢复备份',
  'X-BACKUP.restoreRowSub': '会替换现有记录，离开前可撤销',
  'X-BACKUP.clearRow': '清空记录',
  'X-BACKUP.retry': '再试一次',
  'X-BACKUP.replaceTitle': '替换记录？',
  'X-BACKUP.confirmCancel': '取消',
  'X-BACKUP.replaceOk': '替换',
  'X-BACKUP.lossRange': '{from}到 {to}的记录会丢失，建议先导出。',
  'X-BACKUP.lossDay': '{date}的记录会丢失，建议先导出。',
  'X-BACKUP.clearTitle': '清空记录？',
  'X-BACKUP.clearOk': '清空',
  'X-BACKUP.clearFailed': '没保存上，记录都还在。',
  'X-BACKUP.clearStay': '先不清空',
  'X-BACKUP.restoreStay': '先不恢复',
  'X-BACKUP.exportFailed': '备份文件没导出来，你的记录都还在。',
  'X-BACKUP.exportStay': '先不导出',
  // X-BACKUP.fileName（阶段 1 Q2-7，03 P182）：导出的备份文件名，{ymd} = 本地日 YYYY-MM-DD
  'X-BACKUP.fileName': '拾字备份-{ymd}.json',
});
