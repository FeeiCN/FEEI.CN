#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${MEDIA_RSYNC_ENV:-$repo_root/config/media-rsync.env}"

if [ -f "$env_file" ]; then
  # shellcheck disable=SC1090
  source "$env_file"
fi

local_dir="${MEDIA_SYNC_LOCAL_DIR:-$repo_root/static/media}"
remote="${MEDIA_SYNC_REMOTE:-}"
direction="${MEDIA_SYNC_DIRECTION:-two-way}"
interval="${MEDIA_SYNC_INTERVAL:-300}"
lock_file="${MEDIA_SYNC_LOCK_FILE:-$repo_root/.media-rsync.lock}"

if [ -z "$remote" ]; then
  echo "MEDIA_SYNC_REMOTE is required, for example: user@example.com:/data/wufeifei.com-site/shared/media"
  exit 2
fi

run_rsync() {
  local source="$1"
  local target="$2"
  shift 2

  rsync \
    -az \
    --partial \
    --human-readable \
    --itemize-changes \
    --exclude '.DS_Store' \
    --exclude '.media-rsync.lock' \
    "$@" \
    "$source" \
    "$target"
}

sync_once() {
  mkdir -p "$local_dir"
  delete_args=()
  if [ "${MEDIA_SYNC_DELETE:-}" = "true" ]; then
    delete_args=(--delete-after)
  fi

  case "$direction" in
    pull)
      run_rsync "$remote/" "$local_dir/" "${delete_args[@]}"
      ;;
    push)
      run_rsync "$local_dir/" "$remote/" "${delete_args[@]}"
      ;;
    two-way)
      if [ "${MEDIA_SYNC_DELETE:-}" = "true" ]; then
        echo "MEDIA_SYNC_DELETE=true is not allowed with MEDIA_SYNC_DIRECTION=two-way; use pull or push for destructive sync."
        exit 2
      fi
      run_rsync "$remote/" "$local_dir/" --update
      run_rsync "$local_dir/" "$remote/" --update
      ;;
    *)
      echo "Unsupported MEDIA_SYNC_DIRECTION: $direction"
      exit 2
      ;;
  esac
}

with_lock() {
  if command -v flock >/dev/null 2>&1; then
    flock -n "$lock_file" "$0" --no-flock
    return
  fi

  if ! mkdir "$lock_file" 2>/dev/null; then
    echo "media sync is already running: $lock_file"
    exit 0
  fi
  trap 'rmdir "$lock_file"' EXIT
  sync_once
}

if [ "${1:-}" = "--no-flock" ]; then
  sync_once
elif [ "${MEDIA_SYNC_LOOP:-}" = "true" ]; then
  while true; do
    with_lock
    sleep "$interval"
  done
else
  with_lock
fi
