---
slug: /ai-relay
icon: router-icon
description: AI 中转站同时包含 API Key 网关与订阅账号网关两条路线；选型重点在资源形态、调度边界、账号池容量和用户治理。
---

# AI 中转站

中转站解决的是"AI 资源怎么被稳定、可控、可计量地消费"。

把视角从站长切到架构师，会发现中转站长期会分成两条路线：一条管理 API Key，一条管理订阅账号。它们看起来都在提供 OpenAI 兼容接口，底层资源形态完全不同，架构风险也完全不同。

## 一个判断

AI 中转站要先按资源形态拆开：

- **API Gateway**：管理官方 API Key、渠道、额度和模型路由。
- **Subscription Gateway**：管理 Claude Max、ChatGPT Plus、Gemini Advanced 这类订阅账号。

API Gateway 的核心问题是"多模型、多渠道、多租户怎么治理"。Subscription Gateway 的核心问题是"账号池、窗口限制、会话消耗怎么调度"。

两类系统可以暴露相似的接口，但不能用同一套容量模型理解。

```text
                 用户
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
  API Gateway          Subscription Gateway
   管 API Key             管订阅账号
       │                       │
       └───────────┬───────────┘
                   ▼
        OpenAI / Claude / Gemini
```

## API Gateway：管 Key 的系统

API Gateway 面向的是"我有多组 API Key，需要统一接入、路由、计量、限额、审计"的场景。典型项目是 LiteLLM、New API、One API。

### LiteLLM

LiteLLM 更接近企业 AI 基础设施。它把不同模型供应商收敛成统一的 OpenAI 兼容接口，同时提供路由、故障切换、预算、虚拟 Key、审计和多租户能力。

```text
OpenAI / Claude / Gemini
Bedrock / Vertex AI
Ollama / vLLM
        │
        ▼
     LiteLLM
        │
        ▼
     Clients
```

它适合企业内部 AI 平台、复杂多云环境、多团队共享模型预算的场景。代价是部署和治理成本更高，依赖链也更长，需要持续跟进版本和安全更新。

### New API

New API 更接近国内 API 聚合站和中小团队的默认选择。它的优势是部署直接、中文社区成熟、后台 UI 完整、渠道管理方便，也能处理常见模型格式转换。

```text
OpenAI / Claude / Gemini / DeepSeek
                │
                ▼
             New API
                │
                ▼
              Users
```

它适合个人站长、小团队、对外提供 API 的轻量平台。代价是企业级治理、复杂路由和组织预算能力不如 LiteLLM。

### One API

One API 是这个方向的早期代表。它的价值在于简单、成熟、迁移成本低。新系统通常会优先看 New API；已有 One API 系统如果运行稳定，继续维护也合理。

### 选型判断

| 场景 | 优先选择 | 原因 |
| --- | --- | --- |
| 企业内部平台 | LiteLLM | 路由、预算、审计、多租户能力完整 |
| 中小团队 | New API | 部署和运维成本更低，后台成熟 |
| API 聚合站 | New API | 渠道管理和国内生态更贴近 |
| 老系统维护 | One API | 简单稳定，迁移收益未必足够 |

API Gateway 的选型重点是系统失控时能不能回答三个问题：谁在用、用了多少、下一次请求应该走哪里。模型数量只是基础能力。

## Subscription Gateway：管账号的系统

Subscription Gateway 的本质是把订阅账号变成可调用的 API。它面对的是一个个有窗口限制、会话限制和风控限制的账号，而不是按量计费的官方 Key。

```text
Claude Max / ChatGPT Plus / Gemini Advanced
                │
                ▼
      Subscription Gateway
                │
                ▼
       Claude Code / Cursor / Codex
```

这种系统的关键是账号池能不能被公平、稳定、可恢复地消耗。接口兼容只是入口。

### Sub2API

Sub2API 是这个方向最典型的项目。它适合把 Claude Max、ChatGPT Plus、Gemini Advanced 等订阅账号组织成账号池，再提供给 Claude Code、Cursor、Codex CLI 等工具使用。

它真正有价值的能力是账号池、分组、优先级、并发控制、自动路由和用量窗口监控。OpenAI 兼容接口只是入口，账号调度才是核心。

更完整的请求链路、账号调度、计费和部署分析，可以看 [Sub2API 深度解析](/sub2api)。

### VoAPI

VoAPI 更轻量，适合需要多账号轮换但不需要复杂运营能力的场景。它能解决账号复用问题，但在生态、调度深度和长期运营工具上不如 Sub2API。

### Claude Relay 系

