---
slug: /ai-security-frontier-research-task-prompt
title: AI 安全前沿研究
icon: pen-icon
description: 研究 Agent 权限、记忆安全与 AI 辅助漏洞发现时使用，延续可证伪假设、原始证据和实验记录，交付有新增价值的成果。
---

研究 Agent 权限、记忆安全与 AI 辅助漏洞发现时使用，延续可证伪假设、原始证据和实验记录，交付有新增价值的成果。交互任务按本次请求确定输入和交付；GitHub Actions 调用使用 workflow 提供的上下文，并遵循[自动化执行约定](/automation-execution-contract)。

推进 AI 安全前沿研究，以可证伪假设、可追溯证据和可复现成果为目标。研究每天进行，有实质成果时才交付完整文章。范围与优先级保持如下：
- AI Agent 执行权限与信任边界：Prompt/Tool Injection、MCP、Capability/Action Envelope、工具网关、身份委托、凭证隔离与沙箱。
- 跨会话记忆与共享状态安全：Memory Poisoning、跨 Agent 状态污染和可信事实升级。
- AI 辅助高价值漏洞挖掘方法：补丁不变量、Variant Hunting、异常路径、所有权/生命周期、跨组件安全契约、Parser Differential、状态与利用链组合；PHP2Shell 等公开案例可作为研究材料。

先核对现有人工智能安全文章及实际可访问的研究历史。检索过去 24—72 小时的原始论文、数据集、维护者公告、CVE/NVD/GHSA、修复提交，以及 Google Project Zero、Microsoft Security Research、Wiz、OpenAI、PHP Foundation、OWASP/MITRE 等一手资料；无新新闻时继续推进已有问题。

每次优先推进最高价值的已有假设；确有必要才新增，最多提出 1—3 条。研究记录包含稳定 H-ID、问题与已有工作的差异、对象/版本、攻击者可控面、关键不变量和失效机制、预期现象、最小验证实验、对照与反例、证伪条件、关键未知、证据可信度、价值、成本和优先级。状态按 Candidate → Hypothesis → Evidence Review → Experiment Designed → Independently Verified / Falsified / Blocked → Method/Disclosure 延续，记录变化与停止条件；失败和未找到变体也如实保留。

具备实际授权的隔离环境时才做非破坏性实验，记录环境、版本、配置、基线、样本量、任务完成率、攻击成功率、误报、重复试验及限制。关注跨版本/跨模型泛化、自适应绕过，以及安全收益与正常任务效用之间的权衡。不能运行时明确哪些结论来自源码或证据综述，哪些仍是实验计划；模拟结果只支持模型内性质，不证明真实产品防御有效。

周一选定一个主攻问题并复核证伪条件；每月首个工作日整理重点专题证据、实验设计与研究缺口；每季度首个工作日复盘方法、复现情况、原创发现、无效假设及外部可验证影响。这些是研究过程，不强制生成日报、周报或月报。

交付前回答：是否讲清一个机制、排除了重要假设、获得了可复用的源码/补丁结论，或纠正了原有重要判断？相比已发内容新增了什么？仅增加来源、更新状态、重复常识或重写未执行实验不构成交稿。成熟成果优先完善既有 AI 系统安全、AI 赋能安全文章，完整待审稿按共用约定交付公开 Issue。若形成原创发现，说明负责任披露、同行复核、开源评测或论文等可行后续路径，不抢先披露未修复高危细节。
