---
slug: /sub2api
icon: router-icon
description: sub2api 是一个面向多上游账号、多协议兼容、多租户计费和账号调度的 AI API 网关系统。理解它，要从一次外部请求如何被鉴权、调度、中转、计费和恢复开始。
---

# sub2api 深度解析：从 API 中转到多账号调度

sub2api 看起来像一个统一的 AI API 入口，但它真正解决的问题远不止“把请求转发出去”。在一次模型调用背后，它要完成协议兼容、API Key 鉴权、用户计费、账号选择、并发控制、失败切换、OAuth token 刷新、缓存一致性和多实例部署治理。

本文从使用者、运维者和系统设计者三个视角拆开 sub2api：一个外部请求如何进入系统、为什么它能中转到不同上游、账号调度如何工作、计费和限流如何落地，以及首次部署时最容易踩哪些坑。文章面向还没有使用过 sub2api、但希望理解其架构和运行逻辑的读者，也适合想自己做一套 AI 中转站的人拿来反推系统边界。

读完之后，你应该能回答五个问题：sub2api 在 AI 网关链路里扮演什么角色；一次请求到底经过哪些步骤；多账号调度、计费、限流和 failover 为什么会这么复杂；如果把它部署到生产环境，哪些配置必须提前想清楚；如果自己做一套类似系统，MVP 应该先做什么、哪些复杂能力应该后置。

## 1. 系统定位

sub2api 本质上是一个多上游账号、多协议兼容、多租户计费的 AI API 网关系统。它对外暴露 OpenAI、Anthropic/Claude、Gemini 等兼容接口，对内管理用户、API Key、分组、渠道、上游账号、订阅、余额、额度、调度、日志和运维任务。

从使用者视角看，它像一个统一 API endpoint：客户端带 API Key 调用 `/v1/messages`、`/chat/completions`、`/responses`、`/v1beta/models/...` 等接口。系统负责鉴权、检查余额/订阅/额度、选择合适的上游账号、转换请求、转发到真实 provider、记录用量并扣费。

从管理员视角看，它是一个账号池和计费运营平台：后台可以管理用户、API Key、分组、账号、渠道、模型映射、价格、OAuth token、支付、订阅、限流、风控和运维监控。

从企业技术负责人视角看，它还会变成一层 AI 能力治理平台：统一入口、统一审计、统一成本归因、统一模型策略。给数百人使用时，问题不再只是“能不能转发”，而是“谁能用、能用什么、花了多少钱、出了问题谁负责、哪些数据不能出去、上游故障时怎么降级”。

如果你想自己做一套中转站，第一步不是写转发代码，而是先选路线：

- **API Key Gateway**：管理官方 API Key、渠道、价格、预算、模型路由和多租户。核心是“不同 provider 的 API 如何统一治理”。
- **Subscription Gateway**：管理 Claude Max、ChatGPT Plus、Gemini Advanced 等订阅账号。核心是“账号池、窗口限制、会话消耗和风控状态如何调度”。
- **混合 Gateway**：同时管理 API Key 和订阅账号。功能最完整，但容量模型、计费模型和风险边界也最复杂。

MVP 阶段不要一开始就做全量 sub2api。更稳的路径是：先支持一种协议入口、一个上游平台、API Key 鉴权、账号池、基础调度、请求日志、并发/RPM 限制和手动禁用账号；等请求链路稳定后，再加多协议转换、OAuth 自动刷新、复杂计费、支付订阅、Ops 报表和多实例一致性。

企业内部落地时，还要先确定组织边界：是否对接 SSO/OIDC/SAML/LDAP，是否按部门、项目、成本中心或岗位授权，是否允许外包和自动化任务使用，是否需要申请审批、额度审批和高风险模型审批。这些不是后台 UI 的细节，而是后续所有分组、计费、审计和限流策略的基础。

## 2. 外部请求主链路

一次外部模型请求不是简单地“进来再转发出去”。它会经过鉴权、计费预检查、用户并发、账号选择、账号并发、协议转换、上游转发、错误处理和用量结算。完整展开后，一条请求从客户端到上游大致是：

1. 客户端把 base URL 指向 sub2api，携带本系统 API Key 请求 `/v1/messages`、`/v1/chat/completions`、`/v1/responses`、`/v1beta/...` 等兼容入口。
2. 网关路由命中后，系统先处理请求体大小限制、request id、endpoint 归一化和运维错误记录。
3. API Key 鉴权层从 `Authorization: Bearer`、`x-api-key`、`x-goog-api-key` 等位置取出本系统 key，查 APIKey、User、Group，检查 key 状态、用户状态、IP ACL、分组权限、余额/订阅入口条件。
4. 请求处理层读取请求体，解析协议类型、模型名、stream 标志、session/conversation 信息、工具调用、图片/文件等结构。
5. 系统进入业务执行前检查：用户并发、用户 RPM、API Key quota、API Key 5h/1d/7d 窗口、用户平台 quota、分组限制、模型限制。
6. 调度器根据 API Key 绑定分组、分组平台、模型路由、账号状态、账号调度开关、临时不可调度窗口、账号并发、账号 quota/RPM、粘性会话、failover 排除列表选择候选账号。
7. 命中账号后，系统获取账号并发槽位；如果账号满载，可能排队等待，等待期间还会维持流式连接心跳。
8. 根据账号类型获取真实上游凭证：API key 账号读取 `api_key`/`access_token`，OAuth 账号读取或刷新 access token，必要时走 Redis token cache 和刷新锁。
9. 根据平台重建上游请求：计算目标 URL，映射模型名，改写或过滤 header，把客户端的 sub2api key 替换成真实上游凭证，按上游协议设置 `Authorization`、`x-api-key`、`anthropic-version`、`OpenAI-Beta`、`session_id` 等必要字段。
10. 通过上游 HTTP client 发出请求。账号可绑定代理，连接池可按 proxy、account 或 account+proxy 隔离，OpenAI 路径还支持 HTTP/2 及代理不兼容时回退 HTTP/1.1。
11. 上游返回后，系统把响应转换成客户端期望的协议形态；非流式响应直接返回，流式响应按 SSE/chunk 转发，同时识别终止事件和错误事件。
12. 如果上游在可 failover 阶段返回 401/403/429/5xx、空流、传输错误等，系统会按错误策略决定是否同账号重试、临时移出账号、切到其它账号，或者把错误返回给客户端。
13. 请求结束后，系统解析 usage，计算价格，写 usage log，执行余额/订阅/API Key quota/账号 quota/用户平台 quota 扣减，更新 last_used、调度缓存、Ops 指标和错误日志。
14. 对异步部分，usage 写入、billing cache、平台 quota flush、账号 last_used、scheduler snapshot/outbox 等可能由后台 worker 延迟完成，DB 和 Redis 共同保证最终状态可恢复。

