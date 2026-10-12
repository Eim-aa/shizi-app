// 文案 · 查字 / 自己选字组件（R-Q）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-Q01（已定）
  'R-Q01.titleLookup': '查字',
  'R-Q01.titlePick': '自己选字',
  'R-Q01.placeholder': '输入一个字或一个词',
  // R-Q02（已定）
  'R-Q02.pickNote': '输入一个字或一个词，再点你要的那个字。',
  'R-Q02.lookupNote': '点一个字，看参考字形、练这个字或加入自选的字。',
  // R-Q03（已定）
  'R-Q03.onlyHanzi': '只能输入汉字。',
  'R-Q03.removed': '只能输入汉字，已去掉 {n} 个字母或符号。',
  'R-Q03.duplicate': '重复的「{char}」只算一次。',
  // R-Q04（已定（"自选的字 · …"完整字样未给））
  'R-Q04.rowCount': '记录了 {n} 次',
  'R-Q04.rowNone': '还没有记录',
  'R-Q04.rowUnavailable': '暂时不能练',
  'R-Q04.rowCustomNone': '自选的字 · 还没有记录',
  'R-Q04.rowCustomCount': '自选的字 · 记录了 {n} 次',
  // R-Q05（已定）
  'R-Q05.cardStat': '记录了 {n} 次 · 最近一次 {date}',
  'R-Q05.btnPractice': '练这个字',
  'R-Q05.btnAdd': '加入自选的字',
  'R-Q05.alreadyAdded': '已在自选的字里',
  'R-Q05.addFailed': '没加进自选的字，输入的字还在。',
  'R-Q05.retry': '再试一次',
  'R-Q05.cancel': '先不加',
  'R-Q05.backToList': '‹ 回到这 {n} 个字',
  'R-Q05.unavailableTitle': '「{char}」暂时不能练。',
  'R-Q05.unavailableReason': '拾字还没有这个字的参考字形。',
  'R-Q05.unavailableSource': '能练的字参考教育部《通用规范汉字表》，个别字暂时还不能练。',
  'R-Q05.viewRecords': '查看记录',
  // R-Q06（已定；Z02 边开发边改）
  'R-Q06.btnPracticeN': '练这 {n} 个字',
  'R-Q06.btnNone': '先选一个字',
  // X-QUERY（M2-0 查字 / 自己选字组件：原型 字库墨墙屏 L427–L446 的读屏标签、卡片拼音 · 笔画、多字重复提示）
  'X-QUERY.selectAria': '选择「{char}」',
  'X-QUERY.unselectAria': '取消选择「{char}」',
  'X-QUERY.rowAria': '{char} {pinyin}，{status}',
  'X-QUERY.rowAriaNoPinyin': '{char}，{status}',
  'X-QUERY.cardMeta': '{pinyin} · {n} 画',
  'X-QUERY.duplicateMany': '重复的{chars}只算一次。',
});
