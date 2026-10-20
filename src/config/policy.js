// 过渡默认值（transitional defaults）。
//
// 规则（01-架构设计 §1 硬性约束）：未决项不能被代码默认值悄悄裁决——所有过渡默认值集中在本文件，
// 每一项都带 03-待产品决定 的 P 编号；界面不得据此宣称「已定」。产品负责人拍板后回写决定表
// 并更新此处。scripts/verify_copy.mjs（policy 检查）与 test/core/policy.test.mjs 断言：
// 每个导出项、每个嵌套键的注释都含 P 编号，且该编号在 03 表里有登记。
//
// 使用：`import * as policy from '../config/policy.js'`；core 函数都接受 `policy` 注入以便测试。
// 动效时长与曲线（motion / paperTransition / skipUndo 里的毫秒数）取 config/motion.js（tokens.json motion / timing，D58）；这里只登记用途与 P 编号。

import { M } from './motion.js';

// ---- 功能开关 ----
// P31 / P07 / P08 / P11 / P12 / P13 / P49 / P51 / P30：features.* 开关，每个键的来源见行尾。
export const features = Object.freeze({
  // P31 逐判断笔迹存储：已决定 D27（覆盖 D14「另案暂停」）——立即开启，保留每字第一次 + 最近一次判断的墨迹，其余回收
  // （store/budget.js pruneInkOfCards / recover）；阶段 2 原生数据层后再升级为全部历次。关闭时按 10.12「有记录无笔迹」出货（F4 …Glyph 文案）。
  perRecordInk: true,
  soundscape: false, // P07 练字背景音：按 Issue #166 删除
  milestones: false, // P08 里程碑庆祝：删除
  difficultyFeedback: false, // P11 文案-D6「这组字难不难」：不影响选字 → 整块不显示
  nextReviewLine: true, // P12 文案-D7「下次练习 · 大约 X 日再练到」：保留（仅有 judged 记录时）
  photoHint: false, // P13 文案-D10「写完提示做成图片」：删除
  imagePickChars: false, // P49 走查-M06 挑字 / L13 选用哪一次笔迹：不做
  appearanceSwitch: true, // P51 「外观：浅色/深色/跟随系统」：按冻结设计实现
  devTools: true, // P30 题库质检等开发工具：保留，仅 ?dev=1 可见（见 devToolsParam）
});

// ---- 墨迹容量（P05；P31 已决定 D27 开启后生效）----
// P05 墨迹总预算（字节，UTF-16 估算）
export const inkBudgetBytes = 1.5 * 1024 * 1024;
// P05 / P78 存储前每笔最多点数（按弧长抽点）：v3 打包编码每点 4 字节，24 点/笔使 14 笔的字 ≈ 3.7KB（UTF-16）、
// 300 字只存最近一次 ≈ 1.1MiB，落在 inkBudgetBytes 内（M4-5 实测 v2 + 32 点为 11.8–14.4KB/条，见 01 §3.5）
export const inkMaxPointsPerStroke = 24;
// P05 每条墨迹最多笔数
export const inkMaxStrokes = 36;
// P121 存储前按误差自适应抽点（阶段 1 P1-E3，D27 每字两份）：只留回放误差超出容差处的点（贪心插点，首末必留），
// 仍受 inkMaxPointsPerStroke 封顶；编码仍是 ink v3，解码不变。core/ink-math.js simplifyStroke / encodeInk 读取。
// 实测（test/core/ink-math.test.mjs）：12 画以上 300 字 × 2 份 ≈ 1.0MiB（均匀抽 24 点为 ≈ 2.0MiB），回放偏差不大于均匀抽点。
export const inkStoreTolerance = Object.freeze({
  xy: 0.3, // P121 位置容差（345 单位；v3 量化步长 0.345）
  w: 0.3, // P121 笔宽容差（345 单位；本体宽 11.5）
  t: 24, // P121 时间容差（ms；回放速度 / 停顿洇墨只需大致时间，v3 dt 量化档 16–32ms）
});
// P176 看后自写墨迹的保留天数（Q1，QA simB D1）：看过答案后「自己写一遍」的本人墨存在那条看过答案记录上（D31「看后写的」进作品）。
// 所在的组还开着（结果页 / 这次的图片可用）时永不回收；之后保留到下次同字有判断（写入那次判断时回收），或超过这些天后
// 在预算回收里先于未过期的被回收（两者都排在判断墨迹的其余层之后；store/budget.js indexRecords / inkTier / pruneInkOfCards）。
export const afterSeenInkKeepDays = 30;

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
// P50 缺墨字（已决定 D31 / D46 ⑩，阶段 1 P1-E7）：作品 / 这天的图片里无墨的字不收（不画进图、不能「放进去」）；月字帖与年报里整段没留墨的字
// 画 under 衬底（仍占一格、仍计字数）。键保留是为了让「无墨即不收」有一个出处。
export const imageMissingInk = 'omit';
// P25 一张图片的字数上限（D39：超过按日期分成多张，每张 ≤ 此数、不截字；core/images/paginate.js）
export const imageMaxChars = 80;

