// 文案 · 我的、练习记录、年度报告（R-M、R-P）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-M01（已定）
  'R-M01.week': '这一周',
  'R-M01.saveImage': '保存图片 ›',
  'R-M01.practiceLog': '练习记录',
  // R-M03（已定）
  'R-M03.settings': '设置',
  'R-M03.backup': '备份与恢复',
  'R-M03.backupSub': '记录只存在这台手机上',
  'R-M03.lastBackup': '上次备份 {date} ›',
  'R-M03.noBackup': '还没有备份',
  // R-M04（已定）
  'R-M04.emptyTitle': '还没有记录',
  'R-M04.emptyBody': '写一个字并判断对错，这里就会有记录。',
  // R-M05（边开发边改）
  'R-M05.sheetAll': '全部 ›',
  // R-M06（已定；导出放以后版本）
  'R-M06.section1': '一 · 今年有记录的字',
  'R-M06.charCount': '{n} 个字',
  'R-M06.section1Note': '写完并判断过对错的字，写对写错都算。',
  'R-M06.monthDays': '{month} 月有记录 {n} 天',
  'R-M06.monthNote': '只看哪天有记录，不分对错。',
  'R-M06.monthNone': '还没有记录',
  'R-M06.rareNote': '今年有记录的字里，它最不常用。',
  'R-M06.inkDate': '{date} · 你当时的笔迹',
  'R-M06.footer': '只算今年的记录。这一页不能保存成图片。',
  'R-M06.emptyTitle': '今年还没有记录',
  'R-M06.emptyBody': '写字并判断对错后，这里会汇总你今年的记录。',
  // R-P01（已定）
  'R-P01.monthDays': '{month} 月有记录 {n} 天',
  'R-P01.legend': '墨点表示这天有记录，不分对错。',
  // R-P02（已定）
  'R-P02.sheetTitle': '{month} 月字帖',
  'R-P02.sheetNote': '点一个字看详情，红色小字是那天的日期。',
  'R-P02.historyNote': '这里只能保存本月的字帖。',
  // R-P03（已定）
  'R-P03.todayChars': '{date}写的字',
  'R-P03.todayImage': '这次的图片 · 保存图片 ›',
  'R-P03.signature': '{date} · {n}个字',
  // R-P04（已定）
  'R-P04.empty': '写一个字并判断对错，这天就会有一个墨点。',
});
