#!/usr/bin/env bash
set -euo pipefail

bundle_dir="$1"
commit="$2"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit'; exit 1; }
[[ "${bundle_dir%/*}" == "$SITE_ROOT/incoming" && "${bundle_dir##*/}" =~ ^[a-zA-Z0-9-]+$ && ! -L "$bundle_dir" ]] || { echo 'Invalid incoming directory'; exit 1; }
staging_dir="$bundle_dir/pages"
cleanup() { rm -rf -- "$bundle_dir"; }
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

# Verification and extraction happen before taking the shared publish lock.
python3 "$bundle_dir/site_artifact.py" extract --folder "$bundle_dir" --destination "$staging_dir"
mkdir -p "$SITE_ROOT/releases"
exec 9>"$SITE_ROOT/.deploy.lock"
flock --wait 600 9 || { echo 'Publish lock timeout'; exit 1; }
publish_started=$(date +%s)

cd "$REPO_DIR"
git fetch --no-tags origin main
latest="$(git rev-parse FETCH_HEAD)"
if [ "$latest" != "$commit" ]; then
  echo "[deploy] Superseded artifact; current main is $latest."
  exit 0
fi
git merge --ff-only "$commit"
previous_release=""
if [ -L "$SITE_ROOT/current" ]; then
  previous_release="$(readlink -f "$SITE_ROOT/current")"
fi
if [ -n "$previous_release" ] && [ "$(basename "$previous_release")" = "$commit" ]; then
  echo '[deploy] This version is already published.'
  exit 0
fi

mkdir -p "$MEDIA_ROOT" "$MUSIC_ROOT" "$DATA_ROOT"
node scripts/build_weather_cache.mjs "$DATA_ROOT/weather"
python3 scripts/sleep_score_storage.py seed --root "$DATA_ROOT/sleep-score" --legacy-root static/data/sleep-score
rsync -a --delete --exclude 'weather/' --exclude 'health/' --exclude 'sleep-score/' static/data/ "$DATA_ROOT/"

scope="$(node scripts/deployment_scope.mjs "${previous_release##*/}" "$commit")"
pages_changed="$(node -e 'console.log(JSON.parse(process.argv[1]).pages)' "$scope")"
if [ "$pages_changed" = false ] && [ -n "$previous_release" ]; then
  echo '[deploy] Shared data and repository refreshed; published pages reused.'
  exit 0
fi

ln -s "$MEDIA_ROOT" "$staging_dir/media"
ln -s "$MUSIC_ROOT" "$staging_dir/music"
ln -s "$DATA_ROOT" "$staging_dir/data"
if [ -n "$previous_release" ] && [ -s "$previous_release/search-index.json" ]; then
  cp "$previous_release/search-index.json" "$staging_dir/search-index.json"
  if [ -s "$previous_release/search-index-status.json" ]; then
    cp "$previous_release/search-index-status.json" "$staging_dir/search-index-status.json"
  fi
  if [ -s "$previous_release/search-index-manifest.json" ]; then
    cp "$previous_release/search-index-manifest.json" "$staging_dir/search-index-manifest.json"
    cp -a "$previous_release/search-index-assets" "$staging_dir/search-index-assets"
  fi
fi
release_dir="$SITE_ROOT/releases/$commit"
if [ -e "$release_dir" ]; then
  echo 'Unpublished release directory already exists; inspect it before retrying.'
  exit 1
fi
mv "$staging_dir" "$release_dir"
ln -s "$release_dir" "$bundle_dir/current.next"
python3 - "$bundle_dir/current.next" "$SITE_ROOT/current" <<'PY'
import os
import sys
os.replace(sys.argv[1], sys.argv[2])
PY
echo "[deploy] Published $commit; locked phase $(( $(date +%s) - publish_started )) seconds."

python3 - "$SITE_ROOT/releases" "$release_dir" "$previous_release" <<'PY'
from pathlib import Path
import re
import shutil
import sys
for release in Path(sys.argv[1]).iterdir():
    if (release.is_dir() and not release.is_symlink() and re.fullmatch(r'[a-f0-9]{40}', release.name)
            and str(release) not in sys.argv[2:]):
        shutil.rmtree(release)
PY