这条链路的关键特征是：鉴权和计费预检查不是只做一次。系统会在入口阶段做一次基础检查，在真正拿到并发槽、准备发往上游前再做一次执行前检查，避免排队期间额度、订阅或限流状态发生变化。

从自研系统角度看，这条链路最好拆成五个面：

- **控制面**：用户、API Key、账号、分组、模型、价格、后台配置。
- **数据面**：外部网关入口、协议解析、账号选择、上游请求、流式响应转发。
- **账务面**：usage 解析、价格计算、余额/订阅/quota 扣减、账务幂等。
- **运维面**：请求日志、错误聚合、账号健康、告警、审计和恢复操作。
- **异步面**：usage worker、缓存刷新、token 刷新、统计聚合、后台补偿。

很多中转站早期会把这些逻辑写在一个 handler 里，短期能跑，后期会很难处理“扣费成功但日志失败”“账号已经不可用但缓存还在”“流式响应半路错误是否能切号”这类边界。越早把这些面分开，后续扩协议、扩账号池和做多实例才越容易。

### 2.1 为什么它能中转？

sub2api 能中转的根本原因不是“复用客户端 key”，而是它自己扮演了兼容 API 服务端和上游 API 客户端两个角色。

对下游客户端，它表现为 OpenAI、Anthropic、Gemini、Claude Code、Codex、Antigravity 等兼容 endpoint。客户端只认识 sub2api 发出的 API Key，并不知道真实上游账号。

对真实上游，它表现为一个正常的上游 API 调用方。系统在账号池里保存真实上游凭证，例如 API key、OAuth access token、refresh token、base URL、代理、模型能力和平台信息。请求进来后，sub2api 会把下游请求解析成内部结构，再按目标平台重建上游请求：

- 下游 `Authorization: Bearer sk-xxx` 只用于 sub2api 自己鉴权，不会原样发给上游。
- 上游请求会换成账号里的真实凭证，例如 `Authorization: Bearer <upstream-token>` 或 `x-api-key: <upstream-key>`。
- 客户端模型名可能被 group/account/channel 映射成另一个上游模型名。
- OpenAI、Anthropic、Gemini 等协议差异由网关转换层处理，例如 messages、responses、chat completions、Gemini v1beta、Antigravity 专用路径等。
- session/conversation/header 会按白名单和平台规则转发或重建，避免把本地无关 header、客户端噪声或敏感信息直接透传给上游。
- 返回时再把上游响应包装成客户端入口对应的错误格式、流式格式和 usage 结构。

所以它更像“协议兼容层 + 账号调度层 + 计费风控层 + 上游 HTTP client”，不是简单的 Nginx 反向代理。真正中转能力来自三个条件：系统持有合法可用的上游账号凭证，能把下游协议转换成上游协议，并能把上游响应转换回下游期望格式。

## 3. 核心实体模型

sub2api 的核心实体可以理解为五层：

`User` 是本系统的最终消费者，拥有余额、角色、状态、并发数、RPM 限制、允许使用的分组、订阅和平台额度。

`APIKey` 是用户对外调用系统的凭证。它绑定用户和可选分组，拥有独立状态、过期时间、总 quota、5h/1d/7d 金额窗口、IP 白名单/黑名单和使用记录。

`Group` 是调度和计费边界。它决定平台类型、是否订阅模式、倍率、模型路由、支持模型范围、图片生成权限、Claude Code 限制、fallback group、RPM 限制等。

`Account` 是真实上游账号或凭证。它有平台、状态、是否可调度、并发数、优先级、模型能力、quota、OAuth token、代理、临时不可调度窗口、session 策略等。

`Channel` 更像 provider/模型能力与价格的抽象层。它参与模型映射、定价解析、渠道限制和实际上游请求构造。

这几个实体的边界很重要：API Key 决定“谁能进来”，Group 决定“走哪类规则”，Account 决定“最终打到哪个上游”，Channel 决定“怎么理解模型和价格”。

如果自己设计数据库，至少要把这些状态分清楚：

- **用户态**：用户是否 active、余额、订阅、全局 RPM、允许访问哪些分组。
- **凭证态**：API Key 是否 active、是否过期、绑定分组、IP ACL、quota、窗口限额。
- **账号态**：上游账号是否 active、是否可调度、是否临时不可调度、并发上限、模型能力、代理、凭证密文。
- **调度态**：session 绑定、账号实时并发、等待队列、临时排除列表、模型级限制。
- **账务态**：usage log、billing dedup、余额流水、订阅周期用量、账号 quota 消耗。
- **运维态**：上游错误、请求错误、账号测试结果、token 刷新失败、系统操作审计。
- **组织态**：部门、项目、成本中心、角色、审批状态、负责人和数据访问边界。

持久事实放 PostgreSQL，短期热状态放 Redis。比如用户、账号、价格、usage log、扣费幂等应该落 DB；并发槽、RPM 计数、粘性会话、token cache、临时不可调度缓存适合 Redis。两者边界不清，会直接影响多实例部署和故障恢复。

企业版数据模型还要能回答“成本和责任归属”。一个 API Key 不应该只是属于某个用户，最好还能绑定部门、项目、应用、环境和负责人。否则数百人一起使用后，账单只能看到总额，看不到哪个团队、哪个项目、哪个自动化任务在消耗预算。

