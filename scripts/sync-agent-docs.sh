#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULES="$ROOT/AGENTS.md"

if [[ ! -s "$RULES" ]]; then
  echo "Missing or empty rules file: $RULES" >&2
  exit 1
fi

if [[ -e "$ROOT/AI.md" || -e "$ROOT/CLAUDE.md" ]]; then
  echo "AI.md and CLAUDE.md are retired; keep AGENTS.md as the single source of truth." >&2
  exit 1
fi

echo "AGENTS.md is the single source of truth"
