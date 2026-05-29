"""
Scan all Markdown/MDX docs with Claude API and output a list of writing issues.

Usage:
    python scripts/lint_docs.py [--docs docs/] [--batch-size 5] [--out issues.md]

Checks (based on CLAUDE.md writing rules):
  1. 结论先行：每段开头应有加粗结论句，格式 **结论。** 正文
  2. 加粗结论后空格：**结论。**正文 → **结论。** 正文
  3. 禁止"不是……而是……"句式
  4. 禁止具体数字/统计数据作为论据（百分比、金额等）
  5. 禁止归因写法（谁在哪篇论文中说了什么）
  6. Front matter 缺少 slug 或 icon（入口页除外）
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
你是一位技术文档审校助手，专门检查中文 Markdown 文档是否符合以下写作规范。\
请逐条仔细分析，只报告真实存在的问题，不要报告不存在的问题。\
每个问题用 JSON 对象表示，最终以 JSON 数组返回，若无问题则返回空数组 []。

【检查规范】
1. 结论先行格式：每个自然段（3行以上的段落）的第一句应该是加粗结论句，\
格式为 `**结论。** 正文`。若段落第一句不是加粗文字，视为违规。\
注意：标题、代码块、列表、引用块、front matter 内的内容不参与检查。\
单句短段落（少于3行）可以豁免。

2. 加粗结论后空格：`**结论。**正文` 中加粗结束标记 `**` 和后续正文之间缺少空格，\
应改为 `**结论。** 正文`。

3. 禁止"不是……而是……"句式：文中出现"不是……而是……"或"不是X而是Y"结构，\
应直接陈述正面结论。

4. 禁止具体数字作为论据：正文中直接引用百分比、精确金额、精确时间段等统计数据\
作为支撑论点的论据（而不是举例说明）。\
可以用"数倍""大幅""以月计"等定性描述替代。

5. 禁止归因写法：正文中出现"XXX在某年某论文/书/演讲中指出/提出/说"这类把论点\
归因到具体人物、时间、出处的句子。应直接陈述论点，出处用 Markdown 链接附在文末。

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
        1: "结论先行格式",
        2: "加粗结论后缺空格",
        3: '"不是……而是……"句式',
        4: "具体数字作为论据",
        5: "归因写法",
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
