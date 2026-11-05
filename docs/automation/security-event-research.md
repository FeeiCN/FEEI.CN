# 安全事件研究复盘迁移说明

任务已由用户在 2026-11-05 明确指定，当前仅运行只读 dry-run。

- registry：`security-event-research`
- 频率：每周一 09:00（Asia/Shanghai）
- 输出：创建 GitHub Issue，等待人工审核
- 禁止：修改仓库、自动发布文章、外部通信、交易、生产变更
- 所需 Secrets：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`

完成至少两轮结果审核后，才评估是否增加仓库写入 adapter。