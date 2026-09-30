// 文案 · 结果页（R-R）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-R01（已定）
  'R-R01.titleCount': '这次记录了 {n} 个字',
  'R-R01.titleZero': '这次没有记下字',
  'R-R01.noteDefault': '跳过和看过答案的字不算在内。',
  'R-R01.noteSeenSkipped': '{seen}看过答案，{skipped}跳过了，没算在内。',
  'R-R01.noteSeenCount': '另有 {n} 个字看过答案，没算在内。',
  // R-R02（已定（"这次没有书写"与 C012"这次没写"不一致，§5.1-12））
  'R-R02.sheetTitleCorrect': '「{char}」这次记为写对',
  'R-R02.sheetTitleWrong': '「{char}」这次记为写错',
  'R-R02.sheetTitleSaw': '「{char}」看过答案',
  'R-R02.sheetTitleSkipped': '「{char}」跳过了',
  'R-R02.sheetNoteChange': '改了只换掉这一次，不会多算一次。',
  'R-R02.sheetNoteSaw': '看过答案的字不判断对错，没算在内。',
  'R-R02.sheetNoteSkipped': '跳过的字没算在内。',
  'R-R02.sheetNoInk': '这次没写',
  'R-R02.sheetCancel': '取消',
  'R-R02.sheetClose': '关闭',
  'R-R02.cellSaw': '看过答案',
  'R-R02.gridHint': '点一个格子，可以对照参考字形、修改判断。',
  // R-R03（已定（见 §5.1-7））
  // R-R04（待定-工程确认（不影响选字就整块删））
  'R-R04.title': '这组字难不难',
  'R-R04.side': '下次会照这个调整',
  'R-R04.firstNote': '以后写哪些字，会参考这次的结果。',
  'R-R04.saveFailed': '没保存上，刚才的选择没记下。',
  'R-R04.retry': '再试一次',
  'R-R04.cancel': '先不选',
  // R-R05（已定；标题字样 §5.1-3）
  'R-R05.bodyAll': '{chars}都记下了。',
  'R-R05.bodyOne': '「{char}」记下了。',
  'R-R05.bodyEarly': '还有 {n} 个字没写，没有记下。',
  'R-R05.kicker': '这次选的字',
  'R-R05.earlyTitle': '先写到这里',
  // R-R06（已定；S05 边开发边改）
  'R-R06.leaveWrong': '回到写错过',
  'R-R06.leaveForget': '回到快忘了',
  'R-R06.leaveAll': '回到有记录的字',
  'R-R06.leaveMine': '回到我的',
  'R-R06.leaveDetail': '回到「{char}」',
  'R-R06.leaveLibrary': '回到字库',
  'R-R06.fromWrong': '从写错过',
  'R-R06.fromForget': '从快忘了',
  'R-R06.fromPicked': '自己选的',
  // R-R07（已定）
  'R-R07.title': '这次的图片',
  'R-R07.missingInk': '「{char}」这一次没有留下笔迹，不在图里。',
  'R-R07.imageNote': '存下来的是图片，不能用来恢复记录。',
  'R-R07.allMissing': '这次记下的字都没有留下笔迹，不能保存本次练习图片；本月图片仍可到练习记录保存。',
  // X-RESULT（M2-3 结果页：原型 ShiziScreen L116–L124 的页头 / 标题 / 格下标签 / 底栏 / 日期来源行；P62 拆句）
  'X-RESULT.headerDaily': '这次练习',
  'X-RESULT.headerFirst': '第一次练习',
  'X-RESULT.pickedDoneTitle': '写完了',
  'X-RESULT.noteSeenOnly': '{seen}看过答案，没算在内。',
  'X-RESULT.noteSkippedOnly': '{skipped}跳过了，没算在内。',
  'X-RESULT.cellCorrect': '写对',
  'X-RESULT.cellWrong': '写错',
  'X-RESULT.cellSkipped': '跳过',
  'X-RESULT.cellAria': '{char} · {caption}',
  'X-RESULT.again': '再写一组',
  'X-RESULT.leaveHome': '回到首页',
  'X-RESULT.dateSource': '{date} · {source}',
  'X-RESULT.againFailed': '没保存上，刚才的选择没记下。',
  'X-RESULT.againRetry': '再试一次',
  'X-RESULT.againCancel': '先不保存',
});
