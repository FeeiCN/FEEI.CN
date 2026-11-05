# ChatGPT 定时任务迁移协议

## 迁移范围

默认不迁移任何现有 ChatGPT 内置任务。只有用户在 Issue 中明确指定某个任务，并完成必要的凭证、适配器、审批和验证后，才可以加入 `automation/registry.yml`。

明确指定前，不得：
- 将现有 ChatGPT 任务批量登记或迁移；
- 停用、修改或替换现有 ChatGPT 内置任务；
- 因为任务出现在历史清单中，就推断用户已经授权迁移。

## Issue 命令

仅仓库 owner/maintainer allowlist 可执行：

- `/designate <task-id|任务名>`：提出本次要迁移的具体任务，先进入待审核状态，不直接执行。
- `/approve <run-id|designation-id>`：批准对应的执行或迁移步骤。
- `/reject <run-id|designation-id> <reason>`：拒绝并记录原因。
- `/run <task-id>`：仅运行已登记、已配置且未暂停的任务。
- `/pause <task-id>`、`/resume <task-id>`：暂停或恢复已登记任务。
- `/change <task-id> key=value`：修改已登记任务配置，涉及权限、凭证、外部副作用时仍需审批。
- `/status <task-id>`：查看任务状态。

Issue 普通文本不产生授权。每条命令必须追加审计评论，记录操作者、时间、任务、动作和结果。

## 运行结果

每次运行结果写入对应 Issue，至少包含任务、计划时间、执行时间、代码版本、输入摘要、结果摘要、证据链接、审批状态、Actions run 链接和幂等键。长日志只放 Actions artifact。

## 安全边界

- Secrets、OAuth token、API key 只放 GitHub Secrets/Environment。
- Gmail、Calendar 等 ChatGPT 内置连接器不会自动迁移，必须单独配置 OAuth/OIDC。
- 外部通信、交易、生产变更和敏感数据处理必须经过 GitHub Environment protection 或 `/approve`。
- 迁移期间不自动停用原 ChatGPT 任务；是否停用必须另行明确指定并审批。
- 迁移任务必须先 dry-run，再至少完成两轮与原任务的并行对比，才可评估是否替换。

## Registry 约束

`automation/registry.yml` 只包含已通过 `/designate` 和审批流程的任务。没有明确指定任务时，`tasks` 必须为空数组。
