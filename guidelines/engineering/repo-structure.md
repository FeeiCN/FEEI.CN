# Engineering: Repository Structure

仓库是 Docusaurus 个人知识站点。本文件覆盖目录结构、构建命令、提交规范、静态资源原则。

## 目录结构

- `docs/`：站点主体内容，按编号分组（`01-health/`、`02-capability/`、`03-wealth/`、`04-experience/`）。
- `blog/`：博客文章。
- `static/`：静态资源（图片、字体、抓取数据）。例如 `static/img/`、`static/reading/books/<bookId>/`。
- `src/theme/`：Docusaurus 主题覆盖和 React 自定义组件。
- `plugins/`：本地 Docusaurus 插件。
- `guidelines/`：给 AI 协作助手的规则文件，**不会被 Docusaurus 收录到站点**。
- `build/`、`.docusaurus/`：Docusaurus 生成产物。**不要手动编辑**——下次构建会被覆盖。

## 构建、检查与开发命令

- `npm run start`：启动本地开发服务器。
- `npm run build`：生成生产构建到 `build/`。
- `npm run serve`：本地预览构建产物。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run clear`：清理 Docusaurus 缓存，适用于路由或主题异常。
- Node.js `>=20`，以 `package.json` 为准。

仅在 `git push` 前必须执行 build 验证：

```bash
npm run build 2>&1 | grep -E "WARNING|SUCCESS|ERROR"
```

输出必须是 `[SUCCESS]` 且无 `[WARNING]`，否则不能推送。

## 静态资源与外部依赖

站点**禁止**引用任何外部资源（图片、字体、脚本、样式表）。所有可下载资源必须落到 `static/` 本地目录，组件用相对路径引用。

- 新增图片/图标/字体 → 放到 `static/` 下，组件用 `/img/...`、`/reading/...` 等相对路径引用。
- 已有外部 URL（CDN/hotlink）→ 必须下载到 `static/` 后改成本地路径。
- 第三方 npm 包内置资源 → 通过 Docusaurus 标准 import 链入，不直接写绝对 URL。
- 微信读书等抓取类资源（封面、JSON 元数据）→ 下载后用本地 `static/reading/books/<bookId>/...` 路径。
- 例外仅限 OG 图、Twitter Card 等社交平台抓取所需的绝对 URL（受限于平台协议）。

## 提交与合并请求

提交信息使用中文，风格以简短祈使句为主，例如：`添加站点图标`、`重构健康文档并恢复更新时间`、`优化财富框架`。一次提交只聚焦一类改动。

**不要在 commit 信息中添加 `Co-Authored-By` 行。**

`git push` 前必须向用户确认，得到明确同意后才能执行。

PR 建议至少包含：

- 本次改动摘要
- 受影响的目录或页面
- 可见界面改动的截图
- `npm run typecheck` 与 `npm run build` 通过说明
