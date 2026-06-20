#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run_claude_with_retry.sh \
    --label <label> \
    --prompt-file <path> \
    --output-file <path> \
    --stderr-file <path> \
    --meta-file <path> \
    [--attempts <n>] \
    [--timeout-seconds <n>] \
    [--max-budget-usd <n>]
EOF
}

LABEL=""
PROMPT_FILE=""
OUTPUT_FILE=""
STDERR_FILE=""
META_FILE=""
ATTEMPTS=2
TIMEOUT_SECONDS=420
MAX_BUDGET_USD=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      LABEL="$2"
      shift 2
      ;;
    --prompt-file)
      PROMPT_FILE="$2"
      shift 2
      ;;
    --output-file)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --stderr-file)
      STDERR_FILE="$2"
      shift 2
      ;;
    --meta-file)
      META_FILE="$2"
      shift 2
      ;;
    --attempts)
      ATTEMPTS="$2"
      shift 2
      ;;
    --timeout-seconds)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --max-budget-usd)
      MAX_BUDGET_USD="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$LABEL" || -z "$PROMPT_FILE" || -z "$OUTPUT_FILE" || -z "$STDERR_FILE" || -z "$META_FILE" ]]; then
  usage >&2
  exit 2
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

: > "$STDERR_FILE"
{
  echo "label=$LABEL"
  echo "attempts=$ATTEMPTS"
  echo "timeout_seconds=$TIMEOUT_SECONDS"
  echo "max_budget_usd=$MAX_BUDGET_USD"
} > "$META_FILE"

last_status=1

for attempt in $(seq 1 "$ATTEMPTS"); do
  attempt_out="$tmpdir/output-${attempt}.json"
  attempt_err="$tmpdir/stderr-${attempt}.log"
  attempt_check="$tmpdir/check-${attempt}.json"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  set +e
  timeout --kill-after=20s "${TIMEOUT_SECONDS}s" \
    claude \
      -p \
      --output-format json \
      --permission-mode dontAsk \
      --setting-sources user \
      --tools "" \
      --no-session-persistence \
      --max-budget-usd "$MAX_BUDGET_USD" \
      < "$PROMPT_FILE" > "$attempt_out" 2> "$attempt_err"
  status=$?
  set -e

  set +e
  python3 - "$attempt_out" > "$attempt_check" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8") if path.exists() else ""
payload = None
valid_json = False
has_result = False

if text.strip():
    try:
        payload = json.loads(text)
        valid_json = True
    except json.JSONDecodeError:
        payload = None

if isinstance(payload, dict):
    value = payload.get("result", payload.get("message"))
    has_result = isinstance(value, str) and bool(value.strip())

print(
    json.dumps(
        {
            "output_bytes": len(text.encode("utf-8")),
            "valid_json": valid_json,
            "has_result": has_result,
        },
        ensure_ascii=False,
    )
)
sys.exit(0 if valid_json and has_result else 1)
PY
  check_status=$?
  set -e

  output_bytes="$(python3 -c "import json, pathlib; print(json.loads(pathlib.Path('$attempt_check').read_text(encoding='utf-8'))['output_bytes'])")"
  valid_json="$(python3 -c "import json, pathlib; print(str(json.loads(pathlib.Path('$attempt_check').read_text(encoding='utf-8'))['valid_json']).lower())")"
  has_result="$(python3 -c "import json, pathlib; print(str(json.loads(pathlib.Path('$attempt_check').read_text(encoding='utf-8'))['has_result']).lower())")"
  stderr_bytes="$(wc -c < "$attempt_err" | tr -d ' ')"

  {
    echo
    echo "attempt=$attempt"
    echo "started_at=$started_at"
    echo "status=$status"
    echo "valid_json=$valid_json"
    echo "has_result=$has_result"
    echo "output_bytes=$output_bytes"
    echo "stderr_bytes=$stderr_bytes"
  } >> "$META_FILE"

  {
    echo
    echo "===== attempt ${attempt} / ${ATTEMPTS} ====="
    cat "$attempt_err"
  } >> "$STDERR_FILE"

  if [[ "$status" -eq 0 && "$check_status" -eq 0 ]]; then
    cp "$attempt_out" "$OUTPUT_FILE"
    echo >> "$META_FILE"
    echo "final_attempt=$attempt" >> "$META_FILE"
    exit 0
  fi

  last_status="$status"
  if [[ "$attempt" -lt "$ATTEMPTS" ]]; then
    sleep $((attempt * 10))
  fi
done

if [[ -f "$attempt_out" ]]; then
  cp "$attempt_out" "$OUTPUT_FILE"
fi

echo >> "$META_FILE"
echo "final_attempt=$ATTEMPTS" >> "$META_FILE"

if [[ "$last_status" -eq 124 || "$last_status" -eq 137 ]]; then
  echo "Claude CLI timed out after ${TIMEOUT_SECONDS}s across ${ATTEMPTS} attempts" >&2
else
  echo "Claude CLI failed after ${ATTEMPTS} attempts; inspect ${STDERR_FILE} and ${META_FILE}" >&2
fi
exit 1