## 4. 调度与粘性会话

调度目标不是简单轮询账号，而是在一堆约束中找到最合适的账号。

调度时会考虑：

- 分组绑定或混合平台策略。
- 账号是否 active、schedulable、未处于临时不可调度窗口。
- 账号是否支持请求模型。
- 模型路由配置是否指定账号集合。
- 账号 quota、窗口费用、RPM 是否允许。
- 账号当前并发和等待队列。
- 优先级、负载率、最后使用时间。
- 粘性会话绑定。
- failover 排除列表。

粘性会话是这个系统理解 Codex/Claude Code 类工作负载的关键。系统会从请求内容、metadata、session id、prompt cache key、客户端上下文等信号生成 session hash，并把 `session -> account` 绑定写入 Redis。之后同一个 session 会优先回到同一个上游账号。

所以“一个 Codex session 会不会固定打到某个上游账号”的答案是：倾向于固定，但不是绝对固定。只要粘性绑定存在且账号仍满足调度条件，系统会优先使用原账号；如果账号不可调度、模型不匹配、quota/RPM 不允许、并发等待队列满、上游失败触发 failover，系统会切换到其它账号，并可能更新粘性绑定。

自研调度器可以先按这个顺序实现：

1. 过滤不可用账号：disabled、未开启调度、临时不可调度、模型不支持、分组不匹配。
2. 过滤容量不足账号：账号并发满、RPM 超限、quota 不足、窗口费用进入红区。
3. 尝试粘性会话：如果 session 已绑定账号且账号仍可用，优先返回它。
4. 在剩余候选中排序：优先级、当前负载、最后使用时间、随机扰动。
5. 获取账号并发槽：拿不到就换下一个或排队。
6. 记录选择结果：写入 session 绑定、request context 和调度日志。

第一版不要急着做复杂权重。比“聪明的排序”更重要的是“过滤条件准确、状态可解释、失败能恢复”。后台能解释为什么某个账号没被选中，调度器才真正可运营。

## 5. 调度开关的含义

账号管理里的“调度”开关本质上控制账号是否进入候选池。账号 active 不代表一定会被调度；只有状态、调度开关、临时不可调度窗口、模型能力、分组归属、quota、RPM 等都满足时，才可能成为候选账号。

这意味着管理员可以保留账号配置但暂停流量，不必删除账号或清空 token。系统遇到 401/403/429/5xx 等上游错误时，也可能通过 RateLimitService 或临时不可调度机制把账号从调度池里短暂移出。

## 6. 计费系统

计费由多个层次组成：

- 用户余额模式：按实际 cost 扣用户余额。
- 订阅模式：按订阅周期额度扣 daily/weekly/monthly usage。
- API Key quota：单个 key 的总消费上限。
- API Key rate limit：按金额统计 5h、1d、7d 窗口。
- 用户平台 quota：限制某用户在某个平台上的消费。
- 账号 quota：限制某个上游账号自身额度。
- 倍率：Group 倍率、用户专属分组倍率、Account 倍率分别作用在不同层面。

费用计算不是只看 token 数。系统支持 token、image、per_request 等计费模式，也会处理 OpenAI cache read token 这类特殊场景。例如 OpenAI input tokens 中需要扣掉 cache read tokens，避免把缓存命中重复按普通输入计费。

扣费幂等是独立设计的。系统不用 usage log 当扣费幂等依据，而是使用 `usage_billing_dedup`，以 `(request_id, api_key_id)` 防止同一次请求被重复扣费。usage log 自身也有唯一约束，但它主要是日志幂等，不承担核心账务幂等。

自己做计费时，最容易踩三个坑：

- **预检查不等于扣费**：请求前只能判断“可能够用”，最终费用必须以响应后的 usage 为准。
- **日志不等于账务**：usage log 可以重复写失败后补偿，扣费必须有独立幂等键。
- **模型名不等于价格名**：客户端请求模型、上游实际模型、计费模型可能不同，价格解析要有明确来源。

如果只是自用，可以先不做余额和支付，但也应该保留 usage log、request id、账号消耗和 API Key 消耗。否则一旦账号池变慢或被打满，很难回答“是谁用掉了额度”。

企业内部不一定需要充值和支付，但一定需要成本治理。更实用的模型是：按部门、项目、应用、用户和模型统计成本；给成本中心设置月度预算；达到 70%、90%、100% 时告警或自动降级；对高价模型、长上下文、图片生成、Agent 批量任务设置单独审批。财务报销不是重点，重点是让技术负责人能把 AI 成本解释清楚、控制住、分摊出去。

## 7. 鉴权与安全入口

外部 API Key 支持从 `Authorization: Bearer`、`x-api-key`、`x-goog-api-key` 读取。普通网关禁止 query 参数传 key；Gemini 原生兼容路径为了兼容 SDK/CLI，在特定路径允许 `key` query 参数，并返回 Google 风格错误结构。

API Key 鉴权检查：

- key 是否存在。
- key 状态是否可用。
- IP 白名单/黑名单。
- 关联用户是否存在并 active。
- 分组是否可用。
- 用户是否允许访问该分组。
- 订阅或余额是否满足入口条件。

后台管理接口使用 AdminAuth，支持管理员 JWT 和 Admin API Key。JWT 会校验签名、过期时间、用户状态和 TokenVersion；管理员接口还要求用户角色是 admin。后台还有 AdminComplianceGuard，管理员未确认合规文档时，除合规确认接口外其它后台接口会返回 423。

这里的 Admin API Key 不是用户调用模型的 API Key，而是给外部系统和自动化脚本调用后台管理接口用的全局管理员凭证。它通过 `x-api-key: <admin-api-key>` 请求头传入，命中后会以管理员身份访问 `/api/v1/admin/...` 这类后台接口，适合内部运维平台、用户同步、支付/订单系统、监控系统或批量管理脚本做服务间集成。

