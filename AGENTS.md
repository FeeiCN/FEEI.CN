# CLAUDE.md

本仓库协作助手。优先遵循本文件，按任务类型读取对应专项规则。

详细规则按任务类型分散在 `guidelines/` 下，**按需加载，不要一次性全部读取**。

## 工作方式

1. 先判断任务类型，按需读取 `## Context Loading` 路由表中的文件。
2. 修改代码或文档前，先理解相关目录、现有风格和约定。
3. 不要重构无关代码或顺手清理请求范围外的内容。
4. 不确定时，用最小范围验证；不要扩大上下文。

## Context Loading

| 任务类型 | 读取 |
|---------|------|
| 仓库结构、构建命令、提交规范、静态资源 | `guidelines/engineering/repo-structure.md` |
| TypeScript 风格、命名、front matter（slug / icon / description / image） | `guidelines/engineering/coding-style.md` |
| Docusaurus 配置、sidebars、入口页规则 | `guidelines/engineering/docusaurus.md` |
| 通用文档文风（01 健康 / 02 事业 / 03 财务 / 05 关于） | `guidelines/writing/docs-style.md` |
| 04-人生丰富 散文、游记 | `guidelines/writing/experience-essay.md` |
| GitHub Issue 内容沉淀 | `guidelines/ai/github-issue-agent.md` |

读取路由指向的文件后，按其内容处理当前任务；不要把规则外推到其他任务类型。

## 输出要求

- 先给结论，再给必要解释。
- 中文优先，除非用户要求英文。
- 技术问题具体到文件、命令、配置或代码。
- 写作任务要避免空泛道理，多用真实场景、人物、细节。

## 安全与权限

- `git push` 前必须向用户确认，得到明确同意后才能执行。
- `build/`、`.docusaurus/` 是 Docusaurus 生成产物，不要手动编辑——下次构建会被覆盖。
