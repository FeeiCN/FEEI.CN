import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const commandEnv = {
  ...process.env,
  PATH: [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
  ].join(':'),
};
const args = parseArgs(process.argv.slice(2));
const exportArgs = args.date ? ['--', '--year', targetYear(), '--end-date', args.date] : [];
const commitMessage = args.message ?? `[auto] 更新健康数据 ${formatLocalDateTime(new Date())}`;
const remote = args.remote ?? 'origin';
const branch = args.branch ?? currentBranch();
const healthFile = path.join('static', 'health', `health_data_${targetYear()}.json`);
const statusFile = path.join('docs', '05-吴飞飞', '01-关于', '关于FEEI.CN', 'FEEI.CN状态.md');

ensureNoStagedChanges();

run('git', ['pull', '--rebase', '--autostash']);
run('npm', ['run', 'export-health-year', ...exportArgs]);

const healthFilePath = path.join(repoRoot, healthFile);
if (!fs.existsSync(healthFilePath)) {
  throw new Error(`Health data file does not exist: ${healthFilePath}`);
}

updateStatusPage();

const changedFiles = [healthFile, statusFile].filter((file) => !isPathClean(file));
if (changedFiles.length === 0) {
  console.log(`No changes to commit: ${healthFile}, ${statusFile}`);
  process.exit(0);
}

run('git', ['add', ...changedFiles]);
run('git', ['commit', '-m', commitMessage]);
run('git', ['push', remote, branch]);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: commandEnv,
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

function ensureNoStagedChanges() {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: commandEnv,
  });

  if (result.status !== 0) {
    throw new Error('There are staged changes. Commit or unstage them before syncing health data.');
  }
}

function isPathClean(file) {
  const result = spawnSync('git', ['status', '--short', '--', file], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: commandEnv,
    stdio: 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git status --short -- ${file} failed with exit code ${result.status}`);
  }

  return result.stdout.trim() === '';
}

function updateStatusPage() {
  run('python3', [
    'scripts/status_page.py',
    '--key',
    'health-data',
    '--name',
    '健康数据',
    '--script',
    'scripts/sync_health_data.mjs',
    '--status',
    '成功',
    '--output',
    '健康数据=/health-data',
  ]);
}

function currentBranch() {
  const result = run('git', ['branch', '--show-current'], {capture: true});
  const branchName = result.stdout.trim();

  if (!branchName) {
    throw new Error('Unable to determine current branch.');
  }

  return branchName;
}

function targetYear() {
  return (args.date ?? formatLocalDate(new Date())).slice(0, 4);
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatLocalDateTime(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(' ', ' ');
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--date' || arg === '--message' || arg === '--remote' || arg === '--branch') {
      const value = argv[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }

      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    throw new Error(`Invalid date: ${parsed.date}`);
  }

  return parsed;
}
