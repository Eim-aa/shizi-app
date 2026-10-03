// 文案 · 关于（R-AB）。
// 键 = 需求条目 id + 槽名；值与 docs/engineering/v10/copy-source.json 逐字一致（scripts/verify_copy.mjs 核对）。
// 改文案先改 copy-source.json（写明出处 / P 编号），再同步这里。数组 = 多行（原文 <br>）。

export default Object.freeze({
  // R-AB01（已定（子页内容未给））
  'R-AB01.privacyRow': '记录只存在这台手机上 ›',
  'R-AB01.openSourceRow': '开源资料 · 致谢 ›',
  'R-AB01.letterTitle': '给我们写信',
  // 写信地址未定（P21）：过渡文案，待产品定稿
  'R-AB01.letterAddressPending': '写信的地址还没有定下来，暂时收不到来信。',
  // X-ABOUT（M4-6 关于页：原型 ShiziScreen L161–L163；三个子页原型没做，隐私 / 开源资料按 03 P21 过渡，待文案）
  'X-ABOUT.title': '关于拾字',
  'X-ABOUT.appName': '拾字',
  // 版本行（阶段 0 B7，已决定 D36 / P90）：版本号 + 构建日期，点按展开完整构建号
  'X-ABOUT.version': '版本 {version}（{day}）',
  'X-ABOUT.versionAria': '版本 {version}，构建日期 {day}，点按显示完整构建号',
  'X-ABOUT.buildFull': '构建号 {build}',
  'X-ABOUT.seal': '字',
  'X-ABOUT.motto': ['提笔忘字，不是忘了，', '只是很久没写。'],
  'X-ABOUT.privacy': '隐私',
  'X-ABOUT.privacy1': '你写的字、笔迹和对错，只存在这台手机上。',
  'X-ABOUT.privacy2': '拾字没有账号，不会把你的记录发到网上。',
  'X-ABOUT.privacy3': '联网只用来更新拾字和取字的笔顺，不会带上你的记录。',
  'X-ABOUT.privacy4': '记录不会自己备份。换手机之前，先在「备份与恢复」里导出备份文件，自己存好。',
  'X-ABOUT.creditsTitle': '开源资料 · 致谢',
  'X-ABOUT.creditsIntro': '拾字用到了下面这些开源的程序、数据和字体。谢谢它们的作者。',
  'X-ABOUT.groupCode': '程序',
  'X-ABOUT.groupData': '字形和字源',
  'X-ABOUT.groupFont': '字体',
  'X-ABOUT.licenseMore': '许可全文',
  'X-ABOUT.more': '›',
});
