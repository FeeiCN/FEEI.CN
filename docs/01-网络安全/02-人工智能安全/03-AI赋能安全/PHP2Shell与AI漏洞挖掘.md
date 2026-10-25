---
slug: /php2shell-ai-vulnerability-research
title: PHP2Shell：AI 让老漏洞有了可验证的攻击链
sidebar_label: PHP2Shell 与 AI 漏洞挖掘
icon: bug-icon
description: 从 PHP2Shell 的 OOM 异常、跨请求状态和多漏洞组合，分析 AI 如何帮助研究人员验证 PHP 核心内存安全问题，以及补丁和证据的边界。
published_at: '2026-10-25'
---

# PHP2Shell：AI 让老漏洞有了可验证的攻击链

2026 年 10 月 21 日，PHP 紧急发布四个安全版本，修复两项评分均为 CVSS v4.0 9.2 的核心漏洞：CVE-2026-109618 和 CVE-2026-109619。二者统称 **PHP2Shell**。受影响的 PHP 运行时可能在没有用户认证的情况下发生远程代码执行（RCE），或泄露进程内存。漏洞位于 PHP 引擎，不要求 WordPress、Drupal 或 Joomla 自己存在业务代码漏洞。Wiz 在这些 CMS 的实验环境中演示了攻击链；能否成功仍取决于 PHP 版本、SAPI、配置和内存布局，并不意味着所有运行 PHP 的站点都可以被同一个 Payload 稳定攻陷。([PHP 官方公告](https://www.php.net/archive/2026.php))([Wiz Research](https://www.wiz.io/blog/php2shell-php-rce))

这起事件最值得研究的地方是：**漏洞成因早已存在，长期缺少的却是可证明影响的利用链。AI 辅助研究改变了这一环节的成本。** PHP Foundation 说明，开发者在 2024 年处理 Quarkslab 审计问题时已经察觉 OOM 异常处理的风险，但未找到具体攻击路径，复杂修复也被兼容性、性能和生态系统的权衡拖延。到 2026 年 8 月，Calif、OpenAI 和 Wiz 先后提交了可验证的高危利用路径，推动其成为最高优先级修复任务。([PHP Foundation](https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/))

## 两种根因，共同指向异常路径的内存状态

| 漏洞 | 根因 | 已确认影响 |
|---|---|---|
| [CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) | 内存耗尽时 `longjmp()` 提前中断初始化，清理逻辑使用了不完整的内部状态 | mod_php 默认部署条件下演示未经认证的 RCE |
| [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp) | 请求所有的全局状态未及时清空，下一个请求复用已经释放的内存 | 跨请求 UAF、内存披露和应用场景中的 RCE |

### OOM 不是普通的资源耗尽

PHP 通过 `memory_limit` 限制请求内存。当某次分配碰到上限，旧实现可能使用 `longjmp()` 跳过当前调用栈，直接进入错误处理。问题是：部分内部对象会先写入计数或指针，后完成内存分配；如果异常恰好发生在中间，后续清理就可能把尚未初始化的内容当作有效对象处理。

这条路径的价值在于它位于 HTTP 请求解析和 PHP 内存管理层。攻击者不需要等应用完成认证，某些条件下甚至不需要应用的 PHP 代码开始执行。官方确认 mod_php 的这一攻击面已经具有完整 RCE 演示；FPM 也在风险范围内，但特定 SAPI 与触发路径的完整利用证据不能混为一谈。([GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w))

### 一次请求结束，并不代表状态真正结束

CVE-2026-109619 涉及保存在进程级或共享状态中的请求数据。一次请求发生致命错误后，指向其内存的引用可能存活；下一次请求复用同一 Worker 时，又在正常初始化清空之前读取了这些旧引用。

Wiz 披露的研究具体包括 Session Upload Progress、致命错误回溯和 OPcache 相关路径。多种实例具有不同前置条件，不应把它们误写成一个简单的两请求通用利用方法。更深层的问题是 **Request Lifecycle 与 Memory Ownership 不一致**：请求结束了，内存生命周期却没有被系统状态正确表达。([Wiz Research](https://www.wiz.io/blog/php2shell-php-rce))

## 公开研究展示了什么

Wiz 将多种内存缺陷组合，演示了 WordPress、Drupal、Joomla 实验部署中的未经认证 RCE，以及不依赖 RCE 的 PHP 进程内存披露；后一类问题可能暴露令牌、密钥和其他请求的数据。不同应用和版本的攻击链不相同，内存布局适配、漏洞组合和可靠性验证构成了大量工作。**这是研究人员公开演示的能力，不等于已经确认每个站点发生了真实入侵。** ([Wiz Research](https://www.wiz.io/blog/php2shell-php-rce))

可以把技术路径概括为：

```text
外部 HTTP 请求
  → 请求解析 / 资源耗尽 / 异常退出
  → 部分初始化或未清理的内部状态
  → Request / Worker / OPcache 生命周期跨越
  → 悬挂引用、错误类型或内存披露
  → 在特定布局与利用链下达到 RCE
```

这里不能简单归结为「输入过滤不严格」。敏感缺陷存在于通用运行时的异常恢复和内存状态管理中，业务层的认证、参数检查甚至代码审计都可能无法覆盖。

## AI 究竟参与了哪些环节

本次研究至少有三条需要区分的时间线和贡献：

- **2024 年**：PHP 开发者在修复外部审计问题时注意到 OOM 根因，尚未形成具体利用路径。不能说 2026 年 AI 第一次发现了所有相关缺陷。
- **2026 年 8 月 11 日**：据 PHP Foundation，Calif 的 Ryan A 报告了同一根因导致的无条件 RCE；OpenAI 当天独立报告同一根因，9 月 18 日又补充了攻击路径。OpenAI 介绍 Calif 在 Patch the Planet 计划中使用 GPT-5.6 Sol。
- **2026 年 8 月 19—24 日**：Wiz 使用 Wiz Atlas、Gemini 4 Argon 与 GPT-5.6 Sol 独立开展研究，并在 8 月 24 日报告漏洞。Wiz 披露模型帮助其分析复杂缺陷、适配不同运行环境、构造与验证攻击链。
- **2026 年 10 月 21 日**：PHP 发布修复。研究方、维护者和安全厂商合作完成补丁验证、漏洞响应与缓解部署。

来源：[PHP Foundation](https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/)、[Wiz Research](https://www.wiz.io/blog/php2shell-php-rce)、[OpenAI Patch the Planet](https://openai.com/index/coordinated-disclosure-of-critical-vulnerabilities/)。

公开资料支持「人类专家与前沿模型协作发现、验证并协助修复」的结论，**不支持把所有发现归功于单一模型，也无法据此证明从初始审计到发布实现了完全无人参与的自主漏洞挖掘**。PHP Foundation 还披露，大量 AI 报告最终是无效、重复或无法复现的，报告数量不是研究质量。

## 对 AI 漏洞挖掘体系的启示

站内[AI 漏洞挖掘](/ai-vulnerability-research)将研究问题分成变化、边界、状态和组合。PHP2Shell 最突出的是后三项，并且为「变化」提供了历史修复的线索：

| 搜索切口 | 在 PHP2Shell 中如何体现 | 可以转化成的审计任务 |
|---|---|---|
| **变化** | 多年积累的异常处理设计，修复面临兼容性约束 | 从历史审计与未完成补丁中提取安全不变量，追踪其是否仍然成立 |
| **边界** | PHP 解析器与应用代码执行边界、进程与请求边界 | 枚举在业务认证前执行、却消耗未认证输入的 Runtime 逻辑 |
| **状态** | 部分初始化状态、请求结束后的悬挂指针 | 检查错误/超时/OOM 后资源是否仍被后续生命周期使用 |
| **组合** | 内存披露、内存破坏、布局适配形成完整利用链 | 将单个可疑缺陷作为可验证 Primitive，再评估必要的组合前提 |

工程上可以把 AI 工作流拆成五步：筛选高杠杆组件与历史异常路径；还原对象所有权与生命周期；在隔离的 Sanitizer / Fuzzer 环境中收集可重复的崩溃证据；由研究者评估可利用性与业务影响；向维护者提交可复核的根因、影响与修复建议。

对于模型，值得设计的是 **Exception-Path Audit Skill、Ownership/Lifetime Analysis、Cross-Request State Audit 和 Patch-Invariant Variant Hunting**。对研究系统，则需要检查漏洞报告的真实修复效果、误报、复现率、样本多样性和每个有效发现的成本。大规模搜索能力和准确性必须同时衡量。

## 修复与仍需关注的风险

PHP 官方在 2026 年 10 月 21 日发布的修复版本：

| 分支 | 修复版本 |
|---|---|
| PHP 8.2 | 8.2.35 |
| PHP 8.3 | 8.3.36 |
| PHP 8.4 | 8.4.27 |
| PHP 8.5 | 8.5.12 |

PHP 8.1 及更老的上游分支不再接受正常安全发布，部分发行版与 LTS 厂商提供 Backport；应按**供应商修复证明**判断，而不是只比较版本字符串。升级后必须确认实际运行的 PHP Worker 已重启并加载修复。配置限制、WAF 和流量规则只能降低特定利用路径的暴露，不能替代正式补丁。([PHP 官方公告](https://www.php.net/archive/2026.php))

**相关补充：CVE-2026-115560。** PHP 于 10 月 23 日另行披露了 Session Upload Progress 的特殊 RCE 条件：应用以 `php_binary` 或 `php_serialize` 配置 Session 序列化格式，却在运行期间切换到 `php`，且上传进度功能仍开启。该问题不包含在 10 月 21 日已修复的两个 CVE 中，拟由下一次正常更新修复；涉及该配置组合时，应临时设置 `session.upload_progress.enabled=0`，并确保配置在请求解析前生效。不能因为版本已升级到 8.5.12 等就忽略这一单独公告。([PHP 2026 年 10 月 23 日公告](https://www.php.net/archive/2026.php))

对已有 PHP 应用的防守优先级仍是：确认运行时资产与 SAPI、检查供应商补丁与实际运行版本、升级和重启、排查异常请求与 Worker 崩溃、确认云 WAF 缓解措施覆盖范围。攻击流量探测、成功利用和真实受害者事件需要分别统计。

## 证据与验证状态

本页基于 2026 年 10 月 25 日前发布的 PHP 官方公告、PHP Foundation、Wiz、OpenAI 及厂商技术材料。**没有在本站环境执行漏洞复现，未独立验证公开 PoC 的可靠性，也未通过公网扫描判定任何组织的暴露情况。**

要研究利用细节，优先在授权隔离实验环境中阅读 [PHP 的两个安全公告](https://www.php.net/archive/2026.php)、[PHP Foundation 复盘](https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/)、[Wiz 技术文章](https://www.wiz.io/blog/php2shell-php-rce)、[OpenAI 协同披露报告](https://openai.com/index/coordinated-disclosure-of-critical-vulnerabilities/)及 [Cloudflare 防御分析](https://blog.cloudflare.com/php-vulnerabilities-waf-protection/)。
