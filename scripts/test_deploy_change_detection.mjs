import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import {deploymentScope} from './deployment_scope.mjs';

test('data and workflow changes do not rebuild pages', () => {
  assert.deepEqual(deploymentScope(['static/data/health/day.json', '.github/workflows/macnimi-data-sync.yml', 'scripts/sync_health_data.mjs']), {pages: false, search: false, data: true});
  assert.deepEqual(deploymentScope([]), {pages: false, search: false, data: false});
});

test('index generation changes rebuild only search; client loaders rebuild pages', () => {
  for (const file of ['scripts/build_search_index.mjs', 'scripts/search_index_storage.mjs', 'config/search-zh-dict.txt']) {
    assert.deepEqual(deploymentScope([file]), {pages: false, search: true, data: false});
  }
  for (const file of ['docs/测试.md', 'src/theme/TOC/index.tsx', 'static/data-backup/day.json', 'scripts/search_worker_loader.cjs', 'plugins/fastSearchPlugin.ts', 'package-lock.json']) {
    assert.equal(deploymentScope([file]).pages, true, file);
  }
});

test('missing deployed baseline conservatively rebuilds', () => {
  const result = spawnSync(process.execPath, ['scripts/deployment_scope.mjs', 'missing-ref', 'HEAD'], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).pages, true);
});

test('workflow uses scope classifier and retries failed or missing indexes', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/deployment_scope.mjs/);
  assert.match(workflow, /\[ "\$index_ready" != true \]/);
});
