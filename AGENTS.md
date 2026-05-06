# Repository Guidelines

## 项目结构与内容组织

本仓库是一个基于 Docusaurus 的个人知识站点。主要内容位于 `docs/`，按编号分组，例如 `01-health/`、`02-capability/`、`03-wealth/`、`04-experience/`。博客文章位于 `blog/`。静态资源放在 `static/`，例如 `static/img/`。主题覆盖和 React 自定义组件位于 `src/theme/`。本地插件代码位于 `plugins/`。不要手动编辑 `build/` 或 `.docusaurus/` 下的生成文件。

## 构建、检查与开发命令

- `npm run start`：启动本地开发服务器。
- `npm run build`：生成生产构建到 `build/`。
- `npm run serve`：本地预览构建产物。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run clear`：清理 Docusaurus 缓存，适用于路由或主题异常。

运行环境要求 Node.js `>=20`，以 `package.json` 为准。

## 编码风格与命名约定

TypeScript 使用严格模式。延续现有配置和主题文件风格：2 空格缩进、保留分号、尽量保持小函数和单一职责。React 主题覆盖应尽量小而明确，并放在 `src/theme/<组件名>/` 下。

文档内容使用 Markdown，要求结构清晰、表达直接。保留 front matter，例如：

```md
---
slug: /health/physical/diet
icon: apple-whole
---
```

遵循现有命名方式：编号目录、语义化文件名、稳定 `slug`。

## 测试与验证要求

当前没有独立的单元测试体系，默认将 `npm run typecheck` 和 `npm run build` 视为必跑检查。修改文档或界面后，建议用 `npm run start` 本地检查对应页面。涉及导航、slug、icon、footer 或主题覆盖时，需额外确认页面渲染和侧边栏行为正常。

## 提交与合并请求规范

最近提交风格以简短祈使句为主，例如：`Add icon favicon`、`Refactor health docs and restore doc update timestamps`、`Refine wealth framework`。建议一次提交只聚焦一类改动。

PR 建议至少包含：

- 本次改动摘要
- 受影响的目录或页面
- 可见界面改动的截图
- `npm run typecheck` 与 `npm run build` 通过说明

## 内容与配置注意事项

`sidebars.ts` 使用基于目录结构的自动侧边栏，因此移动文档会直接影响导航。全站级配置应放在 `docusaurus.config.ts`。新增图标或图片资源时，优先放到 `static/` 本地目录，避免依赖外部热链。
