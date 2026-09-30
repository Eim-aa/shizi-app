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
  // R-S04（已定）
  'R-S04.largeNote': ['打开后，文字和写字格都放大一号。', '手机字号调大时，这里也会跟着变大。'],
  'R-S04.largeLabel': '更大字体',
});
