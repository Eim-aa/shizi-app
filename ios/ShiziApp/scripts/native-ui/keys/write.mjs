// QA-H1 语义键（B3.3 起按屏分文件，elements.mjs 的 loadKeys 按文件名顺序合并）。每条：key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop:/id:）；
// web = 网页 data-testid（id:，id:xxx#N 取同 id 的第 N 个）。页面卡只加自己的 keys/<屏>.mjs。

// 写字页与重写错字页（网页 write/*、write/redo.js）
export const KEYS = [
  { key: 'end', native: ['prop:endButton'], web: ['id:write-end'] },
  { key: 'skip', native: ['prop:skipButton'], web: ['id:write-skip'] },
  { key: 'progress', native: ['id:native-write-count', 'id:native-write-head-progress'], web: ['id:write-progress', 'id:redo-progress'] },
  // 原生页头中间的标签：回忆阶段是进度「n / N」，其余阶段是标题（assignKeys 里按文字分）；网页标题是 h1
  { key: 'center', native: ['id:native-write-progress'], web: [] },
  { key: 'prompt-cell-0', native: ['prop:promptCells[0]'], web: ['id:write-prompt-cell#0'] },
  { key: 'prompt-cell-1', native: ['prop:promptCells[1]'], web: ['id:write-prompt-cell#1'] },
  { key: 'prompt-cell-2', native: ['prop:promptCells[2]'], web: ['id:write-prompt-cell#2'] },
  { key: 'grid', native: ['prop:gridFrame'], web: ['id:write-grid', 'id:write-compare-mine'] },
  { key: 'ref-grid', native: ['prop:refFrame'], web: ['id:write-compare-ref'] },
  { key: 'undo', native: ['prop:undoButton'], web: ['id:write-undo', 'id:redo-undo'] },
  { key: 'clear', native: ['prop:clearButton'], web: ['id:write-clear', 'id:redo-clear'] },
  { key: 'line-text', native: ['prop:lineLabel'], web: ['id:write-line-text'] },
  { key: 'line-change', native: ['prop:changeButton'], web: ['id:write-line-change'] },
  { key: 'hint', native: ['prop:hintButtonView'], web: ['id:write-hint'] },
  { key: 'show-answer', native: ['prop:answerButton', 'prop:redoAnswerButton'], web: ['id:write-show-answer', 'id:redo-show-answer'] },
  // B2.9a 重写错字页（网页 write/redo.js）：对照阶段求助行「再写一次」（格下说明按文字配对）
  { key: 'redo-again', native: ['prop:redoAgainButton'], web: ['id:redo-again'] },
  { key: 'judge-wrong', native: ['prop:wrongButton'], web: ['id:write-judge-wrong'] },
  { key: 'judge-correct', native: ['prop:correctButton'], web: ['id:write-judge-correct'] },
  { key: 'primary', native: ['prop:doneButton', 'prop:primaryButton'], web: ['id:write-done', 'id:write-trace-done', 'id:write-answer-next', 'id:write-next', 'id:result-again', 'id:result-done', 'id:result-leave', 'id:redo-done', 'id:redo-next'] },
  { key: 'undo-bar', native: ['id:native-write-undo-bar'], web: ['id:write-skip-undo'] },
  { key: 'undo-bar-text', native: ['id:native-write-undo-text'], web: ['id:write-skip-undo-text'] },
  { key: 'end-dialog', native: ['id:native-write-end-dialog'], web: ['id:write-end-dialog'] },
  { key: 'end-body', native: ['id:native-write-end-body'], web: ['id:write-end-body'] },
  { key: 'sheet', native: ['prop:sheet.view'], web: ['id:write-change-sheet', 'id:result-sheet'] },
  { key: 'change-detail', native: [], web: ['id:write-change-detail', 'id:result-sheet-detail'] },
  { key: 'change-title', native: ['id:native-change-title'], web: [] },
  { key: 'change-mine', native: ['id:native-change-mine'], web: ['id:write-change-mine', 'id:result-sheet-mine'] },
  { key: 'change-ref', native: ['id:native-change-ref'], web: ['id:write-change-ref', 'id:result-sheet-ref'] },
  { key: 'change-note', native: ['id:native-change-note'], web: ['id:write-change-note', 'id:result-sheet-note'] },
];
