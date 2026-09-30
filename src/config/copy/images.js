// 文案 · 图片（R-I）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-I01（已定）
  'R-I01.kindSession': '这次的图片',
  'R-I01.kindMonth': '{month} 月字帖',
  'R-I01.kindGlyph': '手写字图片',
  'R-I01.imageNote': '存下来的是图片，不能用来恢复记录。',
  'R-I01.glyphNote': '用的是你最近一次写的这个字。存下来的是图片，不能用来恢复记录。',
  'R-I01.monthSignature': '{month} · 有记录{n}天 · {m}个字',
  'R-I01.signatureDate': '{year}年{month}月{day}日',
  'R-I01.signatureMonth': '{year}年{month}月',
  'R-I01.glyphEntry': '把这个字做成图片',
  'R-I01.overLimit': 'TODO: 超过 80 个字的图片说明（P25）',
  // R-I02（已定（导出模块要补））
  'R-I02.glyphCaption': '{pinyin} · {date}',
});