// ---- 调度与选字 ----
// P03 第二次起每组字数的缺省（D65 #2，覆盖 D41 的 5）：用户在「我的 › 每组字数」里选（settings.groupSize，取值见 groupSizeOptions，P314）；
// 没选过（含所有老用户）按 20。今日计划、首页主按钮、字库「今日练习」、再写一组都读同一个值（core/group-size.js groupSizeOf）。
export const groupSize = 20;
// P314 「每组字数」可选的值（D65 #2）：5 / 10 / 20 / 30。配比、积压阀、每日复习上限、回来的第一组按组大小等比例换算（groupMix.baseSize）。
export const groupSizeOptions = Object.freeze([5, 10, 20, 30]);
// P03 每日到期复习上限（练完记账；D41 之后只作「一天写很多组」时的保险：按 5 字一组写的 30，组大小换了按比例换算（= 6 组的复习量，20 字一组为 120），
// 要写 7 组以上才会碰到；到期不够时的「提前复习」补位不计入此上限，见 groupMix.earlyCountsTowardCap）
export const dailyReviewCap = 30;
// P125 每组复习与新字的配比（已决定 D41「保底一新 + 积压阀」，规则 D；依据 docs/engineering/v10/phase1/复习新字配比-研究与推荐.md §4.3 / §6.1，
// 参考实现 docs/engineering/v10/phase1/tools/simulate-mix.mjs RULES.D；阈值以 groupSize=5 为前提，改组大小须重跑模拟）。
// 积压天数 p = 到期未写数 ÷（reviewsPerGroupForPressure × 近 pressureWindowDays 天平均每天组数，至少 1）；全部输入从现有 records / sched 推出，不新增存储。
// D65 #2（P314）：下面的个数都按 baseSize（5 字一组）写，组大小换了按 size / baseSize 等比例换算（core/mix.js scaledCount，四舍五入、至少 1）：
// 新字 1 / 2 / 3 份 → 20 字一组 4 / 8 / 12 个；积压折算 4 → 16；回来的第一组 3 → 12。p 的单位是「天」，所以天数阈值不用换算，
// 按字数算的积压门槛自然随组大小等比例。比例不变的理由：D41 的配比是按「一组里新字占几成」在 5 字组上模拟定的（研究 §4.3），
// 组变大以后每天的复习量与新字量同比例放大，积压的增长速度（以天计）和 5 字组一致；见 docs/qa/调度模拟报告.md 的 5 字 / 20 字对照。
export const groupMix = Object.freeze({
  baseSize: 5, // P314 下面各个数所依据的组大小（D41 按 5 字一组定的）
  newMax: 3, // P125 每组新字最多 3 个（到期与提前复习都不够补位时才补到第 4、5 个，例如首练后的第一组）
  threeNewBelowDays: 0.5, // P125 p < 0.5 且最近新字写对率 ≥ threeNewMinAccuracy → 3 个新字
  threeNewMinAccuracy: 0.6, // P125 给第 3 个新字所需的最近新字写对率
  twoNewBelowDays: 1.5, // P125 p < 1.5 → 2 个新字
  valveDays: 4, // P125 p < 4 → 1 个新字；p ≥ 4（积压阀，D65 #2）→ 新字 0（全复习），直到 p 回落到 valveReleaseDays 以下
  valveReleaseDays: 2, // P314 积压阀回滞（D65 #2）：阀关着（上一组 0 个新字）时 p ≥ 2 仍不给新字；null = D41 旧阀（p ≥ 4 时隔一组给 1 个，只作对照）
  reviewsPerGroupForPressure: 4, // P125 积压折算：每组按 4 个复习算几天能清掉
  pressureWindowDays: 7, // P125 「近几天平均每天组数」的窗口（不含今天），至少按 1 组算
  recentNewWindow: 10, // P125 「最近新字写对率」取最近几个新字的首次判断
  newAccuracyPrior: 0.5, // P125 新字写对率的先验（缺数据时平滑）
  allAccuracyPrior: 0.7, // P125 全部判断写对率的先验（热身字门控用）
  accuracyPriorWeight: 2, // P125 先验按几个判断的权重平滑
  returnAfterDays: 7, // P125 离开 ≥ 此天数后回来的第一组，积压阀不判「全复习」，照常给 1 个新字
  returnGroupSize: 3, // P184（已决定 D48 ⑧，补充 D41）离开 ≥ returnAfterDays 天回来的第一组缩短为 3 字（配比规则不变，只是组小了；大写数字特别组整组出，不受影响）
  earlyReviewFill: true, // P125 到期不够时用最快到期的字提前复习补位，再不足才补新字
  earlyCountsTowardCap: false, // P125 提前复习是否计入 dailyReviewCap（P03）：不计入
});
// P315 写错的字优先回来（D65 #1，问题清单 #1）：到期字排序先「最近一次练习日写错、今天到期」，再「最近一次判断是写错」的其余到期字，最后普通到期字
// （同一层内仍按逾期天数降序、稳定度升序）；每组再保底 ceil(组大小 × reserveShare) 个「最近一次练习日写错、今天到期」的字，不受每日复习上限与新字目标挤占。
// 比例 0.2 = 每 5 个字 1 个：一天一组、写对率 80% 时一组大约写错这么多，昨天写错的字今天都能回来；更多时排序已让它们排在最前。
export const wrongFirst = Object.freeze({
  enabled: true, // P315 总开关
  reserveShare: 0.2, // P315 保底比例（按组大小，向上取整：5 → 1、10 → 2、20 → 4、30 → 6）
});
// P126 热身字（D28 的细化，已决定 D41）：每组至多 1 个高频字、放组首；只在首练后 firstDays 天内，或最近 window 次判断写对率 < accuracyBelow 时放，
// 占一个新字位（新字位 ≥ 2 时）；热身字写对（无提示）一律记 Easy（easyOnCorrect）。热身字清单是数据（src/config/char-order.js，由脚本生成）。
export const warmup = Object.freeze({
  mode: 'gated', // P126 门控：只在 firstDays 天内或最近写得吃力时放
  firstDays: 7, // P126 首练当天算第 1 天，到第 7 天为止
  accuracyBelow: 0.6, // P126 最近 window 次判断写对率低于此值时也放（写得吃力的时候，用好写的字托一下）
  window: 10, // P126 看最近几次判断
  perGroupMax: 1, // P126 每组至多 1 个热身字（新热身字或热身字的复习二选一）
  easyOnCorrect: true, // P126 热身字写对（无提示）记 Easy
});
// P127 新字第一次判断就写对（无提示）的 FSRS 评级（已决定 D41：Easy，初始稳定度约 8 天；带提示写对按 P34 ratingWithHint.first）；判断前看过答案的新字不算第一次（D66 ①，P321）
export const ratingFirstCorrect = 'Easy';
// P128 D40「写写大写数字」特别组：累计写满 afterGroups 组后、且积压天数 p < belowDays 的下一次练习，日常组换成两组特别组
// （壹贰叁肆伍、陆柒捌玖拾，各一组；佰仟在两组特别组之后进入普通新字队列的最前）。每组各只出现一次（以记录为准），之后按普通 FSRS 回来。
export const capitalNumerals = Object.freeze({
  enabled: true, // P128 总开关
  afterGroups: 10, // P128 累计写满几组之后（首练算一组；有判断的组才算）
  belowDays: 1.5, // P128 触发时积压天数 p 须小于此值（与「2 个新字」同一档）
});
// P09 第一次练习的字（已决定 D38：尴 → 赢 → 拾，共 3 个，三字都在默认库「规范常用字」；首练组大小 = 此队列长度，只影响首练，之后每组仍是 groupSize）
export const firstQueue = Object.freeze(['尴', '赢', '拾']);
// P33 「自选了还没写」是否进入今天的练习：不进（只走 B 路径）
export const customIntoDaily = 'none';
// P34 带提示且判写对的 FSRS 评级（D65 #4，覆盖 D41 的「一律 Good」；D66 ② 改复习一档）：按点了几次提示取第 n 个（超出取最后一个），新字第一次判断与复习分开。
// 复习（D66 ②）：1 次（约四分之一个字）Hard，2 次起（平均已露出一半以上的笔画）Again——给出一半以上就算没想起来，与写错同一个间隔；
// 修前 1–2 次都是 Hard，2 次提示的成熟字仍约 4 个月后再见（产品体验评审 P2-02）。
// 新字第一次：1 次 Good（初始稳定度约 2 天，与无提示的 Easy 约 8 天拉开），2 次 Hard（约 1 天），3 次起 Again（明天）；首次学习不至于因为一次提示就被压到「几乎每天都来」。
// D66 ① 复核：新字第一次这一档不改——Hard 与 Again 下次都是明天（至少次日），差别只在之后长得快慢；判断前看过答案的新字不走这一档，按复习一档（见 answerSeenRating）。
// 每段提示约四分之一个字（core/hints.js）；没有部件分组的字每段 1 笔，按同一张表（次数口径，记录里只存次数）。
export const ratingWithHint = Object.freeze({
  first: Object.freeze(['Good', 'Hard', 'Again']), // P34 新字第一次判断带提示写对：1 次 / 2 次 / 3 次起
  review: Object.freeze(['Hard', 'Again', 'Again']), // P34 复习带提示写对：1 次 / 2 次起（D66 ②）
});
// P36 看过答案（无判断）的字当天是否排除出 daily（D65 #5，覆盖原 'none'）：'today' 当天不再出；到期的字明天回来（D66 ① 起复习字看答案记一次 Again，见 P321），新字明天照常在新字池原位
export const answerSeenScope = 'today';
// P321 看过答案 = 当天「没写出来」（D66 ①，覆盖 D65 #5 的「看答案不改调度」；产品体验评审 P2-01）：
// 'Again' = 复习字（已有调度项）看了答案，当天记一次 Again（不生成判断记录、不改三档以外的计数），下次按「忘了之后」的间隔回来；
// 一个字一天只记一次：当天判断过、或已经因为看答案记过的，不再记；同一天看过答案之后再写的判断不再进 FSRS（不记第二次 Again，写对也不加分）。
// 新字看了答案不建调度项，之后第一次判断不再给 Easy：按复习口径评级（无提示写对 Good、带提示按 ratingWithHint.review）——
// 理由：看过答案以后的第一次写对是在短时记忆的帮助下写出来的，不是「第一次凭记忆写出来」（Easy 约 8–10 天）；Good 约 2 天，与「第一次写错再写对」相近。
// 'none' = 修前口径（看答案不改调度，只作对照）。core/fsrs.js applyAnswerSeen / applyJudgment / replay 读取。
export const answerSeenRating = 'Again';
// P06 「跳过」排除范围（D65 #5，覆盖原 'session'）：'today' = 当天不再出（记 skipped 记录，不写 stoppedAt，调度项不变）；'session' = 只在本组内
export const skipScope = 'today';
// P06 跳过的新字（从没判断过）推迟几天再进新字池（D65 #5）：跳过那天算第 1 天，这些天里新字池跳过它，之后回到原来的位置
// （不放池尾：池尾 = 几千个字之后，等于再也见不到；也不写 stoppedAt）。0 = 不推迟。
export const skipNewDeferDays = 7;
// P04 快忘了口径：最近一次 judged 为写对且 FSRS 到期
export const forgetRule = 'due';
// P04 快忘了最多几个
export const forgetCap = 12;
// P322 字库「已熟悉」的条件（D66 ⑰，产品体验评审 P2-07；D60 只要稳定度 ≥ 21 天）：稳定度 ≥ stabilityDays 天，且至少 minSuccesses 次「想起来了」。
// 「想起来了」= 调度项上评过级、不是 Again 的次数（FSRS reps − lapses：写对 / 带 1 次提示写对；写错、2 次以上提示、看答案记的 Again 都不算）——
// 从调度项读，最旧月份折叠掉中间的记录也不影响。理由：第一次无提示写对（Easy，约 8 天）后隔 10 天再写对一次，稳定度就过 21 天，
// 只有两次提取、跨 10 天，撑不起「已熟悉」；三次成功意味着至少两次是隔了几天以后的回忆。达不到的字留在「未熟悉」，三档合计不变。
export const knownZone = Object.freeze({
  stabilityDays: 21, // P322 稳定度下限（天；D60 原值）
  minSuccesses: 3, // P322 至少几次「想起来了」（reps − lapses）
});
// P113 写错过 / 快忘了清单默认勾选几个「最该练」的字（已决定 D36）；其余收在「其余 N 个字」下，展开后可逐个选
export const listDefaultSelect = 5;
// P37 跨天未完成的「今天的练习」：直接作废（已判断的保留，未写的不算）
export const dailyExpiry = 'discard';
// P320 一天从几点开始（D66 ⑦，覆盖 01 §3.1「日界本地 0 点」）：凌晨 4 点——0:00–3:59 仍算前一天。core/dates.js localDay 是唯一的归日函数：
// 记录的 localDay、今日计划、跨天作废（P37）、到期（due ≤ 今天）、连续 / 累计练习天数、年报与月字帖归日、提醒 practicedToday 都读它。
// 只影响新判断的归日与「今天」的判定，已经存下的 localDay / due / startedDay 不改写。0 = 0 点分界（旧口径）。
export const dayStartHour = 4;
// P61 首练（first）与自选组（picked）是否跨天过期：都不过期（'never'）；'daily' = 与今天的练习同口径（P37）。
// daily 本身仍按 P37 dailyExpiry。core/sessions.js expireDaily 读此表。
export const sessionExpiry = Object.freeze({
  first: 'never', // P61 首练不跨天过期
  picked: 'never', // P61 自选组（B）不跨天过期
});
// P60 自选组（B）里的复习是否计入每日复习上限 dailyReviewCap（P03）：过渡计入。
// 现行记账 records.reviewsDoneOn 按当天全部 judged 计，即 true 的口径；false 需记录能区分会话类型，见 M0 验收修复报告。
export const dailyCapCountsPicked = true;
// P38 S02「结束那组，开新的」时旧 B 有判断：不进结果页（core 仍回报 notice；界面不弹提示，D58 / I3 P0-10）
export const s02EndOld = 'toast';
// P46 清空所有记录后下一组重回「第一次练习」
export const afterClearRestartFirst = true;
// P73 没有设置练习范围（settings.library 缺省 / 未知）时的默认字库：沿旧版 core3500（B-scheduling §7；M2-2 报告）。
// 换库 / 首次启动让用户选属 M3-5。src/data/deck.js DEFAULT_LIBRARY_ID 与 src/core/session-start.js planDaily 读取。
export const defaultLibrary = 'core3500';

