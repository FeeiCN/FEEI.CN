import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dependencyFields = [
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'bundledDependencies', 'bundleDependencies', 'overrides', 'workspaces', 'engines', 'os', 'cpu', 'libc', 'packageManager',
];
const installScripts = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'dependencies'];

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

export function buildDependencyFingerprint(manifest, lockfile, runtime = `${process.platform}-${process.arch}-${process.versions.modules}`) {
  const dependencies = Object.fromEntries(dependencyFields.map((key) => [key, manifest[key]]));
  const scripts = Object.fromEntries(installScripts.map((key) => [key, manifest.scripts?.[key]]));
  return crypto.createHash('sha256').update(JSON.stringify(sorted({version: 1, dependencies, scripts, runtime})))
    .update('\0').update(lockfile).digest('hex');
}

function linkBuildCache(repoRoot, cacheRoot) {
  const localCache = path.join(repoRoot, 'node_modules/.cache');
  fs.mkdirSync(path.dirname(localCache), {recursive: true});
  let existing;
  try {
    existing = fs.lstatSync(localCache);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing?.isSymbolicLink()) {
    if (path.resolve(path.dirname(localCache), fs.readlinkSync(localCache)) === cacheRoot) {
      fs.mkdirSync(cacheRoot, {recursive: true});
      return;
    }
    throw new Error(`Build cache already points elsewhere: ${localCache}`);
  }
  if (existing) {
    if (!fs.existsSync(cacheRoot)) {
      fs.mkdirSync(path.dirname(cacheRoot), {recursive: true});
      fs.renameSync(localCache, cacheRoot);
    } else {
      fs.cpSync(localCache, cacheRoot, {recursive: true});
      fs.rmSync(localCache, {recursive: true});
    }
  }
  fs.mkdirSync(cacheRoot, {recursive: true});
  fs.symlinkSync(cacheRoot, localCache, 'dir');
}

export function prepareBuildDependencies({repoRoot, cacheRoot, install = () => execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {cwd: repoRoot, stdio: 'inherit'})}) {
  repoRoot = path.resolve(repoRoot);
  cacheRoot = path.resolve(cacheRoot);
  const modules = path.join(repoRoot, 'node_modules');
  if (cacheRoot === modules || cacheRoot.startsWith(modules + path.sep)) {
    throw new Error('Persistent build cache must be outside node_modules');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const lockfile = fs.readFileSync(path.join(repoRoot, 'package-lock.json'));
  const fingerprint = buildDependencyFingerprint(manifest, lockfile);
  const stamp = path.join(modules, '.feei-build-dependencies');
  const installed = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
  linkBuildCache(repoRoot, cacheRoot);
  if (installed === fingerprint && fs.existsSync(path.join(modules, '.package-lock.json'))) {
    console.log('Dependencies unchanged. Skipping npm ci.');
    return false;
  }
  fs.rmSync(stamp, {force: true});
  try {
    install();
  } finally {
    linkBuildCache(repoRoot, cacheRoot);
  }
  fs.writeFileSync(stamp, fingerprint + '\n');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cacheRoot = process.argv[2];
  if (!cacheRoot) throw new Error('Usage: node scripts/prepare_build_dependencies.mjs <persistent-cache-directory>');
  prepareBuildDependencies({repoRoot: process.cwd(), cacheRoot});
}
