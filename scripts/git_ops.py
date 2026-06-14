"""Shared git operations for cron-driven data-update scripts.

Provides pull / add / commit / push with a fixed bot identity so that
auto-committed data lands as `FeeiCN[bot] <feei@feei.cn>` regardless of
the calling shell's git config.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Sequence, Union

from tz import BEIJING_TZ

GIT_BOT_NAME = "FeeiCN[bot]"
GIT_BOT_EMAIL = "feei@feei.cn"

PathLike = Union[str, Path]


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def run_git_command(args: Sequence[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [
            "git",
            "-c", f"user.name={GIT_BOT_NAME}",
            "-c", f"user.email={GIT_BOT_EMAIL}",
            *args,
        ],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        fail(f"git {' '.join(args)} failed: {details}")
    return completed


def git_pull_target_repo(repo_root: Path) -> None:
    print(f"[info] git pull {repo_root.name} ...", file=sys.stderr)
    run_git_command(["pull", "--ff-only"], repo_root)
    print("[info] git pull 完成", file=sys.stderr)


def git_commit_and_push_target_repo(
    paths: Sequence[PathLike],
    *,
    repo_root: Path,
    description: str,
) -> None:
    """Stage `paths` (relative to `repo_root`), commit, push.

    The commit message is built as ``[auto] {description} {timestamp}``
    so the `[auto]` prefix and timestamp stay consistent across all
    cron-driven data commits. No-op if nothing is staged.
    """
    relative_paths: list[str] = []
    for p in paths:
        if not p:
            continue
        path_obj = Path(p) if not isinstance(p, Path) else p
        relative_paths.append(str(path_obj.relative_to(repo_root)))
    if not relative_paths:
        return

    run_git_command(["add", "--", *relative_paths], repo_root)
    diff_check = subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--", *relative_paths],
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if diff_check.returncode == 0:
        return
    if diff_check.returncode != 1:
        details = (diff_check.stderr or diff_check.stdout).strip()
        fail(f"git diff --cached failed: {details}")

    timestamp = datetime.now(tz=BEIJING_TZ).strftime("%Y-%m-%d %H:%M")
    message = f"[auto] {description} {timestamp}"
    print("[info] git commit ...", file=sys.stderr)
    run_git_command(
        ["commit", "--only", "-m", message, "--", *relative_paths],
        repo_root,
    )
    print("[info] git push ...", file=sys.stderr)
    run_git_command(["push"], repo_root)
    print("[info] git push 完成", file=sys.stderr)
