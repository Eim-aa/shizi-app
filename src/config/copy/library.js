// 文案 · 字库：墨墙、有记录的字、写错过 · 快忘了清单、换库（R-L、R-A、R-E）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-L01（已定）
  'R-L01.curriculumName': '小学初中常用字',
  // R-L02（已定；L09 边开发边改）
  'R-L02.more': '还有 {n} 个字 ›',
  // R-L03（已定；四档天数写死待正式；L14 边开发边改）
  'R-L03.legend': '墨色越浅，越久没写。点一个字，看它每次的笔迹。',
  'R-L03.toneOldest': '三个月以上',
  'R-L03.legendDark': '颜色越暗，越久没写',
  // R-L04（已定）
  'R-L04.queryNote': '查到的字可以直接练，也可以加入自选的字。',
  // R-L05（已定）
  'R-L05.noRecordNote': '每天写的新字，从这个字库里挑。',
  'R-L05.empty': '去「习字」写几个字，判断过对错，就会出现在这里。',
  // R-L06（已定；轻提示边开发边改）
  'R-L06.entry': '更换字库 ›',
  'R-L06.countLine': '可以练 {n} 个字 · 有记录 {m} 个',
  'R-L06.confirmBody': ['以后的新字从这个字库里来。', '已有的记录、自选的字和写错过的字都不变。'],
  'R-L06.saveFailed': '没保存上，刚才的选择没记下。',
  'R-L06.retry': '再试一次',
  'R-L06.cancel': '先不换',
  'R-L06.lib.core3500.name': '规范常用字',
  'R-L06.lib.core3500.desc': '日常最常用的字。大多数人从这里开始。',
  'R-L06.lib.adv3000.name': '规范次常用字',
  'R-L06.lib.adv3000.desc': '看书看报会碰到的字。常用字写熟了，可以换这个。',
  'R-L06.lib.rare.name': '规范专门用字',
  'R-L06.lib.rare.desc': '人名、地名和古文里的少见字。目前能练的大约一半。',
  'R-L06.lib.curriculum2500.name': '小学初中常用字',
  'R-L06.lib.curriculum2500.desc': '小学到初中语文课要求会写的字。适合陪孩子一起练。',
  'R-L06.sourceNote': '字表参考教育部《通用规范汉字表》。有些字拾字还没收进来，暂时不能练，所以能练的字比原表少。',
  // R-L07（已定）
  'R-L07.forgetCardNote': '有一阵没写、可能快忘了的字。',
  'R-L07.forgetCardEmpty': '可能快忘了的字会放在这里。',
  // R-L10（已定）
  'R-L10.customUnwritten': '另有 {n} 个自选的字还没写',
  // R-A01（已定）
  'R-A01.sortRecentNote': '按最近一次写的月份排。每格是你最近一次的笔迹。',
  'R-A01.sortPinyinNote': '按拼音首字母排。多音字按第一个读音。',
  'R-A01.sortRecent': '最近写的',
  'R-A01.sortPinyin': '拼音',
  'R-A01.sortAge': '多久没写',
  // R-A02（已定）
  'R-A02.filterCustom': '自选的字 {n}',
  'R-A02.customNote': '你自己挑来常练的字。还没写的排在前面。',
  'R-A02.customUnwrittenNote': '加入了自选的字，还没有记录。',
  'R-A02.filterWrong': '写错过',
  'R-A02.filterForget': '快忘了',
  'R-A02.filterCustomUnwritten': '自选了还没写',
  'R-A02.practiceThese': '练这些字 →',
  // R-A03（已定）
  'R-A03.foundIn': '在 {month} 月',
  'R-A03.notFound': '「{char}」还没有记录。',
  'R-A03.searchAria': '在有记录的字里查字',
  // R-E02（已定；S06（返回保留勾选 + 全选/全不选）边开发边改）
  'R-E02.selected': '选了 {n} 个字 · 写完会回到这里。',
  'R-E02.selectedZero': '写完会回到这里。',
  'R-E02.btnMany': '练这些字',
  'R-E02.btnOne': '练这个字',
  'R-E02.btnNone': '先选一个字',
  'R-E02.leaveWrong': '回到写错过',
  'R-E02.leaveForget': '回到快忘了',
  // R-E03（已定）
  'R-E03.wrongThumb': '写错那次',
  'R-E03.wrongMeta': '{date}写错 · 一共写错 {n} 次',
  'R-E03.wrongNote': '右边小图是你写错的那一次。点圆圈选字，点这一行看记录。',
  'R-E03.forgetMeta': '最近一次 {date} · 记录了 {n} 次',
  'R-E03.forgetNote': '格子里是你最近一次的笔迹。点圆圈选字，点这一行看记录。',
  // R-E04（已定（画布 09 节 K18 其余 1–12 条原文不在仓库，§6.2））
  'R-E04.wrongEmpty': '现在没有写错过的字',
  'R-E04.forgetEmpty': '可能快忘了的字会放在这里。',
  'R-E04.forgetTop': '有一阵没写、可能快忘了的字。写一遍，就会从这里移走。',
  'R-E04.wrongTop': '下次写对了，就会从这里移走',
  'R-E04.titleWrong': '写错过',
  'R-E04.titleForget': '快忘了',
});
