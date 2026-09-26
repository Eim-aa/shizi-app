> 历史核查／提案：基于 c7c8fc2。文中原始证据路径属于冻结交付索引，不是本仓库运行依赖；不代表当前主干或已获实施许可。见 [交接入口](../README.md)。

# E8 数据链核查与接口边界

仅检查候选 `c7c8fc2ffbc80241802f1f1743e845dfc8e2160c` 的源码，未读取真实App库、照片或备份。全部动态验证输入见 `fixtures/artificial.json`，不是真人数据。以下行号指该候选 `index.html`。

**现有最近墨迹、月统计和FSRS事件不足以普遍取得“每月／每次最后一次判断的那份笔迹”。** 独立模块接受外部提供的完整判断快照；`coverage:'complete'` 是调用者对该范围完备性的明确保证，本轮只对人工夹具设此值，不能从最近缓存自动推定。

## 从输入到导出

| 层 | 来源 / 实际字段 | 坐标、裁减和寿命 | 可以支持的结论 |
|---|---|---|---|
| 指针采样 | `P`2028输出x/y/t/p；t取event.timeStamp，否则performance.now；pen有p，其他为0 | x/y按CSS矩形换算到动态S；t是当前页面的单调计时，不是Unix时间。相同t被宽度计算强制至少1ms | 输入瞬间有p，不等于后续保存了p；t=0还会因`||`替换 |
| 现场笔画 | `inkBegin/inkMove`2123–2124只存x/y/t/w/v；p在这里丢失 | w是宽度/base比值，v是S坐标单位/ms；inkEnd只纳入≥2点，单点不留；move用合并事件。结束事件没有另收P(up) | w/v不能反推原始p；无原始首尾完整性保证 |
| 当前会话现场 | `capturePracticeVisual/sessionPayload`1358–1365克隆inkStrokes、submissionSnapshot、roundStats、episodes、lastStampSnapshot | 会话version2覆盖同一SESSION_KEY；单字focus会清会话。visual.inkStrokes本身没带canvasSize，提交快照带；恢复2359直接装载数组 | 当前未清会话可能保留部分带t现场，非历史逐次档案；跨重建时钟/画布尺度须核对 |
| 提交快照 | `freezeSubmissionSnapshot`2261–2266：target/idx/attemptId/createdAt/canvasSize，inkStrokes与hintStrokes分开，还有compositeGeometry/compositeImage | 本人笔迹仍x/y/t/w/v，p已缺。Object.freeze只冻最外层；clone才隔离；hint和reference不得冒充本人。createdAt为墙钟，与点t不同 | 有canvasSize可换算至345；某条仍在的原始快照可证明其自身字段，不证明所有历史都在 |
| 每次判断元数据 | `recordOutcome`1656–1688的ep.attempts有attemptId/seq/outcome/userCorrect/uncertain/hintUsed等/at | attempt对象不含笔迹；仅随会话存，完成/新会话可清。roundStats首条每idx一份；之后只在!hard更新handwriting | 后一次写错不会替换roundStats中的旧成功笔迹；末次判断和stat笔迹可能不是一条 |
| FSRS持久事件 | `applyFSRSReview`1116–1127：attemptId/eventId/cardKey/target/reviewedAt/localDay/rating/reason及调度参数 | 独立localStorage键，函数未见长度裁减；无x/y/t/p/w/v，无sessionId显式字段 | 可核某个保留事件日期，不能把Again等同用户写错，不能从调度事件恢复墨迹 |
| 本次图片中间墨迹 | `shareInkFromSnapshot`1647–1649只取本人inkStrokes | x/y÷canvasSize，钳[0,1]、三位小数；前48笔，每笔均匀索引最多48点；w三位ratio、v三位且钳0..6；t/p删除 | 路径可静态重绘，不可精确回放或重推压力 |
| 最近墨迹 | `persistRecentInk`1651–1654，在1676仅!hard调用，即fast；存version2/day/at/dataURL/strokes | 每字只一份。120×120 WebP q.68（允许PNG），dataURL估算UTF16≤32KiB；strokes再裁前36笔、每笔24点，x/y三位，w/v两位。它无attemptId/sessionId | 不是“最近一次对或错判断”；同月匹配只能证明缓存自称该月，不能证明最后判断 |
| 缓存淘汰 | 1089–1093 | 最多96字且dataURL+strokes字符串估算总420KiB；saveMemory失败逐个删最老recentInk再试 | 历史缺墨是预期可能。不是全部笔迹留存承诺；本轮不批准也不扩展删除策略 |
| 备份 | `BACKUP_KEYS/backupPayload`2821、2831–2834：version1，data值是各localStorage键的字符串 | 含memory/activity/session/FSRS等当下仍存在的内容；已被覆盖、淘汰、未存的字段不会凭备份恢复；没有额外矢量压缩 | 备份“含记录”不等于逐次完整笔迹。这里没有读取任何真实备份 |
| 当前图片 | `renderPracticeCardCanvas`2788取roundStats顺序与handwriting；`monthReportData`1780–1785取日去重键并补Good事件；`renderMonthlyPostCanvas`1791–1793先80字，按同月recentInk取图 | 月图可能用旧成功墨代末次错墨；下月覆盖后历史月丢墨；无匹配则黑色字体兜底。单字图2761也只取recentInk | 与本轮“该范围末次判断缺墨→浅参考、不可借旧墨”的要求不同，独立模块修正解析边界但没有接进产品 |