// ---- 首页 ----
// P23 题记：三条按日轮换（一年中第几天 mod 3）
export const epigraphRotation = 'day-of-year';

// ---- 写字页与提示 ----
// （提示次数 / 起点：已决定 D64 ①，不再限次、不看已写笔数，由 core/hints.js 推出，这里不放数字）
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
// P24 / P200 声音触发点（已决定 D50 ⑦ / D46 ⑮）：判断「收进」（j1 纸页落定，三个变体轮换）与结果页落款（s1 木印·闷实）；
// 书写与描红不出声（原 trace-stroke 点位与高频纸声已删除）。素材 assets/sound/（scripts/sound/gen.mjs 程序合成），逻辑 platform/sound.js。
export const keySoundEvents = Object.freeze(['judge', 'seal']);
// P201 声音播放增益（dB，已决定 D50 ⑦ 的「判断声比盖章低约 6–8dB」）：这个差已经在素材里——LUFS-M −31 对 −23（耳机 8dB）、
// 采样峰值 −10.6…−12.2 对 −3.0 dBFS、外放估差 6.1dB——所以两项都取 0dB，不在播放端放大（放大会削波）；
// 真机试听后落款偏吓人 / 偏轻时在这里调（负值降、不超过 0 以防削波）。原生与网页同一取值（原生消息带 gain）。
export const soundGainDb = Object.freeze({ judge: 0, seal: 0 });

