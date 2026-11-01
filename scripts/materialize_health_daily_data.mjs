import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compactMonthlyDetails, selectDay, writeHealthJson} from './health_month_storage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const healthRoot = path.resolve(args.target ?? path.join(repoRoot, 'static', 'data', 'health'));

if (!args.year && !args.all) {
  throw new Error('Provide --year <YYYY> or --all');
}
if (args.year && !/^\d{4}$/.test(args.year)) {
  throw new Error(`Invalid year: ${args.year}`);
}

let updated = 0;
let skipped = 0;
const years = args.all
  ? fs.readdirSync(healthRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name)).map((entry) => entry.name)
  : [args.year];
for (const year of years) {
  const yearDir = path.join(healthRoot, year);
  for (const monthEntry of fs.readdirSync(yearDir, {withFileTypes: true})) {
    if (!monthEntry.isFile() || !/^(0[1-9]|1[0-2])\.json$/.test(monthEntry.name)) continue;
    const month = monthEntry.name.slice(0, 2);
    const monthly = JSON.parse(fs.readFileSync(path.join(yearDir, monthEntry.name), 'utf8'));
    const dailyDir = path.join(yearDir, month);
    fs.mkdirSync(dailyDir, {recursive: true});
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    for (let index = 1; index <= lastDay; index += 1) {
      const dayPart = String(index).padStart(2, '0');
      const day = `${year}-${month}-${dayPart}`;
      const collections = compactMonthlyDetails({data: selectDay(monthly.data ?? {}, day)}).data;
      if (!hasRecords(collections)) continue;
      const dailyFile = path.join(dailyDir, `${dayPart}.json`);
      const previous = fs.existsSync(dailyFile) ? JSON.parse(fs.readFileSync(dailyFile, 'utf8')) : {};
      const exportedAt = previous.source?.exportedAt ?? previous.exportedAt ?? monthly.exportedAt ?? null;
      const daily = {
        version: 3,
        date: day,
        source: {format: 'health-auto-export', exportedAt, collections},
        derived: previous.derived ?? {
          date: day,
          summary: previous.summary ?? {},
          timeline: previous.timeline ?? [],
          ...(previous.hrv ? {hrv: previous.hrv} : {}),
          ...(previous.weight ? {weight: previous.weight} : {}),
        },
        sync: previous.sync ?? {state: 'migrated', checkedAt: exportedAt, collections: {}},
      };
      if (writeHealthJson(dailyFile, daily)) updated += 1;
    }
  }
}

console.log(`Materialized canonical data in ${updated} daily health file(s); skipped ${skipped} month(s) without a cache.`);

function hasRecords(collections) {
  return Object.values(collections).some((section) => Object.values(section).some((value) => (
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  )));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      parsed.all = true;
      continue;
    }
    if (arg !== '--year' && arg !== '--target') throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    parsed[arg.slice(2)] = value;
    index += 1;
  }
  return parsed;
}
