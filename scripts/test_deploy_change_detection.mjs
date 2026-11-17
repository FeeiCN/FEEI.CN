import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('interrupted builds reset only generated Rspack state before one retry', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const loop = workflow.slice(workflow.indexOf('          build_ok=false'), workflow.indexOf('          build_resource_snapshot after'));
  for (const failure of [124, 137, 143, 1]) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'feei-build-recovery-'));
    try {
      fs.mkdirSync(path.join(folder, 'cache/rspack'), {recursive: true});
      fs.writeFileSync(path.join(folder, 'cache/other-data'), 'preserve');
      const result = spawnSync('bash', ['-e'], {cwd: folder, encoding: 'utf8', input: `
        build_cache="$PWD/cache"
        staging_dir="$PWD/staging"
        calls=0
        run_build() { calls=$((calls + 1)); if [ "$calls" = 1 ]; then return ${failure}; fi; }
        ${loop}
        echo "result=$build_ok calls=$calls"
      `});
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, failure === 1 ? /result=false calls=1/ : /result=true calls=2/);
      assert.equal(fs.existsSync(path.join(folder, 'cache/rspack')), failure === 1);
      assert.equal(fs.readFileSync(path.join(folder, 'cache/other-data'), 'utf8'), 'preserve');
    } finally {
      fs.rmSync(folder, {recursive: true, force: true});
    }
  }
});
