---
slug: /sub2api
icon: router-icon
description: Sub2API 将多协议兼容、上游账号池、负载调度、分布式并发和幂等计费连成一条请求链路；理解它，要从一笔请求如何被执行并入账开始。
content_type: reference
last_reviewed: '2026-07-11'
---

# Sub2API 深度解析：一笔 AI 请求如何穿过账号池并进入账本

只把 Sub2API 看成反向代理，会漏掉它大部分有价值的工程。一次模型调用抵达这里之后，系统还要判断调用者有没有资格、哪个账号适合承接、当前是否有并发槽、两端协议如何互译、流中错误如何结束，以及请求完成后究竟该扣谁的钱。

可以先用一个公式建立直觉：

```text
Sub2API = 协议适配器 + 上游凭证池 + 智能调度器
        + 分布式并发闸门 + 幂等计费账本 + 运营控制台
```

本页只回答一个问题：**一笔外部 API 请求如何穿过这六层能力，最终成为一条可审计的用量记录？**

至于是否应该采用订阅账号网关、账号来源是否获得授权，以及中转方案如何选型，放在 [AI 中转站的选型与风险边界](/ai-relay) 中讨论。这里聚焦代码机制。

## 版本与证据边界

| 项目 | 固定值 |
|---|---|
| **官方仓库** | [`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api) |
| **发布版本** | [`v0.1.151`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.151) |
| **Commit** | [`deff3123ded1d14e51df1fd1286e3d43ed9ec9bd`](https://github.com/Wei-Shaw/sub2api/commit/deff3123ded1d14e51df1fd1286e3d43ed9ec9bd) |
| **发布日期** | 2026-07-10 |
| **复核日期** | 2026-07-11 |
| **复核方法** | 静态阅读固定 tag 的路由、中间件、Handler、Service、Repository、前端、迁移和部署文件；未连接真实上游账号 |

后续版本可能改变路由、调度权重、计费口径和配置默认值。本文所有源码链接都固定到 `v0.1.151`，不能拿 `main` 分支的新行为反向解释这个快照。

本次重构还参考了较早的 `v0.1.138` 深度分析，但只保留解释框架，易变事实全部在 `v0.1.151` 重新核对。两个版本之间已经发生了有意义的演进：

- 原先巨大的 Gateway Service 被拆成调度、转发、请求构造、响应处理和计费等文件；
- Usage Worker 的默认溢出策略从 `sample` 改为 `sync`，队列满时优先把计费任务放回请求路径执行。

这两个变化也说明，阅读快速演进的网关项目时，固定版本比记住某个函数名更重要。

官方 [README_CN](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/README_CN.md) 将项目定位为“AI API 网关平台 - 订阅配额分发管理”，同时明确提示上游服务条款风险，并声明没有授权基于该项目开展商业化运营。源码能证明技术控制流，不能替任何账号来源或业务用途提供授权结论。

## 从反向代理到运营系统

Sub2API 同时运行数据面和控制面：

| 平面 | 主要入口 | 主要职责 |
|---|---|---|
| **数据面** | `/v1/*`、`/v1beta/*`、`/responses` | 鉴权、调度、协议转换、上游传输、流式响应、用量采集 |
| **控制面** | `/api/v1/*` 与 Vue 后台 | 用户、Key、分组、账号、渠道、订阅、支付、风控和运维 |

生产构建会把 Vue 前端嵌入 Go 二进制，所以部署后看起来是一个服务。启动入口 [`main.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/cmd/server/main.go) 和 Wire 装配文件 [`wire.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/cmd/server/wire.go) 显示，它还会启动 Token 刷新、调度快照、用量清理、支付订单、渠道监控、邮件和备份等后台任务。

理解数据面，先抓住四个业务对象和一张事实表：

```text
User 1 ── N APIKey N ── 1 Group N ── N Account
  │           │             │              │
  │           │             │              └─ 上游凭证、平台、并发、代理、健康状态
  │           │             └─ 平台、倍率、订阅、模型路由、能力开关
  │           └─ 下游凭证、额度、有效期、IP ACL、费用窗口
  └─ 余额、角色、并发、RPM、平台额度

每次调用 ──> UsageLog ──> User / APIKey / Group / Account / Subscription
```

**User 是消费主体。** [`user.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/ent/schema/user.go) 保存余额、冻结余额、状态、并发、RPM、TOTP 和通知配置。

**APIKey 是对外授权与预算边界。** [`api_key.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/ent/schema/api_key.go) 除了 Key 本身，还能限制 IP、过期时间、总额度，以及 5 小时、1 天、7 天三个费用窗口。

**Group 是策略中心。** [`group.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/ent/schema/group.go) 决定 Anthropic、OpenAI、Gemini、Antigravity 或 Grok 平台，承载倍率、订阅规则、RPM、模型路由、fallback、图片与视频计价等策略。

**Account 是可调度的上游执行单元。** [`account.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/ent/schema/account.go) 保存账号类型、JSON 凭证、代理、并发、优先级、额度窗口和临时不可调度状态。Group 与 Account 是多对多关系，同一账号池可以被不同产品策略复用。

**UsageLog 是请求事实表。** [`usage_log.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/ent/schema/usage_log.go) 记录请求模型、映射模型、上游模型、Token、缓存、图片、视频、价格、倍率、首 Token 延迟、总耗时以及关联对象。账务余额保存在用户、订阅、Key 和账号表中，UsageLog 提供审计与分析明细。

同一组对象支撑多套客户端协议。路由集中在 [`gateway.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/server/routes/gateway.go)：

| 入口 | 客户端语义 | 主要分派 |
|---|---|---|
| `/v1/messages` | Anthropic Messages | OpenAI/Grok Group 进入 OpenAI 兼容网关，其余进入通用网关 |
| `/v1/responses`、`/responses` | OpenAI Responses | 原生转发或转换到 Group 对应平台 |
| `/v1/chat/completions` | Chat Completions | 原生转发或经 Responses 桥接 |
| `/v1beta/models/*` | Gemini 原生协议 | Gemini SDK/CLI 兼容链路 |
| 图片、视频与批量图片入口 | 媒体任务 | OpenAI、Grok 或批处理链路按能力分派 |

客户端使用同一个 Base URL，实际进入哪条上游链路由 API Key 绑定的 Group 决定。“客户端讲什么协议”和“服务端调用什么平台”由此成为两个独立维度。

## 一笔 `/v1/messages` 请求的生命线

为了让控制流可追踪，下面固定一个场景：

- 客户端调用 `POST /v1/messages`，携带 Sub2API 签发的本地 API Key；
- API Key 绑定 Anthropic 平台 Group；
- 请求包含 `model`、`messages` 和 `stream`；
- 系统运行在 standard mode。

同一路径在 OpenAI 或 Grok Group 下会进入另一套兼容 Handler；Gemini、媒体和 WebSocket 也有自己的链路。下面的细节不外推到所有协议。

```text
客户端
  -> 路由与本地 API Key 鉴权
  -> 用户并发槽与计费资格复查
  -> 会话锚点、模型路由和账号调度
  -> 账号并发槽
  -> 协议改写、凭证替换和上游请求
  -> SSE 或 JSON 返回
  -> Usage Worker
  -> PostgreSQL 幂等结算
  -> Redis 缓存与通知更新
```

**第一步：路由先确定协议入口。** `RegisterGatewayRoutes` 给 `/v1` 依次挂上请求体限制、客户端 Request ID、运维错误采集、端点规范化、API Key 鉴权和 Group 检查。本场景最终进入 [`GatewayHandler.Messages`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/handler/gateway_handler.go)。

**第二步：验证的是下游 Key。** [`api_key_auth.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/server/middleware/api_key_auth.go) 按顺序接受 `Authorization: Bearer`、`x-api-key` 和 `x-goog-api-key`，并拒绝 Query String 中的 Key，避免凭证进入访问日志、浏览器历史和 Referer。

中间件继续检查 Key、用户、Group、IP ACL、有效期、额度和订阅，再把 APIKey、User、Group 与可选 Subscription 写入请求上下文。真正访问供应商的上游凭证保存在 Account 中；下游 Key 不会原样转成上游授权头。

认证热路径也不是每次查询 PostgreSQL。[API Key Service](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/api_key_service.go) 与 [缓存实现](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/api_key_auth_cache_impl.go) 组合了进程内 Ristretto L1、Redis L2、负缓存、TTL 抖动和 singleflight。singleflight 会把同一时刻对同一个 Key 的重复回源合并成一次；多实例通过 Redis Pub/Sub 广播 L1 失效。

**第三步：大请求只做一次轻量解析。** Handler 读取 body 后调用 [`ParseGatewayRequest`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_request.go)。解析器用 `gjson` 提取 `model`、`stream`、`thinking`、`metadata.user_id` 等标量，并保存 system、messages、input 在原始 JSON 中的字节范围。

后续内容审核、会话哈希、模型改写和转发共享同一个 `ParsedRequest`。只有必须结构化修改某个子树时才做完整解码，减少大上下文在热路径上的重复分配。

**第四步：先拿用户槽，再重新检查资格。** Handler 通过 Redis 申请用户并发槽。暂时没有空位时，它会有限等待，并用退避和抖动避免所有请求同时重试；流式客户端等待期间还能收到 keepalive。

拿到槽之后，Handler 再调用 `CheckBillingEligibility`。这次复查有明确原因：请求排队期间，余额、订阅或额度窗口可能已被其他请求消耗。中间件负责尽早挡住明显无效请求，Handler 在占用上游资源前缩小“检查通过到实际使用”之间的竞态窗口。

**第五步：调度器决定由谁执行。** Handler 从显式 session、可缓存内容和请求上下文推导会话哈希，在 Redis 查询粘性账号，再调用 [`SelectAccountWithLoadAwareness`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_scheduling.go)。

选择过程会综合模型路由、Group 与平台、粘性绑定、账号状态、能力、优先级、额度窗口、RPM、当前负载、失败排除集合和等待计划。它先筛掉不满足当前请求的账号，再尝试获得真正的并发槽。快照只辅助选择，原子抢槽才决定请求此刻能否进入。

**第六步：选中账号后才构造上游请求。** Handler 取得账号槽，按需要串行化同一用户消息，然后调用 [`GatewayService.Forward`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_forward.go)。转发层会根据账号类型取得或刷新凭证、应用模型映射、改写请求体与 Header、选择代理和 TLS 配置，再通过统一的 HTTP Upstream 发出请求。

这些动作会因 OAuth、API Key、Service Account、Bedrock、Vertex 和平台能力而分叉。固定主线是“Group 给出策略，Account 给出执行身份，Forward 把当前请求变成该身份能发送的上游请求”。

**第七步：响应一旦开始，故障切换就有边界。** 非流式响应可以收完整 body 后再处理。流式响应进入 [`gateway_upstream_response.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_upstream_response.go)，逐事件读取 SSE，修正模型与 usage，刷新到客户端，并识别终止事件。

Handler 会记录 Forward 前已经写出的字节数。上游在首批业务字节输出前失败时，可以有限重试或换账号；客户端已经收到内容后，系统停止 failover，避免两条上游流被拼成一条损坏的协议流。具体重试状态保存在 [`failover_loop.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/handler/failover_loop.go)。

**第八步：请求结果进入用量与账务链路。** 请求结束后，Handler 根据 ForwardResult 生成记录任务，交给 Usage Worker。任务会计算成本、执行幂等结算、追加 UsageLog，并在数据库提交后更新 Redis 缓存与通知。客户端收到完整响应，只能证明数据面已经完成；账务任务仍可能处于队列或同步回退阶段。

## 三个真正困难的机制

**协议转换是一组状态机。** 旧 Chat Completions、Responses、Anthropic Messages 和 Gemini 对 reasoning、tool call、stop reason、usage 与流式终止的表达都不同。以 Chat Completions 请求转到 Anthropic 为例，链路可能是：

```text
Chat Completions Request
        -> OpenAI Responses Request
        -> Anthropic Messages Request
        -> Anthropic SSE Events
        -> OpenAI Responses Events
        -> Chat Completions Chunks
```

转换器集中在 [`internal/pkg/apicompat`](https://github.com/Wei-Shaw/sub2api/tree/v0.1.151/backend/internal/pkg/apicompat)。它要记住当前 content block、output index、工具参数是否完成、tool call 与 tool result 是否配对、累计 usage，以及终止事件是否已经发出。逐行替换字段无法维护这些跨事件约束。

项目也没有强行用一个巨大 Provider 接口抹平所有平台。通用、OpenAI/Grok、Gemini 和 Antigravity 保留各自的协议逻辑，底层只统一 [`HTTPUpstream`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/http_upstream_port.go) 传输端口。这让平台专用的 OAuth、WebSocket、SSE 和错误语义可以独立演进。

**调度、粘性和并发各自回答不同问题。**

- 调度回答“当前请求更适合哪个账号”；
- 粘性回答“在账号仍健康时，是否优先沿用上次身份”；
- 并发闸门回答“这个账号此刻还有没有可用槽位”。

通用调度器先处理模型路由和粘性，再按账号状态、优先级、窗口、负载与最近使用情况缩小候选。OpenAI 还有独立的 [高级调度器](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/openai_account_scheduler.go)：它能利用 `previous_response_id` 与 session 粘性，并在高级模式下把优先级、负载、队列、错误率 EWMA、首 Token 延迟、额度余量和重置时间组合成分数，再从 top-K 中加权选择。

EWMA 是“近期样本权重更高”的移动平均。它允许调度器在粘性账号质量明显下降时临时逃逸，也避免偶发单次错误立刻改变所有流量。

用户槽和账号槽由 [`concurrency_cache.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/repository/concurrency_cache.go) 在 Redis 中原子申请，并使用 Redis 服务端时间减少多实例时钟漂移。调度快照即使短暂陈旧，最终原子抢槽仍能守住并发上限。

**SSE 把网络连接变成账务输入。** 流开始后，HTTP 状态码已经不足以描述结果；系统还要判断是否看见业务事件、终止事件、完整 usage，以及客户端是否中途断开。

客户端断开时，Anthropic 和 OpenAI 的部分流式路径会停止向下游写入，但继续 drain 上游，争取拿到流末尾的 usage。这提高了计费完整性，也会让上游连接和账号槽在客户端离开后继续占用一段时间。资源回收速度与账务完整性在这里形成了真实取舍。

## Redis 负责实时判断，PostgreSQL 负责最终入账

计费分成前置资格检查和后置结算，两者解决的问题不同。

**前置检查避免明显无效的请求进入上游。** [`billing_cache_service.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/billing_cache_service.go) 会检查余额或订阅、用户平台额度、API Key 总额度与费用窗口，以及用户和 Group 的 RPM。

余额与订阅状态无法确认时，系统通过熔断器 fail-closed，也就是拒绝请求以控制财务风险；RPM 的 Redis 操作失败时选择 fail-open，让短期限流失效优先于整站不可用。不同子系统采用不同退化策略，说明 Redis 故障不能概括成“缓存命中率下降”。

**后置结算按实际结果计算成本。** [`gateway_usage_billing.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_usage_billing.go) 会综合请求模型、映射模型、实际上游模型、输入输出 Token、缓存创建与读取、图片或视频规格、渠道价格和用户倍率。

[Usage Billing Repository](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/repository/usage_billing_repo.go) 在一个 PostgreSQL 事务中完成：

1. 用 `(request_id, api_key_id)` 抢占幂等键，并保存请求指纹；
2. 扣用户余额或增加订阅用量；
3. 增加 API Key quota 与费用窗口；
4. 更新需要本地统计额度的上游账号；
5. 提交后返回新的余额和额度状态。

相同 Request ID 与相同指纹再次出现时不会重复扣费；相同 ID 带着不同指纹会被判为冲突。余额不足以覆盖最终成本时，事务仍会记录透支状态，避免“请求成功、扣费失败、结果免费”的反向激励。批量图片还增加了冻结余额的 reserve、capture、release 链路，使异步任务可以先预占再结算。

**Usage Worker 在吞吐和正确性之间设置了明确默认值。** [`usage_record_worker_pool.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/usage_record_worker_pool.go) 默认 128 个 worker、16384 个排队任务，并可自动扩到 512。队列满时默认 `sync`：提交方内联执行任务，以尾部延迟换取计费任务不被静默丢弃。

`drop` 和 `sample` 仍可显式配置。部署者一旦改用它们，就要自行承担 UsageLog 缺口和漏计费风险，并监控 Dropped、队列长度、同步回退和数据库连接池。这里的关键不在“用了异步”，而在过载时谁承担损失。

两类存储的职责可以压缩成下表：

| PostgreSQL | Redis |
|---|---|
| 用户、Key、Group、Account、订阅、支付 | API Key L2 缓存与失效广播 |
| 幂等扣费事务与权威余额 | 用户/账号并发槽与等待状态 |
| UsageLog 与运营事实 | 粘性会话、RPM、额度热缓存 |
| SQL Migration 与长期审计 | OAuth 刷新锁、临时封禁、调度快照 |

登录 Refresh Token 会话本身也保存在 Redis。它因此既是缓存，也是多实例实时协调层；PostgreSQL 才是长期业务状态与财务账本。

为了避免每次选号都联查完整账号关系，[Scheduler Snapshot Service](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/scheduler_snapshot_service.go) 把面向调度的候选集合构造成 Redis 快照。数据库中的 Scheduler Outbox 记录账号和 Group 变化，后台 worker 增量重建相关 bucket，周期全量重建负责修复漏事件；快照 Miss 时还能在限速与超时保护下回源数据库。

这是一个轻量的读写模型分离：PostgreSQL 保存规范化写模型，Redis 保存适合高频选号的读模型。快照允许短暂陈旧，最终状态检查和并发抢槽仍会再次执行。

## 控制面与生产部署

前端使用 Vue 3、TypeScript、Pinia、Vue Router、TailwindCSS、Axios 和 Chart.js。它覆盖用户、API Key、用量、充值和订阅，也覆盖账号池、Group、渠道、代理、OAuth、模型同步、风控、错误透传、实时 Ops、备份和支付配置。

普通用户的典型路径是“登录与 2FA → 创建绑定 Group 的 API Key → 查看用量与错误 → 兑换或购买订阅”；管理员主要沿着“账号池 → Group 策略 → 渠道与监控 → 用户与账务”运营系统。

[`main.ts`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/frontend/src/main.ts) 会先应用主题和后端注入的公开配置，再初始化 i18n 与 Router，等首次导航完成后挂载。[Axios Client](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/frontend/src/api/client.ts) 统一附加 Bearer Token 和语言 Header，为 GET 请求补充时区，并用 single-flight 处理 401 刷新：一个请求负责刷新，其他失败请求排队后重放。

支付适配器位于 [`internal/payment/provider`](https://github.com/Wei-Shaw/sub2api/tree/v0.1.151/backend/internal/payment/provider)，覆盖 EasyPay、支付宝、微信支付、Stripe 和 Airwallex。付款结果最终增加余额或开通订阅，继续复用同一套资格检查和结算模型。

数据层在这个 tag 包含 38 个 Ent 实体 Schema 和 212 个 SQL Migration。启动时 [`ent.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/repository/ent.go) 先执行嵌入二进制的迁移，再创建 Ent Client。迁移器使用 PostgreSQL Advisory Lock 串行化多实例启动，保存 SHA-256 checksum，并为 `*_notx.sql` 提供 `CREATE INDEX CONCURRENTLY` 等非事务场景。SQL Migration 是线上结构的权威来源，Ent Schema 提供类型与关系模型。

根目录 [`Dockerfile`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/Dockerfile) 使用 Node 24 构建前端、Go 1.26.5 编译嵌入式二进制，并把 PostgreSQL 18 匹配的 `pg_dump` 与 `psql` 放入 Alpine 运行镜像。入口脚本先以 root 修复 `/app/data` 卷权限，再通过 `su-exec` 降权到 UID 1000 的 `sub2api` 用户。

官方 [Compose](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/deploy/docker-compose.yml) 启动应用、PostgreSQL 18 和 Redis 8。只向宿主机发布应用的 8080 端口，但默认绑定 `0.0.0.0`；PostgreSQL 与 Redis 留在内部网络，Redis 同时启用 AOF everysec 和定期快照。

同一快照的部署入口还包括 [`deploy/README.md`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/deploy/README.md)、[`.env.example`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/deploy/.env.example)、[`config.example.yaml`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/deploy/config.example.yaml) 和 [`docker-compose.local.yml`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/deploy/docker-compose.local.yml)。程序、镜像、Compose 和配置示例应来自同一个 tag，避免把 `main` 的配置字段套在旧二进制上。

生产环境至少要明确这些边界：

- `trusted_proxies` 决定 IP ACL 和日志中的客户端 IP 是否可信；
- 反向代理要允许需要的下划线 Header，关闭 SSE 响应缓冲，并配置足够长的超时；
- 未显式配置 JWT Secret 时，代码会在 PostgreSQL 的 `security_secrets` 中原子生成并复用；数据库恢复必须包含它；
- `TOTP_ENCRYPTION_KEY` 未配置时会在进程启动时随机生成，生产环境需要固定，否则 TOTP 和复用该密钥的配置可能无法解密；
- Account 的上游凭证以 JSONB 保存，数据库、备份和管理员权限都属于高价值安全边界；
- 内置备份只通过 `pg_dump` 保护 PostgreSQL，不覆盖 Redis 或 `/app/data`；
- 定时备份只有进程内互斥，没有分布式 leader lock，多副本部署应只在一个副本启用或交给外部任务系统。

simple mode 会跳过余额、订阅和 quota 检查，只记录 UsageLog，不执行常规扣费。它适合个人或内部场景；对外发 Key、充值和订阅仍应使用 standard mode。

## 错误在哪里结束，排障从哪里开始

一笔请求可以在不同层独立失败：

| 位置 | 典型结果 |
|---|---|
| **路由与鉴权** | body、Key、用户、Group、IP、额度或订阅不满足，本地直接结束 |
| **账号选择** | 没有符合模型与容量条件的账号，或等待队列无法接纳请求 |
| **上游发送前** | 凭证、代理、协议转换或传输失败，可按错误类型有限重试 |
| **流式输出后** | 已经写出业务字节，停止账号切换，返回流内错误或结束当前流 |
| **用量与计费** | Worker 或结算失败进入服务日志和指标，不能从客户端状态单独推断 |

[`failover_loop.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/handler/failover_loop.go) 维护失败账号、同账号重试次数、切换次数和最后错误。客户端取消会停止请求级重试；账号池耗尽也会结束循环。故障切换解决的是有限、可分类、首字节前的失败，不提供任意时刻的无缝恢复。

排障时至少要关联五类信息：

1. 客户端或 Sub2API 生成的 Request ID；
2. API Key 对应的 User 与 Group；
3. 调度最终选择的 Account，以及其他候选被排除的原因；
4. 上游状态、错误分类和流是否已经开始；
5. Usage Worker、幂等结算和 UsageLog 的最终状态。

只看客户端最后一个 HTTP 状态码，很难区分本地策略拒绝、没有可用账号、上游故障、流中错误和后置账务失败。Ops 中间件会记录被重试掩盖的上游失败，Request ID 才是把客户端、网关、账号和账务串起来的主键。

Redis 故障也需要按子系统拆开看：认证可能回源数据库，调度快照可以受控回源，RPM 倾向 fail-open，余额和订阅检查倾向 fail-closed，粘性与全局并发协调则直接受影响。运维手册需要写出每一层的退化模式。

## 工程判断与仍需偿还的复杂度

**热路径优化建立在真实瓶颈上。** 轻量 JSON 解析、singleflight、批量 Redis 读取、版本化调度快照、有界 worker 和短 TTL 本地缓存，都围绕大请求、高 QPS、长连接与多实例协调展开。

**流式语义受到认真对待。** 代码区分输出前后，为不同协议生成对应终止事件，处理 keepalive、首 Token Flush、终止事件缺失和断连后 usage 收集。这些细节直接决定 Claude Code、Codex 和 SDK 能否稳定工作。

**账务路径具备明确的最终一致性边界。** Redis 提供低延迟预判，PostgreSQL 用幂等事务收敛结果，`v0.1.151` 又把 Usage 队列默认溢出改成同步回退。系统仍接受有限的并发超支窗口，但没有把 Redis 当财务账本。

**核心 Service 的拆分已经降低维护热点。** `gateway_service.go` 和 `openai_gateway_service.go` 在这个版本都已缩小到约千行，调度、Forward、响应和计费被移到职责文件。两个 Handler 仍分别约 2200 和 2500 行，协议分支、fallback 与资源释放继续集中，修改时仍需要较高的回归成本。

**Redis 承担的是系统正确性。** 并发、粘性、RPM、Token 刷新锁、认证缓存失效和调度读模型都依赖共享 Redis。多实例各连一个独立 Redis，会让全局并发与会话语义失真。

**前端存在明确的信任边界。** 自定义 iframe 会把当前主 JWT 放进管理员配置的 URL 查询参数，且没有 `sandbox`。跨域页面受同源策略限制，仍然已经通过 URL 得到 Token；同源页面还拥有更强能力。access/refresh token 同时保存在 `localStorage`，管理员可配置 HTML 也会进入页面渲染，因此管理员配置、CSP、第三方页面和脚本依赖需要作为一个威胁模型审查。

**测试资产与合并门禁并不等量。** 固定 tag 有 763 个 Go 测试文件和 141 个前端测试文件；后端 CI 分开运行单元与集成测试，前端 CI 却只执行 Makefile 列出的 6 个关键 Vitest 文件，没有让完整测试和 coverage 阈值成为门禁。CI 使用 Node 20，Docker 前端构建使用 Node 24，也应通过统一版本或兼容矩阵消除环境漂移。

这些问题没有否定项目的工程价值。它们说明复杂度已经从“能不能代理请求”转移到协议状态、分布式协调、账务正确性、安全边界和持续演进成本。

## 源码阅读路线与证据缺口

准备二次开发时，沿一条请求向下读，比从生成代码或设置页面开始更快：

1. [`cmd/server/main.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/cmd/server/main.go)：初始化、运行模式和关闭。
2. [`server/router.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/server/router.go) 与 [`routes/gateway.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/server/routes/gateway.go)：控制面和数据面入口。
3. [`middleware/api_key_auth.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/server/middleware/api_key_auth.go)：下游认证与早期资格检查。
4. [`handler/gateway_handler.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/handler/gateway_handler.go)：Anthropic 场景的请求编排。
5. [`service/gateway_request.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_request.go)：请求解析和热路径数据结构。
6. [`service/gateway_scheduling.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_scheduling.go)：模型路由、粘性和通用账号选择。
7. [`service/gateway_forward.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_forward.go) 与 [`gateway_upstream_response.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/gateway_upstream_response.go)：上游执行与 SSE。
8. [`internal/pkg/apicompat`](https://github.com/Wei-Shaw/sub2api/tree/v0.1.151/backend/internal/pkg/apicompat)：协议语义转换。
9. [`billing_cache_service.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/billing_cache_service.go) 与 [`usage_billing_repo.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/repository/usage_billing_repo.go)：前检与最终结算。
10. [`concurrency_cache.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/repository/concurrency_cache.go) 与 [`scheduler_snapshot_service.go`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/backend/internal/service/scheduler_snapshot_service.go)：Redis 协调和调度读模型。
11. [`frontend/src/router/index.ts`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/frontend/src/router/index.ts) 与 [`frontend/src/api/client.ts`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.151/frontend/src/api/client.ts)：控制台工作流与会话刷新。

本文仍有明确证据缺口：

- 只做固定 tag 的静态源码阅读，没有启动完整服务，也没有连接真实供应商账号；
- 主线只追踪 Anthropic Group 的 `/v1/messages`，OpenAI、Grok、Gemini、图片、视频和 WebSocket 有各自分支；
- 源码能证明控制流和默认配置，不能证明特定部署的性能、可用性、实际账单或账号合规性；
- 调度结果受运行时设置、账号状态、Redis 快照和上游响应影响，静态阅读不能复现某一次真实选号；
- 升级版本后，应重新固定 tag 或 commit，再复核本文引用的路径和结论。

对 Sub2API 最有用的心智模型是一条可追踪的因果链：本地 Key 决定谁能进入，Group 定义策略，调度器选择 Account，并发闸门决定何时执行，协议层维持客户端语义，PostgreSQL 最终记录这次调用产生了什么账务事实。
