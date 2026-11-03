// QA-H1 语义键（B3.3 起按屏分文件，elements.mjs 的 loadKeys 按文件名顺序合并）。每条：key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop:/id:）。
// id:xxx#N 取同 id 的第 N 个。页面卡只加自己的 keys/<屏>.mjs。

// 写字页与重写错字页（网页 write/*、write/redo.js）
export const KEYS = [
  { key: 'end', native: ['prop:endButton'] },
  { key: 'skip', native: ['prop:skipButton'] },
  { key: 'progress', native: ['id:native-write-count', 'id:native-write-head-progress'] },
  // 原生页头中间的标签：回忆阶段是进度「n / N」，其余阶段是标题（assignKeys 里按文字分）；网页标题是 h1
  { key: 'center', native: ['id:native-write-progress'] },
  { key: 'prompt-cell-0', native: ['prop:promptCells[0]'] },
  { key: 'prompt-cell-1', native: ['prop:promptCells[1]'] },
  { key: 'prompt-cell-2', native: ['prop:promptCells[2]'] },
  { key: 'grid', native: ['prop:gridFrame'] },
  { key: 'ref-grid', native: ['prop:refFrame'] },
  { key: 'undo', native: ['prop:undoButton'] },
  { key: 'clear', native: ['prop:clearButton'] },
  { key: 'line-text', native: ['prop:lineLabel'] },
  { key: 'line-change', native: ['prop:changeButton'] },
  { key: 'hint', native: ['prop:hintButtonView'] },
  { key: 'show-answer', native: ['prop:answerButton', 'prop:redoAnswerButton'] },
  // B2.9a 重写错字页（网页 write/redo.js）：对照阶段求助行「再写一次」（格下说明按文字配对）
  { key: 'redo-again', native: ['prop:redoAgainButton'] },
  { key: 'judge-wrong', native: ['prop:wrongButton'] },
  { key: 'judge-correct', native: ['prop:correctButton'] },
  { key: 'primary', native: ['prop:doneButton', 'prop:primaryButton'] },
  { key: 'undo-bar', native: ['id:native-write-undo-bar'] },
  { key: 'undo-bar-text', native: ['id:native-write-undo-text'] },
  { key: 'end-dialog', native: ['id:native-write-end-dialog'] },
  { key: 'end-body', native: ['id:native-write-end-body'] },
  { key: 'sheet', native: ['prop:sheet.view'] },
  { key: 'change-title', native: ['id:native-change-title'] },
  { key: 'change-mine', native: ['id:native-change-mine'] },
  { key: 'change-ref', native: ['id:native-change-ref'] },
  { key: 'change-note', native: ['id:native-change-note'] },
];
