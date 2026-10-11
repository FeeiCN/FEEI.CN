import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMedicationCollection} from './health_collection_transform.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const healthRoot = path.join(repoRoot, 'static', 'data', 'health');
const args = parseArgs(process.argv.slice(2));
let updated = 0;
let missing = 0;
let verified = 0;

for (const year of fs.readdirSync(healthRoot).filter((entry) => /^\d{4}$/.test(entry))) {
  if (args.year && year !== args.year) continue;
  const yearDir = path.join(healthRoot, year);
  for (const file of fs.readdirSync(yearDir).filter((entry) => /^\d{2}\.json$/.test(entry))) {
    const month = file.slice(0, 2);
    const monthly = JSON.parse(fs.readFileSync(path.join(yearDir, file), 'utf8'));
    const records = monthly.data?.medications?.medications ?? [];
    const byDate = new Map();
    records.forEach((record) => {
      const date = medicationDate(record);
      byDate.set(date, [...(byDate.get(date) ?? []), record]);
    });

    for (const [date, dayRecords] of byDate) {
      if (!date || !date.startsWith(`${year}-${month}-`)) continue;
      const dailyFile = path.join(yearDir, month, `${date.slice(-2)}.json`);
      if (!fs.existsSync(dailyFile)) {
        missing += 1;
        continue;
      }

      const daily = JSON.parse(fs.readFileSync(dailyFile, 'utf8'));
      const built = buildMedicationCollection(dayRecords, {normalizeDateTime});
      const replacements = [...built.timeline];
      const timeline = (daily.timeline ?? [])
        .map((item) => item.type === 'medication' ? replacements.shift() ?? null : item)
        .filter(Boolean);
      timeline.push(...replacements);

      daily.summary ??= {};
      daily.summary.rawRecords ??= {};
      daily.summary.rawRecords.medications = dayRecords.length;
      daily.summary.medications = built.summary;
      daily.timeline = timeline;

      verifyMedicationCollection(daily, built, date);

      if (!args.dryRun) fs.writeFileSync(dailyFile, `${JSON.stringify(daily)}\n`);
      updated += 1;
      verified += 1;
    }
  }
}

console.log(`${args.dryRun ? 'Would update' : 'Updated'} ${updated} daily health files; verified ${verified}; ${missing} source dates had no daily file.`);

function verifyMedicationCollection(daily, expected, date) {
  const actualTimeline = (daily.timeline ?? []).filter((item) => item.type === 'medication');
  if (JSON.stringify(actualTimeline) !== JSON.stringify(expected.timeline)) {
    throw new Error(`${date}: daily medication timeline does not match monthly source`);
  }
  if (JSON.stringify(daily.summary?.medications) !== JSON.stringify(expected.summary)) {
    throw new Error(`${date}: daily medication summary does not match monthly source`);
  }
  if (actualTimeline.some((item) => !item.name || !item.status || !item.scheduledDate)) {
    throw new Error(`${date}: daily medication record is missing name, status, or scheduledDate`);
  }
}

function medicationDate(record) {
  const value = record?.scheduledDate ?? record?.start ?? record?.end;
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function normalizeDateTime(value) {
  if (typeof value !== 'string') return undefined;
  return value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/, '$1 $2 +0000');
}

function parseArgs(argv) {
  const parsed = {dryRun: false, year: ''};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') {
      parsed.dryRun = true;
    } else if (argv[index] === '--year' && /^\d{4}$/.test(argv[index + 1] ?? '')) {
      parsed.year = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or invalid argument: ${argv[index]}`);
    }
  }
  return parsed;
}