它和管理员 JWT 的定位不同：JWT 面向后台登录用户，依赖登录态、过期时间、用户状态和 TokenVersion；Admin API Key 面向机器调用，不依赖浏览器登录，也不适合发给普通用户。因为它拥有完整后台管理权限，泄露后的影响接近“后台管理员账号泄露”：攻击者可能修改用户、额度、分组、模型、上游账号或系统设置。

因此这个功能更像系统级集成密钥，而不是日常使用凭证。生成后完整 key 只显示一次，后续只能看到脱敏值；重新生成会立即废掉旧 key；删除后依赖它的外部集成会停止工作。生产环境里应该只把它放在服务端密钥管理系统或 CI/CD Secret 中，按环境隔离、定期轮换，并限制能读取它的人和服务。

登录安全链路包括 Turnstile、密码校验、TOTP 双因素、refresh token 轮转和高风险接口 Redis 限流。Refresh token 服务端只存 hash，每次刷新都会删除旧 token 并生成新 token，TokenVersion 变化会让旧 token 家族失效。

中转站的安全底线比普通后台更高，因为它同时持有下游用户 API Key 和上游真实凭证。自研时至少要做到：

- 上游 token/API key 加密存储，后台展示时只显示掩码。
- Admin API Key 只用于可信服务端集成，不能写进前端代码、客户端配置、公开文档或普通用户脚本。
- 管理员操作有审计日志，尤其是导出账号、修改余额、重置密码、禁用账号、系统升级。
- 普通网关不要允许 query 传 key，除非为了兼容特定 SDK 且范围受控。
- 自定义 base URL 必须有 allowlist 或私网限制，避免 SSRF。
- API Key 支持过期、撤销、IP ACL 和最小权限分组。
- 所有高风险接口要有速率限制和二次确认。

企业场景还要额外考虑身份、数据和审计：

- 登录最好接企业 SSO，并同步部门、岗位、离职状态。
- API Key 要能绑定应用负责人，员工离职后自动失效或转交。
- 请求日志和响应日志要有分级策略：默认记录元数据，敏感内容脱敏或不落库。
- 对客户数据、源代码、密钥、个人信息等高风险内容，要接 DLP 或至少提供拦截/告警机制。
- 审计日志要覆盖谁创建了 key、谁改了额度、谁导出了账号、谁打开了高风险模型。
- 数据留存周期要明确，不能因为“方便排查”无限期保存 prompt 和 response。

## 8. 并发、RPM 与额度限制

并发限制分用户并发和账号并发。两者都使用 Redis sorted set 存槽位，key 分别类似：

- `concurrency:user:{userID}`
- `concurrency:account:{accountID}`

成员是 requestID，score 使用 Redis TIME。这样多实例时不依赖应用服务器本地时钟。槽位有 TTL，释放时 `ZREM`，请求取消时也会通过 context 回调释放。

并发满时系统不一定立刻拒绝。用户并发和账号并发都可能进入等待逻辑；流式请求等待期间可以发送 SSE ping。等待队列计数也是 Redis 维护，队列满时返回 429。

RPM 限制按用户和用户+分组计数，不按 API Key 计数，目的是防止同一用户创建多个 key 绕过限速。RPM 优先级是：

- user-group `rpm_override` 优先于 group rpm。
- group `rpm_limit` 在无 override 时生效。
- user `rpm_limit` 是全局硬上限，始终生效。

Redis 计数失败时 RPM fail-open，记录 warning 但不阻断请求。这是可用性优先的选择，但多实例部署时必须共享 Redis，否则全局 RPM 会被实例分裂。

限流要先回答“保护谁”：保护用户体验、保护账号池、保护账务，还是保护上游 provider。用户级 RPM 防止一个用户开多个 key 绕过限制；账号级并发保护单个上游账号；分组级限制保护某类流量；全局限制保护系统整体。不要只做一个全局 QPS，它解释不了真实问题。

企业里还要把限流和服务等级绑定。比如 P0 生产应用、研发 Agent、普通聊天、批处理任务不应该共享同一组限制。P0 应用需要稳定和告警，研发 Agent 需要较高并发但可降级，普通聊天可以排队，批处理任务应该让路。没有服务等级，数百人使用时最容易出现“低价值任务占满高价值账号池”的问题。

## 9. Failover 与上游错误处理

Failover 是上游账号请求失败后的切号机制。系统会把失败账号加入排除列表，在同一请求内重新选择其它账号。对某些 `RetryableOnSameAccount` 错误，会先在同一账号上重试，重试耗尽后再临时暂停该账号调度并切号。

流式响应一旦已经向客户端写出内容，就不能随意 failover，因为客户端已经收到部分上游响应，切到另一个账号会造成协议和内容不一致。

Failover 还和计费有关。如果一个粘性会话切换了账号，或者上游错误明确要求，系统可能触发 ForceCacheBilling，把 input tokens 按 cache read 的方式处理，避免因为切号导致缓存上下文成本异常。

上游错误还会反向影响账号状态。401、403、429、5xx、模型容量不足等错误会进入 RateLimitService 或平台特定处理逻辑，可能清理 token、标记临时不可调度、设置模型级限制或触发恢复测试。

### 9.1 如何降低上游限流和账号异常风险？

先明确边界：这里说的是合规使用下的稳定性和风控治理，目标是减少误伤、过载、额度打爆、错误重试风暴和账号状态污染。它不能保证账号不被上游限制，也不应该被理解为绕过平台风控、规避检测或违反上游服务条款的方法。

系统内已经有一些降低风险的机制：

- 账号调度开关：有问题的账号可以保留配置但停止进流量。
- 账号并发和等待队列：避免单个账号被瞬时并发打爆。
- 用户 RPM、分组 RPM、API Key quota、窗口消费限制：在本地先限流，减少请求直接冲到上游。
- 粘性会话：同一 Codex/Claude Code session 优先回到同一账号，降低会话上下文在多个上游账号之间跳来跳去造成的不一致。
- failover 排除列表：同一请求里失败过的账号不会被反复选中，避免错误风暴。
- 临时不可调度：遇到 401/403/429/529、模型容量、超时或自定义错误策略时，可把账号短暂移出调度池。
- OAuth token 后台刷新和请求时刷新锁：降低 access token 过期导致的 401，并避免多实例同时刷新同一个 refresh token。
- Gemini quota precheck、OpenAI/Codex usage snapshot、Anthropic window limit 等平台特定逻辑：在本地提前识别额度风险。
- 代理、连接池隔离和代理探测：用于网络稳定性和账号/代理组合隔离，避免一个坏代理或坏连接池影响所有账号。
- Ops 错误聚合：区分本地拦截、客户端问题、调度失败、上游 429/529 和其它上游错误，便于及时下线异常账号。

