---
slug: /automation/security-event-research
title: 安全事件研究复盘迁移说明
icon: code-icon
description: 安全事件研究复盘任务的迁移背景、当前 SKILL 入口和人工审阅边界。
---

任务最初于 2026-11-05 经用户指定，以只读 dry-run 迁移。当前由独立 workflow 调度，直接读取[安全事件分析 SKILL](/security-incident-analysis-principles)正文，并与[自动任务执行约定](/automation-execution-contract)合并执行。选题与分析方法在 SKILL 中维护，执行时间、启用开关和交付方式由 workflow 配置。

- registry：`security-event-research`
- 频率：每周一 09:00（Asia/Shanghai）
- 输出：创建 GitHub Issue，等待人工审核
- 禁止：修改仓库、自动发布文章、外部通信、交易、生产变更
- 所需 Secrets：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`

启用定时研究不授予文章发布权限。成果先交付 Issue 审阅，用户明确确认具体版本后才可按仓库规则写入；后续调整执行权限须另行确认。
