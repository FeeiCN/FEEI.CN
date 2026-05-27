# Claude Code Guidelines

## 项目结构与内容组织

本仓库是一个基于 Docusaurus 的个人知识站点。主要内容位于 `docs/`，按编号分组，例如 `01-health/`、`02-capability/`、`03-wealth/`、`04-experience/`。博客文章位于 `blog/`。静态资源放在 `static/`，例如 `static/img/`。主题覆盖和 React 自定义组件位于 `src/theme/`。本地插件代码位于 `plugins/`。不要手动编辑 `build/` 或 `.docusaurus/` 下的生成文件。

分组目录的入口页应放在该目录内部，并使用"目录名.md"命名。例如 `docs/02-capability/02-ai/02-trends/` 的入口页应为 `docs/02-capability/02-ai/02-trends/02-trends.md`，不要放在上级目录中命名为 `02-AI趋势判断.md` 这类跨目录入口文件。其他分组目录同样遵循该规则。

每个 Markdown 文档应根据主体内容设置合理的 `icon`。图标系统使用 `src/components/ItsHoverIcon/icons/` 下的 ItsHover 图标，或 `src/components/ItsHoverIcon/index.tsx` 中 `ICON_ALIASES` 已注册的别名。新增或修改 `icon` 前需先确认对应图标真实存在，避免使用未注册的 Lucide 名称导致侧边栏图标缺失。

## 构建、检查与开发命令

- `npm run start`：启动本地开发服务器。
- `npm run build`：生成生产构建到 `build/`。
- `npm run serve`：本地预览构建产物。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run clear`：清理 Docusaurus 缓存，适用于路由或主题异常。

运行环境要求 Node.js `>=20`，以 `package.json` 为准。

修改代码后（md文档除外），默认执行 `npm run typecheck` 和 `npm run build`，确认无报错后再提交。

## 编码风格与命名约定

TypeScript 使用严格模式。延续现有配置和主题文件风格：2 空格缩进、保留分号、尽量保持小函数和单一职责。React 主题覆盖应尽量小而明确，并放在 `src/theme/<组件名>/` 下。

文档内容使用 Markdown，要求结构清晰、表达直接。保留 front matter，例如：

```md
---
slug: /health
icon: apple-whole
---
```

遵循现有命名方式：编号目录、语义化文件名、稳定 `slug`。文件名使用中文，`slug` 使用 `/` 开头的简短英文路径，例如 `slug: /cybersecurity-law`。

正文写作优先采用结论先行：每个自然段先用一句加粗结论概括核心观点，再展开解释。加粗结论和后续正文之间保留一个空格，格式为 `**结论。** 正文内容`，避免写成 `**结论。**正文内容`。

## 内容写作规范

- 不添加注释，除非有非显而易见的原因需要说明。
- 不创建 README 或说明文档，除非用户明确要求。
- 不在文档末尾添加总结段落，内容本身应自明。
- 新增文档优先复用现有文件，确认无合适位置后再新建。
- 移动文件会影响 `sidebars.ts` 自动侧边栏和导航，操作前需确认影响范围。
- 不写"谁在什么时候的什么论文中说了什么"，只陈述论点本身。必要时可以 Markdown 链接形式附上原文出处，但不在正文中展开归因。
- 避免使用"不是……而是……"句式。直接陈述正面结论，必要时用独立短句补充说明被排除的误解。
- 不引用具体数字和统计数据作为论据（百分比、金额、精确时间段等）。用逻辑关系和因果机制来表达观点：具体数字会让文章显得像数据报道，而洞见来自逻辑，不来自数字。可以用定性描述替代（"数百倍""断崖式下滑""以月计"）。

## GitHub Issue 处理流程

GitHub Issue 可作为新的想法和观点收集入口。处理这类 issue 时，不要简单把原文追加到文档中，而应先理解其核心观点、适用边界和与现有内容的关系，再整理成更清晰、连贯、可沉淀的表达。

默认只处理用户本人创建的 issue。若 issue 由其他人创建，应先向用户确认是否需要处理。

推荐流程：

1. 使用 `gh issue list` 或 `gh issue view <number>` 读取待处理 issue。
2. 判断观点应归属到哪个内容区域：
   - 健康幸福：`docs/01-health/`
   - 事业有成、能力、职业、AI、安全、软件工程：`docs/02-capability/`
   - 财务自由：`docs/03-wealth/`
   - 人生丰富、体验、探索世界：`docs/04-experience/`
   - 全局人生框架：`docs/overview.mdx`
3. 对原始观点进行探讨和完善，补足逻辑链条，去掉口号化、重复或过于临时的表达。
4. 将内容融入对应文档的合适位置，优先调整上下文和段落结构，而不是孤立追加。
5. 修改后执行 `npm run typecheck` 和 `npm run build`。
6. 处理完成后，向用户确认是否需要关闭对应 issue。
7. 若用户确认关闭，关闭前在 issue 中评论处理结果，说明观点已融入哪些文件和位置。

## 提交与合并请求规范

提交信息使用中文，风格以简短祈使句为主，例如：`添加站点图标`、`重构健康文档并恢复更新时间`、`优化财富框架`。建议一次提交只聚焦一类改动。

PR 建议至少包含：

- 本次改动摘要
- 受影响的目录或页面
- 可见界面改动的截图
- `npm run typecheck` 与 `npm run build` 通过说明

## 内容与配置注意事项

`sidebars.ts` 使用基于目录结构的自动侧边栏，因此移动文档会直接影响导航。全站级配置应放在 `docusaurus.config.ts`。新增图标或图片资源时，优先放到 `static/` 本地目录，避免依赖外部热链。
