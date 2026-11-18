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

test('manual recovery clears only Rspack cache under the deployment lock and forces a build', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /reset_rspack_cache:\n\s+description: .+\n\s+type: boolean\n\s+default: false/);
  assert.match(workflow, /RESET_RSPACK_CACHE='\$\{\{ inputs.reset_rspack_cache \|\| false \}\}'/);
  const cleanup = workflow.match(/build_cache="\$site_root\/build-cache"\n\s+if \[ "\$RESET_RSPACK_CACHE" = true \]; then[\s\S]*?\n\s+fi/)[0];
  assert.ok(workflow.indexOf('flock --wait 1200 9') < workflow.indexOf(cleanup));
  const skip = workflow.match(/if \[ "\$pages_changed" = false \].*?; then/)[0];
  for (const reset of ['false', 'true']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-cache-recovery-'));
    try {
      for (const file of ['build-cache/rspack/pack', 'build-cache/mdx/compiled', 'data/record.json', 'releases/current/index.html']) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), 'keep');
      }
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c',
        'site_root="$1"; RESET_RSPACK_CACHE="$2"; pages_changed=false; previous_release=existing;\n'
        + cleanup + '\n' + skip + '\n echo skip; else echo build; fi', 'recovery-test', root, reset], {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(path.join(root, 'build-cache/rspack/pack')), reset === 'false');
      for (const file of ['build-cache/mdx/compiled', 'data/record.json', 'releases/current/index.html']) {
        assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), 'keep');
      }
      assert.equal(result.stdout.trim().split('\n').at(-1), reset === 'true' ? 'build' : 'skip');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  }
});
