<div align="center">

![Logo](https://feei.cn/media/img/logo.webp)

# FEEI.CN

**一个公开维护的个人知识、数据与判断系统。**

> 把所有的时间、精力和金钱都投入到长期目标中。

[![GitHub stars](https://img.shields.io/github/stars/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/network/members)
[![Last commit](https://img.shields.io/github/last-commit/FeeiCN/FEEI.CN?style=flat-square)](https://github.com/FeeiCN/FEEI.CN/commits/main)
[![Docusaurus](https://img.shields.io/badge/Docusaurus-3.10.2-25c2a0?style=flat-square&logo=docusaurus&logoColor=white)](https://docusaurus.io/)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[在线站点](https://feei.cn) · [开始阅读](https://feei.cn/life-certainty) · [关于我](https://feei.cn/about)

</div>

## 这是什么

这是一个长期公开维护的个人系统，用文档、数据和复盘记录我如何在健康、事业、财富和人生体验上持续做选择。网络空间安全是长期主线，其他方向延伸自同一个问题：如何在不确定环境里建立更稳定的判断和行动系统。

| 方向 | 入口 |
| :--- | :--- |
| 健康幸福 | [健康幸福](https://feei.cn/health) |
| 事业有成 | [事业有成](https://feei.cn/capability) |
| 财务自由 | [财务自由](https://feei.cn/wealth) |
| 人生丰富 | [人生丰富](https://feei.cn/experience) |

如果你第一次访问，可以从[创造确定性人生](https://feei.cn/life-certainty)开始，也可以直接选择上面的长期方向。

## 仓库里有什么

| 内容 | 说明 |
| :--- | :--- |
| 文档 | 600+ 篇 `.md` / `.mdx`，覆盖安全、人生系统和年度复盘 |
| 组件 | React 页面、数据仪表盘、图表和 Docusaurus 主题覆盖 |
| 插件 | 本地 Docusaurus 插件和搜索扩展 |
| 数据 | 阅读、健康、足迹、资产、港股打新和 LLM 用量等结构化数据 |
| 自动化 | GitHub Actions、本机脚本和服务器部署流程 |

主要数据页面：

| 页面 | 内容 |
| :--- | :--- |
| [阅读仪表盘](https://feei.cn/reading) | 阅读量、热力图、年度分布和书架 |
| [健康数据](https://feei.cn/health-data) | 身体指标、睡眠、运动和饮食 |
| [中国足迹](https://feei.cn/travel-data) | 省份、地级市和年度足迹 |
| [AI 使用数据](https://feei.cn/ai-usage-data) | 多个模型服务的用量记录 |

## 本地运行

```bash
git clone https://github.com/FeeiCN/FEEI.CN.git
cd FEEI.CN
npm ci
npm run start          # 本地开发，http://localhost:3000
```

构建与检查：

```bash
npm run build          # 生产构建到 build/
npm run typecheck      # TypeScript 类型检查
npm run check:docs     # 检查新增或修改的文档
npm run serve          # 预览构建产物
```

要求：Node.js `>= 20`。

部分媒体资源保存在部署服务器，不随 Git 仓库发布。文章中的媒体使用 `/media/...` 路径，相关同步配置见 `config/media-rsync.env.example` 和 `ops/media-rsync/`。

## 目录速查

```text
docs/         600+ 篇站点内容，按安全、人生系统和个人资料分组
src/          React 页面、组件、主题覆盖和样式
plugins/      本地 Docusaurus 插件
scripts/      数据同步、检查和维护脚本
static/data/  阅读、健康、资产等结构化数据
config/       搜索和媒体同步配置
ops/          媒体同步与服务器运行配置
.github/      GitHub Actions 工作流
```

`build/` 和 `.docusaurus/` 是构建产物，不应手动编辑。

## 部署

向 `main` 分支推送后，GitHub Actions 通过 SSH 触发服务器部署。服务器拉取代码、执行文档检查和 Docusaurus 构建，构建结果由 Nginx 发布。部署流程见 `.github/workflows/deploy.yml`。

## 使用边界

这个仓库包含个人文章、健康记录、资产数据和自动同步脚本。公开内容用于展示和个人复盘，不能替代通用的理财、健康或工程建议。

仓库没有授予代码的开放源代码许可证。代码可以阅读和学习，复制、修改、分发或用于商业项目前请先联系作者。文章、个人数据、图片、音乐和其他媒体保留相应权利；引用文章时请保留来源，不要转载个人数据或未获授权的媒体。

公开仓库不包含运行同步链路所需的私有凭证。部分脚本依赖本机环境、GitHub Variables、iPhone App 或个人账号授权，无法保证脱离这些条件后直接运行。

## 关于作者

吴飞飞，网络安全从业者，长期关注信任、安全架构、攻防对抗、AI 安全与风险治理，维护过多个开源安全项目，并在 QCon、SSC、EISS、InSecWorld 等会议分享企业安全架构与 AI 攻防。

这是一个个人知识库，欢迎提交错别字、失效链接、明显代码问题和可复现的构建问题；个人经历、价值判断和数据结论不接受改写型 PR。

合作与交流：`feei#feei.cn`（`#` 换成 `@`），微信 `FEEI_WU`。

如果某个判断、代码或数据页面对你有帮助，欢迎[开始阅读](https://feei.cn/life-certainty)或在 GitHub 点 ⭐。