实际运营上，更稳妥的做法是：

1. 不超卖账号能力。按每个上游账号真实额度设置账号并发、RPM、quota 和分组策略，不要把所有用户都无差别压到少数账号。
2. 对高风险错误保守处理。401/403/402 这类认证、权限、计费问题通常不应盲目重试；应暂停账号、刷新 token、检查后台错误后再恢复。
3. 对 429/529 尊重冷却。429 是明确限流信号，529/overload 是容量信号，应该临时移出调度池或降低流量，而不是快速重试。
4. 保持会话一致。Codex/Claude Code/Antigravity 这类长上下文工作负载尽量使用粘性会话和分组隔离，不要把同一对话混到不同 provider 或账号类型上。
5. 隔离账号和流量类型。把 OpenAI、Anthropic、Gemini、Antigravity、图片、嵌入、Codex 等用途拆到不同 group 或模型路由里，减少一个功能异常拖垮整个账号池。
6. 监控并及时摘除异常账号。重点看 upstream 401/403/429/529、临时不可调度数量、token refresh 失败、空流、超时、usage worker 积压和账号 quota 快耗尽。
7. 生产环境避免不受控自定义上游 URL。启用 URL allowlist，限制 upstream host，避免错误配置造成 SSRF、明文 HTTP 或非预期中继。
8. 多实例必须共享 Redis/DB。否则 RPM、并发、粘性会话、临时不可调度和 token 刷新锁会分裂，反而放大上游风险。
9. 遵守上游条款和授权边界。账号来源、使用场景、调用频率、模型能力、数据使用方式都应符合 provider 规则；系统只能做调度和治理，不能消除违规使用带来的账号限制风险。

如果自己做系统，监控面板至少要能看到这些指标：请求成功率、P95/P99 延迟、上游 401/403/429/529 数量、无可用账号次数、账号临时不可调度数量、账号并发使用率、用户 RPM 命中次数、token 刷新失败次数、usage worker 积压、扣费失败和重复扣费拦截次数。没有这些指标，系统出问题时只能靠猜。

企业负责人还需要定义 SLA/SLO，而不是只看监控图。至少要明确：整体可用性目标、核心模型可用性目标、P95/P99 延迟目标、错误预算、上游故障降级策略、告警分级和值班负责人。上游 provider 出问题不一定是你的锅，但内部用户只会看到“公司 AI 网关不可用”，所以降级、公告和责任边界要提前设计。

## 10. OAuth Token 生命周期

OAuth 账号的 access token 来自 credentials、Redis token cache 或刷新流程。系统区分请求路径刷新和后台刷新：

- 请求路径发现 token 过期时会按需刷新，确保当前请求继续。
- 后台 TokenRefreshService 会周期性刷新快过期账号，降低请求时遇到过期 token 的概率。

多实例刷新竞争由 Redis 刷新锁控制。多个实例同时发现 token 要刷新时，只有拿到锁的实例真正使用 refresh token，其他实例等待或读取刷新后的缓存，避免 refresh token 被重复消费。

刷新成功后，系统不仅要更新 credentials，还要清理 token cache、同步调度缓存，确保调度器和请求路径看到一致的账号状态。

## 11. 模型映射、渠道限制和定价

模型名会经历多个阶段：

1. 客户端请求模型。
2. 分组级模型路由或默认映射。
3. 渠道级模型映射。
4. 账号级模型映射。
5. 上游实际模型。
6. 计费模型解析。

这意味着“请求模型”和“上游模型”可能不同，“上游模型”和“计费模型”也可能不同。`billing_model_source` 决定最终按哪个模型查价格。

渠道限制用于约束账号和模型是否可用，例如模型支持范围、定价模式、渠道映射、图片生成配置等。定价解析支持 token、image、per_request 等不同模式，并叠加 group/user/account 倍率。

最容易误解的是：模型映射不是单点配置，而是分布在分组、渠道、账号、请求转换和计费解析多层。排查“为什么这个模型被换成另一个模型”时，要沿整条链路看。

自研时协议兼容不要贪多。建议优先级是：

1. 先做 OpenAI `/v1/chat/completions` 非流式和流式。
2. 再做 Anthropic `/v1/messages`，因为 Claude Code 类工具依赖更强。
3. 再做 OpenAI `/v1/responses`、Gemini `/v1beta`、图片、embeddings、count_tokens。
4. 最后处理各类专用 alias、WebSocket、复杂工具调用和平台私有扩展。

每加一个协议，都要同步补齐四件事：请求解析、上游请求构造、错误格式映射、usage 解析。只转发 body 不处理错误和 usage，后续调度和计费都会断。

## 12. 幂等、请求去重和系统操作锁

项目里有多层幂等：

- HTTP 写接口幂等：依赖 `Idempotency-Key`、scope、fingerprint 和 response replay。
- 计费幂等：依赖 `usage_billing_dedup`。
- usage log 幂等：依赖 usage log 唯一索引。
- 系统操作锁：复用 idempotency records 做 update/rollback/restart 全局互斥。

HTTP 幂等会保存成功响应体，重复请求可以直接重放结果。对于 update/rollback/restart 这类系统级操作，仅有 HTTP 幂等还不够，因为不同管理员、不同 key 仍可能并发触发，所以还需要全局系统操作锁。

多实例部署时，这些幂等能力依赖共享 PostgreSQL。如果两台服务器用不同 DB，同一个请求可能各自执行和扣费。

## 13. 异步任务与缓存一致性

sub2api 大量使用异步处理来降低请求尾延迟：