Claude Relay、Claude2API、Claude Bridge 这一类项目通常围绕网页会话或非官方链路做转发。它们可以解决短期可用性问题，但稳定性、风控风险和维护成本都更高，不适合承载多人长期使用。

### 选型判断

| 场景 | 优先选择 | 原因 |
| --- | --- | --- |
| Claude Code 账号池 | Sub2API | 调度、分组、并发控制更完整 |
| 小规模账号轮换 | VoAPI | 轻量，部署和理解成本低 |
| 临时实验 | Claude Relay 系 | 可快速验证，但不适合长期服务 |

Subscription Gateway 的容量上限由账号池决定。第一瓶颈通常是账号窗口、会话消耗和风控，服务器性能反而靠后。

## Sub2API 的运营重点

把 Sub2API 部署到 ai.feei.cn 这类服务时，重点在运营边界。几个人自用时，账号池问题不明显；一旦进入多人共享，系统稳定性主要取决于账号调度。

### 不要把 Sub2API 当成 New API

很多人会先把系统想成这样：

```text
用户
 ↓
Sub2API
 ↓
Claude Max
```

这个模型在小规模使用时成立，但用户一多就会出现：

```text
503 No available accounts
```

这个错误通常表示所有可用账号都进入限制窗口。订阅账号被打满后，没有官方按量 API 那种自然扩容能力。

### 容量按活跃 Agent 用户估算

Agent 场景的消耗远高于网页聊天。Claude Code、Cursor、Codex CLI 会连续发起多轮请求，一次任务可能消耗掉普通聊天很久才会用到的额度窗口。

规划账号池时，不应该只看注册用户数，而要看活跃 Agent 用户数、任务类型和并发时段。真正决定容量的是高强度任务在同一时间段内压到多少账号。

### 账号必须分层

所有账号放进同一个池子，最容易出现一个高强度用户拖垮所有人的情况。更稳的方式是按使用场景分层：

- **P0**：自己和核心管理员。
- **P1**：Claude Code、Codex CLI 这类高消耗 Agent。
- **P2**：Cursor 这类持续但可控的 IDE 场景。
- **P3**：普通 Web Chat。

Sub2API 的 Priority、Concurrency、Account Group 这些能力，应该围绕场景隔离来用。账号池要让高消耗任务有自己的边界，避免平均分配带来的相互拖累。

### 并发要保守

过高并发会更快触发上游限制。Claude 系账号限制的不只是请求数，还包括会话、RPM、TPM 和窗口成本。

并发配置应该从低值开始，根据窗口消耗和失败率逐步调整。系统稳定以后，再给高优先级池单独放宽。

### 监控窗口消耗

Sub2API 后台里的当前窗口成本、窗口上限、今日成本、RPM、TPM、活跃会话、当前并发、最后使用时间，都比 CPU 和内存更重要。

其中最值得盯的是 `current_window_cost` 和 `window_cost_limit`。它们回答的是"这个账号还能撑多久"。

### 代理和账号来源要隔离

账号来源复杂时，出口代理比服务器规格更关键。所有账号都走同一个出口，容易被关联；账号级 Proxy 能显著降低集中风控风险。

这件事不应该等到账号异常后再补。账号池一开始就要把地区、出口、用途分开。

### 不要只准备 Claude

Claude 是很多 Agent 工作流的首选，但不能成为唯一上游。Claude 被打满、临时故障、账号风控都会发生。

更稳的形态是把 Claude、OpenAI、Gemini 统一纳入资源池：

```text
Claude Max
OpenAI
Gemini
```

Sub2API 负责订阅账号池，API Gateway 负责更上层的用户、额度和路由。规模越大，越需要把这两层拆清楚。

## 推荐路径

ai.feei.cn 这类面向 Claude Code、Codex CLI、Cursor 的服务，可以按使用规模逐步演进：

| 阶段 | 推荐架构 |
| --- | --- |
| 个人自用 | Sub2API |
| 小团队共享 | Sub2API + New API |
| 多团队使用 | Sub2API + LiteLLM |
| 企业入口 | LiteLLM + Sub2API + Open WebUI |

一种比较稳的演进方式：

```text
Nginx
  ↓
New API
  ↓
Sub2API
  ├─ Claude Pool
  ├─ OpenAI Pool
  └─ Gemini Pool
```

职责分工保持清楚：

- Sub2API 负责订阅账号池。
- New API 负责用户、Key、配额和统计。
- LiteLLM 在规模上来后负责统一路由、治理和审计。
- Open WebUI 负责企业级用户入口。

长期看，AI 中转站是一层资源治理系统。API Gateway 解决 Key 的治理，Subscription Gateway 解决账号的调度。真正稳定的中转站，会同时理解这两种资源的边界。
