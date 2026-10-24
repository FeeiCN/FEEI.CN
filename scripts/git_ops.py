"""Shared git operations for cron-driven data-update scripts.

Provides pull / add / commit / push with a fixed bot identity so that
auto-committed data lands as `FeeiCN[bot] <feei@feei.cn>` regardless of
the calling shell's git config.
"""

from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Sequence, Union

from tz import BEIJING_TZ

GIT_BOT_NAME = "FeeiCN[bot]"
GIT_BOT_EMAIL = "feei@feei.cn"

PathLike = Union[str, Path]

TRANSIENT_GIT_ERRORS = (
    "couldn't connect to server",
    "connection reset",
    "connection timed out",
    "error in the http2 framing layer",
    "failed to connect",
    "operation timed out",
    "recv failure",
    "remote end hung up unexpectedly",
    "tls connection was non-properly terminated",
)


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


def is_transient_git_error(result: subprocess.CompletedProcess[str]) -> bool:
    details = f"{result.stdout or ''}\n{result.stderr or ''}".lower()
    return any(marker in details for marker in TRANSIENT_GIT_ERRORS)


def run_git_with_network_retry(
    args: Sequence[str],
    cwd: Path,
    *,
    max_attempts: int = 3,
) -> subprocess.CompletedProcess[str]:
    result: subprocess.CompletedProcess[str] | None = None
    for attempt in range(1, max_attempts + 1):
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode == 0 or not is_transient_git_error(result):
            return result
        if attempt < max_attempts:
            print(
                f"[warn] git {' '.join(args)} 网络失败，"
                f"{attempt + 1}/{max_attempts} 次重试 ...",
                file=sys.stderr,
            )
            time.sleep(attempt * 2)
    assert result is not None
    return result


def _ensure_no_git_operation(repo_root: Path) -> Path:
    git_dir = Path(run_git_command(["rev-parse", "--absolute-git-dir"], repo_root).stdout.strip())
    for name in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"):
        if (git_dir / name).exists():
            fail(f"git operation already in progress ({name}); automatic sync stopped")
    return git_dir


def git_pull_target_repo(repo_root: Path) -> None:
    """Best-effort fast-forward pull at script start.

    If branches have diverged, the push retry can rebase local commits
    onto origin/main. Uncommitted work or content conflicts stop that
    retry without replacing the remote tree.
    """
    _ensure_no_git_operation(repo_root)
    print(f"[info] git pull {repo_root.name} ...", file=sys.stderr)
    result = run_git_with_network_retry(["pull", "--ff-only"], repo_root)
    if result.returncode == 0:
        print("[info] git pull 完成", file=sys.stderr)
        return
    print(
        f"[warn] git pull --ff-only skipped (push retry will reconcile): "
        f"{(result.stderr or '').strip()}",
        file=sys.stderr,
    )


def git_push_with_retry(repo_root: Path, *, max_attempts: int = 3) -> None:
    """Retry a rejected push by rebasing, preserving remote changes.

    Identical changes already upstream may be skipped by Git. Real
    conflicts abort the retry and retain both local and remote commits.
    """
    bot_args = ["-c", f"user.name={GIT_BOT_NAME}", "-c", f"user.email={GIT_BOT_EMAIL}"]
    push_args = ["git", *bot_args, "push"]
    fetch_args = ["git", "fetch", "origin"]
    rebase_args = ["git", *bot_args, "-c", "rebase.updateRefs=false", "rebase", "--no-autostash", "origin/main"]
    for attempt in range(1, max_attempts + 1):
        git_dir = _ensure_no_git_operation(repo_root)
        result = run_git_with_network_retry(push_args[1:], repo_root)
        if result.returncode == 0:
            return
        stderr = (result.stderr or result.stdout or "").lower()
        if "fetch first" in stderr or "non-fast-forward" in stderr:
            print(
                f"[info] push rejected, rebasing onto origin/main (attempt {attempt}/{max_attempts})",
                file=sys.stderr,
            )
            fetch_result = run_git_with_network_retry(fetch_args[1:], repo_root)
            if fetch_result.returncode != 0:
                fail(f"git fetch failed: {(fetch_result.stderr or fetch_result.stdout).strip()}")
            _ensure_no_git_operation(repo_root)
            if run_git_command(["status", "--porcelain"], repo_root).stdout.strip():
                fail("git push rejected; uncommitted files are present, rebase skipped")
            rebase_result = subprocess.run(
                rebase_args,
                cwd=repo_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if rebase_result.returncode != 0:
                if (git_dir / "rebase-merge").exists() or (git_dir / "rebase-apply").exists():
                    run_git_command(["rebase", "--abort"], repo_root)
                fail(f"git rebase origin/main failed; local commits retained: {(rebase_result.stderr or rebase_result.stdout).strip()}")
            continue
        fail(f"git push failed: {(result.stderr or result.stdout).strip()}")
    fail(f"git push failed after {max_attempts} retries")


def git_commit_and_push_target_repo(
    paths: Sequence[PathLike],
    *,
    repo_root: Path,
    description: str,
) -> None:
    """Stage `paths` (under `repo_root`), commit, push.

    Each `paths` entry may be either an absolute path or a path
    relative to `repo_root`; both forms are resolved to repo-relative
    strings for `git add`. The commit message is built as
    ``[auto] {description} {timestamp}`` so the `[auto]` prefix and
    timestamp stay consistent across all cron-driven data commits.
    No-op if nothing is staged.
    """
    relative_paths: list[str] = []
    for p in paths:
        if not p:
            continue
        path_obj = Path(p) if not isinstance(p, Path) else p
        if not path_obj.is_absolute():
            path_obj = repo_root / path_obj
        try:
            relative_paths.append(str(path_obj.relative_to(repo_root)))
        except ValueError as exc:
            fail(f"git_ops: {path_obj} is not under repo_root {repo_root}: {exc}")
    if not relative_paths:
        return

    _ensure_no_git_operation(repo_root)
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
    git_push_with_retry(repo_root)
    print("[info] git push 完成", file=sys.stderr)
