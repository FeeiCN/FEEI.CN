import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compactMonthlyDetails, selectDay, writeHealthJson} from './health_month_storage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const healthRoot = path.resolve(args.target ?? path.join(repoRoot, 'static', 'data', 'health'));

if (!args.year) {
  throw new Error('--year is required');
}
if (!/^\d{4}$/.test(args.year)) {
  throw new Error(`Invalid year: ${args.year}`);
}

let updated = 0;
let skipped = 0;
const yearDir = path.join(healthRoot, args.year);
for (const entry of fs.readdirSync(yearDir, {withFileTypes: true})) {
  if (!entry.isDirectory() || !/^\d{2}$/.test(entry.name)) continue;
  const monthFile = path.join(yearDir, `${entry.name}.json`);
  if (!fs.existsSync(monthFile)) {
    skipped += 1;
    continue;
  }
  const monthly = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
  const dailyDir = path.join(yearDir, entry.name);
  for (const dayEntry of fs.readdirSync(dailyDir, {withFileTypes: true})) {
    if (!dayEntry.isFile() || !/^\d{2}\.json$/.test(dayEntry.name)) continue;
    const dailyFile = path.join(dailyDir, dayEntry.name);
    const daily = JSON.parse(fs.readFileSync(dailyFile, 'utf8'));
    const day = `${args.year}-${entry.name}-${dayEntry.name.slice(0, 2)}`;
    daily.data = compactMonthlyDetails({data: selectDay(monthly.data ?? {}, day)}).data;
    if (writeHealthJson(dailyFile, daily)) updated += 1;
  }
}

console.log(`Materialized canonical data in ${updated} daily health file(s); skipped ${skipped} month(s) without a cache.`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--year' && arg !== '--target') throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    parsed[arg.slice(2)] = value;
    index += 1;
  }
  return parsed;
}
