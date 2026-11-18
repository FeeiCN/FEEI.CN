import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
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

test('Actions checks avoid building or transferring pages; server owns the strict build', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const check = yaml.load(fs.readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
  const deploy = yaml.load(fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  const checks = check.jobs.check.steps.map((step) => step.run || '').join('\n');
  assert.doesNotMatch(checks, /npm run build|docusaurus build|site_artifact/);
  assert.match(checks, /npm run check:docs/);
  assert.match(checks, /npm run typecheck/);
  assert.deepEqual(deploy.on.workflow_run.workflows, ['网站严格检查']);
  assert.equal(deploy.on.push, undefined);
  const publishing = deploy.jobs.deploy.steps.map((step) => step.run || '').join('\n');
  assert.doesNotMatch(publishing, /scp |download-artifact|site_artifact/);
  assert.match(publishing, /env CI_STRICT=true .*npm run build -- --out-dir/);
  assert.ok(publishing.indexOf('run_build') < publishing.indexOf('group_start "Publish release"'));
  assert.match(publishing, /mv -Tf "\$next_current_link" "\$current_link"/);
});

test('page deployments never rebuild search; nightly workflow targets the locked published release', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/deployment_scope.mjs/);
  const deploy = yaml.load(workflow).jobs.deploy.steps.map((step) => step.run || '').join('\n');
  assert.doesNotMatch(deploy, /build_search_index\.mjs|nohup|index_ready|search_changed/);
  const nightly = yaml.load(fs.readFileSync(new URL('../.github/workflows/search-index.yml', import.meta.url), 'utf8'));
  assert.deepEqual(nightly.on.schedule, [{cron: '0 19 * * *'}]);
  assert.equal(nightly.on.push, undefined);
  assert.equal(nightly.on.workflow_run, undefined);
  const run = nightly.jobs.index.steps.find((step) => step.name === 'Rebuild search index for the published release').run;
  assert.ok(run.indexOf('flock --wait 600 9') >= 0);
  assert.ok(run.indexOf('flock --wait 600 9') < run.indexOf('readlink -f'));
  assert.match(run, /readlink -f "\$SITE_ROOT\/current"/);
  assert.match(run, /timeout .* node scripts\/build_search_index\.mjs "\$release_dir"/);
  assert.doesNotMatch(run, /git pull|npm ci|npm run build|nohup/);
});

test('new page releases inherit the last nightly index and its status without regeneration', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const inheritance = workflow.match(/          if \[ -n "\$previous_release" \] && \[ -s "\$previous_release\/search-index.json" \]; then[\s\S]*?\n          fi/)[0];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-nightly-search-'));
  try {
    const previous = path.join(root, 'previous');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(path.join(previous, 'search-index-assets'), {recursive: true});
    fs.mkdirSync(staging);
    const files = ['search-index.json', 'search-index-manifest.json', 'search-index-status.json', 'search-index-assets/shard.json.gz'];
    for (const file of files) fs.writeFileSync(path.join(previous, file), `last-night:${file}`);
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', 'previous_release="$1"; staging_dir="$2";\n' + inheritance,
      'inheritance-test', previous, staging], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    for (const file of files) assert.equal(fs.readFileSync(path.join(staging, file), 'utf8'), `last-night:${file}`);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
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