- usage log 进入 worker pool。
- 计费缓存写入有 worker pool。
- 用户平台 quota Redis 同步增量，DB 可由 flusher 异步刷。
- 账号 last_used 批量延迟写。
- scheduler outbox 用于调度缓存一致性。
- OAuth token 后台刷新。
- Ops 聚合、报表、支付订单过期、清理任务等后台服务。

这里的设计取舍是：请求路径尽量快速返回，关键账务和一致性靠幂等、Redis 热缓存、DB 原子更新、outbox、后台补偿共同保证。短时间不一致是存在的，例如缓存延迟、worker 堵塞、Redis 故障、outbox 延迟，但系统通常通过后续刷新和 DB 权威状态修正。

异步化不是为了把复杂度藏起来。任何进入 worker 的任务，都要回答三个问题：失败后是否可重试，重复执行是否安全，用户是否能感知延迟。usage log、last_used、统计聚合适合异步；余额扣减、并发槽释放、账号临时不可调度这类关键状态要么同步完成，要么必须有强幂等和补偿。

## 14. 双机部署风险

这套系统可以多实例部署，但不是简单复制两份服务即可。至少要满足：

- 共享 PostgreSQL。
- 共享 Redis。
- JWT secret、加密 key、Turnstile、CORS、网关配置一致。
- 两台服务器的 trusted proxy / forwarded IP 策略一致。
- Redis Pub/Sub 可用，以便 API Key 认证 L1 缓存跨实例失效。
- 后台 singleton 任务要有 Redis/DB leader lock 或 advisory lock。

如果 DB 不共享，会出现重复扣费、幂等失效、系统操作并发执行、用户/账号状态分裂。

如果 Redis 不共享，会出现并发限制被放大、RPM 分裂、粘性会话失效、refresh token/TOTP 临时会话跨实例不可用、登录限流分裂、API Key 缓存失效不同步。

如果配置不一致，会出现一台签发的 JWT 另一台无法验证、IP ACL 判断不同、CORS 行为不同、Turnstile 强制策略不同、请求体限制不同等问题。

因此推荐架构是：多台无状态 app 实例 + 同一 PostgreSQL + 同一 Redis + 统一配置/secret + 前置负载均衡。

多实例时还要注意连接池。`.env.example` 明确提醒 PostgreSQL 服务端 `POSTGRES_MAX_CONNECTIONS` 必须大于所有 Sub2API 实例的 `DATABASE_MAX_OPEN_CONNS` 总和并预留余量。比如 2 个实例、每个 `DATABASE_MAX_OPEN_CONNS=256`，数据库最大连接至少要覆盖 512 再加预留，否则高峰时会出现数据库连接等待或耗尽。

自研上线前，至少要做四类故障演练：Redis 不可用、DB 慢查询、上游持续 429、OAuth token 失效。每个演练都要看系统是否能正确限流、降级、告警、恢复，而不是只看进程是否还活着。

数百人规模还需要容量规划。不要只按员工总数估算，要按日活、峰值并发、Agent 用户占比、任务类型和模型成本估算。一个研发 Agent 的消耗可能远高于几十次普通聊天；一个 CI 自动化任务的错误重试可能瞬间打爆账号池。容量规划应至少区分：人工聊天、IDE/Agent、自动化任务、生产服务调用、批量离线任务。

## 15. 第一次使用还会问什么

前面的章节偏架构。对一个从未使用过的人来说，还会有一组更实际的问题：怎么装、怎么初始化、怎么跑通第一条请求、哪些配置不能随便变、出了问题先看哪里。

最小上手清单可以按这个顺序走：

1. 选 Docker Compose 或脚本安装，把服务、PostgreSQL、Redis 启起来。
2. 固定 `POSTGRES_PASSWORD`、`JWT_SECRET`、`TOTP_ENCRYPTION_KEY`。
3. 登录后台或完成 Setup Wizard，创建管理员。
4. 创建分组，明确这个分组走 Anthropic、OpenAI、Gemini 还是 Antigravity。
5. 添加上游账号，确认账号 active、调度开启、凭证测试通过。
6. 创建用户，并给用户余额、订阅或启用 simple mode。
7. 让用户创建 API Key，并绑定正确分组。
8. 客户端把 base URL 指到 sub2api，用 `Authorization: Bearer sk-xxx` 发起请求。
9. 如果失败，先看 HTTP 状态、response body、后台 Ops 错误和服务日志。

### 15.1 我应该用哪种方式部署？

项目提供三类常见方式：

- 一键脚本安装：下载 GitHub Release 二进制，安装到 `/opt/sub2api`，创建 systemd 服务。适合已有 PostgreSQL 和 Redis 的 Linux 服务器。
- Docker Compose：同时拉起 sub2api、PostgreSQL、Redis。对首次部署尤其推荐 `docker-compose.local.yml`，因为数据目录在本地，备份和迁移更直接。
- 源码构建：先构建前端，再用 `go build -tags embed` 构建后端。`-tags embed` 很关键，否则二进制不会内嵌前端 UI。

对首次使用者，最直接路径是 Docker Compose：

1. 创建部署目录。
2. 运行 `deploy/docker-deploy.sh` 或手动复制 `.env.example`。
3. 设置或生成 `POSTGRES_PASSWORD`、`JWT_SECRET`、`TOTP_ENCRYPTION_KEY`。
4. `docker compose up -d`。
5. 打开 `http://服务器IP:8080`。

### 15.2 第一次启动后怎么进入后台？

如果是脚本安装，启动服务后打开 `http://YOUR_SERVER_IP:8080`，Setup Wizard 会引导配置数据库、Redis 和管理员账号。

如果是 Docker Compose，环境变量里可以配置 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。`ADMIN_PASSWORD` 为空时会自动生成，并在首次启动日志里输出。可以用下面的命令查找：

```bash
docker compose -f docker-compose.local.yml logs sub2api | grep "admin password"
```

首次进入后台后，还需要确认管理员合规文档。管理员未确认前，大多数后台接口会被阻断，只允许访问合规确认接口。

### 15.3 哪些 secret 必须固定？

