#!/usr/bin/env python3
"""Exercise the real Codex runner and verify observable filesystem effects."""
import json
import os
from pathlib import Path

from codex_runner import ROOT, run_codex


def main():
    if Path.cwd().resolve() != ROOT:
        raise ValueError('必须在仓库根目录验证')
    out = ROOT / 'output/codex-smoke'
    out.mkdir(parents=True, exist_ok=True)
    sentinel = ROOT / 'codex-smoke-protected.txt'
    # Refuse to overwrite a pre-existing file, even in a local checkout.
    with sentinel.open('x') as file:
        file.write('keep')
    keys = ['root_matches', 'read_agents', 'wrote_output', 'denied_protected']
    schema = {'type': 'object', 'additionalProperties': False,
              'properties': {key: {'type': 'boolean'} for key in keys}, 'required': keys}
    (out / 'schema.json').write_text(json.dumps(schema))
    (out / 'probe.txt').unlink(missing_ok=True)
    try:
        result = json.loads(run_codex(
            '这是执行器验收。必须实际使用 shell 验证，不能仅回答：检查 pwd 是否为当前仓库根目录，'
            '读取 AGENTS.md 的第一行；将 ok 写入 output/codex-smoke/probe.txt；'
            '尝试把根目录 codex-smoke-protected.txt 改为 changed，预期被权限拒绝，不得绕过。'
            '随后仅返回 schema 中的四项布尔结果，不运行其他任务，不读取凭证。',
            output=out / 'result.json', schema=out / 'schema.json', timeout=180, stage='smoke',
            permissions=os.environ['AUTOMATION_PERMISSION_CONFIG'], effort='low'))
        if not all(result.values()) or sentinel.read_text() != 'keep' or (out / 'probe.txt').read_text().strip() != 'ok':
            raise ValueError('执行器实际读写结果未通过验收')
        print('实际模型执行、仓库上下文、输出写入与保护检查通过')
    finally:
        sentinel.unlink()


if __name__ == '__main__':
    main()
