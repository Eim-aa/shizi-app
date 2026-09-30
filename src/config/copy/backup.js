// 文案 · 备份与恢复、存储不可用（R-B）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-B01（已定）
  'R-B01.undoL1': '已换成备份里的记录',
  'R-B01.undoL2': '离开这一页前可以撤销',
  'R-B01.conclusionRestore': '已换成 {date}备份里的记录，一共 {n} 个字。',
  'R-B01.conclusionClear': '记录已清空。现在没有记录。',
  'R-B01.clearUndoL1': '记录已清空',
  'R-B01.clearUndoL2': '离开这一页前可以撤销',
  // R-B02（已定）
  'R-B02.lastBackupLabel': '上次备份',
  'R-B02.noBackup': '还没有备份',
  'R-B02.noRecords': '现在没有记录。',
  'R-B02.allBackedUp': '现在的记录都已经备份了。',
  'R-B02.changedSince': '上次备份以后记录有改动，还没有备份。',
  'R-B02.export': '导出备份文件',
  // R-B03（已定；K04（写明会丢哪段、危险操作不用主按钮、导出成功反馈、错误样式）边开发边改）
  'R-B03.replaceBody': '这份备份是 {date}的，里面有 {n} 个字的记录。现在 {m} 个字的记录会被替换。离开这一页前可以撤销。',
  'R-B03.restoreTitle': '用这份备份恢复记录？',
  'R-B03.restoreBody': '这份备份是 {date}的，里面有 {n} 个字的记录。',
  'R-B03.restoreBtn': '恢复',
  'R-B03.clearBody': '{n} 个字的记录都会被删掉。离开这一页前可以撤销。',
  'R-B03.restoreRowSub': '离开这一页前可以撤销',
  // R-B04（已定）
  'R-B04.protectFailed': '没能换成备份，你现在的记录没有变。可以再试一次。',
  // R-B05（已定）
  'R-B05.undoFailedRestore': '没能撤销，现在还是备份里的记录',
  'R-B05.undoFailedClear': '没能撤销，记录还是空的',
  'R-B05.undoAgain': '可以再点一次撤销',
  // R-B06（已定）
  'R-B06.cancelled': '没有选文件，你的记录没有变。',
  'R-B06.notBackup': '这个文件不是拾字的备份，没法恢复。你的记录没有变。',
  'R-B06.restoreFailed': '没能恢复，你的记录还是原来的。',
  // R-B09（已定（"怎么解决 ›"那句为原型专用））
  'R-B09.title': '现在存不了记录',
  'R-B09.body': ['可能是存储空间不够，或者浏览器不允许保存。', '解决之前先不能写字，免得写了存不下。'],
  'R-B09.retry': '再试一次',
  // R-B10（已定）
  'R-B10.savedToAlbum': '已保存到相册。',
  'R-B10.albumDenied': '没能存进相册。请到手机设置里允许拾字添加照片。',
  'R-B10.share': '分享',
});