至少两个不能随便变：

- `JWT_SECRET`：如果为空，每次启动可能生成随机 secret，重启后用户登录态失效；多实例时不一致会导致 A 实例签发的 token 在 B 实例无法验证。
- `TOTP_ENCRYPTION_KEY`：用于加密 TOTP secret。为空或变化会导致已有 2FA 配置无法解密，用户可能无法通过 TOTP 登录。

Docker 部署还必须设置安全的 `POSTGRES_PASSWORD`。这些 secret 可以用 `openssl rand -hex 32` 一类命令生成。

### 15.4 跑通第一条外部请求，需要先配置哪些东西？

最小闭环不是“部署成功”就能调用模型，还要有业务数据：

1. 创建或确认管理员账号。
2. 创建用户，或开放注册让用户自己注册。
3. 创建分组，决定平台、计费模式、倍率、模型策略等。
4. 创建上游账号，并确保账号 active 且调度开关开启。
5. 把账号放进对应分组，或确认分组/混合平台策略能选到它。
6. 给用户余额、订阅或 simple mode 豁免，否则 standard 模式下可能因余额/订阅不足被拦截。
7. 用户创建 API Key，并绑定可用分组。
8. 客户端使用这个 API Key 调用网关接口。

后台提供了对应的管理能力：管理员可管理用户、分组和账号；用户侧可管理自己的 API Key，并查询可用分组。创建 API Key 时可以设置名称、绑定分组、自定义 key、IP 访问控制、总 quota、过期时间和 5h/1d/7d 窗口限额。

### 15.5 客户端应该怎么填 base URL 和 key？

普通兼容接口一般按 OpenAI/Anthropic/Gemini SDK 的 base URL 习惯配置到 sub2api 域名，然后用系统生成的 API Key。

常见入口包括：

- Anthropic/Claude 兼容：`/v1/messages`
- OpenAI Chat Completions：`/chat/completions` 或 `/v1/chat/completions`
- OpenAI Responses/Codex：`/responses`、`/v1/responses` 或相关 Codex alias
- Gemini 原生：`/v1beta/...`
- Antigravity 专用：`/antigravity/v1/messages`、`/antigravity/v1beta/...`

API Key 传法优先用：

```http
Authorization: Bearer sk-xxx
```

也支持 `x-api-key`；Gemini 兼容路径支持 `x-goog-api-key`，特定 Gemini 路径也兼容 query `key`。普通网关不建议也不允许 query 传 key。

如果要快速验证 OpenAI 兼容链路，可以用类似请求：

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "hello"}
    ]
  }'
