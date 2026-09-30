// 文案 · 通用（tab 名、临时与系统文案）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // X-APP（M0-1 src/app.js SKELETON_TEXT（骨架期临时文案，M0-4 router 接手后删除））
  'X-APP.skeleton': '拾字 v10 骨架',
  // X-TABS（01-架构设计 §1「习字 / 字库 / 我的」三个 tab；04 R-L05「去「习字」…」）
  'X-TABS.write': '习字',
  'X-TABS.library': '字库',
  'X-TABS.mine': '我的',
  // X-COMMON（通用组件：Page.js 页头 aria-label、UndoBar.js 撤销底栏（R-G05））
  'X-COMMON.back': '返回',
  'X-COMMON.close': '关闭',
  'X-COMMON.undo': '撤销',
  'X-COMMON.undone': '已撤销',
  // X-SYS（03 P55 待文案：坏值顶部提示）
  'X-SYS.corruptNotice': 'TODO: 启动时发现坏数据的顶部提示（P55）',
  'X-SYS.blockMigration': 'TODO: 旧数据没能导入时阻断页补充说明（P55，M5-6 迁移变体）',
});
