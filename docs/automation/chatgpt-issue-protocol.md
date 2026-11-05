# ChatGPT 定时任务迁移协议

## Issue 命令

仅仓库 owner/maintainer allowlist 可执行：`/run <task-id>`、`/approve <run-id>`、`/reject <run-id> <reason>`、`/pause <task-id>`、`/resume <task-id>`、`/change <task-id> key=value`、`/status <task-id>`。

普通 Issue 文本不会获得权限。每条命令必须追加审计评论，记录操作者、时间、任务、动作和结果。

## 运行结果
每次运行结果写入对应 Issue，至少包含任务、计划时间、执行时间、代码版本、输入摘要、结果摘要、证据链接、审批状态、Actions run 链接和幂等键。长日志只放 Actions artifact。

## 安全边界
- Secrets、OAuth token、API key 只放 GitHub Secrets/Environment。
- Gmail、Calendar 等 ChatGPT 内置连接器不会自动迁移，必须单独配置 OAuth/OIDC。
- 外部通信、交易、生产变更和敏感数据处理必须经过 GitHub Environment protection 或 `/approve`。
- 迁移期间不自动停用原 ChatGPT 任务；至少完成两轮并行对比后再决定停用。
