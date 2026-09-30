// 文案 · 单字详情（R-D）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-D01（已定）
  'R-D01.wrongLine': '上次你判断写错了',
  'R-D01.forgetLine': '有一阵没写，可能快忘了',
  // R-D02（待定-工程确认（算不出就删行））
  'R-D02.nextReview': '下次练习 · 大约 {date} 再练到',
  // R-D03（已定；L12/L13 边开发边改）
  'R-D03.count': '记录了 {n} 次',
  'R-D03.none': '还没有记录',
  // R-D04（已定）
  'R-D04.makeImage': '把这个字做成图片',
  'R-D04.noInkNote': '最近一次没有笔迹，再写一次就能做图片。',
  'R-D04.noRecordNote': '先写一次这个字，才能做成图片。',
  // R-D05（已定）
  'R-D05.swapWord': '换掉这个词语',
  'R-D05.banner': '「{word}」以后不会再出现',
  'R-D05.undo': '撤销',
  // R-D06（已定；Z03 边开发边改）
  'R-D06.rowTitle': '从自选的字移除',
  'R-D06.rowSub': '记录不会删掉，只是不再算自选的字。',
  'R-D06.confirmBody': '把「{char}」从自选的字移除？这个字的记录不会删掉。',
  'R-D06.confirmRemove': '移除',
  'R-D06.confirmCancel': '取消',
  'R-D06.undoL1': '「{char}」已从自选的字移除',
  'R-D06.undoL2': '离开这一页前可以撤销',
  'R-D06.undone': '已撤销',
  // R-D07（已定）
  'R-D07.noInkLabel': '没有笔迹',
  'R-D07.noInkLarge': '这一次没有留下笔迹',
  // R-D08（已定）
  'R-D08.btnPractice': '练这个字',
  // R-D10（已定）
  'R-D10.title': '「{char}」的旧记录',
  'R-D10.body': ['旧版本拍照留下的记录，只能看，不能做成图片。', '备份时会一起存下。'],
});
