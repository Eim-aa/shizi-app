// 文案 · 图片（R-I）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-I01（已定）
  'R-I01.kindSession': '这次的图片',
  'R-I01.kindMonth': '{month}月字帖',
  'R-I01.kindGlyph': '手写字图片',
  'R-I01.imageNote': '存下来的是图片，不能用来恢复记录。',
  'R-I01.glyphNote': '用的是你最近一次写的这个字。存下来的是图片，不能用来恢复记录。',
  'R-I01.signatureDate': '{year}年{month}月{day}日',
  'R-I01.signatureMonth': '{year}年{month}月',
  'R-I01.glyphEntry': '把这个字做成图片',
  // 超 80 字（P25 pending）：已写过渡文案，待产品定稿；80 与 policy.imageMaxChars 同值（单测核对）
  'R-I01.overLimit': '一张图最多放 80 个字，现在的字超过了，暂时做不成图片。记录都还在，没有受影响。',
  // R-I02（已定（导出模块要补））
  'R-I02.glyphCaption': '{pinyin} · {date}',
  // X-IMAGES（M4-5 图片预览弹层：原型 ShiziScreen L192–L201 / L486–L487 / charEl；04 §3.2 图片规格；P50）
  'X-IMAGES.save': '保存图片',
  'X-IMAGES.saved': '已存好',
  'X-IMAGES.saving': '正在保存…',
  'X-IMAGES.retry': '再试一次',
  'X-IMAGES.ratioPortrait': '3:4',
  'X-IMAGES.ratioSquare': '1:1',
  'X-IMAGES.missingSession': '{chars}这一次没有留下笔迹，不在图里。',
  'X-IMAGES.missingDay': '{chars}这天没有留下笔迹，不在图里。',
  'X-IMAGES.missingMonth': '{chars}这个月没有留下笔迹，不在图里。',
  'X-IMAGES.emptyMonth': '这个月还没有可以放进图片的字',
  'X-IMAGES.brand': '拾字',
  'X-IMAGES.renderFailed': '图片暂时无法生成，请稍后再试。',
  'X-IMAGES.saveFailed': '图片没存下来，可以再试一次。',
  'X-IMAGES.shareStay': '先不分享',
  'X-IMAGES.rendering': '正在生成…',
  'X-IMAGES.saving': '正在保存…',
});
