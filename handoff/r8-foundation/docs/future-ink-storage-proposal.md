> 历史核查／提案：基于 c7c8fc2。文中原始证据路径属于冻结交付索引，不是本仓库运行依赖；不代表当前主干或已获实施许可。见 [交接入口](../README.md)。

> 当前决定：本方案仍暂停。用户最新已解除历史测试记录兼容的硬约束；下文旧备份/旧记录兼容条款仅作历史提案，不是当前必须实施的要求。不得据此扩大迁移工作。

# 逐判断保存笔迹：独立新增存储提案与估时

状态（E8-2026-09-26-r2）：**暂停。等待留存政策和真人数据量明确后再讨论实施；未实施、未迁移、未增持久键。** 下文结构、容量模型及14–22人日等估算原样保留为历史提案，不构成开工或排期承诺。保留时长、容量阈值、删除策略待定；以下不是留存承诺，也不沿用recentInk的96/420KiB淘汰作为新政策。

## 建议权威结构

每次明确判断对应稳定attemptId；改判断保留该attemptId并增judgmentRevision，不重写原笔迹或原日期。建议分成Attempt元数据与不可变InkPayload，用同一事务关联：

```text
Attempt {
  schemaVersion, attemptId, profileEpoch, sessionId, charKey, target,
  judgedAtUTC, localDayAtJudgment, timeZoneAtJudgment, sequence,
  explicitJudgment: correct | wrong, judgmentRevision,
  sourcePhase, assistanceFacts, inkId | null, inkMissingReason | null
}
InkPayload {
  schemaVersion, inkId, attemptId, source: own,
  capturedAtUTC, coordinateSpace: logicalCanvas,
  canvasWidth, canvasHeight, clockDomainId, timeOrigin,
  inputType: pen | touch | mouse | unknown,
  strokes: [{strokeId, points: [{x,y,t,p?}], endedBy: up | cancel}],
  completeness, captureVersion, checksum
}
```

x/y为记录时逻辑画布坐标，保留尺度；t为同一明确时钟域、相对该次首次落笔的真实ms，跨笔停顿保留。p有值才保存，未知省略并写capability，不补默认压力。原始采样与滤波/CR/预测分开：预测绝不入库；w/v、轮廓/缩略图是可重建派生缓存，含rendererVersion，不作原始事实权威。

当前inkBegin已丢p，因此新采集要从输入入口改，单换存储末端无效。正常判断必须绑定提交瞬间本人笔迹，帮助参考/trace分别标源；输入冻结、在途笔收口、判断修订及帮助语义须沿已批准契约，不能借此提案重新决定评级或交互。

## 容量模型（假设，不是真人测量）

按JSON UTF-8每点65B、每条元数据/分隔等约1000B估计；真实长小数和字段名会改变成本。没有把压缩包大小算成安装/持久化大小。

| 人工容量档 | 假设笔画×点/笔 | 点数/判断 | 原始JSON估算/判断 | 30次判断/日×365天 |
|---|---:|---:|---:|---:|
| 低 | 3×20 | 60 | 4,900B≈4.79KiB | 53,655,000B≈51.17MiB |
| 中 | 12×80 | 960 | 63,400B≈61.91KiB | 694,230,000B≈662.07MiB |
| 高 | 30×240 | 7,200 | 469,000B≈458.01KiB | 5,135,550,000B≈4.78GiB |

重复判断按次累积，不按不同字数估。这里没有测60/120Hz设备，点数只是容量参数。若另用二进制x/y Float32、t Float64、p Float32，则每点20B加缺值mask/索引/元数据，960点约19,200B；精度、端序、校验与版本须单独定，不能先压缩丢时序再声称原始完整。缩略图、数据库索引、事务日志、备份副本及撤销恢复副本需另加；压缩率未经样本测量，不承诺固定2–4倍。正式阈值应等真人采样、设备配额和留存决定。

## 事务、索引、兼容与恢复

建议权威记录/墨迹/operation receipt在同一IndexedDB事务完成后才向调用者确认；以epoch、attemptId和预期revision拒绝陈旧写，稳定operation重试幂等。输入现场直到确认保持；ACK不确定时先查询receipt，不重新捕获下一字。草稿/判断/历史分开，不把轻量checkpoint当历史档案。这些是未来要求，不是本轮交付的可用存储代码。

索引建议按(profileEpoch, sessionId, sequence)、(profileEpoch, charKey, localDay, judgedAtUTC, sequence)、attemptId；图片先选范围最后判断，再按其inkId查墨，ink缺失明确留空，绝不向前找一份有墨。日期以判断时保存的localDay/timeZone为准，后来跨时区查看不改历史归属；补记目标日与实际书写日分字段。

备份需新schema版本及独立墨迹清单/checksum/关联数；旧version1导入为legacy，保留其完整原字段，不给不在的t/p/attempt关联补值。旧阅读器遇到不认识的版本应拒绝覆盖；新增键必须审查BACKUP_KEYS，同时注意跨localStorage/IDB不是原子事务。可用打包流或分块导出避免多份大base64常驻内存，UI/分享接法另批。

迁移先生成只读盘点与映射计划、保持旧权威可回退，再在新epoch staging校验条数/校验和/关联；marker不等于停写锁，需确实停止所有旧writer（包括其他页/SW/native桥）。完成后原子发布新索引，再切权威；失败不写“成功”，不丢旧库。历史只可标legacy-partial；不能从最近成功墨迹制造所有过去判断。没有该证据时继续浅色参考。

quota/存储不可用时保留现场、明确保存失败，不先改计数再静默删历史；删除/降采样/保留上限必须另获产品决定。进程中断、提交完成但ACK丢失、重复操作、跨页写入、备份损坏、恢复撤销、新库不可读、后台清退都要有测试；真实设备和真正故障另安排，不从E3模拟器或E8桌面图推定通过。

## 工作量与依赖

| 工作包 | 工程人日估计 | 依赖/出口 |
|---|---:|---|
| schema、原始输入p/t与尺度链、明确提交绑定 | 2–3 | 用户确认保存原始粒度、身份/时间字段；本人/帮助分源 |
| 原子提交、receipt/版本、重试与故障保留 | 3–5 | 权威切换契约和旧writer清单 |
| 最后判断索引与图片/历史读接口 | 2–3 | 先定数据完备性与未知状态，不改选字规则 |
| 备份版本、分块/校验、旧数据只读兼容与恢复 | 3–5 | 留存/删除待定、目标设备容量、备份协议 |
| 自动化回归、故障注入、迁移演练与验收材料 | 4–6 | 获授权测试资料与恢复环境 |
| 合计 | **14–22人日** | 约3–5工程周，单工程师；不是上线承诺 |

另留真机验证与产品/QA签收排期；未知历史格式、大数据备份与容器限制可能增加工作量。页面/交互、字体制作、新笔锋、回放录制工具不包含在此估时。本轮只是文档，模块中无IndexedDB/localStorage写入或迁移实现。