// ---- 笔迹渲染（手感参数，待真机）----
// P65 笔迹渲染常量：core/ink-math.js 默认从这里读（buildStroke / catmullRom / resampleForReplay / encodeInk 的 base），
// 仍可经 opts 注入（opts.policy 整表或 opts.base / lo / hi 等单键）。全是「待真机」起始值（交接备注一、八.3；
// L-proto-model-ink §4.2），Pencil / ProMotion 真机看过再定。已定规格（speedCap 1.5、tau 35ms、window 30ms、
// dotLen 24、single .9，交接备注八.1 / D09）不在此表，留在 ink-math 的 INK_SPEC。
export const ink = Object.freeze({
  base: 11.5, // P65 本体宽 BASE（345 单位）；来源：原型 SZInk.build / 交接备注八.1
  lo: 0.25, // P65 收笔阈值 LO：抬笔前 30ms 均速 ≤ lo 不收尖（单位/ms）；来源：交接备注八.1
  hi: 0.9, // P65 收笔阈值 HI：均速 ≥ hi 收到最尖（单位/ms）；来源：交接备注八.1
  pressureLo: 0.58, // P65 压力因子 .58 + √p·gain 的截距兼下限（pen 且 p>0，D10）；来源：旧版 index.html:2198（639f592）
  pressureGain: 0.94, // P65 压力因子增益 √p 系数；来源：旧版 index.html:2198
  pressureHi: 1.52, // P65 压力因子上限；来源：旧版 index.html:2198
  step: 3, // P65 Catmull-Rom 重采样步长（约 3 单位一点，03 P65「抽点步长」）；来源：交接备注八.1 / 原型
  tapMax: 28, // P65 收尖段长度上限 min(tapMax, tapRatio·len)；来源：原型 SZInk.build（文字规格未写）
  tapRatio: 0.3, // P65 收尖段占全长比例；来源：原型 SZInk.build（文字规格未写）
  endMinSlow: 0.9, // P65 收尖末端倍数（k=0，慢收笔，实际不收尖）；来源：原型 SZInk.build（文字规格未写）
  endMinFast: 0.12, // P65 收尖末端倍数（k=1，快收笔最尖）；来源：原型 SZInk.build（文字规格未写）
  euroMinCutoff: 1, // P65 1€ 滤波 minCutoff；来源：原型 SZInk.build（文字规格未写）
  euroBeta: 0.02, // P65 1€ 滤波 beta；来源：原型 SZInk.build（文字规格未写）
  euroDCutoff: 1, // P65 1€ 滤波 dCutoff；来源：原型 SZInk.build（文字规格未写）
});

