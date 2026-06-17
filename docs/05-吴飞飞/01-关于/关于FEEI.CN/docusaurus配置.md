---
slug: /docusaurus-config
title: Docusaurus 配置
icon: code-icon
description: 入口页放在目录内部、sidebars 自动生成、缓存异常时运行 npm run clear。
sidebar_badge:
  text: SKILL
  color: success
---

Docusaurus 配置相关规则。

## 入口页规则

分组目录的入口页应放在该目录内部，并使用"目录名.md"命名。例如：

- `docs/02-capability/02-ai/02-trends/` 的入口页应为 `docs/02-capability/02-ai/02-trends/02-trends.md`。
- 不要放在上级目录中命名为 `02-AI趋势判断.md` 这类跨目录入口文件。

其他分组目录同样遵循该规则。

## 侧边栏

`sidebars.ts` 使用基于目录结构的自动侧边栏，因此**移动文档会直接影响导航**。操作前需确认影响范围。

## 全站配置

全站级配置应放在 `docusaurus.config.ts`，不要散落到各文件。

## 缓存异常

路由或主题异常时，运行 `npm run clear` 清理 Docusaurus 缓存。
