import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildHealthChartHistory} from './build_health_chart_history.mjs';
import {buildMonthlyHealthFromDailyFiles, writeMonthlyHealth} from './health_month_storage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const healthRoot = path.resolve(process.argv[2] ?? process.env.HEALTH_DATA_ROOT ?? path.join(repoRoot, 'static', 'data', 'health'));
let updated = 0;
let verified = 0;

for (const year of fs.readdirSync(healthRoot, {withFileTypes: true})) {
  if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
  const yearDir = path.join(healthRoot, year.name);
  for (const month of fs.readdirSync(yearDir, {withFileTypes: true})) {
    if (!month.isDirectory() || !/^(0[1-9]|1[0-2])$/.test(month.name)) continue;
    const key = `${year.name}-${month.name}`;
    const output = path.join(yearDir, `${month.name}.json`);
    if (writeMonthlyHealth(output, buildMonthlyHealthFromDailyFiles(healthRoot, key))) updated += 1;
    else verified += 1;
  }
}

await buildHealthChartHistory({healthRoot});
console.log(`Rebuilt ${updated} monthly health caches; verified ${verified}.`);