// P111 笔锋细节（飞白 / 洇墨）总开关：true = 只由「减少动态效果」决定；false = 一律关。不再按 hardwareConcurrency / deviceMemory 关
// （iOS WebKit 会钳低这两个值，ADA G15）。src/ui/canvas/brush.js brushDetailEnabled、ink-canvas.js 读取。
export const brushDetail = true;

// ---- 写字页版式与动画节奏（M1 验收后登记，M2-H 迁入）----
// P69 紧凑版触发（已决定 D36：只改控件排布，不再缩书写格）：视口高度 ≤ 此值（px）或 :root[data-text-large]（系统字号 --k ≥ compactTextScale，P131）时写字页用紧凑版。
// src/ui/screens/write/compact.js 读取（COMPACT_MAX_HEIGHT / COMPACT_QUERY，CSS media 与 JS 同一条件）。
export const compactMaxHeight = 760;
// P258 全 App 主按钮的底线（R3-C3W；第三轮 T3-01 / T3-04，D53 ② ③）：主按钮底边落在「安全区上沿（Tab 栏页是 Tab 栏上沿）往上 gapAboveEdge」这一条线上——写字页 / 判断页的底栏
// 只有一行主按钮（+「⋯」），底栏下内边距 = 下安全区 + gapAboveEdge；首页把主按钮放在 Tab 栏上沿往上同一距离。两边共用这一个常量（首页卡 C3-H 合并时以先定义的为准）。
// R4-F1（D55，P260）：写字页底栏回到「主按钮 + 其下一行文字按钮」（提示 / 看答案 / 跳过一次点击直达，不再收进「⋯」），主按钮因此比首页高一行；
// 写字页曾不用这条线（底栏下内边距 max(8, 下安全区)）；W2 / A7 起求助行挪到主按钮上方，R5M（P298，审计 P1-15）起写字页、结果页、备份页、首页全部回到这一条线。
export const mainButtonLine = Object.freeze({
  gapAboveEdge: 24, // P258 主按钮底边到安全区 / Tab 栏上沿的距离（pt）
});
// P118 书写格显示边长（D36，覆盖 X08「紧凑版固定 258」与 P69 的缩格；阶段 1 E9b 按 D49 实现交接 §13.2 改公式）：题面（高 P）、promptGap、书写格（边长 g）、
// 格下工具行（高 toolsHeight）作为一组放在主区（页头底 → 按钮行顶 − 12）里：g = clamp(min, min(屏宽 − 2·sideMargin, max, 主区高 − P − promptGap − toolsHeight − bottomGap), max)；
// 组顶 = max(topMin, round((主区高 − 组高) × topShare))（空余 40% 在上、60% 在下）。内部坐标仍是 345 单位，只缩放显示（src/ui/screens/write/layout.js）。
// g 与字号（--k、:root[data-text-large]）无关（xS–XXXL）；AX 档（:root[data-ax]）改为按实际可用高度排版、永不滚动（D51 ⑦，P225）：g = clamp(axMin, min(屏宽 − 2·sideMargin, max,
// 实际主区高 − P − promptGap − axNoteHeight − bottomGap), max)，撤销 / 清空移到页头，格下只留 axNoteHeight 高的说明位。非 AX 档放不下（g 取下限）时页面正文可滚动、按钮行上沿出现 hairline。
export const writeGrid = Object.freeze({
  min: 258, // P118 书写格边长下限（pt）
  max: 400, // P118 书写格边长上限（pt）
  sideMargin: 20, // P118 格子距屏幕左右边缘至少 20pt（屏宽 − 40；设计系统 v1 页边 20，P1-E1b 由 16 改）
  promptGap: 16, // P118 题面到书写格的间距（pt；D49 实现交接 §13.1，P1-E1b 的 24 改 16）
  toolsHeight: 40, // P118 格下说明位高度（pt；D49 实现交接 §13.1 原是「说明 + 撤销 / 清空图标」工具行，P258 起撤销 / 清空在页头，只剩说明位）
  toolRowHeight: 48, // P280（D57，A7）格下工具行 = 离格 4 + 撤销 / 清空 44（图标加文字，贴格左右沿）；格下总高 = toolRowHeight + toolsHeight（说明位仍在工具行下面）
  axMin: 220, // P225 AX 档书写格边长下限（pt；D51 ⑦：258 → 220，SE 3 的 AX5 也放得下，格子完整可写好过大格子被盖住）
  axNoteHeight: 56, // P225 / P241 AX 档格下说明位的最小高度（pt；R3-K1 起按量到的实际高度排，格子缩到 axMin 仍放不下时见 P261 的让步顺序，R4-F1 起没有「⋯」菜单）
  // P243（R3-K1，第三轮审查 A3-03）AX 档辅助字分层封顶（pt）：[AX1–AX2, AX3–AX5]；取代 P225 一律 17 的 axAuxMax。题面汉字（52 × min(k, 1.6) 的格、字面 80%）仍最大。
  // 样式里是字面值（字阶 17 / 22 / 28，令牌门禁只认字面），test/ui/k1-aux-type.test.mjs 核对两边一致。
  axAux: Object.freeze({
    pinyin: Object.freeze([22, 28]), // P243 拼音：单字题的唯一线索
    note: Object.freeze([17, 22]), // P243 格下说明 / 结果行 / 提示行 / 读屏建议
    progress: Object.freeze([17, 22]), // P243 页头进度「n / m」
    title: Object.freeze([17, 22]), // P243 页头标题（可折两行）
    links: Object.freeze([17, 22]), // P261 底栏主按钮下一行的文字按钮（提示 / 看答案 / 跳过 / 结束这组…；D56 起没有「在纸上写」）：不封顶时 AX5 的 49pt 字让四个按钮折成三四行，书写格放不下
    paper: Object.freeze([22, 28]), // P243 纸上写模式格内的说明与「改回在屏幕上写」
  }),
  // P299（R5M，规范「写字页永不滚动」D51 ⑦，IC-21）放不下时的最后两步：格子已到下限仍放不下 → ① 书写格低于下限，最小 fitGridMin（非 AX 档只有这一步，
  // 且只按名义版式算，与字号和卡无关）；② 格子到 fitGridMin 仍放不下 → AX 档题面整体按可用高度缩小（transform，不重排、不截断），最多缩到 promptFitMin。两步之后仍放不下才让正文滚动（320×568 一类）。
  promptFitMin: 0.6, // P299 AX 档题面缩放下限（AX5 的提示行 22pt × 0.6 ≈ 13pt，仍不小于标准字号的说明字）
  fitGridMin: 180, // P299 书写格最后让步的下限（pt）
  axPromptScaleMax: 1.6, // P225 AX 档题面汉字格的放大倍率上限：格边 = 52 × min(--k, 1.6)（V2-06「练习字按 min(k, 1.6) 放大」）
  bottomGap: 16, // P118 书写格组与按钮行之间至少留的空（pt，D49 实现交接 §13.2）
  topShare: 0.4, // P118 组高以外的空余，上方占的比例（D49 实现交接 §13.2：40% 在上、60% 在下）
  topMin: 12, // P118 组顶下限（pt）
  // E9d（P195，D29 / D36）：书写格边长 g 只由视口决定、不随系统字号变——g 用「标准字号（L 档）下的名义版式」算：名义页头高（不含状态栏）、名义按钮行高（上 12 + 主按钮 54，P258 起底栏只有一行，不含下安全区）、
  // 名义题面高、名义说明位高，再加量到的安全区（状态栏、下安全区与字号无关）。组的垂直位置（top）仍按实际量到的高度排。
  nominalHead: 44, // P195 名义页头高（pt，L 档，不含上安全区）
  nominalFoot: 134, // P195 / P260 / P280 名义按钮行高（pt，L 档：上 12 + 求助行 48 + 间 20 + 主按钮 54；不含下安全区 / 下内边距；A7：求助下到「写好了」正上方 20，D57）
  footBottomMin: mainButtonLine.gapAboveEdge, // P195 / P260 / P298 按钮行下内边距下限（pt，= max(24, 下安全区)：A7 起求助行在主按钮上方，主按钮回到全 App 底线 mainButtonLine，R5M / 审计 P1-15）
  nominalPrompt: 80, // P195 名义题面高（pt，L 档：拼音行 24 + 间 4 + 题面格 52）
});
/** P259 AX 档从这一级起描一遍阶段主按钮改用短文案「自己写」（X-ANSWER.btnTraceDoneShort；AX1–AX2 与常规字号仍是「描好了，自己写」）。 */
export const axShortPrimaryFrom = 3;
// P70 动画节奏（工程取值，原型没有；待设计走查）。各模块默认从这里读，仍可经参数覆盖。
export const motion = Object.freeze({
  answerSpeed: 1.6, // P70 看答案 / 先播一遍笔顺动画速度（hanzi-writer strokeAnimationSpeed）；src/ui/canvas/glyph.js ANIMATION
  answerStrokeGapMs: M.dur.s, // P70 看答案笔间隔（hanzi-writer delayBetweenStrokes，ms）；glyph.js ANIMATION
  answerFadeMs: M.dur.release, // P70 看答案淡入淡出（hanzi-writer strokeFadeDuration，ms；D58 归并：240 → motion.duration.release 220）；glyph.js ANIMATION
  hintStrokeMs: M.dur.release, // P70 提示单笔描画时长上限（ms；D58 归并：240 → motion.duration.release 220，下限 110 → fade 150）；src/ui/screens/write/hint-layer.js HINT_DRAW.maxMs
  hintStagger: 0.7, // P70 提示第 j 笔延迟 = j × 单笔时长 × 此系数；hint-layer.js HINT_DRAW.stagger
  reducedFadeMs: M.dur.reduce, // P70 减少动态效果时提示与笔迹的淡入淡出（ms；D58 ② 全 App 统一 150，原 R-G01 120）；hint-layer.js REDUCED_FADE_MS
  persistNoticeMs: M.timing.toastWithAction, // P70 P52 抬笔写失败的一次性顶部提示显示时长（ms）；src/ui/screens/write/persist.js NOTICE_MS
  hintFadeInMs: M.role.hintIn, // P210 提示整组淡入（ms，D34 / D51 ⑧：网页阶段不逐笔写出）；hint-layer.js HINT_FADE_IN_MS
  answerRevealMs: M.moment.answerReveal, // P210 看答案时答案衬底显影（ms，求助梯子设计稿 I2-02；减少动态效果直接显示）；answer.js ANSWER_REVEAL_MS
  stepPlayMaxMs: M.moment.stepPlayMax, // P210 描一遍前笔顺快放总时长上限（ms，含起始淡化与笔间隔；落笔 / 点一下即到终态）；glyph.js playbackPlan
});
// P282–P284 写字页进出动效（W2，D57；设计稿「写字页与我的.html」B 节，B1 按钮长成这张纸 / B3 安静淡入）。进出共用同一个进度 s（1 = 写字页，0 = 来源）：点按时 s 按曲线走，
// 左缘右滑时 s = 1 − 手指进度 p 逐帧跟手（src/ui/paper-transition.js，由 root.js 的 BACK_TRANSITION 接上 router 的进度接口）。曲线是 cubic-bezier 的四个控制点。
export const paperTransition = Object.freeze({
  openMs: M.role.paperIn, // P282 B1 进入时长（ms）：按钮长成整张纸；曲线 openEase
  closeMs: M.role.paperOut, // P282 B1 退出时长（ms）：纸收回按钮；曲线 closeEase
  openEase: M.bezier.paperOpen, // P282 B1 进入曲线（起步稍慢，让人看得见按钮在长）
  closeEase: M.bezier.out, // P282 B1 退出 / 松手完成 / 取消回弹的曲线
  fullMs: M.role.paperGestureFull, // P282 左缘右滑松手完成：从当前位置继续收进按钮，时长 fullMs × 剩余进度 s（至少 minFinishMs）
  minFinishMs: M.role.paperGestureMin, // P282 松手完成的最短时长（ms）
  cancelMs: M.role.gestureCancel, // P282 松手取消：长回整屏的时长（ms）
  dragLeanPt: M.distance.paperDragLean, // P282 跟手时纸往右偏的最大量 sin(π·p) × 60（pt）
  dragRadiusPt: M.distance.paperDragRadius, // P282 跟手开始时纸的圆角（pt），随进度收到按钮的圆角
  contentFadeFrom: 0.6, // P282 写字页内容在 s 从 0.6 起淡入（到 1 满）
  quietOpenMs: M.role.quietIn, // P283 B3 安静淡入进入时长（ms）：没有来源按钮的入口（通知、字库「练这个字」、自选字等）
  quietCloseMs: M.role.quietOut, // P283 B3 退出时长（ms）
  quietScaleFrom: M.scale.quietFrom, // P283 B3 写字页从 0.96 放大到 1
  quietDragPt: M.distance.quietDrag, // P283 B3 左缘右滑时页面跟手右移的最大量（pt）= (1 − s) × 40
  reducedMs: M.dur.reduce, // P284 减少动态效果：进、出、左缘右滑完成一律 150ms 交叉淡化，不缩放、不位移
  veilTo: 0.25, // P310 B1 透明来源（文字按钮、列表行、字帖格）或已不在屏上的来源：纸在元素大小时透明，展开到 s = 0.25 时完全显出（缩回时反向淡出）
  sourceFreshMs: M.timing.sourceFresh, // P282 点来源按钮到页面真正推入之间最多隔多久仍算「从这个按钮来」（ms，超过按没有来源走 B3）
});

