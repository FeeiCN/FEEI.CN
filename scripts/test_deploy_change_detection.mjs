import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const start = workflow.indexOf('          data_only=false\n');
const end = workflow.indexOf('          if [ "$data_only" = true ]; then', start);
assert.ok(start >= 0 && end > start, 'Deployment change detection must exist');
const detection = workflow.slice(start, end);

function detectsDataOnly(files, baselineAvailable = true) {
  const result = spawnSync('bash', ['-c', `
set -euo pipefail
git() {
  case "$1" in
    cat-file) [ "$DEPLOY_TEST_BASELINE" = available ] ;;
    diff) cat ;;
    *) return 2 ;;
  esac
}
deployed_head=baseline
new_head=candidate
${detection}
printf '%s' "$data_only"
`], {
    input: files.join('\n'),
    encoding: 'utf8',
    env: {...process.env, DEPLOY_TEST_BASELINE: baselineAvailable ? 'available' : 'missing'},
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === 'true';
}

test('only changes under static/data skip the website build', () => {
  assert.equal(detectsDataOnly(['static/data/health/day.json', 'static/data/reading/year.json']), true);
  assert.equal(detectsDataOnly(['docs/annual-review.md']), false);
  assert.equal(detectsDataOnly(['static/data/day.json', 'src/theme/TOC/index.tsx']), false);
  assert.equal(detectsDataOnly(['static/data-backup/day.json']), false);
});

test('empty changes and an unavailable deployed baseline require a build', () => {
  assert.equal(detectsDataOnly([]), false);
  assert.equal(detectsDataOnly(['static/data/day.json'], false), false);
});

test('large mixed changes still build when a non-data path appears first or last', () => {
  const dataFiles = Array.from({length: 50000}, (_, index) => `static/data/records/${index}.json`);
  assert.equal(detectsDataOnly(['docs/annual-review.md', ...dataFiles]), false);
  assert.equal(detectsDataOnly([...dataFiles, 'src/theme/TOC/index.tsx']), false);
  assert.equal(detectsDataOnly(dataFiles), true);
});
