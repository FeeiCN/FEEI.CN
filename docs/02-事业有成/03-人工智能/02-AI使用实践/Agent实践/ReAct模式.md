---
slug: /react-agent-loop
icon: brain-circuit-icon
---

# ReAct 模式

ReAct 的底层可以理解为一个多轮工具调用循环：模型判断下一步，程序执行工具，工具结果回到上下文，模型根据新观察继续判断。

```text
用户问题
→ 模型输出 action 或 final
→ 如果是 action，宿主程序调用工具
→ 工具结果写入 scratchpad
→ 进入下一轮
→ 直到模型输出 final 或达到最大步数
```

ReAct 的价值不在于“能调用工具”，而在于模型可以根据每一轮 Observation 动态决定下一步 Action。它解决的是路径未知的问题。

## 适用边界

ReAct 适合需要根据中间结果不断调整路径的任务：

- 告警研判
- 漏洞分析
- 攻击链分析
- 应急响应
- 资产暴露面分析
- 代码安全审查
- 渗透测试辅助

固定流程、单次查询、简单计算、直接调用扫描器这类任务，用 function calling 或 workflow 就够了。

## 最小组件

手写一个最小 ReAct Agent，需要五个部件：

1. **Tool Registry**：工具名到函数的映射。
2. **Prompt 模板**：告诉模型可用工具和输出格式。
3. **模型调用函数**：把当前任务和历史步骤发给模型。
4. **Action 解析器**：解析模型输出的结构化 JSON。
5. **循环控制器**：执行工具、记录观察、限制最大步数。

## 教学版代码

```python
import json


def calculator(expression: str) -> str:
    result = eval(expression, {"__builtins__": {}})
    return str(result)


TOOLS = {
    "calculator": calculator,
}


SYSTEM_PROMPT = """
你可以使用工具。

需要调用工具时输出：
{"type": "action", "tool": "calculator", "input": "1 + 1"}

可以最终回答时输出：
{"type": "final", "answer": "答案"}

只输出 JSON。
"""


def call_llm(prompt: str) -> str:
    # 实际项目中替换成模型 API。
    if "Observation: 56088" in prompt:
        return '{"type": "final", "answer": "123 * 456 = 56088。"}'
    return '{"type": "action", "tool": "calculator", "input": "123 * 456"}'


def run_react_agent(question: str, max_steps: int = 5) -> str:
    scratchpad = ""

    for _ in range(max_steps):
        prompt = f"{SYSTEM_PROMPT}\n用户问题：{question}\n历史步骤：{scratchpad}"
        parsed = json.loads(call_llm(prompt))

        if parsed["type"] == "final":
            return parsed["answer"]

        if parsed["type"] == "action":
            tool = TOOLS.get(parsed["tool"])
            observation = tool(parsed["input"]) if tool else f"未知工具：{parsed['tool']}"
            scratchpad += f"\nAction: {parsed['tool']}({parsed['input']})\nObservation: {observation}\n"
            continue

        return f"未知输出类型：{parsed}"

    return "任务超过最大步数，已停止。"
```

这里的关键不是 `calculator`，而是循环本身。

## scratchpad 与 max_steps

`scratchpad` 是 Agent 的短期工作记录，保存已经调用过的工具、输入和返回结果。没有它，模型第二轮就不知道第一轮发生了什么。

```text
Action: calculator(123 * 456)
Observation: 56088
```

`max_steps` 是安全阀，防止模型一直调用工具而不输出最终答案。每一轮通常包括：把用户问题和历史步骤发给模型，模型决定调用工具或最终回答，程序执行工具，把结果写回 scratchpad，再进入下一轮。

## 结构化输出

生产环境不应直接暴露 Thought，也不应依赖模型自由文本解析。更稳妥的方式是让模型输出严格 schema。

```json
{"type": "action", "tool": "search_web", "input": {"query": "..."}}
```

或者：

```json
{"type": "final", "answer": "..."}
```

Function Calling 解决“怎么让模型调用工具”。ReAct 解决“模型如何通过多轮工具调用完成开放任务”。Agent 则在 ReAct 基础上继续加入记忆、规划、权限、审计、审批、回滚和长期任务管理。

## 生产约束

ReAct 循环本身很简单，风险主要来自工具。一旦模型可以调用工具，就必须补齐：

- 最大步数限制
- 工具超时
- 工具输入校验
- 工具权限控制
- 工具白名单
- 工具结果脱敏
- 全链路审计日志
- 错误恢复
- 高危工具人工审批
- Final 前校验

安全场景尤其要注意：工具权限、执行沙箱、调用审计、限速和熔断必须先于自主执行能力落地。
