---
slug: /skill-principles
title: SKILL 原则
icon: code-icon
description: 创建与维护 SKILL 文档的规范：统一放在 关于FEEI.CN/ 子目录、front matter 字段、CLAUDE.md 路由表登记、写作语气。
sidebar_badge:
  text: SKILL
  color: success
---

创建与维护 SKILL 文档的元规则。本身也是 SKILL 文档，是 bootstrap 例外。

## 什么是 SKILL 文档

SKILL 文档是给 AI 协作助手使用的工作规则文件。读者不必阅读，但维护者在新增、修改、删除 SKILL 文档时必须遵循本文规范。

## 位置

所有 SKILL 文档统一放在 `docs/05-吴飞飞/01-关于/关于FEEI.CN/` 子目录下。

理由：本仓库是 FEEI.CN 站点本身，所有针对仓库的工作规则（写作、配置、提交、工作流、元规则）都是关于这个仓库/站点的元信息，集中在 `关于FEEI.CN/` 下与目录语义一致。

## front matter 必填字段

所有 SKILL 文档的 front matter 必须包含：

```yaml
---
slug: /xxx-skill           # 英文路径
title: ...                 # 中文标题
icon: code-icon            # 统一使用 code-icon
description: ...           # 必填，≤160 字
sidebar_badge:
  text: SKILL
  color: success
---
```

- `icon` 一律 `code-icon`，保证视觉一致
- `sidebar_badge` 一律 `{ text: 'SKILL', color: success }`，让 SKILL 文档在 sidebar 中可识别
- 文件名用中文，`slug` 用英文短路径
- `description` 必填，概括文档覆盖的规则或主题

**icon 必须带 `-icon` 后缀**。ItsHoverIcon 的 slug 来自文件名（如 `code-icon.tsx` → `code-icon`），缺后缀会导致 icon 无法渲染。

## CLAUDE.md 路由表

新增、移动、删除 SKILL 文档时，必须同步更新 `CLAUDE.md` 的 Context Loading 路由表：

- 新增：在表中加一行 `任务类型 | 文档路径`
- 移动：更新该行路径
- 删除：删除该行

路径要与 `git mv` 后的实际位置一致。

## 写作语气

SKILL 文档的内容遵循本站通用文风：

- 指令式或陈述判断为主（"不创建 README"、"slug 必须稳定"）
- 不引用具体数字和统计数据作为论据
- 不在文档末尾添加总结段落
- 不一句一段，合并相关句子

详细写作规范见 `我的写作原则`。

## 引用其他 SKILL

正文中需要引用其他 SKILL 文档时：

- 直接使用中文文件名（依赖 slug 解析），如 `详见 docusaurus配置`
- 不需要 markdown 超链接形式
- 不要引用文件路径（`docs/02-.../docusaurus配置.md`）

## bootstrap 例外

本文档作为元规则，在创建时已经位于合适的目录、front matter 完整、CLAUDE.md 已登记——这是预先建立的初值。后续如果修改本文档本身，仍需遵循上述所有规则。

如果将来需要"创建 SKILL 文档"的脚手架或模板，应另建一个 SKILL 文档覆盖，不要让本元规则与具体实现耦合。
