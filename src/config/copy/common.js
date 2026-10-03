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
  // X-SYS（03 P55：坏值顶部提示、迁移失败阻断页补充说明；已写过渡文案，待产品定稿）
  'X-SYS.corruptNotice': '有一部分存下来的内容坏了，读不出来，已经另外收好，其他记录没有受影响。如果发现设置或记录和以前不一样，可以重新设置，或用备份文件恢复。',
  'X-SYS.blockMigration': '之前的记录没能导入这一版，旧记录还原样留在这台手机上，没有丢。如果是存储空间不充足，先空出一些再点下面的按钮重新导入；一直不行的话，不要清理浏览器，也不要删掉拾字。',
  // X-SHARE（M6-6 桥错误回调 shiziShareFailed，03 P96 过渡：原生分享面板没打开 / 外链打不开时的页内轻提示；待文案）
  'X-SHARE.backupFailed': '备份文件没有分享出去，可以再试一次。',
  'X-SHARE.cardFailed': '图片没有分享出去，可以再试一次。',
  'X-SHARE.linkFailed': '这个地址没能打开。',
  'X-SHARE.failed': '没能打开分享，可以再试一次。',
});
