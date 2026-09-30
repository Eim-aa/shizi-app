// 文案 · 首页（R-H）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-H01（已定）
  'R-H01.title': '今天写几个字',
  // R-H02（已定）
  'R-H02.line': '{date} · {period}',
  'R-H02.dateFormat': '{month} 月 {day} 日',
  'R-H02.period.dawn': '早上',
  'R-H02.period.noon': '中午',
  'R-H02.period.dusk': '傍晚',
  'R-H02.period.night': '晚上',
  // R-H03（已定）
  'R-H03.firstVisit': '第一次来，先写 5 个字试试。',
  // R-H04（已定）
  'R-H04.resumePicked': '这次选的字 · 还有 {n} 个字没写',
  'R-H04.resumeDaily': '今天的练习 · 还有 {n} 个字没写',
  'R-H04.resumeFirst': '第一次练习 · 还有 {n} 个字没写',
  // R-H05（已定）
  'R-H05.body': '上一组还有{chars}没写。',
  'R-H05.continueOld': '接着写那组',
  'R-H05.endOldStartNew': '结束那组，开新的',
  'R-H05.cancel': '取消',
  'R-H05.oldGroupSavedToast': '上一组判断过的 {m} 个字已经记下。',
  // R-H06（已定）
  'R-H06.title': '自己选字',
  'R-H06.hint': '输入一个字或一个词，再点你要的那个字。',
  'R-H06.saveFailed': '没保存上，输入的字还在。',
  'R-H06.cancel': '先不保存',
  'R-H06.retry': '再试一次',
  // R-H07（已定（契约））
  'R-H07.todayCount': '今天记录了 {n} 个字',
  // R-H10（边开发边改）
  'R-H10.savedToast': '已保存，下次接着写',
  // R-H11（已定（两态是否同一页见 §6.2））
  'R-H11.title': '现在没有要写的字',
  'R-H11.body': '想接着写，可以自己选几个字。',
  'R-H11.backHome': '回到首页 ›',
  'R-H11.noCharsBody': '可以换一个字库，或者先练写错过的字。',
  'R-H11.noCharsLink': '看写错过的字 ›',
  // X-HOME（原型首页壳 L217 ctaLabel（K 报告 §1-3）；01 M2-3「继续写字 · 今天的练习」）
  'X-HOME.start': '开始写字',
  'X-HOME.continue': '继续写字',
  // X-HOME（M2-1 首页：原型首页壳-v3 L44 / L56 / L57 / L71 / L74 / L81 的装饰字与入口；开组写入失败说明，P55 待文案）
  'X-HOME.ctaGlyph': '拾',
  'X-HOME.arrow': '→',
  'X-HOME.sealGlyph': '字',
  'X-HOME.more': '›',
  'X-HOME.pick': '自己选字 →',
  'X-HOME.inkRowLabel': '今天有记录的字：{chars}',
  'X-HOME.startFailed': '没保存上，刚才的选择没记下。',
  // X-SESSION（M2-2 会话开始：S02 保存失败三段式、「现在没有要写的字」页主按钮；04 R-H05 / R-H11 没给这些槽，P55 待文案）
  'X-SESSION.s02SaveFailed': '没保存上，刚才的选择没记下。',
  'X-SESSION.s02Retry': '再试一次',
  'X-SESSION.s02Cancel': '先不保存',
  'X-SESSION.nonePick': '自己选字',
  'X-SESSION.noneLibSwitch': '更换字库',
});
