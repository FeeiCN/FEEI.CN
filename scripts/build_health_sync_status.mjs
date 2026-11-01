import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeHealthJson} from './health_month_storage.mjs';
import {validateHealthDailyV5} from './health_daily_v5.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const healthRoot = path.resolve(process.argv[2] ?? process.env.HEALTH_DATA_ROOT ?? path.join(repoRoot, 'static', 'data', 'health'));
const days = [];

for (const year of fs.readdirSync(healthRoot, {withFileTypes: true})) {
  if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
  const yearDir = path.join(healthRoot, year.name);
  for (const month of fs.readdirSync(yearDir, {withFileTypes: true})) {
    if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
    for (const file of fs.readdirSync(path.join(yearDir, month.name), {withFileTypes: true})) {
      if (!file.isFile() || !/^\d{2}\.json$/.test(file.name)) continue;
      const payload = JSON.parse(fs.readFileSync(path.join(yearDir, month.name, file.name), 'utf8'));
      const issues = [];
      issues.push(...validateHealthDailyV5(payload, `${year.name}-${month.name}-${file.name.slice(0, 2)}`, healthRoot));
      if (payload.sleep?.totalMinutes > 0 && !Array.isArray(payload.sleep?.stages)) issues.push('sleep summary has no stages');
      if (payload.heart?.hrv?.dailyMs > 0 && !Array.isArray(payload.heart?.hrv?.measurements)) issues.push('HRV summary has no measurements');
      if (payload.activity?.steps >= 3000 && !Array.isArray(payload.activity?.movementPeriods)) issues.push('steps have no movement periods');
      days.push({
        date: `${year.name}-${month.name}-${file.name.slice(0, 2)}`,
        state: issues.length ? 'incomplete' : 'complete',
        exportedAt: payload.exportedAt ?? null,
        issues,
      });
    }
  }
}

days.sort((left, right) => left.date.localeCompare(right.date));
const latest = days.at(-1) ?? null;
const payload = {
  version: 1,
  canonicalFrom: '2026-01-01',
  latestDate: latest?.date ?? null,
  latestSourceAt: [...days].map((day) => day.exportedAt).filter(Boolean).sort().at(-1) ?? null,
  incompleteDates: days.filter((day) => day.state === 'incomplete').map((day) => day.date),
  qualityIssues: days.filter((day) => day.issues.length).map((day) => ({date: day.date, issues: day.issues})),
};
const output = path.join(healthRoot, 'sync-status.json');
const changed = writeHealthJson(output, payload);
console.log(`${changed ? 'Updated' : 'Verified'} health sync status: ${path.relative(repoRoot, output)}`);
