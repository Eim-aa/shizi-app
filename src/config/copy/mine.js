// 文案 · 我的、练习记录、年度报告（R-M、R-P）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-M01（已定）
  'R-M01.saveImage': '保存图片',
  'R-M01.practiceLog': '练习记录',
  // R-M03（已定）
  'R-M03.backup': '备份',
  'R-M03.lastBackup': '上次备份 {date}',
  'R-M03.noBackup': '还没有备份',
  'R-M03.remind': '提醒', // D63：「我的」页提醒行 / 提醒页页头
  'R-M03.remindOff': '关',
  // R-M04（已定）
  'R-M04.emptyTitle': '还没有记录',
  'R-M04.emptyBody': '写字并点写对或写错，这里就有记录。',
  // R-M05（边开发边改）
  'R-M05.sheetAll': '全部 {n} 字', // D63：标题行右侧，整行进练习记录
  // R-M06（已定；导出放以后版本）
  'R-M06.section1': '一 · 写过的字',
  'R-M06.charCount': '{n} 个字',
  'R-M06.section1Note': '写完并选过对错的字都算。',
  'R-M06.monthDays': '{month}月写了 {n} 天',
  'R-M06.monthNote': '只看哪天写了，不分对错。',
  'R-M06.monthNone': '还没有记录',
  'R-M06.rareNote': '今年写过的字里，它最少见。',
  'R-M06.inkDate': '{date}的笔迹',
  'R-M06.footer': '只算今年的记录。这一页不能保存成图片。',
  'R-M06.emptyTitle': '今年还没有记录',
  'R-M06.emptyBody': '写几个字，这里就会汇总今年。',
  // R-P01（已定）
  'R-P01.monthDays': '{month}月写了 {n} 天',
  'R-P01.legend': '墨点表示这天有记录，不分对错。',
  // R-P02（已定）
  'R-P02.sheetTitle': '{month}月字帖',
  'R-P02.sheetNote': '点一个字看详情，红色小字是那天的日期。',
  'R-P02.historyNote': '这里只能保存本月的字帖。',
  // R-P03（已定）
  'R-P03.todayChars': '{date}写的字',
  'R-P03.todayImage': '本次图片 · 保存',
  // R-P04（已定）
  'R-P04.empty': '写字并点写对或写错，这天就有墨点。',
  // X-MINE（extra：M4-1 我的首页与练习记录里 04 没有收录的原型字样与读屏名，见 copy-source.json extra.X-MINE）
  'X-MINE.annual': '年度报告',
  'X-MINE.backupStale': '{n} 天没有备份', // D66 ⑱：有记录且 ≥ 30 天没备份时「备份」行的右值
  'X-MINE.backupNearFull': '快存满了，建议导出备份', // D66 ⑭ / ⑱：笔迹存储接近上限时「备份」行的右值（卡 A 提供 storagePressure）
  'X-MINE.about': '关于拾字',
  // D63「我的」页概览三个数
  'X-MINE.ovStreak': '连续练习',
  'X-MINE.ovTotal': '累计练习',
  'X-MINE.ovChars': '已练汉字',
  'X-MINE.ovDay': '天',
  'X-MINE.ovChar': '字',
  'X-MINE.chevron': '›',
  'X-MINE.weekdays': ['一', '二', '三', '四', '五', '六', '日'],
  'X-MINE.dayRecorded': '{date}，有记录',
  'X-MINE.monthHead': '{month}月',
  'X-MINE.monthNone': '{month}月还没有记录',
  'X-MINE.prevMonth': '上个月',
  'X-MINE.nextMonth': '下个月',
  'X-MINE.cellLabel': '{char} · {date}',
  // AX 档次级页（R2-A1 / A2-03，03 P233）：月历改成每天一行的列表、周条改成一句话；字帖格的日期角标不画，日期在格的读屏名称里（X-MINE.cellLabel）
  'X-MINE.axDayRow': '{date} · 写了 {n} 个字',
  'X-MINE.axDayRowPaper': '{date} · 有记录',
  'X-MINE.sheetOrder': '按第一次写的先后排',
  'X-MINE.sheetEmpty': '这个月还没有可做图的字',
  // 只在纸上写过的一天（日历有点、没有字帖）；阶段 1 P1-E2，过渡文案，03 P172
  'X-MINE.paperDayNote': '这一天的字都写在纸上。',
  // X-ANNUAL（extra：M4-2 年度报告里 04 R-M06 没有收录的原型字样与读屏名，见 copy-source.json extra.X-ANNUAL）
  'X-ANNUAL.section2': '二 · 写得最勤',
  'X-ANNUAL.section3': '三 · 少见的字',
  'X-ANNUAL.section4': '四 · 第一个字',
  'X-ANNUAL.emptyGlyph': '年',
  'X-ANNUAL.prevYear': '上一年', // D66 ⑪：年报页内逐年切换（有往年记录时才出现）
  'X-ANNUAL.nextYear': '下一年',
  'X-ANNUAL.rareGlyph': '「{char}」的标准字形',
  'X-ANNUAL.firstInk': '「{char}」当时的笔迹',
  'X-ANNUAL.firstNoInk': '「{char}」，没有笔迹',
});
