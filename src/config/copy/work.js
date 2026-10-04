// 文案 · 作品出口（X-WORK；阶段 1 P1-E7，交接「实现交接.md」§4–§8；全部是过渡文案，阶段 1 文案统一时定稿，D39 / D45）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 宋体显示的文案用字必须在 ShiziSerifSC 子集内；只用黑体显示的键登记在 scripts/fonts/build_corpus.mjs HEI_ONLY_COPY。

export default Object.freeze({
  // 结果页作品：格下标注、作品下的行
  'X-WORK.afterSeen': '看后写的',
  'X-WORK.rowNoInkCorrect': '「{char}」写对了，没有笔迹',
  'X-WORK.rowNoInkWrong': '「{char}」写错了，没有笔迹',
  'X-WORK.rowSeen': '「{char}」看过答案',
  'X-WORK.rowSkipped': '「{char}」跳过了',
  // 纸上（D46 ⑬ / D47，P1-E78）：行 =「「{char}」写对」+ 墨三的「· 纸上」（X-DETAIL.paperTag）；整组都在纸上时衬底格下写「纸上」
  'X-WORK.rowPaperCorrect': '「{char}」写对',
  'X-WORK.rowPaperWrong': '「{char}」写错',
  'X-WORK.rowPaperAria': '{char}，{state}，纸上',
  'X-WORK.paperState': '{state}，纸上',
  'X-WORK.statusPaper': '纸上',
  'X-WORK.statusCorrect': '写对',
  'X-WORK.statusWrong': '写错',
  'X-WORK.statusSeen': '看过答案',
  'X-WORK.statusSkipped': '跳过',
  // 读屏（交接 §5.5）
  'X-WORK.charsJoin': '、',
  'X-WORK.workAria':'作品：{chars}，{n} 个字，{date}',
  'X-WORK.workAriaOne': '作品：{chars}，{date}',
  'X-WORK.cellAria': '{char}，{state}，点两下对照和修改',
  'X-WORK.cellStateCorrect': '写对',
  'X-WORK.cellStateAfterSeen': '看后写的',
  'X-WORK.cellStateWrong': '写错',
  'X-WORK.shareAria': '分享这次的图片',
  // 分享弹层（交接 §5.3）
  'X-WORK.done': '完成',
  'X-WORK.alsoAdd': '也放进来',
  'X-WORK.chipWrong': '{char} · 写错',
  'X-WORK.saved': '存好了',
  'X-WORK.previewAria': '图片预览',
  'X-WORK.splitNote': '{n} 个字，存成 {m} 张，每张不超过 {max} 字。',
  'X-WORK.saveMany': '保存 {m} 张图片',
  'X-WORK.pageAria': '第 {k} 张，共 {m} 张',
  // 落款（纸面汉字，由 ui/work-text.js 拼接）
  'X-WORK.kuanCount': '{n}字',
  'X-WORK.kuanJoin': '{date}　{n}',
  'X-WORK.kuanMonthDay': '{month}月{day}日',
  'X-WORK.kuanPart': '其{n}',
  'X-WORK.kuanJoinPart': '{kuan}　{part}',
  'X-WORK.annualBrand': '拾字　年报',
  'X-WORK.annualCoverLine': '这一年，你写过{n}个字。',
  'X-WORK.annualFirstLabel': '今年第一个字',
  'X-WORK.annualFirstDate': '{date}的笔迹',
  // 月字帖（交接 §7）
  'X-WORK.monthTitle': '{month}月字帖',
  'X-WORK.monthUnderNote': '浅色的字，这个月没有留下笔迹。点一个字看详情。',
  'X-WORK.monthCellNoInk': '{char}，这个月没有留下笔迹',
  'X-WORK.monthOpen': '{month}月字帖，{n} 个字',
  // 年报（交接 §8）
  'X-WORK.annualPageTitle': '年报',
  'X-WORK.annualHead': '这一年，你写过 {n} 个字。',
  'X-WORK.annualMonthName': '{month}月',
  'X-WORK.annualMonthCount': '{n} 字',
  'X-WORK.annualMonthAria': '{month}月，{n} 个字，点开看字帖',
  'X-WORK.annualTwiceTitle': '同一个字，两次',
  'X-WORK.annualFirstCellAria': '「{char}」第一次的笔迹',
  'X-WORK.annualLastCellAria': '「{char}」最近一次的笔迹',
  'X-WORK.annualSaveTitle': '保存年报',
  'X-WORK.annualSaveNote': '存成册页：卷首、每个月、卷尾，每张 3:4。',
  'X-WORK.annualSaveButton': '保存 {n} 张图片',
  'X-WORK.annualSaveLong': '存成一张长图',
  'X-WORK.annualLongNote': '一张长图，宽 1440，字很小，适合存进相册。',
});
