// 文案 · 结果页（R-R）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-R01（已定）
  'R-R01.titleCount': '写了 {n} 个字',
  'R-R01.titleZero': '没有记录',
  'R-R01.noteDefault': '跳过和看过答案的字不算在内。',
  'R-R01.noteSeenCount': '另有 {n} 个字看过答案，没算在内。',
  // R-R02（已定（"这次没有书写"与 C012"这次没写"不一致，§5.1-12））
  'R-R02.sheetTitleCorrect': '「{char}」写对了',
  'R-R02.sheetTitleWrong': '「{char}」写错了',
  'R-R02.sheetTitleSaw': '「{char}」看过答案',
  'R-R02.sheetTitleSkipped': '「{char}」跳过了',
  'R-R02.sheetNoteChange': '改了只换掉这一次，不会多算一次。',
  'R-R02.sheetNoteSaw': '看过答案的字不判断对错，没算在内。',
  'R-R02.sheetNoteSkipped': '跳过的字没算在内。',
  'R-R02.sheetNoInk': '这次没写',
  'R-R02.sheetCancel': '取消',
  'R-R02.sheetClose': '关闭',
  'R-R02.cellSaw': '看过答案',
  // R-R03（已定（见 §5.1-7））
  // R-R04（待定-工程确认（不影响选字就整块删））
  'R-R04.title': '这组字难不难',
  'R-R04.side': '下次会照这个调整',
  'R-R04.firstNote': '以后写哪些字，会参考这次的结果。',
  'R-R04.saveFailed': '没保存上，刚才的选择没记下。',
  'R-R04.retry': '再试一次',
  'R-R04.cancel': '先不选',
  // R-R05（已定；标题字样 §5.1-3）
  'R-R05.bodyEarly': '还有 {n} 个字没写，没有记下。',
  'R-R05.kicker': '自己选的',
  // R-R06（已定；S05 边开发边改）
  'R-R06.leaveWrong': '回到写错过',
  'R-R06.leaveForget': '回到快忘了',
  'R-R06.leaveAll': '回到写过的字',
  'R-R06.leaveMine': '回到我的',
  'R-R06.leaveDetail': '回到「{char}」',
  'R-R06.leaveLibrary': '回到字库',
  // R-R07（已定）
  'R-R07.title': '本次图片',
  'R-R07.missingInk': '「{char}」这一次没有留下笔迹，不在图里。',
  'R-R07.imageNote': '存下来的是图片，不能用来恢复记录。',
  'R-R07.allMissing': '这次的字都没存下笔迹，做不了图片。',
  // X-RESULT（M2-3 结果页：原型 ShiziScreen L116–L124 的页头 / 标题 / 格下标签 / 底栏 / 日期来源行；P62 拆句）
  'X-RESULT.headerDaily': '这次练习',
  'X-RESULT.headerFirst': '首次练习',
  'X-RESULT.cellCorrect': '写对',
  'X-RESULT.cellWrong': '写错',
  'X-RESULT.cellSkipped': '跳过',
  'X-RESULT.again': '再写一组',
  // 首练结果页的主按钮（R2-R1 / N2-05）：「再写一组」降为下面的文字按钮
  'X-RESULT.done': '完成',
  'X-RESULT.leaveHome': '回到首页',
  'X-RESULT.againFailed': '没保存上，刚才的选择没记下。',
  'X-RESULT.againRetry': '再试一次',
  'X-RESULT.againCancel': '先不保存',
  // X-FIRST（阶段 1 P1-E5，设计稿「首练与首页」§三：首练结果页的标题、复现预告、写错字的「放进去」；过渡文案，阶段 1 文案统一时定稿）
  // 首练结果页标题：固定说这一组的「三个字」（首练恒为 3 个字；C3-H / N3-07、D53，03 P248，取代 V2-05 的按作品字数取数——作品字数交给落款）
  'X-FIRST.title': '这三个字，很多人提笔就忘。',
  'X-FIRST.tier.tomorrow': '明天',
  'X-FIRST.tier.soon': '过两天',
  'X-FIRST.tier.later': '过几天',
  'X-FIRST.reviewFirst': '{chars}{tier}再来',
  'X-FIRST.reviewNext': '{chars}{tier}',
  'X-FIRST.reviewSame': '{tier}，它们再来。',
  'X-FIRST.reviewJoin': '，',
  'X-FIRST.reviewEnd': '。',
  // X-FIRST.daysLater（阶段 1 Q2-16，03 P185，D48）：结果页每字「N 天后再见」；E9c（P192）起接入复现句（天数相同的字合并成一个分句，laterGroup / laterSame）
  'X-FIRST.daysLater': '{n} 天后再见',
  'X-FIRST.daysLaterTomorrow': '明天再见',
  'X-FIRST.laterGroup': '{chars}{text}',
  'X-FIRST.laterSame': '{text}',
  // 作品下的行（D49 减法稿：字在左边，状态词不再重复字名与引号；「放进去」→「放进图里」）
  'X-FIRST.excluded': '写错了',
  // 全写错那一屏（没有任何作品，C3-H / N3-03、D53，03 P248）：下面几行只点一次名，不带朱点，用中性的说法；朱点留给「放进图里」以后的作品
  'X-FIRST.excludedQuiet': '写过了',
  'X-FIRST.addIn': '放进图里',
  'X-FIRST.addAria': '把「{char}」放进图里',
  // 首练结果页复现句前的一句（C3-H / N3-01、D53 ④，03 P245）：首页那个品牌字就是首练第三个「拾」——写成了说「你写下的第一个「拾」。」（与首页格下 X-HOME.shiFirstLine 同一句），没写成说一次它就是首页那个字
  'X-FIRST.shiWritten': '你写下的第一个「拾」。',
  'X-FIRST.shiHome': '「拾」就是首页那个字。',
  // X-INVITE（阶段 1 P1-E5，D35 / D46 ③：首练结果页内嵌的提醒邀请；点「好」才请求系统权限；过渡文案）
  'X-INVITE.title': '明天这个时候，给你一个词？',
  'X-INVITE.titleEvening': '明天晚上八点半，给你一个词？',
  'X-INVITE.body': '锁屏只显示词语和拼音，如「{word}（{pinyin}）」，先在心里写一遍。',
  'X-INVITE.blankLabel': '空着的字', // 示例里被遮住那一位的读屏名称（页面上画成描边小方框，N2-13）
  'X-INVITE.bodyPlain': '锁屏只显示词语和拼音，先在心里写一遍。',
  // 按钮写出结果（C3-H / T3-12、D53，03 P248）：「好」离开上下文不知道在好什么；首练页最多两句话，首练那次不再放说明 body（今天的练习那次仍放）
  'X-INVITE.yes': '开启提醒',
  'X-INVITE.no': '先不用',
  'X-INVITE.accepted': '好，明天 {time} 给你一个词。',
  'X-INVITE.changeTime': '改时间',
  'X-INVITE.timeLabel': '提醒时间',
  'X-INVITE.denied': '通知没打开。请到手机设置里打开。',
});
