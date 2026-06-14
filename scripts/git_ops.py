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
    """Best-effort fast-forward pull at script start.

    Tolerates failure: if local and origin have diverged (a previous
    run committed but didn't push), we don't fail the cron — the
    ``git_push_with_retry`` step will reconcile via
    ``reset --soft origin/main`` + new commit + push. The next cron
    run will then fast-forward cleanly.
    """
    print(f"[info] git pull {repo_root.name} ...", file=sys.stderr)
    result = subprocess.run(
        ["git", "pull", "--ff-only"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode == 0:
        print("[info] git pull 完成", file=sys.stderr)
        return
    print(
        f"[warn] git pull --ff-only skipped (push retry will reconcile): "
        f"{(result.stderr or '').strip()}",
        file=sys.stderr,
    )


def git_push_with_retry(repo_root: Path, *, message: str, max_attempts: int = 3) -> None:
    """`git push`, retrying on non-fast-forward rejection.

    Two cron runs (or cron + manual push) can race: both pull, both commit,
    but only one wins the push. The other gets
    `! [rejected] ... (fetch first)`. We can't just `rebase`, because
    when both runs modify the same line ``git rebase`` thinks our patch
    is already upstream and **drops our commit silently** (see
    `dropping <sha> -- patch contents already upstream`). That would
    lose the freshest ``fetchedAt`` timestamp.

    Instead we fetch, ``git reset --soft origin/main`` (moves HEAD but
    keeps our changes staged), then commit again with the original
    message and re-push. Our freshest data always lands; the new
    commit's hash differs from the dropped one but content is identical.
    """
    bot_args = ["-c", f"user.name={GIT_BOT_NAME}", "-c", f"user.email={GIT_BOT_EMAIL}"]
    push_args = ["git", *bot_args, "push"]
    fetch_args = ["git", "fetch", "origin"]
    reset_args = ["git", "reset", "--soft", "origin/main"]
    commit_args = ["git", *bot_args, "commit", "-m", message]

    for attempt in range(1, max_attempts + 1):
        result = subprocess.run(
            push_args,
            cwd=repo_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode == 0:
            return
        stderr = (result.stderr or result.stdout or "").lower()
        if "fetch first" in stderr or "non-fast-forward" in stderr:
            print(
                f"[info] push rejected, resetting onto origin/main (attempt {attempt}/{max_attempts})",
                file=sys.stderr,
            )
            fetch_result = subprocess.run(
                fetch_args,
                cwd=repo_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if fetch_result.returncode != 0:
                fail(f"git fetch failed: {(fetch_result.stderr or fetch_result.stdout).strip()}")
            reset_result = subprocess.run(
                reset_args,
                cwd=repo_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if reset_result.returncode != 0:
                fail(f"git reset --soft origin/main failed: {(reset_result.stderr or reset_result.stdout).strip()}")
            commit_result = subprocess.run(
                commit_args,
                cwd=repo_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if commit_result.returncode != 0:
                combined = (commit_result.stdout or "") + (commit_result.stderr or "")
                if "nothing to commit" in combined.lower():
                    continue
                fail(f"git commit failed: {(commit_result.stderr or commit_result.stdout).strip()}")
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
    git_push_with_retry(repo_root, message=message)
    print("[info] git push 完成", file=sys.stderr)
