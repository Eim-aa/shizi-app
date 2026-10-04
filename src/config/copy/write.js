// 文案 · 写字页（R-W，判断页除外）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-W01（已定）
  'R-W01.progress': '{n} / {total}',
  // R-W02（已定（显示位置/持续几字见 §6.2））
  'R-W02.firstTip': '看拼音和提示，把这个字写在格子里。',
  // R-W03（已定）
  'R-W03.titleRecall': '凭记忆写出这个字',
  'R-W03.titleCompare': '写对了吗？',
  'R-W03.titleAnswer': '这个字这样写',
  'R-W03.titleSelf': '自己写一遍',
  // R-W04（已定）
  'R-W04.stepTrace': '第 1 步，共 2 步：描一遍',
  'R-W04.stepSelf': '第 2 步，共 2 步：自己写',
  // R-W05（文案已定；"已写对哪几笔"算法 待定-工程确认（做不到退回按已写笔数））
  'R-W05.hintLabel': '提示',
  'R-W05.hintRemaining': '提示，还有 {n} 次',
  'R-W05.hintUsedUp': '提示已用完',
  'R-W05.hintUnavailable': '暂时没有提示',
  'R-W05.noHintNote': '这个字暂时没有提示，可以直接看答案。',
  // R-W06（说明句「浅红色是提示……」已删，D51 ⑧：不再用文字解释颜色；方案②/N07 原型专用-不做）
  // R-W07（已定（N01 的「」与 X10 关系见 §5.1-2））
  'R-W07.confirmBody': '看了答案，这个字就记为看过答案。',
  'R-W07.confirmKeepThinking': '接着想',
  'R-W07.confirmShow': '看答案',
  'R-W07.answerNote': '这个字记为看过答案，后面再写只算练习。',
  'R-W07.btnSelf': '自己写',
  'R-W07.btnTrace': '描一遍',
  'R-W07.btnNext': '下一个',
  'R-W07.selfNote': '这个字看过答案了，再写只算练习。',
  'R-W07.btnShowAnswer': '看答案',
  // R-W08（已定（接入时实测，决定 L51））
  'R-W08.answerNote': '这个字记为看过答案，后面再写只算练习。',
  'R-W08.traceNote': '浅色是参考字形。',
  // R-W10（已定）
  'R-W10.lineRecordedCorrect': '「{char}」记为写对 · 修改 ›',
  'R-W10.lineRecordedWrong': '「{char}」记为写错 · 修改 ›',
  'R-W10.lineChangedCorrect': '「{char}」已改为写对 · 修改 ›',
  'R-W10.lineChangedWrong': '「{char}」已改为写错 · 修改 ›',
  'R-W10.lineSaw': '「{char}」记为看过答案',
  'R-W10.changeBodyCorrect': '刚才记的是写对。改了只换掉这一次，不会多算一次。',
  'R-W10.changeBodyWrong': '刚才记的是写错。改了只换掉这一次，不会多算一次。',
  'R-W10.changeFailed': '没改成，还是原来的判断。',
  'R-W10.retry': '再试一次',
  'R-W10.cancel': '先不改',
  // R-W14（已定）
  'R-W14.btnSkip': '跳过',
  // R-W15（已定；S04 边开发边改（原型仍以"结束这组"为主按钮，已核））
  'R-W15.confirmBody': '还有 {n} 个字没写，结束后就不写了。判断过的 {m} 个字已经记下。',
  'R-W15.continue': '接着写',
  'R-W15.end': '结束这组',
  'R-W15.zeroToast': '这组结束了，没有记下字。',
  // R-W16（已定）
  'R-W16.saveFailed': '没保存上，你写的字还在。',
  'R-W16.retry': '再试一次',
  'R-W16.cancel': '先不保存',
  'R-W16.saved': '保存好了。',
  // R-W18（已定）
  'R-W18.btnUndo': '撤销',
  'R-W18.btnClear': '清空',
  // R-W20（边开发边改）
  'R-W20.skippedToast': '已跳过「{char}」',
  'R-W20.undo': '撤销',
  // R-W28（已定）
  'R-W28.repeatBlankNote': '空格里是同一个字，只写一次。',
  // R-W29（已定）
  'R-W29.btnDone': '写好了',
  // X-PROMPT（src/core/cards.js PROMPT_COPY（#175 原文，M0-2 占位常量；M1-8 题面接入时由 UI 从 copy 传入））
  'X-PROMPT.fallbackHint': '这个字暂时没有常用词，按拼音写就好',
  'X-PROMPT.repeatBlankLabel': '同一目标字的另一处空格',
  'X-PROMPT.missingPinyin': '？',
  'X-PROMPT.repeatBlankGlyph': '□',
  'X-PROMPT.groupLabel': '题目',
  // 回忆阶段题面「要写的字」空格的读屏名称（阶段 0 A9，03 P112）：只读位置、拼音和声调，不含答案字（D16）；揭示阶段不设名称，读屏顺着文本读。
  'X-PROMPT.blankLabel': '要写的字，第 {n} 个，读 {pinyin}，{tone}',
  'X-PROMPT.blankLabelSingle': '要写的字，读 {pinyin}，{tone}',
  'X-PROMPT.tone1': '一声',
  'X-PROMPT.tone2': '二声',
  'X-PROMPT.tone3': '三声',
  'X-PROMPT.tone4': '四声',
  'X-PROMPT.tone5': '轻声',
  // X-WRITE（M1-1 书写格组件的读屏名称）
  'X-WRITE.gridLabel': '书写格',
  // X-WRITE.firstTip（阶段 1 Q2-1，03 P181；实现交接 §3 过渡文案）：首练第 1 字格下说明位一次性提示
  'X-WRITE.firstTip': '凭记忆写，想不起来可以点提示。',
  // X-ANSWER（M1-4 描一遍阶段标题与按钮；原型 ShiziWriteScreen L551–L553）
  'X-ANSWER.titleTrace': '描一遍',
  'X-ANSWER.btnTraceDone': '描好了，自己写',
  'X-ANSWER.btnRetrace': '再描一遍',
  // X-PAPER（阶段 1 P1-E8「在纸上写，回来自判」写字页；实现交接 §10.2 / §10.3，过渡文案；03 P165 / P167 / P168）
  'X-PAPER.title': '在纸上写',
  'X-PAPER.body': '写好了点「写好了」，再自己对照。',
  'X-PAPER.backToScreen': '改回在屏幕上写',
  'X-PAPER.toPaper': '在纸上写',
  'X-PAPER.note': '这个字记下时会标注「纸上」，不留笔迹。',
  'X-PAPER.suggest': '读屏开启时，可以在纸上写好，回来自己对照。',
  'X-PAPER.suggestYes': '改为在纸上写',
  'X-PAPER.suggestNo': '不用',
  // X-PERSIST（M1-6 抬笔写会话现场失败的顶部一次性提示；01 §4 表「沿旧两句」，旧 index.html L1067）
  'X-PERSIST.saveFailed': '这次进度没有保存。请立即导出备份后重新打开 App。',
  'X-PERSIST.quotaFailed': '本地空间已满，这次进度没有保存。请立即导出备份并清理空间。',
});
