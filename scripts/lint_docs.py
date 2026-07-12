"""
Scan Markdown/MDX docs with Claude API and report semantic writing issues.

Usage:
    python scripts/lint_docs.py [--docs docs/] [--batch-size 5] [--out issues.md]

Checks that require semantic judgment:
  1. 页面是否混合多个主要职责
  2. 章节是否偏离同一个核心问题
  3. 重要判断的证据是否足够
  4. 强断言是否缺少成立条件或失效边界
  5. 高风险、时效事实与数字是否缺少来源、口径或复核信息

Mechanical front matter and Markdown checks are handled by check_docs_quality.mjs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
import time
from pathlib import Path

import anthropic

DOCS_ROOT = Path(__file__).parent.parent / "docs"

SYSTEM_PROMPT = """\
你是一位中文知识库编辑，只检查需要语义判断的文章质量问题。\
请逐条仔细分析，只报告会实质影响读者理解、可信度或可执行性的问题。\
不要把个人文风偏好当作错误，不要建议把每段改成加粗结论，不要禁止必要数字和来源归因。\
每个问题用 JSON 对象表示，最终以 JSON 数组返回，若无问题则返回空数组 []。

先读取 front matter 中的 content_type。缺少时根据页面主要用途临时判断，但不要把缺字段作为问题；\
机械字段由其他脚本检查。各类型职责如下：hub 负责定位与阅读路径，article 回答一个问题，\
tutorial 帮读者复现结果，reference 供查询，review 解释阶段结果与调整，archive 保留历史原貌，\
essay 用场景叙事，gallery 以媒体归档为主，dashboard 以结构化数据为主。

【检查规范】
1. 页面职责混杂：同一页承担两个以上互相竞争的主要任务，例如入口导航同时堆放长篇观点、\
观点文同时包含个人待办看板、教程夹入与复现无关的行业评论。指出应保留的主要职责和应下沉内容。

2. 主线偏移：页面声称回答一个问题，但章节或大段内容不能支持同一个核心判断或操作目标。\
不要仅因文章长、标题多或存在附录就报告；必须指出具体偏移内容。

3. 证据不足：重要外部事实没有可追溯来源，因果判断只有结论没有机制或事实，个人经历被直接\
推广为普遍规律。逻辑自洽不能代替事实核验，机制说明也不能单独充当外部证据。

4. 断言越界："唯一"、"永远"、"必然"、"本质"、"所有人"、"最佳"等强判断没有同等强度\
的证据，也没有说明成立条件、反例或失效边界。只有确实影响结论可靠性时才报告。

5. 来源与时效不足：医疗、投资、法律、安全、AI 产品现状、教程版本等高风险或快速变化内容，\
缺少原始来源、适用对象、时间范围、数据口径、验证环境或最后复核信息。数字本身不是问题；\
没有来源和口径的精确数字、评分与阈值才是问题。

essay 不适用结论先行；重点检查经验是否被无依据的普遍判断覆盖。archive 不按当前事实更新，\
只检查是否缺少必要的历史背景或来源。gallery 和 dashboard 不要求写成长篇文章。

【输出格式】
返回一个 JSON 数组，每个元素包含：
{
  "rule": 1,          // 违反规则编号 (1-5)
  "line": 42,         // 大致行号（从1开始，估算即可）
  "excerpt": "...",   // 问题片段（原文，不超过80字）
  "suggestion": "..." // 简短修改建议（不超过60字）
}

只返回 JSON，不要有任何其他文字。若无问题，返回 []。\
"""

USER_TEMPLATE = """\
请审校以下文件（路径：{path}）：

```markdown
{content}
```
"""


def collect_files(docs_root: Path) -> list[Path]:
    files = []
    for ext in ("*.md", "*.mdx"):
        files.extend(docs_root.rglob(ext))
    return sorted(files)


def check_file(client: anthropic.Anthropic, path: Path, docs_root: Path) -> list[dict]:
    rel = path.relative_to(docs_root.parent)
    content = path.read_text(encoding="utf-8")
    # Skip very short stub files (< 5 lines of real content)
    lines = [l for l in content.splitlines() if l.strip()]
    if len(lines) < 5:
        return []

    prompt = USER_TEMPLATE.format(path=rel, content=content[:12000])
    try:
        response = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=2048,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = ""
        for block in response.content:
            if block.type == "text":
                raw = block.text.strip()
                break
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        issues = json.loads(raw) if raw else []
        return [{"file": str(rel), **issue} for issue in issues]
    except (json.JSONDecodeError, anthropic.APIError) as e:
        print(f"  [WARN] {rel}: {e}", file=sys.stderr)
        return []


def format_report(all_issues: list[dict]) -> str:
    rule_names = {
        1: "页面职责混杂",
        2: "主线偏移",
        3: "证据不足",
        4: "断言越界",
        5: "来源或时效不足",
    }
    if not all_issues:
        return "# 文档审校报告\n\n无发现问题。\n"

    lines = ["# 文档审校报告\n", f"共发现 {len(all_issues)} 个问题。\n"]

    by_file: dict[str, list[dict]] = {}
    for issue in all_issues:
        by_file.setdefault(issue["file"], []).append(issue)

    for file, issues in sorted(by_file.items()):
        lines.append(f"\n## {file}\n")
        for iss in issues:
            rule_label = rule_names.get(iss.get("rule", 0), f"规则{iss.get('rule')}")
            line_no = iss.get("line", "?")
            excerpt = iss.get("excerpt", "").replace("\n", " ")
            suggestion = iss.get("suggestion", "")
            lines.append(f"- **[规则{iss.get('rule')} {rule_label}]** 行 {line_no}")
            lines.append(f"  - 原文：`{excerpt}`")
            lines.append(f"  - 建议：{suggestion}\n")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Lint docs with Claude API.")
    parser.add_argument("--docs", default=str(DOCS_ROOT), help="Docs root directory")
    parser.add_argument("--batch-size", type=int, default=5, help="Files per API call batch")
    parser.add_argument("--out", default="issues.md", help="Output report file")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files (0=all)")
    args = parser.parse_args()

    docs_root = Path(args.docs)
    files = collect_files(docs_root)
    if args.limit:
        files = files[: args.limit]

    print(f"Found {len(files)} files in {docs_root}")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Error: ANTHROPIC_API_KEY environment variable not set.")

    client = anthropic.Anthropic(api_key=api_key)
    all_issues: list[dict] = []
    total = len(files)

    for i, path in enumerate(files, 1):
        rel = path.relative_to(docs_root.parent)
        print(f"[{i}/{total}] {rel}", end=" ... ", flush=True)
        issues = check_file(client, path, docs_root)
        all_issues.extend(issues)
        print(f"{len(issues)} issue(s)")
        # Rate limit: pause between batches
        if i % args.batch_size == 0 and i < total:
            time.sleep(2)

    report = format_report(all_issues)
    out_path = Path(args.out)
    out_path.write_text(report, encoding="utf-8")
    print(f"\nReport written to {out_path} ({len(all_issues)} issues total)")


if __name__ == "__main__":
    main()
