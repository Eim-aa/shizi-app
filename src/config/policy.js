// 过渡默认值（transitional defaults）。
//
// 规则（01-架构设计 §1 硬性约束）：未决项不能被代码默认值悄悄裁决——所有过渡默认值集中在本文件，
// 每一项都带 03-待产品决定 的 P 编号；界面不得据此宣称「已定」。产品负责人拍板后回写决定表
// 并更新此处。scripts/verify_copy.mjs（policy 检查）与 test/core/policy.test.mjs 断言：
// 每个导出项、每个嵌套键的注释都含 P 编号，且该编号在 03 表里有登记。
//
// 使用：`import * as policy from '../config/policy.js'`；core 函数都接受 `policy` 注入以便测试。

// ---- 功能开关 ----
// P31 / P07 / P08 / P11 / P12 / P13 / P49 / P51 / P30：features.* 开关，每个键的来源见行尾。
export const features = Object.freeze({
  // P31 逐判断笔迹存储。决定-D14「另案暂停」。任务卡 M0-6 指定 false（关闭时按 10.12「有记录无笔迹」出货）；
  // 注意 03 表 P31 过渡默认写的是 true 且「未解除前不得以此上线」——两处不一致，已在 M0-6 报告登记待裁决。
  perRecordInk: false,
  soundscape: false, // P07 练字背景音：按 Issue #166 删除
  milestones: false, // P08 里程碑庆祝：删除
  difficultyFeedback: false, // P11 文案-D6「这组字难不难」：不影响选字 → 整块不显示
  nextReviewLine: true, // P12 文案-D7「下次练习 · 大约 X 日再练到」：保留（仅有 judged 记录时）
  photoHint: false, // P13 文案-D10「写完提示做成图片」：删除
  imagePickChars: false, // P49 走查-M06 挑字 / L13 选用哪一次笔迹：不做
  appearanceSwitch: true, // P51 「外观：浅色/深色/跟随系统」：按冻结设计实现
  devTools: true, // P30 题库质检等开发工具：保留，仅 ?dev=1 可见（见 devToolsParam）
});

// ---- 墨迹容量（P05，P31 解除后才生效）----
// P05 墨迹总预算（字节，UTF-16 估算）
export const inkBudgetBytes = 1.5 * 1024 * 1024;
// P05 存储前每笔最多点数（按弧长抽点）
export const inkMaxPointsPerStroke = 32;
// P05 每条墨迹最多笔数
export const inkMaxStrokes = 36;

// ---- 备份与保护副本 ----
// P32 保护副本寿命：跟随备份页生命周期
export const undoSnapshot = 'persist';
// P32 非主动重载后仍在备份页：继续给撤销（A）
export const undoAfterReload = 'resume';
// P26 替换确认写明会丢失的日期范围（走查-K04）
export const replaceConfirmShowsLostRange = true;

// ---- 图片 ----
// P02 月字帖取墨：本月第一次（M02）；显示与导出一致
export const monthSheetPick = 'first';
// P50 缺墨字：按第十稿 10.12 不画进图并说明（不用 D11 的浅参考）
export const imageMissingInk = 'omit';
// P25 一张图片的字数上限（D12 契约）
export const imageMaxChars = 80;
// P25 超上限：返回 pending + 待文案说明，不截字
export const imageOverflow = 'pending';

// ---- 调度与选字 ----
// P03 第二次起每组字数
export const groupSize = 5;
// P03 每日到期复习上限（练完记账）
export const dailyReviewCap = 30;
// P09 第一次练习的 5 个字（旧校准组前 5）
export const firstQueue = Object.freeze(['尴', '嚏', '狩', '晤', '飓']);
// P33 「自选了还没写」是否进入今天的练习：不进（只走 B 路径）
export const customIntoDaily = 'none';
// P34 带提示且判写对的 FSRS 评级
export const ratingWithHint = 'Good';
// P36 看过答案（无判断）的字当天是否排除出 daily：不排除
export const answerSeenScope = 'none';
// P06 「跳过」排除范围：只在当前会话（记 skipped 记录，不写 stoppedAt）
export const skipScope = 'session';
// P04 快忘了口径：最近一次 judged 为写对且 FSRS 到期
export const forgetRule = 'due';
// P04 快忘了最多几个
export const forgetCap = 12;
// P37 跨天未完成的「今天的练习」：直接作废（已判断的保留，未写的不算）
export const dailyExpiry = 'discard';
// P38 S02「结束那组，开新的」时旧 B 有判断：不进结果页，给轻提示
export const s02EndOld = 'toast';
// P46 清空所有记录后下一组重回「第一次练习 5 个字」
export const afterClearRestartFirst = true;

