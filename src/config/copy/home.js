// 文案 · 首页（R-H）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-H01（已定）
  'R-H01.title': '今天写字',
  // R-H02（已定）
  'R-H02.line': '{date} · {period}',
  'R-H02.dateFormat': '{month}月{day}日',
  'R-H02.period.dawn': '早上',
  'R-H02.period.noon': '中午',
  'R-H02.period.dusk': '傍晚',
  'R-H02.period.night': '晚上',
  // R-H03（已定；阶段 1 P1-E5：首次打开按钮下一行，设计稿「首练与首页」§一，替换「第一次来，先写 3 个字试试。」）
  'R-H03.firstVisit': '先写三个大家常忘的字。',
  // R-H04（已定；阶段 1 E9d，P196 / D49 ⑦：A、B 两组都没写完时 A 那一行可见文字只剩「… · 接着写」，计数只放进读屏名称，过渡文案）
  'R-H04.resumePicked': '自己选的 · 接着写',
  'R-H04.resumeDaily': '今天的字 · 接着写',
  'R-H04.resumeFirst': '首次练习 · 接着写',
  // 读屏名称（含可见文字「… · 接着写」，再加剩余字数；Voice Control 报可见文字能点到）
  'R-H04.resumePickedAria': '自己选的 · 接着写，还剩 {n} 个',
  'R-H04.resumeDailyAria': '今天的字 · 接着写，还剩 {n} 个',
  'R-H04.resumeFirstAria': '首次练习 · 接着写，还剩 {n} 个',
  // 当前字已看过答案、正在描或自己写：不再算进「还有 N 个字没写」（阶段 0 B6，已决定 D36 / P77）；只进读屏名称
  'R-H04.resumePickedNow': '自己选的 · 接着写，第 {k} 个，剩 {n} 个',
  'R-H04.resumeDailyNow': '今天的字 · 接着写，第 {k} 个，剩 {n} 个',
  'R-H04.resumeFirstNow': '首次练习 · 接着写，第 {k} 个，剩 {n} 个',
  'R-H04.resumePickedNowLast': '自己选的 · 接着写，最后一个了',
  'R-H04.resumeDailyNowLast': '今天的字 · 接着写，最后一个了',
  'R-H04.resumeFirstNowLast': '首次练习 · 接着写，最后一个了',
  // R-H05（已定）
  'R-H05.body': '上一组还有{chars}没写。',
  'R-H05.continueOld': '接着写',
  'R-H05.endOldStartNew': '开新一组',
  'R-H05.cancel': '取消',
  // R-H06（已定）
  'R-H06.title': '自己选字',
  'R-H06.hint': '输入一个字或一个词，再点你要的那个字。',
  'R-H06.saveFailed': '没保存上，输入的字还在。',
  'R-H06.cancel': '先不保存',
  'R-H06.retry': '再试一次',
  // R-H11（已定（两态是否同一页见 §6.2））
  'R-H11.title': '现在没有要写的字',
  'R-H11.body': '想接着写，可以自己选几个字。',
  'R-H11.backHome': '回到首页 ›',
  'R-H11.noCharsBody': '可以换练习范围，或先复习旧字。',
  'R-H11.noCharsLink': '待复习 ›',
  // X-HOME（原型首页壳 L217 ctaLabel（K 报告 §1-3）；01 M2-3「继续写字 · 今天的练习」）
  'X-HOME.start': '开始写字',
  'X-HOME.continue': '继续写字',
  // X-HOME（M2-1 首页：原型首页壳-v3 L44 / L56 / L57 / L71 / L74 / L81 的装饰字与入口；开组写入失败说明，P55 待文案）
  'X-HOME.pick': '自己选字',
  'X-HOME.startFailed': '没保存上，刚才的选择没记下。',
  // X-HOME（阶段 1 P1-E5，设计稿「首练与首页」：首次打开、日常首页五态；全部是过渡文案，阶段 1 文案统一时定稿）
  'X-HOME.mottoLine1': '提笔忘字，',
  'X-HOME.mottoLine2': '不是忘了，',
  'X-HOME.mottoLine3': '只是很久没写。',
  'X-HOME.shiLabel': '拾',
  'X-HOME.capitalBody': '今天写两组大写数字，借条、红包上用得着。',
  'X-HOME.capitalDefer': '写平常字',
  'X-HOME.backNote': '你写过的 {n} 个字都还在。',
  // X-SESSION（M2-2 会话开始：S02 保存失败三段式、「现在没有要写的字」页主按钮；04 R-H05 / R-H11 没给这些槽，P55 待文案）
  'X-SESSION.s02SaveFailed': '没保存上，刚才的选择没记下。',
  'X-SESSION.s02Retry': '再试一次',
  'X-SESSION.s02Cancel': '先不保存',
  'X-SESSION.nonePick': '自己选字',
  'X-SESSION.noneLibSwitch': '换范围',
});