// ---- 查字 / 字库 ----
// P56 字库墨墙墨色四档的天数阈值（R-L03；原型硬编码 7/30/90）：≤7 天 / ≤30 天 / ≤90 天 / 更久
export const inkToneDays = Object.freeze([7, 30, 90]);
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
// P48 通知里的词语怎么给（M5-5 过渡）：'blank' = 目标字位换成 □（与写字页题面同样不露答案，决定-D16；
// R-S01「让你想想是哪个字」）；'word' = 旧版整词（639f592 reminderQuestion）。src/platform/reminder.js 读取。
export const reminderWord = 'blank';
// P99 通知里目标字位的占位字符（D53，N2-13）：全角下划线「＿」，锁屏上读作「＿尬（gān）」；原来的「□」在正文字体里与「口」等宽等高，会读成「口尬」。src/platform/reminder.js 读取。
export const reminderBlank = '＿';

// ---- 容量 ----
// P57 占用预警阈值：估算占用 > 该比例 × assumedQuotaBytes 时在备份页与首页状态句预警（01 §4）。store/budget.js 读取（可注入）。
export const storageWarnRatio = 0.8;
// P57 假定的 localStorage 配额（字节）；真机实际配额未测，真机回填。store/budget.js 读取（可注入）。
export const assumedQuotaBytes = 5 * 1024 * 1024;
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
  spreadDuePerDayShare: 0.5, // P314 迁移那一刻已到期（due ≤ 迁移当天）的字摊到之后几天：每天（连同那天本来就到期的字）至多 round(groupSize × 0.5) 个（D65 #2；store/migrate.js spreadLegacyDue）
  legacyKeyRetentionDays: 30, // P53 旧 v1 键回退窗口（天）
  legacyKeyReleaseOnExport: true, // P53 用户完成一次 v2 导出即可提前回收（先到者）
});

