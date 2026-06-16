#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

remote_user="${ASSETS_SYNC_REMOTE_USER:-root}"
remote_host="${ASSETS_SYNC_REMOTE_HOST:-feei.cn}"
remote_port="${ASSETS_SYNC_REMOTE_PORT:-10022}"

local_music_dir="$repo_root/static/music"
local_media_dir="$repo_root/static/media"
remote_music_dir="${ASSETS_SYNC_REMOTE_MUSIC_DIR:-/data/wufeifei-assets/music}"
remote_media_dir="${ASSETS_SYNC_REMOTE_MEDIA_DIR:-/data/wufeifei-assets/media}"
iconv="${ASSETS_SYNC_ICONV:-auto}"

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

dry_run=false
delete=false

usage() {
  cat <<'EOF'
Usage: bash scripts/sync-static-assets.sh [--dry-run] [--delete]

Sync local static/music and static/media to:
  root@feei.cn:/data/wufeifei-assets/music
  root@feei.cn:/data/wufeifei-assets/media

Defaults to real upload. Use --dry-run to preview changes.
Use --delete only when remote files removed locally should also be removed remotely.
Set ASSETS_SYNC_ICONV= to disable filename charset conversion.
Set ASSETS_SYNC_ICONV=UTF-8-MAC,UTF-8 to force a specific conversion.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=true
      ;;
    --delete)
      delete=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

require_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    echo "Local directory not found: $dir"
    exit 1
  fi
}

require_dir "$local_music_dir"
require_dir "$local_media_dir"

remote="${remote_user}@${remote_host}"
ssh_args=(-p "$remote_port")
rsync_args=(
  -rlptDz
  --partial
  --human-readable
  --itemize-changes
  --8-bit-output
  --no-owner
  --no-group
  --exclude '.DS_Store'
  -e "ssh -p $remote_port"
)

if [ "$iconv" = "auto" ]; then
  if rsync --version 2>/dev/null | grep -q ' iconv'; then
    rsync_args+=(--iconv=UTF-8-MAC,UTF-8)
  else
    echo "Local rsync does not support --iconv; syncing without filename charset conversion."
  fi
elif [ -n "$iconv" ]; then
  rsync_args+=(--iconv="$iconv")
fi

if [ "$dry_run" = "true" ]; then
  rsync_args+=(--dry-run)
  echo "[dry-run] previewing changes only"
fi

if [ "$delete" = "true" ]; then
  rsync_args+=(--delete-after)
fi

echo "Ensuring remote directories exist..."
if [ "$dry_run" = "true" ]; then
  echo "[dry-run] ssh ${ssh_args[*]} $remote \"mkdir -p '$remote_music_dir' '$remote_media_dir'\""
else
  ssh "${ssh_args[@]}" "$remote" "mkdir -p '$remote_music_dir' '$remote_media_dir'"
fi

echo "Syncing static/music -> $remote:$remote_music_dir/"
rsync "${rsync_args[@]}" "$local_music_dir/" "$remote:$remote_music_dir/"

echo "Syncing static/media -> $remote:$remote_media_dir/"
rsync "${rsync_args[@]}" "$local_media_dir/" "$remote:$remote_media_dir/"

echo "Done."
