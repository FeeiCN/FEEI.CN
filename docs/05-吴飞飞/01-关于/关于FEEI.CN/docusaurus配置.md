---
slug: /docusaurus-config
title: Docusaurus 配置
icon: code-icon
description: 入口页放在目录内部、sidebars 自动生成、缓存异常时运行 npm run clear。
content_type: reference
last_reviewed: '2026-07-10'
sidebar_badge:
  text: SKILL
  color: success
---

Docusaurus 配置相关规则。

## 入口页规则

本节只规定入口页的文件位置和命名，页面职责、内容结构与验收使用 `我的写作原则`。

分组目录的入口页应放在该目录内部，并使用"目录名.md"命名。例如：

- `docs/01-网络安全/02-人工智能安全/02-智能工程/03-AI转型/` 的入口页应为 `docs/01-网络安全/02-人工智能安全/02-智能工程/03-AI转型/03-AI转型.md`。
- 不要放在上级目录中命名为 `03-AI转型.md` 这类跨目录入口文件。

其他分组目录同样遵循该规则。

## 侧边栏

`sidebars.ts` 主要使用基于目录结构的自动侧边栏，因此**移动文档会直接影响导航**。事业有成使用显式侧边栏组合直接挂载的事业文档与子目录；网络空间安全和人生系统在一级目录中分别组织专业内容与四个人生目标。

## 全站配置

全站级配置应放在 `docusaurus.config.ts`，不要散落到各文件。

## 新文章 RSS

`homeRecordsPlugin` 从公开文档生成 `/rss.xml`，收录填写 `published_at` 的 `article`、`tutorial`、`review`、`essay`，排除草稿、未列出页面及 SKILL。按首次发布日期倒序保留最近 100 篇，条目标识使用稳定原文地址；正文复核不会重复产生新条目。无效或未来日期不收录，未来日期不会自动发布，需在日期到达后重新构建部署。

推送 `main` 的文档变更会触发网站构建与部署，RSS 随构建更新。自动内容工作流成功结束后通过 `workflow_run` 触发部署，避免 `GITHUB_TOKEN` 推送不触发其他工作流的问题；也可手动运行 Deploy website。阅读器按自身抓取周期发现新文章，不保证即时通知。工作流配置需先合入默认分支才生效。

## 缓存异常

路由或主题异常时，运行 `npm run clear` 清理 Docusaurus 缓存。