`tests/verify.mjs`对候选原函数 `shareInkFromSnapshot/compactHandCardStrokes` 直接输入50笔×60点的人工记录：实测分别变48×48、36×24，只余x/y/w/v，见 `evidence/node-validation.json`。这是算法裁减证据，不是用户历史完整性调查。

## 保持选字与确定墨迹分开

本次图片的成员和顺序由 `sessionSelection(roundStats,cards)` 逐行沿用当前renderPracticeCardCanvas；不按写对过滤，不从新判断列表重新选字。月图由 `monthSelection` 逐字复现1780–1785：practiceDays升序→当日targetKeys首次出现顺序→补独立键与当月Good事件→映射已知CARDS。用同一人工输入运行候选原函数和适配器，成员/顺序一致。未知旧key仍计入原统计practiced但不能画为已知字，这一不一致应作为调用者警告，不能悄改统计。

P03身份边界已定向修正：缺失或空白 scope.sessionId 明确失败；判断 id/sessionId 与 ink.attemptId 必须是非空字符串，禁止 undefined 相等被误认作关联。记录身份不全回浅参考，不能声称已取得准确末次墨迹；月份格式与真实日历日期同样校验。修前人工反例在 evidence/p03-before-fix.json，修后反例在 tests/verify.mjs。

接着 `resolveGlyphs` 对已选字符只查指定sessionId或localDay月份内的explicit correct/wrong记录，按at再sequence选择最后一条；同刻同序或无有效排序信息则明确缺口。**先选最后判断，再看其ink；不先过滤有墨记录。** ink必须关联同一attemptId；缺失、不合法、身份不符都保留该判断日期作为judgmentDate来源证据并用浅参考。其他月或其他会话的墨不回填。`coverage:'unknown'`时所有已选字保持成员但不声称末次笔迹已证实。

该接口需要：`{id,char,sessionId,localDay,at,sequence,explicit,judgment,ink:{attemptId,coordinateSpace:'normalized-0-1',strokes}}`；p/t并非静态重绘的必需输入，不因此补造。展示日期／角标另由selection条目的displayDate或displayTag传入；renderer不从judgmentDate生成角标。不传展示元数据就不画角标，不自行决定首次分组还是末次日期。冻结imgData把首次分组日期作tag，本次人工图按每四项一组显式给tag，作为测试输入；实际产品分组的接线留后续。日期与会话须由权威调用者提供，不能解析自定义attemptId字符串臆造。该输入结构是独立导出契约，**不是已落地新存储，也不是现有备份转换器**。示例数据标明artificial。将来须有可靠逐判断快照或有证据的局部原快照才能提供complete。

> 当前补记实现1170–1175会把baseTargets复制进被补日targetKeys；设计最新规则只给被补日标记、字算真实书写日，两者有差异。本轮保持既有选字入口，不修补记数据或统计。针对被补月却没有该月明确判断的字，只能显示浅参考并报告no-judgment-in-scope；不能从真实书写月借墨。

超过80字：当前1791的slice(0,80)仅作为现状记载。本轮最新答复优先，布局和渲染接口统一返回`{status:'pending',reason:'OVER_80_POLICY_PENDING',…}`，保留原数量／比例，渲染结果为`canvas:null,cells:[]`，保留原输入不截断，不决定全月/图上计数字段。0字返回empty/null canvas，不制造一张有假落款的空记录图。

## 首页 N 与最多8个墨迹的接口方案（未接首页）

N既有链为renderHome1711→todayStampCount1177→dailyActivity().stamps1163；markPracticeStamp1166在当天targetKey首次出现时加stamps，同字再次判断加attempts而非stamps。key规则1389为base:字或custom:索引:字，不能擅自改成单纯Unicode去重。N不是写对次数、掌握数、墨迹缓存数；继续沿用它。

建议只读接口：`{day,N,items,status,gaps}`。取当日targetKeys对应的最后明确判断，按判断时间降序、稳定sequence破同刻；N≤8返回N项，N>8返回最近判断8项，数字仍N。墨缺失保留项位并给reference理由；不能为凑8项借前日墨，也不能把N改成有墨数。若N与已知目标数不一致，或历史不足以确定最近8项，status=`incomplete`并给出缺失数量/排序缺口；当前homeRecentIndexes1701–1705按memory.last，且profile过滤与daily.stamps不是同一契约，不能直接宣布可接。人工契约例：N=0→0；1→1；8→8；9→8；重复目标只更新排序，数字不变。没有改首页、题面或统计。

## 工程约束陈旧事实与版本冲突

- 旧约束7294/811及三级818与本候选不符：deck-data.js实数7314条/7314唯一目标，7314均有本地data文件；governance为可练7314、不可练791、三级838。未修改字库；7294是旧资料口径。字体需按F8报告列精确版本差额，不把二者混称通过。
- “有效记录只来自有本人墨迹后的明确对/错”是目标规则，不是此候选全链事实：declareDontKnow2440可直接recordOutcome('miss')，该函数仍markPracticeStamp；postTraceRecall2490附近又有独立处理。此轮不重写判断规则，只把选字与事实证据分开。
- “同一份笔锋数据”不代表字段无损：现场p即丢，分享和recentInk再次裁点并丢t；品牌font内嵌仅约4.2KiB也不能推定全字覆盖。新字体属于F8独立交付。
- “PNG、最多80”之外的旧图片布局与第八稿不同；当前本次图随行数加高，月图仅3:4。新离屏模块固定1080×1440/1080×1080，未改原入口。
- 几何建议、skip永久停排、补记与页面动效冲突仅记录，不在E8顺带改成新交互。
