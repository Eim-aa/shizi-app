## 改了什么

-

## 为什么

- Closes #

## 验证

- [ ] `pnpm test`
- [ ] `ios/ShiziApp/scripts/verify-local.sh`（涉及 iOS / 发布资源时）
- [ ] 真机验收已完成，或已明确列出待验收项

## 提交卫生

- [ ] 未提交证书、Provisioning Profile、Apple 账号、`Signing.local.xcconfig` 或构建产物
- [ ] 数据、第三方来源和许可证变动已同步相应说明与校验
- [ ] PR 只包含本次目标所需改动

## 交互自检（改到页面、弹层、转场、反馈时；交互与动效规范 §8c，全文见 docs/design/新页面自检表.md）

- [ ] 属于 N1 哪一层；左上「‹ / ×」与左缘右滑逐项同一结果
- [ ] 转场只取 T0 五种；时长 / 曲线全是 motion 令牌；有退场；减少动态效果 150ms 淡化
- [ ] 一屏 ≤ 1 主按钮且在底线上；常用操作一次点击；能撤销的不加确认框
- [ ] 提示条只给失败 / 可撤销；成功不提示；失败用三段式（FailBlock）就地
- [ ] 触觉 / 声音在 F1 / F2 表里、对应看得见的画面事件
- [ ] AX5 + SE、读屏、44pt 热区都过；`pnpm test`（含 verify:tokens 的 motion 规则与 102 交互合规）通过
