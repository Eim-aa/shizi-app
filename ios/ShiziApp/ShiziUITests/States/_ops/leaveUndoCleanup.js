// 离开撤销条（跳过后离开写字页，撤销条跟到来源页）有 5 秒寿命，连着跑下一个状态时还在——登记一个还原：下一个顶层夹具清空前把它清掉。
const skip = await import('/src/ui/screens/write/skip.js');
(window.__qaCleanups = window.__qaCleanups || []).push(() => skip.clearLeaveUndo());
