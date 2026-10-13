// 文案 · 提醒与外观（R-S；D63 起没有「设置」页：提醒在提醒页、外观与练习范围在「我的」页）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-S01（已定）
  'R-S01.library': '练习范围',
  'R-S01.remindNote': '通知给一个词和拼音，想想是哪个字。',
  // R-S02（已定）
  'R-S02.title': '通知没开',
  'R-S02.body': '要收提醒，请到手机设置打开通知。',
  'R-S02.link': '手机设置 ›',
  // R-S03（已定 + 边开发边改）
  'R-S03.appearance': '外观',
  'R-S03.appearance.light': '日间',
  'R-S03.appearance.dark': '夜间',
  'R-S03.appearance.auto': '跟随系统',
  // R-S04「更大字体」开关与说明：D29（覆盖 P59）删除——字号跟随手机系统字号（见 copy-source.json R-S04 dropped）
  // X-SETTINGS（提醒页：「练习提醒」取原型 ShiziScreen L147 / L156；提醒时间、保存失败三段式为工程补槽，见 copy-source.json extra）
  'X-SETTINGS.remindLabel': '练习提醒',
  'X-SETTINGS.remindTime': '提醒时间',
  'X-SETTINGS.saveFailed': '没保存上，刚才的选择没记下。',
  'X-SETTINGS.cancel': '先不保存',
  'X-SETTINGS.retry': '再试一次',
  // X-REMIND（M5-5 提醒通知的标题与正文，P48；R-S01 只给了设置页说明，通知字样沿旧版，见 copy-source.json extra）
  'X-REMIND.title': '{word}（{pinyin}）',
  'X-REMIND.body': '还记得这个字怎么写吗？点开试试。',
});
