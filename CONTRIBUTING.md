# 参与开发

## 开始前

1. 从目标基线创建短生命周期分支，命名为 `feat/<topic>`、`fix/<topic>` 或 `chore/<topic>`。
2. 不要提交证书、Provisioning Profile、Apple 账号、`Signing.local.xcconfig`、`DerivedData`、archive 或其他构建产物。
3. 数据和字库改动先阅读 `sources/README.md`、`LEGAL_RELEASE_CHECKLIST.md` 与对应生成脚本，生成文件不得手改。

## 本地验证

安装固定依赖并启动页面：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm start
```

另开终端运行：

```bash
pnpm test
```

涉及 iOS、Web 资源或发布脚本时，再运行：

```bash
ios/ShiziApp/scripts/verify-local.sh
```

需要真机能力的相册、通知、触觉、VoiceOver、分享和离线恢复必须在 PR 中列出人工验收结果；自动化通过不能替代这些检查。

## 提交与 PR

- 新提交采用 Conventional Commits，例如 `fix: prevent partial backup restore` 或 `feat: bound offline stroke cache`。
- 一个提交只表达一个可审查意图；生成数据与其生成器、fixture、说明放在同一功能提交中。
- PR 使用仓库模板，写明关联 Issue、验证命令、真机待办和第三方数据影响。
- 合并前要求 `Verify / quality-gate` 通过，并由非实现者完成代码审查。
- 发布 tag 只在负责人确认可发布构建后创建，使用 `v<major>.<minor>.<patch>`，不得用 tag 冒充尚未验收的版本。

## 合并后

- 确认关联 Issue 状态符合 PR 实际范围，未完成的外部授权或真机门槛继续保持开放。
- 删除已经合并的远端功能分支；保留 `main`、当前发布维护分支和仍有开放 PR 的分支。
- 若缓存结构、备份格式或数据口径改变，同步 `CHANGELOG.md` 与相关 ADR。
