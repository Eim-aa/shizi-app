// 文案 · 设置（R-S）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-S01（已定）
  'R-S01.title': '设置',
  'R-S01.library': '练习范围',
  'R-S01.keySound': '声音',
  'X-SETTINGS.soundSub': '点写对写错时有轻声，写字时无声。', // 副标题（D53，N2-12）：说清它管哪两处
  'R-S01.remindNote': '通知给一个词和拼音，想想是哪个字。',
  // R-S02（已定）
  'R-S02.title': '通知没开',
  'R-S02.body': '要收提醒，请到手机设置打开通知。',
  'R-S02.link': '手机设置 ›',
  // R-S03（已定 + 边开发边改）
  'R-S03.appearance': '外观',
  'R-S03.appearance.light': '浅色',
  'R-S03.appearance.dark': '深色',
  'R-S03.appearance.auto': '跟随系统',
  // R-S04「更大字体」开关与说明：D29（覆盖 P59）删除——字号跟随手机系统字号（见 copy-source.json R-S04 dropped）
  // X-SETTINGS（M4-3 设置页：组标题与「练习提醒」取原型 ShiziScreen L145–L152；提醒时间、保存失败三段式为工程补槽，见 copy-source.json extra）
  'X-SETTINGS.groupPractice': '练习',
  'X-SETTINGS.groupRemind': '提醒',
  'X-SETTINGS.groupDisplay': '显示',
  'X-SETTINGS.groupData': '数据',
  'X-SETTINGS.remindLabel': '练习提醒',
  'X-SETTINGS.remindTime': '提醒时间',
  'X-SETTINGS.more': '›',
  'X-SETTINGS.saveFailed': '没保存上，刚才的选择没记下。',
  'X-SETTINGS.cancel': '先不保存',
  'X-SETTINGS.retry': '再试一次',
  // 写字方式（阶段 1 P1-E8，D46 ⑬；实现交接 §10.3，过渡文案；03 P165；D56 起行内带一句说明 P277，写字页不再有「在纸上写」入口）
  'X-SETTINGS.writeMode': '写字方式',
  'X-SETTINGS.writeModeSub': '在纸上写，回来对照',
  'X-SETTINGS.writeScreen': '屏幕上写',
  'X-SETTINGS.writeScreenSub': '用手指或 Apple Pencil 写',
  'X-SETTINGS.writePaper': '在纸上写',
  'X-SETTINGS.writePaperSub': '照常看题和提示；写好后自己对照。',
  'X-SETTINGS.writeModeNote': '纸上写的标「纸上」，不留笔迹，不进图片。',
  // X-REMIND（M5-5 提醒通知的标题与正文，P48；R-S01 只给了设置页说明，通知字样沿旧版，见 copy-source.json extra）
  'X-REMIND.title': '{word}（{pinyin}）',
  'X-REMIND.body': '还记得这个字怎么写吗？点开试试。',
});