// ---- 首页 ----
// P16 有未完成组时首页仍显示「今天记录了 N 个字」+ 墨迹行
export const homeShowRecordWhileResume = true;
// P23 题记：三条按日轮换（一年中第几天 mod 3）
export const epigraphRotation = 'day-of-year';

// ---- 写字页与提示 ----
// P17 每字提示上限
export const hintMax = 2;
// P01 提示从哪一笔接着给：按已写笔数
export const hintStartRule = 'written-count';
// P29 GROUPS 部件分组在提示中是否使用：不用（数据保留）
export const hintUseGroups = false;
// P39 first-tip 引导句：只在 first 会话第 1 个字、标题下方、首次落笔后消失
export const firstTip = Object.freeze({
  scope: 'first-session-first-card', // P39
  position: 'under-title', // P39
  dismissOn: 'first-stroke', // P39
});
// P52 抬笔写会话失败：不阻断书写，顶部一次性提示，判断时由三段式兜底
export const strokeSaveFailure = 'non-blocking';
// P24 按键音触发点：判断落定与描红落笔（沿旧）
export const keySoundEvents = Object.freeze(['judge', 'trace-stroke']);

// ---- 查字 / 字库 ----
// P42 查字组件模式：只保留 lookup / pick（不做 add 模式）
export const queryModes = Object.freeze(['lookup', 'pick']);
// P45 查字/选字输入上限：不设硬上限，只过滤不截断
export const queryInputMax = null;
// P19 查字卡片显示真实最近笔迹；墙与 mini 用标准字 + 红点
export const queryCardInk = 'latest';
// P27 墙截断「还有 N 个字 ›」的分母：与墙成员一致（含自选未写）
export const wallMoreScope = 'wall-members';
// P20 拼音口径：显示 SEED `py`（语境读音）
export const pinyinSource = 'seed-py';
// P10b 旧照片记录不算「有记录」
export const legacyPhotoCountsAsRecord = false;

// ---- 提醒 ----
// P18 提醒时间：用户选
export const remindMode = 'user';
// P18 提醒默认时间
export const remindDefault = '20:00';
// P47 通知点开：以 picked（B）打开该字并走 S02
export const reminderOpens = 'picked-s02';
// P48 提醒内容取字：写错过优先，其次到期最久
export const reminderPick = 'wrong-then-overdue';

// ---- 容量 ----
// P28 records 总预算（字节）；超预算或超 400 天先到者折叠最旧月份
export const recordsBudgetBytes = 1.5 * 1024 * 1024;
// P28 records 折叠的天数阈值
export const recordsFoldAfterDays = 400;

// ---- 迁移（M5-4）----
// P10 / P35 / P53：v1 → v2 一次性导入。
export const migration = Object.freeze({
  importLegacy: true, // P10 导入旧数据（A）
  legacyHintedAs: 'none', // P35 v1 reason:"hinted" 且 hintCount>0：不生成判断，只留帮助事实与练习日
  synthesizeFromMemory: true, // P35 有 memory 无事件的字：用 memory 合成 legacy 记录
  legacyKeyRetentionDays: 30, // P53 旧 v1 键回退窗口（天）
  legacyKeyReleaseOnExport: true, // P53 用户完成一次 v2 导出即可提前回收（先到者）
});

// ---- 平台与开发 ----
// P54 返回手势实现层：单 WebView + 原生识别器驱动跟手转场（工程近似）
export const backGesture = 'single-webview';
// P30 开发工具入口的 URL 参数（?dev=1）
export const devToolsParam = 'dev';