```

这个请求能成功的前提是：API Key 绑定的分组能路由到 OpenAI 平台账号，账号支持请求里的模型，且用户计费/额度检查通过。Anthropic/Claude 客户端则通常把 base URL 指到服务根地址或 `/antigravity`，再调用 `/v1/messages` 形态的接口。

Antigravity 的 Claude Code 场景可以这样配置：

```bash
export ANTHROPIC_BASE_URL="http://localhost:8080/antigravity"
export ANTHROPIC_AUTH_TOKEN="sk-xxx"
```

如果前面有 Nginx，必须注意 `underscores_in_headers on;`。Nginx 默认会丢弃带下划线的 header，例如 `session_id`，这会破坏多账号场景的粘性会话路由。

### 15.6 standard mode 和 simple mode 该怎么选？

默认是 standard mode，适合完整 SaaS/运营场景，包含用户、余额、订阅、支付、计费、额度等完整链路。

simple mode 面向个人开发者或内部团队，隐藏 SaaS 相关功能，并跳过计费/余额检查。生产环境启用 simple mode 时还必须设置 `SIMPLE_MODE_CONFIRM=true` 才允许启动。

如果你只是自己或小团队内部用，simple mode 能降低初始配置成本；如果要对外发 key、按用户计费、做充值/订阅/账单，应该使用 standard mode。

### 15.7 为什么刚配置好账号还是没有可用账号？

常见原因不是一个开关，而是一串条件任意一个不满足：

- 账号不是 active。
- 账号调度开关关闭。
- 账号不在当前分组，或分组平台不匹配。
- 请求模型不在账号支持范围。
- group/model routing 把请求路由到其它账号集合。
- 账号并发满且等待队列也满。
- 账号 quota、窗口费用或 RPM 进入红区。
- 账号因 401/403/429/5xx 被临时不可调度。
- OAuth token 过期且刷新失败。
- 用户余额、订阅、API Key quota 或 rate limit 已不足。

排查路径建议：

1. 后台账号列表看状态、调度、错误、临时不可调度。
2. 后台账号测试接口验证上游凭证。
3. 后台分组确认账号归属、平台、模型路由。
4. 用户 API Key 确认绑定了正确分组。
5. Ops 错误和 request errors 查看是本地拦截、调度失败还是上游失败。
6. 看 sub2api 日志，尤其是 `No available accounts`、`rate_limit_error`、`billing_check_failed`、`select_account_no_available` 一类信息。

### 15.8 如何判断问题发生在哪一层？

可以按 HTTP 状态和错误类型粗分：

- 401：API Key/JWT 无效、用户不存在、token 过期、用户禁用等鉴权问题。
- 403：IP ACL、API Key 过期、订阅缺失、余额不足、管理员权限不足、分组/功能不允许等。
- 423：管理员未确认合规文档。
- 429：API Key quota/rate limit、RPM、并发等待队列、认证入口限流等。
- 500：本地内部错误。
- 502/503：上游失败、无可用账号、调度耗尽、服务暂不可用。

如果是客户端调用模型失败，优先看 response body 的 code/message，再去后台 Ops 的 request errors/upstream errors 找同一个 request id。系统本身会设置和传递 request id，便于关联客户端、网关日志和上游错误。

### 15.9 生产部署最容易忽略什么？

最容易忽略的不是“能不能启动”，而是长期稳定性：

- 固定 `JWT_SECRET` 和 `TOTP_ENCRYPTION_KEY`。
- PostgreSQL/Redis 做持久化和备份。
- 多实例共享同一 DB/Redis。
- 计算数据库连接池总量。
- Nginx 开启 `underscores_in_headers on;`。
- 配置 trusted proxies，否则 IP ACL 可能看错客户端 IP。
- release 模式下如果要求 Turnstile，要确认后台开关和 secret key 都配置。
- 不要在生产允许不受控 HTTP 上游 URL，避免明文传输和 SSRF 风险。
- 定期检查后台 Ops 错误、账号临时不可调度、OAuth token 刷新失败、usage/billing worker 积压。

这些问题往往不会在第一天暴露，但会在高并发、多账号、多用户、多实例时放大。

如果是自己从零做系统，第一次上线前可以用这份更偏研发的检查清单：

- 是否能解释每个请求最终选中了哪个账号、为什么其它账号没被选中。
- 是否有 request id 串起客户端响应、网关日志、上游错误和扣费记录。
- 是否有独立扣费幂等，重试不会重复扣费。
- 是否能手动下线账号、分组、用户和 API Key。
- 是否能在 Redis 重启后恢复并发槽、RPM 和粘性会话的合理状态。
- 是否能在上游 429/401/403 时停止错误风暴。
- 是否能看到账号池容量：当前并发、窗口消耗、今日消耗、错误率。
- 是否备份了 DB，是否知道如何恢复。
- 是否明确哪些功能暂不支持，并给客户端返回稳定错误。

如果是企业内部上线，还要额外确认：

- 是否接入 SSO，离职员工和转岗员工权限是否会同步变化。
- 是否按部门/项目/成本中心归因用量和预算。
- 是否定义了 P0/P1/P2 用户或应用的服务等级。
- 是否有内部接入文档、SDK 示例、错误码说明和支持渠道。
- 是否有管理员值班、告警分级、故障公告和复盘流程。
- 是否明确哪些数据允许发送给哪些供应商，哪些数据必须拦截或脱敏。
- 是否有上游供应商、模型、账号池和私有模型的备选方案。

## 16. 进一步阅读：从哪些模块继续看

如果读完文章后还想对照实现，可以从下面几组模块继续阅读。它们不是使用 sub2api 的前置条件，但能帮助理解关键设计为什么这样落地。

请求入口：

- `backend/internal/server/router.go`
- `backend/internal/server/routes/gateway.go`
- `backend/internal/server/middleware/api_key_auth.go`
- `backend/internal/server/middleware/api_key_auth_google.go`

鉴权和后台：

- `backend/internal/server/middleware/jwt_auth.go`
- `backend/internal/server/middleware/admin_auth.go`
- `backend/internal/server/middleware/admin_compliance.go`
- `backend/internal/service/auth_service.go`
- `backend/internal/service/totp_service.go`
- `backend/internal/service/turnstile_service.go`

调度和转发：

- `backend/internal/service/gateway_service.go`
- `backend/internal/service/openai_gateway_service.go`
- `backend/internal/handler/gateway_handler.go`
- `backend/internal/handler/openai_gateway_handler.go`
- `backend/internal/handler/failover_loop.go`

计费和限流：

- `backend/internal/service/billing_service.go`
- `backend/internal/service/billing_cache_service.go`
- `backend/internal/service/api_key_service.go`
- `backend/internal/repository/api_key_repo.go`
- `backend/internal/repository/usage_billing_repo.go`
- `backend/internal/service/concurrency_service.go`
- `backend/internal/repository/concurrency_cache.go`
- `backend/internal/repository/user_rpm_cache.go`

缓存、幂等和异步：

- `backend/internal/service/api_key_auth_cache_impl.go`
- `backend/internal/service/idempotency_service.go`
- `backend/internal/repository/idempotency_repo.go`
- `backend/internal/service/system_operation_lock_service.go`
- `backend/internal/service/usage_record_worker_pool.go`
- `backend/internal/service/scheduler_snapshot_service.go`

部署和首次使用：

- `README.md`
- `deploy/.env.example`
- `deploy/config.example.yaml`
- `deploy/docker-compose.local.yml`
- `deploy/docker-compose.yml`

## 17. 总结

sub2api 不是一个简单的 API 转发器，而是一个面向多用户、多上游、多协议、多计费模式的 AI 网关运营系统。它的复杂度主要来自四个方向：

第一，协议兼容复杂。OpenAI、Anthropic、Gemini、Claude Code、Codex、Antigravity 等入口都有不同请求形态、错误格式和会话语义。

第二，调度复杂。账号选择要同时考虑分组、模型、平台、粘性会话、并发、quota、RPM、临时不可调度和 failover。

第三，计费复杂。系统既要实时预检查，又要请求结束后按实际用量扣费，还要保证重复请求不重复扣费。

第四，多实例一致性复杂。大量状态在 Redis 和 PostgreSQL 中协同，部署时必须把共享状态、锁、缓存失效和后台任务治理好。

理解这个项目的最佳路径是从一次外部请求入手：API Key 鉴权、用户并发、计费预检查、账号选择、账号并发、上游转发、failover、用量记录、扣费、缓存失效。把这条链路跑通后，再分别深入后台管理、OAuth token、模型映射、支付订阅和运维监控。

如果你的目标是自研中转站，最佳路径也是从这条链路开始，但顺序要更克制：先把一个协议、一个上游、一个账号池、一套 API Key 鉴权和一套日志跑稳定，再逐步引入计费、分组、多协议、多实例和自动恢复。中转站最危险的不是功能少，而是看起来能转发，实际上不可解释、不可计量、不可恢复。

如果你的目标是企业内部数百人使用，还要再加一层治理：身份统一、权限分层、预算可控、数据合规、故障可告警、责任可追踪。技术链路只是底座，真正决定系统能不能长期运行的是治理能力。

最后需要强调：sub2api 的价值在于协议兼容、账号治理和运营能力，而不是规避上游规则。无论是代理、粘性会话、限流还是 failover，都应该用于合规、授权和可观测的生产运维场景。账号来源、调用频率、数据处理方式和具体业务用途，仍然必须遵守对应上游服务的条款。
