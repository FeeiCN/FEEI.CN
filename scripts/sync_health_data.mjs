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
const commitMessage = args.message ?? `[auto] 更新健康数据 ${formatLocalDateTime(new Date())}`;
const remote = args.remote ?? 'origin';
const branch = args.branch ?? currentBranch();
const healthDir = path.join('static', 'data', 'health');

ensureNoStagedChanges();
runWithRetry('git', ['pull', '--rebase', '--autostash']);

// Determine which month(s) to export
const monthsToExport = args.date ? [args.date.slice(0, 7)] : [currentMonth()];
const changedFiles = [];

for (const month of monthsToExport) {
  const [y, m] = month.split('-');
  const targetFile = path.join(y, `${m}.json`);

  run('npm', ['run', 'export-health-year', '--', '--year', y, '--month', month, '--skip-daily']);

  if (!fs.existsSync(path.join(repoRoot, healthDir, targetFile))) {
    throw new Error(`Health data file does not exist: ${targetFile}`);
  }

  if (!isPathClean(path.join(healthDir, targetFile))) {
    changedFiles.push(path.join(healthDir, targetFile));
  }

  const targetDailyDir = path.join(y, m);
  if (!isPathClean(path.join(healthDir, targetDailyDir))) {
    changedFiles.push(path.join(healthDir, targetDailyDir));
  }
}

if (!args.date) {
  const missingDates = findMissingDailyHealthDates();
  console.log(`Found ${missingDates.length} missing daily health date(s).`);

  for (const missingDate of missingDates) {
    const [year, month, day] = missingDate.split('-');
    const dailyFile = path.join(healthDir, year, month, `${day}.json`);

    run('npm', ['run', 'export-health-year', '--', '--date', missingDate]);

    if (!fs.existsSync(path.join(repoRoot, dailyFile))) {
      throw new Error(`Daily health data file does not exist: ${dailyFile}`);
    }

    if (!isPathClean(dailyFile)) {
      changedFiles.push(dailyFile);
    }
  }
}

const historyFile = path.join(healthDir, 'history.json');
if (fs.existsSync(path.join(repoRoot, historyFile)) && !isPathClean(historyFile)) {
  changedFiles.push(historyFile);
}

if (changedFiles.length === 0) {
  console.log('No changes to commit.');
  process.exit(0);
}

run('git', ['add', ...changedFiles]);
run('git', ['commit', '-m', commitMessage]);
pushHealthData();

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

function runWithRetry(command, commandArgs, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(command, commandArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: commandEnv,
      stdio: 'pipe',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return result;
    }

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (!isTransientGitError(output) || attempt === maxAttempts) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
    }

    process.stderr.write(
      `${command} ${commandArgs.join(' ')} network failure; retrying (${attempt + 1}/${maxAttempts})...\n`,
    );
    sleep(attempt * 2000);
  }
}

function isTransientGitError(output) {
  const normalized = output.toLowerCase();
  return [
    "couldn't connect to server",
    'connection reset',
    'connection timed out',
    'error in the http2 framing layer',
    'failed to connect',
    'operation timed out',
    'recv failure',
    'remote end hung up unexpectedly',
    'tls connection was non-properly terminated',
  ].some((marker) => normalized.includes(marker));
}

function pushHealthData() {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync('git', ['push', remote, branch], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: commandEnv,
      stdio: 'pipe',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      return;
    }

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (!isPushRejected(output) || attempt === maxAttempts) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      throw new Error(`git push ${remote} ${branch} failed with exit code ${result.status}`);
    }

    process.stderr.write(
      `git push was rejected by a newer remote commit; retrying (${attempt + 1}/${maxAttempts})...\n`,
    );
    runWithRetry('git', ['fetch', remote]);
    run('git', ['reset', '--soft', `${remote}/${branch}`]);

    const commitResult = spawnSync('git', ['commit', '-m', commitMessage], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: commandEnv,
      stdio: 'pipe',
    });

    if (commitResult.error) {
      throw commitResult.error;
    }

    if (commitResult.status !== 0) {
      const commitOutput = `${commitResult.stdout ?? ''}\n${commitResult.stderr ?? ''}`;
      if (commitOutput.toLowerCase().includes('nothing to commit')) {
        return;
      }
      process.stdout.write(commitResult.stdout ?? '');
      process.stderr.write(commitResult.stderr ?? '');
      throw new Error(`git commit -m ${commitMessage} failed with exit code ${commitResult.status}`);
    }
  }
}

function isPushRejected(output) {
  const normalized = output.toLowerCase();
  return normalized.includes('fetch first') || normalized.includes('non-fast-forward');
}

function sleep(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
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

function currentBranch() {
  const result = run('git', ['branch', '--show-current'], {capture: true});
  const branchName = result.stdout.trim();

  if (!branchName) {
    throw new Error('Unable to determine current branch.');
  }

  return branchName;
}

function currentMonth() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function findMissingDailyHealthDates() {
  const dailyRoot = path.join(repoRoot, healthDir);
  const existingDates = new Set();

  for (const yearEntry of fs.readdirSync(dailyRoot, {withFileTypes: true})) {
    if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) continue;
    const yearDir = path.join(dailyRoot, yearEntry.name);
    for (const monthEntry of fs.readdirSync(yearDir, {withFileTypes: true})) {
      if (!monthEntry.isDirectory() || !/^\d{2}$/.test(monthEntry.name)) continue;
      const monthDir = path.join(yearDir, monthEntry.name);
      for (const fileEntry of fs.readdirSync(monthDir, {withFileTypes: true})) {
        if (fileEntry.isFile() && /^\d{2}\.json$/.test(fileEntry.name)) {
          existingDates.add(`${yearEntry.name}-${monthEntry.name}-${fileEntry.name.slice(0, 2)}`);
        }
      }
    }
  }

  const firstDate = [...existingDates].sort()[0];
  if (!firstDate) {
    throw new Error('No existing daily health data found; refusing an unbounded backfill.');
  }

  const today = formatLocalDate(new Date());
  const missing = [];
  for (let cursor = new Date(`${firstDate}T12:00:00Z`); ; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > today) break;
    if (!existingDates.has(date)) missing.push(date);
  }
  return missing;
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
