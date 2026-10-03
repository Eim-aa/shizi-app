// 文案 · 设置（R-S）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-S01（已定）
  'R-S01.title': '设置',
  'R-S01.library': '练习范围',
  'R-S01.keySound': '按键音',
  'R-S01.remindNote': '通知会给一个词语和拼音，让你想想是哪个字。',
  // R-S02（已定）
  'R-S02.title': '手机关了拾字的通知，收不到提醒',
  'R-S02.body': '想收到提醒，请到手机设置里打开拾字的通知。',
  'R-S02.link': '去手机设置 ›',
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
  // P132（D29）：旧「更大字体」打开过的用户（v1 迁移带来 large=true），启动后显示一次的轻提示；过渡文案
  'X-SETTINGS.textSizeNotice': '文字大小跟随手机设置，可以在手机的设置里调整。',
  // X-REMIND（M5-5 提醒通知的标题与正文，P48；R-S01 只给了设置页说明，通知字样沿旧版，见 copy-source.json extra）
  'X-REMIND.title': '{word}（{pinyin}）',
  'X-REMIND.body': '还记得这个字怎么写吗？点开试试。',
});
