// 文案 · 判断页 / 对照（R-W09、R-W17）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-W09（已定）
  'R-W09.prompt': '你来判断，点一下就记下。',
  'R-W09.continueWriting': '接着写',
  'R-W09.continueWritingAria': '回到格子里接着写',
  'R-W09.btnWrong': '写错了',
  'R-W09.btnCorrect': '写对了',
  'R-W09.labelMine': '你的书写',
  'R-W09.labelReference': '参考字形',
  // 对照卡的读屏名称（阶段 0 A9，03 P112）：判断页已揭晓答案，读出字、拼音、笔画数不算泄露。
  'R-W09.mineCardLabel': '你的书写，{n} 笔',
  'R-W09.refCardLabel': '参考字形：{char}，{pinyin}，{n} 画',
  'R-W09.refCardLabelNoCount': '参考字形：{char}，{pinyin}',
  'R-W09.refCardLabelChar': '参考字形：{char}',
  // R-W17（已定）
  'R-W17.noInk': '这次没写',
  // X-JUDGE（M1-5 修改判断弹层标题 / 主按钮 / 取消；原型 ShiziWriteScreen L240、L637、L639）
  'X-JUDGE.changeTitle': '修改「{char}」的判断',
  'X-JUDGE.changeToWrong': '改为写错',
  'X-JUDGE.changeToCorrect': '改为写对',
  'X-JUDGE.changeCancel': '取消',
});
