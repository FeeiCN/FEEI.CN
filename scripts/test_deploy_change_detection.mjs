import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
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

test('page deployments never rebuild search; nightly workflow targets the locked published release', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
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

test('only verified main checks trigger SCP deployment, outside the server publish lock', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const deployment = yaml.load(fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  const check = yaml.load(fs.readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
  assert.equal(deployment.on.push, undefined);
  assert.deepEqual(deployment.on.workflow_run.workflows, ['网站严格检查']);
  assert.equal(deployment.concurrency, undefined);
  assert.equal(check.concurrency['cancel-in-progress'], true);
  assert.deepEqual(check.on.workflow_run.workflows, ['日记议题归档', 'Codex 议题驱动', '议题内容抓取与行车记录', '安全工程内容同步']);
  const steps = deployment.jobs.deploy.steps;
  const download = steps.find((step) => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with['artifact-ids'], '${{ needs.prepare.outputs.artifact_id }}');
  assert.ok(steps.findIndex((step) => step.name === 'Verify commit, source attempt, digest and archive paths')
    < steps.findIndex((step) => step.name === 'Setup SSH'));
  const upload = steps.find((step) => step.name === 'Upload with SCP and publish on server').run;
  assert.match(upload, /scp .* -P "\$SERVER_PORT"/);
  const publish = fs.readFileSync(new URL('./publish_site_artifact.sh', import.meta.url), 'utf8');
  assert.ok(publish.indexOf(' extract --folder') < publish.indexOf('flock --wait'));
  assert.doesNotMatch(publish, /npm ci|npm run build|npm run typecheck|curl|wget|gh run download/);
  assert.match(publish, /Superseded artifact/);
  assert.match(publish, /already published/);
});
