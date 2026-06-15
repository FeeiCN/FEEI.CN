# AI: GitHub Issue → Content Workflow

把 GitHub Issue 中的观点沉淀到站内文档的流程。

## 流程

1. 用 `gh issue list` 或 `gh issue view <number>` 读取待处理 issue。
2. 判断观点应归属到哪个内容区域：
   - 健康幸福 → `docs/01-health/`
   - 事业有成、能力、职业、AI、安全、软件工程 → `docs/02-capability/`
   - 财务自由 → `docs/03-wealth/`
   - 人生丰富、体验、探索世界 → `docs/04-experience/`
   - 全局人生框架 → `docs/overview.mdx`
3. 对原始观点进行探讨和完善：补足逻辑链条，去掉口号化、重复或过于临时的表达。
4. 将内容融入对应文档的合适位置，优先调整上下文和段落结构，而不是孤立追加。
5. 提交时在 commit 信息末尾附上 issue 编号，例如：`优化财富框架 (#42)`。

## 边界

- **默认只处理用户本人创建的 issue**。若 issue 由其他人创建，应先向用户确认是否需要处理。
- 不要简单把 issue 原文追加到文档中。要先理解其核心观点、适用边界和与现有内容的关系，再整理成更清晰、连贯、可沉淀的表达。
