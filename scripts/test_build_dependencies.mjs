import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildDependencyFingerprint, prepareBuildDependencies} from './prepare_build_dependencies.mjs';

test('build and test scripts do not reinstall dependencies, but installation inputs do', () => {
  const manifest = {dependencies: {example: '1.0.0'}, scripts: {build: 'build', prepare: 'generate'}};
  const fingerprint = buildDependencyFingerprint(manifest, 'lock');
  assert.equal(buildDependencyFingerprint({...manifest, scripts: {...manifest.scripts, build: 'new build', test: 'test'}}, 'lock'), fingerprint);
  assert.equal(buildDependencyFingerprint({scripts: manifest.scripts, dependencies: manifest.dependencies}, 'lock'), fingerprint);
  assert.notEqual(buildDependencyFingerprint({...manifest, dependencies: {example: '2.0.0'}}, 'lock'), fingerprint);
  assert.notEqual(buildDependencyFingerprint({...manifest, scripts: {...manifest.scripts, prepare: 'new generate'}}, 'lock'), fingerprint);
  assert.notEqual(buildDependencyFingerprint(manifest, 'new lock'), fingerprint);
  assert.notEqual(buildDependencyFingerprint(manifest, 'lock', 'other-node-abi'), fingerprint);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feei-build-dependencies-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const repoRoot = path.join(root, 'repo');
  const cacheRoot = path.join(root, 'cache');
  const modules = path.join(repoRoot, 'node_modules');
  fs.mkdirSync(path.join(modules, '.cache'), {recursive: true});
  fs.writeFileSync(path.join(modules, '.cache', 'compiled'), 'preserved');
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({scripts: {build: 'build'}}));
  fs.writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}');
  let installs = 0;
  const install = () => {
    installs++;
    fs.rmSync(modules, {recursive: true});
    fs.mkdirSync(modules);
    fs.writeFileSync(path.join(modules, '.package-lock.json'), '{}');
  };
  return {repoRoot, cacheRoot, modules, install, installs: () => installs};
}

test('npm ci preserves the build cache and script-only changes reuse installed dependencies', (t) => {
  const state = fixture(t);
  assert.equal(prepareBuildDependencies(state), true);
  assert.equal(fs.readFileSync(path.join(state.modules, '.cache/compiled'), 'utf8'), 'preserved');
  assert.equal(fs.realpathSync(path.join(state.modules, '.cache')), fs.realpathSync(state.cacheRoot));
  fs.writeFileSync(path.join(state.repoRoot, 'package.json'), JSON.stringify({scripts: {build: 'changed build'}}));
  assert.equal(prepareBuildDependencies(state), false);
  fs.writeFileSync(path.join(state.repoRoot, 'package-lock.json'), '{"lockfileVersion":3}');
  assert.equal(prepareBuildDependencies(state), true);
  assert.equal(state.installs(), 2);
  assert.equal(fs.readFileSync(path.join(state.modules, '.cache/compiled'), 'utf8'), 'preserved');
});

test('a failed installation retains the cache and must be retried', (t) => {
  const state = fixture(t);
  const failedInstall = () => {
    fs.rmSync(state.modules, {recursive: true});
    throw new Error('install failed');
  };
  assert.throws(() => prepareBuildDependencies({...state, install: failedInstall}), /install failed/);
  assert.equal(fs.readFileSync(path.join(state.cacheRoot, 'compiled'), 'utf8'), 'preserved');
  assert.equal(fs.existsSync(path.join(state.modules, '.feei-build-dependencies')), false);
  assert.equal(prepareBuildDependencies(state), true);
  assert.equal(prepareBuildDependencies(state), false);
});

test('missing installed dependencies require installation even with an existing fingerprint', (t) => {
  const state = fixture(t);
  prepareBuildDependencies(state);
  fs.rmSync(path.join(state.modules, '.package-lock.json'));
  assert.equal(prepareBuildDependencies(state), true);
  assert.equal(state.installs(), 2);
});

test('the persistent cache cannot be stored inside node_modules', (t) => {
  const state = fixture(t);
  assert.throws(() => prepareBuildDependencies({...state, cacheRoot: path.join(state.modules, '.cache')}), /outside node_modules/);
});

test('an evicted cache is recreated through its existing symlink', (t) => {
  const state = fixture(t);
  prepareBuildDependencies(state);
  fs.rmSync(state.cacheRoot, {recursive: true});
  assert.equal(prepareBuildDependencies(state), false);
  assert.equal(fs.realpathSync(path.join(state.modules, '.cache')), fs.realpathSync(state.cacheRoot));
});
