> 历史核查／提案：基于 c7c8fc2。文中原始证据路径属于冻结交付索引，不是本仓库运行依赖；不代表当前主干或已获实施许可。见 [交接入口](../README.md)。

# E8 回放字段缺口（不交转换工具）

输入规范：`sources/design-snapshot/data/handwriting/格式-第八稿交接版.md`。核查对象：c7c8fc2候选源码的数据链，不是用户备份抽样。用户已取消本轮备份回放工具；本目录没有真实数据转换、重放或补齐工具。

| 格式字段 | 现有能找什么 | 可恢复范围与不可恢复部分 |
|---|---|---|
| char（必需） | submissionSnapshot.target；当前卡片idx映射；FSRS target/cardKey；memory按字key | 原目标仍可映射时可取。未知旧自定义idx、失去对应题库版本时不能瞎猜；字形像某字不是证据 |
| writer（必需） | 当前存储无写字人编号；无账号不等于已知同一writer | 不可从设备、备份文件名、照片或墨迹风格推断。以后真人采集单独授权分配匿名编号 |
| pass（必需） | episodes.attempts有seq、attemptId；memory.seen为累积数 | seq是本组尝试号，不是该写字人该字第几遍；seen可能含帮助/旧口径。历史遍次不可恢复 |
| kind（可选 normal/wrong/trace） | 当前submissionSnapshot.practicePhase、hintEverUsed、enteredTracing；attempt userCorrect/outcome；FSRS reason/rating | 拥有同一原快照与明确判断时可描述那条；Again不能直接判wrong，enteredTracing是曾描过，不证明该墨为trace。recentInk无对应attemptId。不能照原型wrongFix删笔来伪造错字 |
| strokes顺序（必需） | 现场inkStrokes及尚在的快照是数组顺序；roundStats/recentInk是裁减副本 | retained数组的先后可知，但48/36笔上限外的笔画已丢；每笔48/24点降采样无法逆转。位图/照片不能变成真实笔序 |
| x/y（必需，345×345左上原点） | 现场S坐标；提交快照canvasSize；分享及recentInk归一化0..1 | 已知canvasSize可作线性换算，归一化点可乘345，只能称尺度转换。三位舍入与钳界已不可逆，归一化0.001在345域约0.345单位。仅visual裸点缺旧S时不能假设当前S |
| t（必需，首次落笔起ms，跨笔停顿保留） | 现场/提交快照有页面时间t；分享与recentInk删除t；FSRS reviewedAt、recentInk.at是整次墙钟 | 单一未断开的快照可减最初t，前提是所有笔连续、时钟域一致且未重建；仍不能声称完整历史。页面重载后performance时钟重置、会话混合时不可直接归一。只有at或v不能恢复采样时间、真实停顿或时间窗 |
| p（可选0..1） | P(e)短暂有pen压力；inkBegin/inkMove未把p存进去 | 历史场景一般已丢，不能由w或v反求。t与p缺失要分开：p可省且说明，t缺失已不满足本格式。不得补0.5或用0冒充实测 |
| w/v（格式未定义） | 现场w ratio/v速度；分享/recentInk保留截断舍入值 | 可附作旧渲染来源，但不是p/t替身。回放build重算宽度不等同当年效果；不要通过“v×距离”造时间。离屏静态图可按已存w绘制，不称回放 |
| 日期/会话/单位（规范之外） | snapshot.createdAt、attempt.at、localDay、roundId/currentAttemptId等 | 建议未来额外保存clockDomain、canvas尺寸、设备输入类型、原始/派生标识与时间基准，历史缺失保留unknown；不能把最近缓存等同指定会话最后一条 |

工程约束“若存了带时间坐标可从备份导出”是有条件的话，不能据它预设所有现有记录都有t/p。备份只包住仍存在的localStorage键，不能复活已淘汰数据。此次没有读取标作“真实数据样本”的附件，也没有读取真实备份或照片。

后续真人数据按用户决定在原型录制模式的真机上采集，保留原始x/y/t与可用p、按规范记录writer/pass/kind。本轮不安排录制，不以桌面鼠标/合成时间戳冒充真机样本，也不交延迟、60/120Hz手感或Pencil结论。
