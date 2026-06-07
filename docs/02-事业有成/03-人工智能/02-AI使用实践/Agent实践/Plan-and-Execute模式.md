---
slug: /plan-and-execute-loop
icon: layout-dashboard-icon
---

# Plan-and-Execute 模式

Plan-and-Execute 可以理解成：

```text
先让模型把任务拆成计划
↓
再让程序按计划一步步执行
↓
每一步可以调用工具，也可以让模型分析
↓
最后把所有执行结果汇总成答案
```

它和 ReAct 最大的区别是：ReAct 边走边想，下一步临时决定；Plan-and-Execute 先把大步骤想清楚，再按步骤执行。

## 用一个例子理解

假设用户问：

```text
帮我分析一下 example.com 的安全风险
```

ReAct 可能是这样：

```text
先查域名
↓
看到 IP
↓
再查端口
↓
看到 443
↓
再查证书
↓
看到历史信息
↓
再决定下一步
```

Plan-and-Execute 则是：

```text
先生成计划：
1. 查询域名基础信息
2. 查询端口和服务
3. 查询历史漏洞
4. 查询安全配置
5. 汇总风险结论
然后按这 5 步执行
```

## 最小组件

最小 Plan-and-Execute 需要 4 个组件：

1. **Planner**：负责把用户任务拆成步骤。
2. **Executor**：负责执行每一步。
3. **Tools**：真实工具函数。
4. **Summarizer**：负责汇总最终结果。

整体流程是：

```text
用户问题
↓
Planner 生成计划
↓
for 每个步骤:
    Executor 执行当前步骤
    保存执行结果
↓
Summarizer 汇总所有结果
↓
最终答案
```

## 教学版代码

```python
def calculator(expression: str) -> str:
    try:
        result = eval(expression, {"__builtins__": {}})
        return str(result)
    except Exception as e:
        return f"计算失败：{e}"


def search_knowledge_base(query: str) -> str:
    knowledge = {
        "react": "ReAct 是 Reasoning and Acting 的缩写，表示模型一边推理，一边调用工具行动。",
        "plan-and-execute": "Plan-and-Execute 是先生成任务计划，再逐步执行计划的 Agent 模式。",
        "agent": "Agent 是可以规划任务、调用工具、观察结果并完成目标的系统。",
    }
    for key, value in knowledge.items():
        if key in query.lower():
            return value
    return "没有找到相关知识。"


TOOLS = {
    "calculator": calculator,
    "search": search_knowledge_base,
}


def planner(user_task: str) -> list[dict]:
    if "ReAct" in user_task or "react" in user_task.lower():
        return [
            {"step": 1, "goal": "查询 ReAct 的定义", "tool": "search", "input": "react"},
            {"step": 2, "goal": "查询 Agent 的定义", "tool": "search", "input": "agent"},
            {"step": 3, "goal": "对比 ReAct 和 Agent 的关系", "tool": None, "input": None},
        ]
    if "123 * 456" in user_task:
        return [
            {"step": 1, "goal": "计算 123 * 456 的结果", "tool": "calculator", "input": "123 * 456"},
        ]
    return [
        {"step": 1, "goal": "尝试搜索相关知识", "tool": "search", "input": user_task},
    ]


def execute_step(step: dict, previous_results: list[dict]) -> dict:
    tool_name = step.get("tool")
    tool_input = step.get("input")
    if tool_name is None:
        result = "该步骤不需要调用工具，将在最终汇总阶段结合前面结果分析。"
    elif tool_name not in TOOLS:
        result = f"未知工具：{tool_name}"
    else:
        result = TOOLS[tool_name](tool_input)
    return {
        "step": step["step"],
        "goal": step["goal"],
        "tool": tool_name,
        "input": tool_input,
        "result": result,
    }


def summarizer(user_task: str, plan: list[dict], execution_results: list[dict]) -> str:
    lines = []
    lines.append(f"用户任务：{user_task}")
    lines.append("")
    lines.append("执行计划：")
    for item in plan:
        lines.append(f"{item['step']}. {item['goal']}")
    lines.append("")
    lines.append("执行结果：")
    for result in execution_results:
        lines.append(f"{result['step']}. {result['goal']}")
        lines.append(f"   工具：{result['tool']}")
        lines.append(f"   输入：{result['input']}")
        lines.append(f"   结果：{result['result']}")
    lines.append("")
    lines.append("最终总结：")
    lines.append("以上是按照 Plan-and-Execute 模式完成的任务：先生成计划，再逐步执行，最后汇总结果。")
    return "\n".join(lines)


def run_plan_and_execute(user_task: str) -> str:
    plan = planner(user_task)
    execution_results = []
    for step in plan:
        result = execute_step(step, execution_results)
        execution_results.append(result)
    final_answer = summarizer(user_task, plan, execution_results)
    return final_answer
```

这里的关键不是某一个工具，而是先规划再执行的控制权。

## Replan

如果某一步失败，就需要重规划。

```python
def should_replan(result: dict) -> bool:
    return "失败" in result["result"] or "未知工具" in result["result"]
```

生产系统里，Replan 判断通常还会包括：

- 工具失败
- 权限不足
- 搜索不到结果
- 发现新资产
- 发现高风险线索
- 计划步骤无法继续

## 和 Workflow 的区别

Plan-and-Execute：

- 计划是模型生成的

Workflow：

- 计划是人提前写死的

Plan-and-Execute 更灵活，Workflow 更稳定。企业生产里常见的组合是：

- Workflow 控制主流程
- Plan-and-Execute 处理某个复杂子任务
- ReAct 处理某个不确定步骤

## 安全场景

例如分析一个告警，Plan-and-Execute 会先生成计划：

1. 查询告警详情
2. 查询目标资产
3. 查询源 IP 情报
4. 查询近 30 分钟访问日志
5. 查询业务指标是否异常
6. 汇总判断是否真实攻击

如果执行到第 3 步发现源 IP 是代理池，可能重规划：

```text
3.1 查询该 IP 是否命中过历史 CC 事件
3.2 查询同网段是否有其他访问
3.3 查询 WAF 是否有拦截记录
```

这就是生产版 Plan-and-Execute + Replan。

## 一句话总结

Plan-and-Execute 的最小实现就是：

```text
plan = planner(user_task)
for step in plan:
    result = execute(step)
    results.append(result)
answer = summarize(results)
```

通俗理解就是：

- ReAct 是边走边想
- Plan-and-Execute 是先画路线图，再按路线图走
- Workflow 是路线图早就固定好了，只按流程走
