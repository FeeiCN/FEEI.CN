import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const exportArgs = args.date ? ['--', '--year', targetYear(), '--end-date', args.date] : [];
const commitMessage = args.message ?? '更新健康数据';
const remote = args.remote ?? 'origin';
const branch = args.branch ?? currentBranch();
const healthFile = path.join('static', 'health', `health_data_${targetYear()}.json`);

ensureNoStagedChanges();

run('git', ['pull', '--rebase', '--autostash']);
run('npm', ['run', 'export-health-year', ...exportArgs]);

if (!fs.existsSync(healthFile)) {
  throw new Error(`Health data file does not exist: ${healthFile}`);
}

if (isPathClean(healthFile)) {
  console.log(`No health data changes to commit: ${healthFile}`);
  process.exit(0);
}

run('git', ['add', healthFile]);
run('git', ['commit', '-m', commitMessage]);
run('git', ['push', remote, branch]);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
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
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error('There are staged changes. Commit or unstage them before syncing health data.');
  }
}

function isPathClean(file) {
  const result = spawnSync('git', ['diff', '--quiet', '--', file], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  return result.status === 0;
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
