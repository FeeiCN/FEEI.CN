import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const healthRoot = path.resolve(args.target ?? process.env.HEALTH_DATA_ROOT ?? path.join(repoRoot, 'static/data/health'));
const remoteUser = process.env.HEALTH_SYNC_REMOTE_USER ?? 'root';
const remoteHost = process.env.HEALTH_SYNC_REMOTE_HOST ?? 'feei.cn';
const remotePort = process.env.HEALTH_SYNC_REMOTE_PORT ?? '10022';
const remoteDir = process.env.HEALTH_SYNC_REMOTE_DIR ?? '/data/wufeifei-assets/data/health';
const remote = `${remoteUser}@${remoteHost}`;
const rsyncShell = `ssh -p ${remotePort}`;

fs.mkdirSync(healthRoot, {recursive: true});

if (!args.pushOnly) pullRemote();
if (args.pullOnly) process.exit(0);

const today = localDate(new Date());
let exportArgs;
if (args.date) {
  exportArgs = ['--date', args.date];
} else if (args.year) {
  exportArgs = ['--year', args.year, '--end-date', args.endDate ?? (args.year === today.slice(0, 4) ? today : `${args.year}-12-31`)];
  if (args.startDate) exportArgs.push('--start-date', args.startDate);
} else {
  const startDate = args.startDate ?? shiftDate(today, -6);
  exportArgs = ['--year', today.slice(0, 4), '--start-date', startDate, '--end-date', args.endDate ?? today];
}

run(process.execPath, [path.join(repoRoot, 'scripts/export_health_year_from_mcp.mjs'), ...exportArgs, '--target', healthRoot]);
run(process.execPath, [path.join(repoRoot, 'scripts/build_health_sync_status.mjs'), healthRoot]);
pushRemote();

function pullRemote() {
  console.log(`Pulling health data from ${remote}:${remoteDir}/`);
  run('rsync', [
    '-az', '--partial', '--update', '--human-readable', '--itemize-changes',
    '--exclude', 'example/', '-e', rsyncShell,
    `${remote}:${remoteDir}/`, `${healthRoot}/`,
  ]);
}

function pushRemote() {
  console.log(`Uploading health data to ${remote}:${remoteDir}/`);
  const dailyIndexes = countDailyIndexes(healthRoot);
  if (dailyIndexes === 0) throw new Error(`Refusing to upload an empty health data root: ${healthRoot}`);
  if (!args.dryRun) run('ssh', ['-p', remotePort, remote, `mkdir -p '${remoteDir}'`]);
  const commandArgs = [
    '-az', '--partial', '--delay-updates', '--human-readable', '--itemize-changes',
    '--no-owner', '--no-group', '--exclude', 'example/', '-e', rsyncShell,
  ];
  if (!args.pushOnly) commandArgs.push('--delete-delay');
  if (args.dryRun) commandArgs.push('--dry-run');
  commandArgs.push(`${healthRoot}/`, `${remote}:${remoteDir}/`);
  run('rsync', commandArgs);
}

function countDailyIndexes(root) {
  let count = 0;
  for (const year of fs.readdirSync(root, {withFileTypes: true})) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    const yearDirectory = path.join(root, year.name);
    for (const month of fs.readdirSync(yearDirectory, {withFileTypes: true})) {
      if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
      count += fs.readdirSync(path.join(yearDirectory, month.name))
        .filter((name) => /^\d{2}\.json$/.test(name)).length;
    }
  }
  return count;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
}

function localDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function shiftDate(value, offset) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--pull-only', '--push-only', '--dry-run'].includes(arg)) {
      parsed[toCamelCase(arg.slice(2))] = true;
      continue;
    }
    if (['--date', '--year', '--start-date', '--end-date', '--target'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      parsed[toCamelCase(arg.slice(2))] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.pullOnly && parsed.pushOnly) throw new Error('--pull-only and --push-only cannot be combined');
  for (const key of ['date', 'startDate', 'endDate']) {
    if (parsed[key] && !/^\d{4}-\d{2}-\d{2}$/.test(parsed[key])) throw new Error(`Invalid ${key}: ${parsed[key]}`);
  }
  if (parsed.year && !/^\d{4}$/.test(parsed.year)) throw new Error(`Invalid year: ${parsed.year}`);
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
