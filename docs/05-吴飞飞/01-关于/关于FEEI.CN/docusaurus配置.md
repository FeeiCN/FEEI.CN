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

- `docs/02-事业有成/03-人工智能/03-AI转型/` 的入口页应为 `docs/02-事业有成/03-人工智能/03-AI转型/03-AI转型.md`。
- 不要放在上级目录中命名为 `03-AI转型.md` 这类跨目录入口文件。

其他分组目录同样遵循该规则。

## 侧边栏

`sidebars.ts` 使用基于目录结构的自动侧边栏，因此**移动文档会直接影响导航**。操作前需确认影响范围。

## 全站配置

全站级配置应放在 `docusaurus.config.ts`，不要散落到各文件。

## 缓存异常

路由或主题异常时，运行 `npm run clear` 清理 Docusaurus 缓存。
