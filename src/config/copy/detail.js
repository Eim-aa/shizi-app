// 文案 · 单字详情（R-D）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-D01（已定）
  'R-D01.wrongLine': '上次写错了',
  'R-D01.forgetLine': '到时间再写一遍了',
  // R-D02（待定-工程确认（算不出就删行））
  'R-D02.nextReview': '下次复习 · 大约 {date}',
  // R-D03（已定；L12/L13 边开发边改）
  'R-D03.count': '写过 {n} 次',
  'R-D03.none': '还没写过',
  // R-D04（已定）
  'R-D04.makeImage': '做成图片',
  'R-D04.noInkNote': '最近一次没有笔迹，再写一次就能做图片。',
  'R-D04.noInkNoteGlyph': '笔迹没存下来，写完后可在结果页做图。',
  'R-D04.noRecordNote': '先写一次这个字，才能做成图片。',
  // R-D05（已定）
  'R-D05.swapWord': '换个词语',
  'R-D05.banner': '「{word}」以后不会再出现',
  'R-D05.undo': '撤销',
  // R-D06（已定；Z03 边开发边改）
  'R-D06.rowTitle': '移出自选',
  'R-D06.rowSub': '记录不删，只是不再算自选字。',
  'R-D06.undoL1': '「{char}」已移出自选字',
  'R-D06.undoL2': '离开这一页前可以撤销',
  'R-D06.undone': '已撤销',
  // R-D07（已定）
  'R-D07.noInkLabel': '没有笔迹',
  'R-D07.noInkLarge': '这一次没有留下笔迹',
  // R-D08（已定）
  'R-D08.btnPractice': '练这个字',
  // R-D10（已定）
  'R-D10.title': '「{char}」的旧记录',
  'R-D10.body': ['旧版本拍照的记录，只能看，不能做图。', '备份时会一起存下。'],
  // X-DETAIL（M3-6 单字详情：原型 ShiziScreen L32–L61 / L128–L132 / L389–L413 的其余字样与三段式，origin: extra）
  'X-DETAIL.pageTitle': '「{char}」的记录',
  'X-DETAIL.viewChar': '看这个字 ›', // D66 ⑮：结果页 / 写字页对照弹层里进字详情的入口
  'X-DETAIL.strokes': '{n} 画',
  'X-DETAIL.wordLabel': '词语',
  'X-DETAIL.glossLabel': '意思',
  'X-DETAIL.emptyNote': '你每次写过的字都会留在这里',
  'X-DETAIL.cellTitle': '{date} · {caption}',
  // 头图「第一次 | 最近一次」（H1 / V2-03、N2-10，03 P223）
  'X-DETAIL.cellNoInkLabel': '{text}，没有笔迹', // 记录格没有存下墨时的读屏名称（格里画衬底字，不写字，V16）
  'X-DETAIL.heroFirst': '第一次',
  'X-DETAIL.heroLatest': '最近一次',
  'X-DETAIL.heroCaption': '{label} · {date}',
  'X-DETAIL.heroCellLabel': '{label}：{text}',
  'X-DETAIL.sourceLabel': '字源',
  'X-DETAIL.legacyEntry': '旧记录',
  'X-DETAIL.photoAlt': '旧版本拍下的照片',
  'X-DETAIL.saveFailed': '没保存上，原来的内容都还在。',
  'X-DETAIL.retry': '再试一次',
  'X-DETAIL.cancel': '先不保存',
  'X-DETAIL.undoFailedL2': '可以再点一次撤销',
  // 纸上记录的标注（阶段 1 P1-E8；实现交接 §10.2，过渡文案；03 P169）
  'X-DETAIL.paperTag': '· 纸上',
  'X-DETAIL.paperRowLabel': '{date}，{caption}，纸上',
});
