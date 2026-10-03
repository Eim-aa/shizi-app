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
// P05 / P78 存储前每笔最多点数（按弧长抽点）：v3 打包编码每点 4 字节，24 点/笔使 14 笔的字 ≈ 3.7KB（UTF-16）、
// 300 字只存最近一次 ≈ 1.1MiB，落在 inkBudgetBytes 内（M4-5 实测 v2 + 32 点为 11.8–14.4KB/条，见 01 §3.5）
export const inkMaxPointsPerStroke = 24;
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
// P61 首练（first）与自选组（picked）是否跨天过期：都不过期（'never'）；'daily' = 与今天的练习同口径（P37）。
// daily 本身仍按 P37 dailyExpiry。core/sessions.js expireDaily 读此表。
export const sessionExpiry = Object.freeze({
  first: 'never', // P61 首练不跨天过期
  picked: 'never', // P61 自选组（B）不跨天过期
});
// P60 自选组（B）里的复习是否计入每日复习上限 dailyReviewCap（P03）：过渡计入。
// 现行记账 records.reviewsDoneOn 按当天全部 judged 计，即 true 的口径；false 需记录能区分会话类型，见 M0 验收修复报告。
export const dailyCapCountsPicked = true;
// P38 S02「结束那组，开新的」时旧 B 有判断：不进结果页，给轻提示
export const s02EndOld = 'toast';
// P46 清空所有记录后下一组重回「第一次练习 5 个字」
export const afterClearRestartFirst = true;
// P73 没有设置练习范围（settings.library 缺省 / 未知）时的默认字库：沿旧版 core3500（B-scheduling §7；M2-2 报告）。
// 换库 / 首次启动让用户选属 M3-5。src/data/deck.js DEFAULT_LIBRARY_ID 与 src/core/session-start.js planDaily 读取。
export const defaultLibrary = 'core3500';

// ---- 首页 ----
// P16 有未完成组时首页仍显示「今天记录了 N 个字」+ 墨迹行
export const homeShowRecordWhileResume = true;
// P23 题记：三条按日轮换（一年中第几天 mod 3）
export const epigraphRotation = 'day-of-year';
// P75 紧凑版首页墨迹行与计数合成一行、只放最近几个字（原型首页壳 L233 审美返修 A09；D12 只写了 N ≤ 8；M2-1 报告）。
// 数字仍为 N。src/ui/screens/home/today.js INK_ROW_COMPACT_MAX 读取。
export const inkRowCompactMax = 4;

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

// ---- 写字页版式与动画节奏（M1 验收后登记，M2-H 迁入）----
// P69 紧凑版触发：视口高度 ≤ 此值（px）或 :root[data-large] 时写字页用紧凑版。src/ui/screens/write/compact.js 读取
// （COMPACT_MAX_HEIGHT / COMPACT_QUERY，CSS media 与 JS 同一条件）。原型只按大字切换，高度阈值是工程取值，待设计确认。
export const compactMaxHeight = 760;
// P70 动画节奏（工程取值，原型没有；待设计走查）。各模块默认从这里读，仍可经参数覆盖。
export const motion = Object.freeze({
  answerSpeed: 1.6, // P70 看答案 / 先播一遍笔顺动画速度（hanzi-writer strokeAnimationSpeed）；src/ui/canvas/glyph.js ANIMATION
  answerStrokeGapMs: 180, // P70 看答案笔间隔（hanzi-writer delayBetweenStrokes，ms）；glyph.js ANIMATION
  answerFadeMs: 240, // P70 看答案淡入淡出（hanzi-writer strokeFadeDuration，ms）；glyph.js ANIMATION
  hintStrokeMs: 240, // P70 提示单笔描画时长上限（ms，下限 110 为原型值）；src/ui/screens/write/hint-layer.js HINT_DRAW.maxMs
  hintStagger: 0.7, // P70 提示第 j 笔延迟 = j × 单笔时长 × 此系数；hint-layer.js HINT_DRAW.stagger
  reducedFadeMs: 120, // P70 减少动态效果时提示与笔迹的淡入淡出（ms，R-G01）；hint-layer.js REDUCED_FADE_MS
  persistNoticeMs: 5000, // P70 P52 抬笔写失败的一次性顶部提示显示时长（ms）；src/ui/screens/write/persist.js NOTICE_MS
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
  legacyKeyRetentionDays: 30, // P53 旧 v1 键回退窗口（天）
  legacyKeyReleaseOnExport: true, // P53 用户完成一次 v2 导出即可提前回收（先到者）
});

// ---- 外观 ----
// P58 深色暖灯透明度（原型可调 .04–.06）。只登记：CSS 读不到 JS，现行值在 src/config/tokens.css 的 --lamp，改这里须同步那里。
export const darkLampLevel = 0.05;
// P58 W23 / R-W24 深色下提示笔、描摹轮廓、禁用按钮是否提亮一档：待真机看过再定（过渡不提亮）。
export const darkBrightenStep = false;
// P59 data-large 时的字号倍率 --k（原型紧凑版 1.3）；不跟随系统 Dynamic Type（映射待定）。现行值在 tokens.css :root[data-large] 的 --k。
export const largeTextScale = 1.3;

// ---- 冷启动恢复（审查整改 F1）----
// P108 进程被杀 / 冷启动后恢复离开时的页面栈（R-W13 写字页阶段、P32 备份页撤销）：离开多久以内才恢复。
// 离开时刻 = 最后一次页面变化或切到后台（visibilitychange hidden / pagehide）。src/ui/route-memory.js 读取（可注入）。
export const routeRestore = Object.freeze({
  enabled: true, // P108 冷启动是否恢复离开时的页面（false = 一律落首页，旧行为）
  maxAgeMinutes: 360, // P108 离开超过这么久（分钟）不恢复，落首页
  crossDay: false, // P108 离开时与现在不是同一本地日（跨过 0 点）时是否仍恢复：过渡不恢复
});

// ---- 跳过撤销（阶段 0 B2，D36）----
// P115 跳过后底部撤销条的寿命与读屏行为（已决定 D36）。src/ui/screens/write/skip.js 读取（SKIP_UNDO_MS 由它派生）。
export const skipUndo = Object.freeze({
  ms: 5000, // P115 撤销条显示多久（毫秒）；原 3000
  pauseWhileHeld: true, // P115 手指按在撤销条上时暂停计时，松开后接着走（剩余时间不重置）
  keepOpenWithAssistiveTech: true, // P115 VoiceOver / 切换控制运行时不自动收起，到下一次操作才收起（P116 读屏状态由原生传入）
});

// ---- 平台与开发 ----
// P54 返回手势实现层：单 WebView + 原生识别器驱动跟手转场（工程近似）
export const backGesture = 'single-webview';
// P30 开发工具入口的 URL 参数（?dev=1）
export const devToolsParam = 'dev';