// ---- 外观 ----
// P58 已决定 D43（设计系统 v1，阶段 1 P1-E1a）：深色暖灯取消、深色下提示 / 描一遍 / 禁用的颜色在 tokens.json 里单独定值，不再有运行时开关；
// 原 darkLampLevel / darkBrightenStep 删除（docs/engineering/v10/copy-source.json nonRuntimeDecisions 登记 P58）。

// ---- 字号（阶段 1 P1-E6；已决定 D29：字号跟随系统 Dynamic Type，覆盖 X08 与 P59 的固定 1.3 / App 内「更大字体」开关）----
// P130 系统字号档位 → 连续倍率 --k（L = 系统默认 = 1）。原生（WebViewController.swift）读 traitCollection.preferredContentSizeCategory，
// 在 pageReady 与 UIContentSizeCategory.didChangeNotification 时经桥全局 shiziContentSize({category, scale}) 传给页面；
// src/platform/text-size.js 按本表取值写进 :root 的 --k（全站字号 = calc(Npx * var(--k))）。表以外的档位（将来 iOS 新增）
// 退回原生量到的正文倍率 scale（UIFont body 字号 / 17），夹在 xS–AX5 之间。
// xS–XXXL 取 iOS 正文（body）字号与默认 17pt 之比（14/15/16/17/19/21/23 pt）。AX1–AX5 继续增大但比 iOS 正文（28–53pt，×1.65–3.12）收一些：
// --k 是全站同一个倍率，标题 / 题面这些大字也乘它，而 iOS 自己在 AX 档里大字放大得少得多（Large Title 只到 ×1.76）；
// 取正文与大标题之间的值，完整 AX 版式（逐级字阶）待设计稿给出后再细分。须经 T5 系统字号矩阵（DEVICE_QA Q24）真机截图确认。
// 【D49 / P186】AX1–AX5 的**字阶**已不再乘 --k：tokens.css 的 :root[data-ax="N"] 逐级直接取值（像系统 Text Style，取值表 tokens.json
// typography.dynamicType.ax）。下面 AX 档的 --k 只剩两个用途：compactTextScale 的紧凑排布判定，以及少数非字阶尺寸（间距、图标等）的倍率。
export const contentSizeScale = Object.freeze({
  xS: 0.82, // P130 extraSmall（14pt）
  S: 0.88, // P130 small（15pt）
  M: 0.94, // P130 medium（16pt）
  L: 1, // P130 large（17pt，系统默认）
  XL: 1.12, // P130 extraLarge（19pt）
  XXL: 1.24, // P130 extraExtraLarge（21pt）
  XXXL: 1.35, // P130 extraExtraExtraLarge（23pt）
  AX1: 1.6, // P130 accessibilityMedium（iOS 正文 28pt ≈ ×1.65）
  AX2: 1.8, // P130 accessibilityLarge（33pt ≈ ×1.94）
  AX3: 2, // P130 accessibilityExtraLarge（40pt ≈ ×2.35）
  AX4: 2.2, // P130 accessibilityExtraExtraLarge（47pt ≈ ×2.76）
  AX5: 2.4, // P130 accessibilityExtraExtraExtraLarge（53pt ≈ ×3.12）
});
// P131 字号到多大时改用紧凑排布（:root[data-text-large]；写字页底栏两行、首页字大一档等，与视口高 ≤ compactMaxHeight 同一套排布，P69 / D36）。
// 原型紧凑尺寸 ⇔ --k 1.3，取 1.3：XXXL 与 AX 档用紧凑排布，XXL（1.24）及以下仍是标准排布。只改控件排布，不改书写格（P118）。
export const compactTextScale = 1.3;

// ---- 冷启动恢复（审查整改 F1）----
// P108 进程被杀 / 冷启动后恢复离开时的页面栈（R-W13 写字页阶段、P32 备份页撤销）：离开多久以内才恢复。
// 离开时刻 = 最后一次页面变化或切到后台（visibilitychange hidden / pagehide）。src/ui/route-memory.js 读取（可注入）。
export const routeRestore = Object.freeze({
  enabled: true, // P108 冷启动是否恢复离开时的页面（false = 一律落首页，旧行为）
  maxAgeMinutes: 360, // P108 离开超过这么久（分钟）不恢复，落首页
  crossDay: false, // P108 离开时与现在不是同一本地日（跨过一天的分界，凌晨 4 点，P320）时是否仍恢复：过渡不恢复
});

// ---- 跳过撤销（阶段 0 B2，D36）----
// P115 跳过后底部撤销条的寿命与读屏行为（已决定 D36）。src/ui/screens/write/skip.js 读取（SKIP_UNDO_MS 由它派生）。
export const skipUndo = Object.freeze({
  ms: M.timing.undoWindow, // P115 撤销条显示多久（毫秒）；原 3000
  pauseWhileHeld: true, // P115 手指按在撤销条上时暂停计时，松开后接着走（剩余时间不重置）
  keepOpenWithAssistiveTech: true, // P115 VoiceOver / 切换控制运行时不自动收起，到下一次操作才收起（P116 读屏状态由原生传入）
});

// ---- 平台与开发 ----
// P54 返回手势实现层：单 WebView + 原生识别器驱动跟手转场（工程近似）
export const backGesture = 'single-webview';
// P30 开发工具入口的 URL 参数（?dev=1）
export const devToolsParam = 'dev';
